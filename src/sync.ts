/**
 * Snap a draft's accents onto the words the voice actually says.
 *
 * Every `t` a writer authors is a GUESS, and it has to be: the draft is
 * written before the audio exists, so nothing in it can know that "eleven
 * thousand eight hundred twenty nine" lands at 78% of its sentence rather
 * than at the 50% the writer wrote. Measured on out/voice-371e3032.srt (203
 * words, each with a real timestamp) the authored `t` values missed their own
 * words by a median of 1.93s, worst 6.17s — the picture emphasising one
 * number while the voice says another.
 *
 * This module is the correction, and it runs AFTER tts.ts because it needs
 * measured audio:
 *
 *   1. accents — each accent is matched to one spoken word and its `t` is
 *      recomputed so the accent has FINISHED landing as that word begins
 *      (`ACCENT_LAND_MS` before the word's measured start).
 *   2. the line — `arriveMs` per beat: the measured moment that beat's
 *      anchored number is spoken, so `revealExtentAt` can ease the line to
 *      its target by then instead of at a fixed 0.68 of the beat. The voice
 *      said "11,185" at 38.0s while the line got there at 43.0s; that gap is
 *      the user's original complaint ("you tell 6000 rebound but the graph
 *      still the same").
 *
 * Everything here is PURE — a draft in, a new draft out, nothing mutated, no
 * I/O. `scripts/sync.ts` is the thin file-reading shell around it, and is
 * also where the authored/derived file convention is written down.
 */
import { ACCENT_LAND_MS, MIN_ACCENT_GAP, accentSpan, type Accent, type AccentKind } from './accent';
import type { Draft } from './verify';

/** One word of the measured narration. `parseSrt` produces these. */
export type Word = { text: string; startMs: number; endMs: number };

/** The measured span of one beat — `timeline-<id>.json`'s beats, narrowed. */
export type BeatSpan = { startMs: number; endMs: number };

/**
 * What the snap needs from the brief: surnames to match on, and each entity's
 * series so a beat's anchored STEP can be turned into the NUMBER the voice
 * says for it. Every field is optional — a snap with no facts still matches
 * the digit-bearing accents, which are most of them.
 */
export type SyncFacts = {
  entities?: { id: string; first?: string; last?: string; series?: { step: string | number; value: number }[] }[];
  /** `value` is here for the same reason `series` is above: a `span` anchored
   *  at the record line has no text of its own, and its match target is the
   *  DIFFERENCE between the two anchors' values. Without the record's own
   *  number that subtraction cannot be done. */
  record?: { holder?: string; value?: number } | null;
  /**
   * The named reference lines, keyed exactly as `Anchor.threshold` names them
   * — and here for the same reason `record.value` is: a span between the
   * payroll's own top and the tax line has no text of its own, so the only way
   * to know which word it should land on is to do the same subtraction the
   * chart does. `scripts/sync.ts` builds this from `brief.facts.budget`,
   * including the derived `payroll` entry.
   */
  thresholds?: Record<string, number> | null;
};

/** Which of the five matching rules placed this accent. `none` kept the
 *  authored `t`: no word was found, and a position is never invented. */
export type SnapRule = 'digits' | 'record' | 'entity' | 'step' | 'none';

/**
 * The old beat-relative landing span, kept ONLY so the report can quantify
 * what it cost. Nothing in the render path reads it — see ACCENT_LAND_MS.
 */
export const LEGACY_BEAT_SPAN = 0.22;

export type AccentSnap = {
  beat: number;
  /** Index within the beat's own accents array. */
  accent: number;
  kind: AccentKind;
  /** The accent's text, or the anchor it points at when it has none. */
  label: string;
  rule: SnapRule;
  /** The spoken word this accent was anchored to, and its measured span. */
  word: string | null;
  wordStartMs: number | null;
  wordEndMs: number | null;
  authoredT: number;
  snappedT: number;
  /** When the ease-in STARTS — the same measurement the bug report used. */
  authoredFireMs: number;
  snappedFireMs: number;
  /** When the accent is fully visible. Authored uses the old 0.22-of-a-beat
   *  span; snapped uses the wall-clock ACCENT_LAND_MS. Both are what the
   *  code actually did/does, which is the point of comparing them. */
  authoredLandedMs: number;
  snappedLandedMs: number;
  /** fire - spoken, and landed - spoken. null when no word was matched. */
  authoredDriftMs: number | null;
  snappedDriftMs: number | null;
  authoredLandedDriftMs: number | null;
  snappedLandedDriftMs: number | null;
  /** True when the 0.12 spacing pass had to move this accent afterwards. */
  spaced: boolean;
};

export type BeatArrival = {
  beat: number;
  entityId: string;
  /** The furthest step this beat's accents anchor on its own entity. */
  step: string | number | null;
  /** The number the series carries at that step — what the voice must say. */
  value: number | null;
  word: string | null;
  spokenMs: number | null;
  /** Where the line got to its target before: startMs + 0.68 * duration. */
  rampArriveMs: number;
  /** Where it gets there now, or null when the number was not found. */
  arriveMs: number | null;
  rampDriftMs: number | null;
  arriveDriftMs: number | null;
  /**
   * Does the line actually MOVE in this beat? `revealExtentAt` returns early
   * when the beat's target is not beyond what earlier beats already reached
   * (`to <= from`), so an arrival — measured or ramped — changes nothing
   * there. True only when this beat anchors a step further along the series
   * than every beat before it. Beat 0 of a chase anchoring the series' own
   * first point is the honest example: its target IS the line's origin, so
   * nothing can arrive and no timing can fix it.
   */
  travels: boolean;
};

export type SyncReport = {
  accents: AccentSnap[];
  arrivals: BeatArrival[];
  /** Accents placed by a measured word, and accents left on their authored t. */
  matched: number;
  unmatched: number;
  /** Beats where two snapped accents came closer than MIN_ACCENT_GAP. */
  spacedBeats: number[];
  landMs: number;
};

/* ------------------------------------------------------------------- 1 words */

const srtMs = (h: string, m: string, s: string, f: string) =>
  Number(h) * 3600000 + Number(m) * 60000 + Number(s) * 1000 + Number(f.padEnd(3, '0'));

const STAMP = /(\d+):(\d+):(\d+)[,.](\d+)\s*-->\s*(\d+):(\d+):(\d+)[,.](\d+)/;

/**
 * Parse `out/voice-<id>.srt` — the word-level file scripts/tts.ts already
 * writes, one cue per word. Pure string work, so the tests can feed it a
 * literal and the CLI can feed it a file.
 */
export function parseSrt(srt: string): Word[] {
  const out: Word[] = [];
  for (const block of srt.split(/\r?\n\s*\r?\n/)) {
    const lines = block.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
    const i = lines.findIndex((l) => STAMP.test(l));
    if (i < 0) continue;
    const m = STAMP.exec(lines[i])!;
    const text = lines.slice(i + 1).join(' ').trim();
    if (!text) continue;
    out.push({ text, startMs: srtMs(m[1], m[2], m[3], m[4]), endMs: srtMs(m[5], m[6], m[7], m[8]) });
  }
  return out.sort((a, b) => a.startMs - b.startMs);
}

/* ----------------------------------------------------------------- 2 matching */

/** Digits only: `"11,829 short"` -> `"11829"`, `"23,924."` -> `"23924"`. */
const digitsOf = (s: string) => s.replace(/\D+/g, '');

/** The first number-shaped token's digits, so "14 seasons" is 14 and not 14
 *  plus whatever digits a later word happens to carry. */
const numberIn = (s: string) => {
  const m = /\d[\d,.]*/.exec(s);
  return m ? digitsOf(m[0]) : '';
};

/** A word reduced to letters for name matching: `"Chamberlain's"` ->
 *  `"chamberlain"`, and the curly apostrophe Gemini likes is folded first. */
const wordKey = (s: string) =>
  s.toLowerCase().replace(/[‘’]/g, "'").replace(/[^a-z']/g, '').replace(/'s$/, '').replace(/'/g, '');

/**
 * The years a season label can be SPOKEN as. `"2012-13"` is said as either
 * "twenty thirteen" or "twenty twelve", so both are candidates, end year
 * first — a script that names one season says its end year far more often
 * ("in 2018 he pulls down 709"). `"1999-00"` expands to 2000, not 1900.
 */
export function stepYears(step: string | number): string[] {
  const s = String(step);
  const m = /^(\d{4})-(\d{2})$/.exec(s);
  if (m) {
    const start = Number(m[1]);
    let end = Math.floor(start / 100) * 100 + Number(m[2]);
    if (end < start) end += 100;
    return [String(end), m[1]];
  }
  const d = digitsOf(s);
  return d ? [d] : [];
}

/**
 * The value one anchor stands on — a point on a series, or the record line.
 *
 * Same three cases the charts' own `Resolve` handles, in value space instead
 * of pixel space: `record: true` is the record's number, a `step` is that
 * season's cumulative value, and no `step` at all means the series' final
 * point (what the head arrives at).
 */
function valueAt(a: Accent['at'], facts: SyncFacts): number | null {
  if (!a) return null;
  if (a.record) return facts.record?.value ?? null;
  // A fourth case, and the same kind as `record`: a height on the axis that
  // belongs to no series. Checked before the entity for the same reason —
  // `entityId` on a threshold anchor only says whose chart this is.
  if (a.threshold !== undefined) return facts.thresholds?.[a.threshold] ?? null;
  const series = facts.entities?.find((e) => e.id === a.entityId)?.series;
  if (!series?.length) return null;
  if (a.step === undefined) return series[series.length - 1].value;
  const hit = series.find((p) => String(p.step) === String(a.step));
  return hit ? hit.value : null;
}

/**
 * A span's own number: the distance between its two anchors, derived exactly
 * as the chart derives the label it draws.
 *
 * This is what makes a span snappable at all. Every other accent is matched
 * on digits it carries in `text`, and a span carries none by design — its
 * label is computed so that it cannot be a number the writer invented. The
 * same computation here gives the snap the word to look for: a span from
 * LeBron's line head to Wilt's record reads 11,829, and "11,829" is the word
 * the voice says.
 */
export function spanValue(accent: Accent, facts: SyncFacts): number | null {
  if (accent.kind !== 'span') return null;
  const from = valueAt(accent.at, facts);
  const to = valueAt(accent.to, facts);
  if (from === null || to === null) return null;
  return Math.abs(from - to);
}

const surnameOf = (full?: string | null) => {
  const parts = (full ?? '').trim().split(/\s+/).filter(Boolean);
  return parts.length ? parts[parts.length - 1] : '';
};

/**
 * Find the accent's word inside ONE beat. Five rules, first match wins,
 * ordered by how precisely each one names the THING THE ACCENT POINTS AT:
 *
 *   1. digits in the accent's own text — the strongest signal, because the
 *      label and the spoken word are then literally the same number. A
 *      `span` has no text and uses its COMPUTED number here instead, which
 *      is the same signal arrived at by subtraction rather than by reading.
 *   2. `at.step` — the year that season is spoken as. A `spotlight` on
 *      `{entityId, step}` is about THAT POINT, and the year names the point.
 *   3. `at.record` — the record holder's surname, else a word saying "record".
 *   4. `at.entityId` — that entity's surname, which only says whose chart
 *      this is. Measured cost of ranking it above the step instead: the
 *      spotlight on LeBron's 2023-24 point landed on "James" at 44.94s
 *      ("while James keeps grinding") rather than on "2024" at 40.1s — 6.7s
 *      after the line itself had arrived at 11,185.
 *   5. nothing — the authored `t` stands. A guessed position is not replaced
 *      by a different guess.
 *
 * `claimed` holds the words earlier accents in this beat already took, so two
 * accents naming the same number do not collapse onto one word (and then get
 * pushed apart again by the spacing pass). It is a preference, not a
 * requirement: with every candidate claimed the first one is used anyway.
 */
export function matchAccent(
  accent: Accent,
  words: readonly Word[],
  facts: SyncFacts,
  claimed: ReadonlySet<Word> = new Set()
): { rule: SnapRule; word: Word | null } {
  const pick = (rule: SnapRule, hit: (w: Word) => boolean): { rule: SnapRule; word: Word | null } | null => {
    const all = words.filter(hit);
    if (!all.length) return null;
    return { rule, word: all.find((w) => !claimed.has(w)) ?? all[0] };
  };

  // A span has no text to read a number out of — its number is derived from
  // the two anchors, and that derived number is the word to match on, which
  // keeps every accent kind on the one digits-first rule.
  const span = spanValue(accent, facts);
  const num = numberIn(accent.text ?? '') || (span === null ? '' : String(span));
  if (num) {
    const byDigits = pick('digits', (w) => digitsOf(w.text) === num);
    if (byDigits) return byDigits;
  }

  if (accent.at?.step !== undefined) {
    for (const year of stepYears(accent.at.step)) {
      const byYear = pick('step', (w) => digitsOf(w.text) === year);
      if (byYear) return byYear;
    }
  }

  if (accent.at?.record) {
    const holder = wordKey(surnameOf(facts.record?.holder));
    const byHolder = holder ? pick('record', (w) => wordKey(w.text) === holder) : null;
    if (byHolder) return byHolder;
    const byWord = pick('record', (w) => /record/i.test(w.text));
    if (byWord) return byWord;
  }

  if (accent.at?.entityId) {
    const e = facts.entities?.find((x) => x.id === accent.at!.entityId);
    const last = wordKey(e?.last ?? '');
    const bySurname = last ? pick('entity', (w) => wordKey(w.text) === last) : null;
    if (bySurname) return bySurname;
  }

  return { rule: 'none', word: null };
}

/* ------------------------------------------------------------------ 3 spacing */

const clamp01 = (x: number) => Math.min(1, Math.max(0, x));

/**
 * Restore the 0.12 minimum distance between accents in one beat.
 *
 * Snapping is per-accent, so two accents whose words are 200ms apart in a
 * 9-second beat end up 0.02 apart, which `verifyDraft` rejects and which
 * reads as one event anyway. Violating pairs are pushed apart AROUND THEIR
 * MIDPOINT — neither is dropped and neither is privileged — and a run that
 * leaves [0,1] slides back in as a whole so the gaps survive the clamp.
 * Returns `ts` in the caller's own order.
 */
export function spaceAccents(ts: readonly number[], gap = MIN_ACCENT_GAP): { ts: number[]; moved: boolean[] } {
  const order = ts.map((_, i) => i).sort((a, b) => ts[a] - ts[b]);
  const v = order.map((i) => ts[i]);
  const slide = (d: number) => { for (let i = 0; i < v.length; i++) v[i] += d; };

  // 1. push every violating pair apart around its own midpoint, so neither
  //    accent is privileged and the pair stays where it was heard.
  for (let i = 1; i < v.length; i++) {
    if (v[i] - v[i - 1] < gap - 1e-9) {
      const mid = (v[i - 1] + v[i]) / 2;
      v[i - 1] = mid - gap / 2;
      v[i] = mid + gap / 2;
    }
  }
  // 2. three accents in one beat can leave a pair violated again (fixing 1-2
  //    moves 2, which is 3's neighbour), so enforce the gap exactly once more,
  //    forwards — this pass is guaranteed, the midpoint pass above is not.
  for (let i = 1; i < v.length; i++) v[i] = Math.max(v[i], v[i - 1] + gap);
  // 3. a run that now ends past 1 (or starts before 0) slides back in AS A
  //    WHOLE, which is what preserves the gaps the two passes just created.
  if (v[v.length - 1] > 1) slide(1 - v[v.length - 1]);
  if (v[0] < 0) slide(-v[0]);

  const out = ts.slice();
  order.forEach((idx, k) => { out[idx] = clamp01(v[k]); });
  return { ts: out, moved: out.map((x, i) => Math.abs(x - ts[i]) > 1e-9) };
}

/* -------------------------------------------------------------------- 4 snap */

/** Words whose start falls inside this beat. */
const wordsIn = (words: readonly Word[], b: BeatSpan) =>
  words.filter((w) => w.startMs >= b.startMs && w.startMs <= b.endMs);

/**
 * The number this beat's line has to reach — the value at the FURTHEST step
 * its accents anchor on its own entity, "furthest" being latest in the
 * series, which is the same step `revealTargets` picks by arc length.
 */
function anchoredNumber(
  beat: Draft['beats'][number],
  facts: SyncFacts
): { step: string | number; value: number; index: number } | null {
  const series = facts.entities?.find((e) => e.id === beat.entityId)?.series;
  if (!series?.length) return null;
  let best = -1;
  for (const a of beat.accents ?? []) {
    if (!a.at || a.at.record || a.at.entityId !== beat.entityId || a.at.step === undefined) continue;
    const i = series.findIndex((s) => String(s.step) === String(a.at!.step));
    if (i > best) best = i;
  }
  return best < 0 ? null : { step: series[best].step, value: series[best].value, index: best };
}

/**
 * A new draft whose accent `t` values — and whose per-beat `arriveMs` — are
 * MEASURED rather than authored. The input is never mutated.
 *
 * `beats` are the measured spans from `timeline-<id>.json`, in draft order;
 * callers that cannot supply as many spans as the draft has beats get the
 * extra beats back untouched (nothing to measure against).
 */
export function snapDraft(
  draft: Draft,
  beats: readonly BeatSpan[],
  words: readonly Word[],
  facts: SyncFacts = {},
  landMs = ACCENT_LAND_MS,
  ramp = 0.68
): { draft: Draft; report: SyncReport } {
  const accents: AccentSnap[] = [];
  const arrivals: BeatArrival[] = [];
  const spacedBeats: number[] = [];
  /** Per entity, the furthest series index its earlier beats already reached
   *  — the same running maximum `revealTargets` keeps in arc-length space. */
  const reached = new Map<string, number>();

  const outBeats = draft.beats.map((beat, i) => {
    const span = beats[i];
    if (!span) return { ...beat };
    const beatMs = span.endMs - span.startMs;
    const mine = wordsIn(words, span);
    const claimed = new Set<Word>();

    // --- accents: t such that the ease-in FINISHES as the word begins.
    const rows = (beat.accents ?? []).map((a, k) => {
      const { rule, word } = matchAccent(a, mine, facts, claimed);
      if (word) claimed.add(word);
      const fireMs = word ? word.startMs - landMs : span.startMs + a.t * beatMs;
      const t = word ? clamp01((fireMs - span.startMs) / (beatMs || 1)) : a.t;
      return { a, k, rule, word, t };
    });

    const spaced = spaceAccents(rows.map((r) => r.t));
    if (spaced.moved.some(Boolean)) spacedBeats.push(i);

    const nextAccents = rows.map((r, k) => ({ ...r.a, t: spaced.ts[k] }));

    rows.forEach((r, k) => {
      const spanNum = spanValue(r.a, facts);
      const authoredFire = span.startMs + r.a.t * beatMs;
      const snappedFire = span.startMs + spaced.ts[k] * beatMs;
      const spoken = r.word ? r.word.startMs : null;
      const authoredLanded = span.startMs + Math.min(1, r.a.t + LEGACY_BEAT_SPAN) * beatMs;
      const snappedLanded = span.startMs + Math.min(1, spaced.ts[k] + accentSpan(beatMs, landMs)) * beatMs;
      accents.push({
        beat: i, accent: k, kind: r.a.kind,
        // A span's label is the number it DRAWS, which it computed rather
        // than carried — so the report shows that number, not its anchors.
        label: r.a.text ?? (spanNum !== null ? `span ${spanNum}`
          : r.a.at?.record ? 'record line'
          : r.a.at?.threshold !== undefined ? `${r.a.at.threshold} line`
          : r.a.at?.step !== undefined
          ? `${r.a.at.entityId} @ ${r.a.at.step}` : r.a.at?.entityId ?? '(no anchor)'),
        rule: r.rule,
        word: r.word?.text ?? null,
        wordStartMs: r.word?.startMs ?? null,
        wordEndMs: r.word?.endMs ?? null,
        authoredT: r.a.t, snappedT: spaced.ts[k],
        authoredFireMs: Math.round(authoredFire), snappedFireMs: Math.round(snappedFire),
        authoredLandedMs: Math.round(authoredLanded), snappedLandedMs: Math.round(snappedLanded),
        authoredDriftMs: spoken === null ? null : Math.round(authoredFire - spoken),
        snappedDriftMs: spoken === null ? null : Math.round(snappedFire - spoken),
        authoredLandedDriftMs: spoken === null ? null : Math.round(authoredLanded - spoken),
        snappedLandedDriftMs: spoken === null ? null : Math.round(snappedLanded - spoken),
        spaced: spaced.moved[k],
      });
    });

    // --- the line: when is this beat's anchored number actually spoken?
    const target = anchoredNumber(beat, facts);
    const hit = target ? mine.find((w) => digitsOf(w.text) === String(target.value)) : undefined;
    const rampArrive = span.startMs + beatMs * ramp;
    const was = reached.get(beat.entityId) ?? 0;
    const travels = !!target && target.index > was;
    if (target) reached.set(beat.entityId, Math.max(was, target.index));
    arrivals.push({
      beat: i, entityId: beat.entityId,
      step: target?.step ?? null, value: target?.value ?? null,
      word: hit?.text ?? null, spokenMs: hit?.startMs ?? null,
      rampArriveMs: Math.round(rampArrive),
      arriveMs: hit ? hit.startMs : null,
      rampDriftMs: hit ? Math.round(rampArrive - hit.startMs) : null,
      arriveDriftMs: hit ? 0 : null,
      travels,
    });

    return {
      ...beat,
      accents: beat.accents ? nextAccents : beat.accents,
      ...(hit ? { arriveMs: hit.startMs } : {}),
    };
  });

  return {
    draft: { ...draft, beats: outBeats },
    report: {
      accents, arrivals,
      matched: accents.filter((a) => a.rule !== 'none').length,
      unmatched: accents.filter((a) => a.rule === 'none').length,
      spacedBeats, landMs,
    },
  };
}

/** median of |drift|, in ms — what the bug report leads with. */
export function driftStats(drifts: readonly (number | null)[]): { n: number; median: number; worst: number; over500: number } {
  const abs = drifts.filter((d): d is number => d !== null).map(Math.abs).sort((a, b) => a - b);
  if (!abs.length) return { n: 0, median: 0, worst: 0, over500: 0 };
  const mid = Math.floor(abs.length / 2);
  return {
    n: abs.length,
    median: abs.length % 2 ? abs[mid] : (abs[mid - 1] + abs[mid]) / 2,
    worst: abs[abs.length - 1],
    over500: abs.filter((d) => d > 500).length,
  };
}
