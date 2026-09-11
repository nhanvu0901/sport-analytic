/**
 * The writer brief — everything Gemini needs to write a script, and nothing
 * it could hallucinate past. Facts, machine-detected story markers, the
 * numbers it is allowed to say, and the router's chart choice all travel in
 * one JSON document; `verify.ts` rejects any draft that steps outside it.
 */
import cumulative from './data/cumulative.json';
import { api } from './espn';
import { fmt } from './scale';
import type { CareerRecord } from './records';
import { route, type ChartId, type DataShape } from '../router/shape';
import { teamChanges } from './teams';
import { ACCENT_KINDS, DENSITY_FLOOR, DENSITY_CEILING, MIN_ACCENTS_PER_BEAT, MAX_ACCENTS_PER_BEAT } from './accent';
// A value import, and safe: verify.ts imports ONLY types from this module
// (`import type`), so the cycle is erased at compile time and there is no
// runtime dependency in that direction. `target_words` below must be the
// same words-per-second verifyDraft measures the finished draft against —
// two copies of 2.9 is exactly the drift that lets a brief ask for a length
// the verifier then rejects.
import { WORDS_PER_SECOND } from './verify';

export type Angle = 'verdict-revisited' | 'chase' | 'cohort-fate' | 'rank-inversion' | 'hidden-cost';
export type Lane = 'evergreen' | 'newsy';
export type MarkerKind = 'missed-season' | 'jump' | 'plateau' | 'rank-flip' | 'award' | 'undrafted' | 'short-career' | 'leader' | 'record-gap';
export type EndingVariant = 'thesis' | 'hard-cut' | 'open-question';

export type Marker = { entityId: string; kind: MarkerKind; step?: string; detail: string; value?: number };

/**
 * The record a chase is measured against, as the brief carries it.
 *
 * A record chase needs the HOLDER's season-by-season data not at all: it needs
 * the chaser's series and one absolute number. That is why this is a scalar
 * beside `entities` and not a second entity — attempting the second series is
 * what made a Wilt Chamberlain rebounds video impossible to build, since ESPN
 * returns 5 of his 14 seasons and zero rebounds.
 *
 * `gap` is per entity because "how far short" is the sentence the script will
 * actually say, and it must be a number the writer is allowed to say —
 * `allowedNumbers` puts every one of them on the list.
 */
export type BriefRecord = {
  measure: string;
  unit: string;
  holder: string;
  value: number;
  /** Seasons the holder needed. A chase is a story about pace. */
  seasons: number;
  /** The label the chart draws on the line. */
  label: string;
  /** How far each charted entity still is from the record. */
  gap: { entityId: string; short: number }[];
  /** Provenance, carried verbatim from src/records.ts. */
  source: string;
  as_of: string;
};

export type BriefEntity = {
  id: string; name: string; first: string; last: string;
  // `null` = a source CONFIRMED this player has no draft record (genuinely
  // undrafted — verified against Naz Reid, whose ESPN athlete detail returns
  // `draft: null`, never an ambiguous absence). `undefined` = we never looked
  // — a candidate's free-text entities carry no pick at all. Conflating the
  // two is exactly how a real brief said "LeBron James went undrafted": his
  // pick was never looked up, that unknown was stored as `null`, and
  // `detectMarkers` read `null` as a fact instead of a gap.
  pick: number | null | undefined; total: number; rank: number; seasons_played: number;
  /**
   * Cumulative, as in the dataset. `team` is ESPN's own per-season
   * `teamSlug` and is optional: it costs no extra request (it is in the same
   * response as the values) but not every source carries one — the C01
   * dataset does not. It travels this far because the CHART needs it, and
   * the chart must not fetch: brief -> video-<id>.json -> CumulativeLines is
   * the one path a series already takes.
   */
  series: { step: string; value: number; team?: string }[];
  awards: { name: string; season: string }[];
};

/**
 * How many accents the WHOLE script may spend, not per beat. A per-beat count
 * ("2 or 3 accents") cannot know how long the script will end up once spoken
 * — that is exactly why a writer following "3 on every beat" to the letter
 * measured 0.521 events/s and was rejected: 3 x 10 beats is fine as a
 * per-beat rule, wrong as a total. `total_min`/`total_max` translate the
 * measured density band (accent.ts's DENSITY_FLOOR/CEILING) into a single
 * absolute number for THIS video's target length; `per_beat_hint` spells the
 * same budget out as a short instruction a writer can act on immediately.
 *
 * Crucially this is an ACCENT budget, not an event budget. `eventDensity`
 * counts `beats.length + accents`, so the beats are events the script has
 * already spent before a single accent fires; the accents get what is left
 * over. See `computeAccentBudget`.
 */
export type AccentBudget = { total_min: number; total_max: number; per_beat_hint: string };

export type WriterBrief = {
  version: 1;
  generated: string;                                  // ISO date
  topic: { id: string; question: string; angle: Angle; lane: Lane; hook_seed: string; why_fans_argue?: string; evidence?: string[] };
  visual: {
    chart: string; alternates: string[]; camera: string;
    accent_kinds: readonly string[];                  // = ACCENT_KINDS
    anchor_steps: string[];                           // valid Anchor.step values = the season labels
    density: { floor: number; ceiling: number; target: number };
    accent_budget: AccentBudget;
  };
  facts: {
    unit: string; as_of: string; entities: BriefEntity[]; markers: Marker[]; allowed_numbers: number[];
    /** Present only for a record chase: the single absolute line the chart
     *  draws and the script argues against. See BriefRecord. */
    record?: BriefRecord;
  };
  style: {
    voice: string; rules: string[];
    /** The outer LEGAL bound — a draft outside it is not a Short any more. */
    duration_s: [number, number];
    /** The single length the writer aims at, inside `duration_s`. A range
     *  cannot be aimed at: density is measured against the draft's ACTUAL
     *  spoken length, so a 2.4x-wide target makes the accent budget
     *  unbindable — 8 beats and 16 accents is 0.343 events/s at 70s and
     *  0.557 at 43.1s, legal and rejected from the same draft. */
    target_seconds: number;
    /** `target_seconds` in words, at WORDS_PER_SECOND. This, not the second
     *  count, is what a writer can actually count while writing. */
    target_words: number;
    /** How many beats this video is, as `[fewest, most]`. Normally a
     *  degenerate range — one number said twice — because the beat count is
     *  DERIVED from the brief's narrative units (`lengthTarget`), not chosen
     *  by the writer. Only the fallback still names a real range. */
    beats: [number, number]; ending_variants: EndingVariant[]; forbidden: string[];
  };
  output: { format: 'json'; schema: unknown; example: unknown };
};

const seasonKey = (label: string) => Number(label.slice(0, 4));

/**
 * Median of a numeric array. Not exported: only `detectMarkers` needs it, and
 * only for its own deltas.
 */
const median = (xs: number[]): number => {
  const s = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
};

/**
 * Story markers, detected from shape alone — never chosen by the writer.
 * Deterministic and pure so it can be unit-tested against synthetic data.
 */
export function detectMarkers(entities: BriefEntity[], seasons: string[], record?: BriefRecord): Marker[] {
  const out: Marker[] = [];
  const sortedSeasons = [...seasons].sort((a, b) => seasonKey(a) - seasonKey(b));

  for (const e of entities) {
    // Rank 1 of 1 is not a fact about anybody. A one-series brief used to
    // emit "most in the class: 12095" about LeBron James in a video about
    // the rebounds record Wilt Chamberlain holds — a marker the writer could
    // only turn into a false claim, since there is no class and he leads
    // nothing. With two or more entities the ordering is real and it fires.
    if (e.rank === 1 && entities.length > 1) {
      out.push({ entityId: e.id, kind: 'leader', detail: `most in the class: ${e.total}`, value: e.total });
    }
    // The chase itself, stated as a marker so it reaches the writer through
    // the same channel as every other story beat — with both numbers it will
    // want to say, and the holder's season count so the pace comparison is
    // available rather than guessed at.
    if (record) {
      const short = record.value - e.total;
      out.push({
        entityId: e.id, kind: 'record-gap', value: short,
        detail: short > 0
          ? `${short} ${record.unit} short of ${record.holder}'s ${record.value} after ${e.seasons_played} seasons — the record took ${record.seasons}`
          : `already past ${record.holder}'s ${record.value} ${record.unit}`,
      });
    }
    // Strict === null on purpose: `undefined` (unknown pick) must NEVER fire this.
    if (e.pick === null) out.push({ entityId: e.id, kind: 'undrafted', detail: 'went undrafted' });
    if (e.seasons_played <= 4 && e.seasons_played < seasons.length - 2) {
      out.push({ entityId: e.id, kind: 'short-career', detail: `only ${e.seasons_played} seasons` });
    }

    // missed-season: any season label strictly between two consecutive steps
    // the entity actually has, that the entity's own series does not carry.
    const have = new Set(e.series.map((p) => p.step));
    for (let i = 0; i < e.series.length - 1; i++) {
      const lo = seasonKey(e.series[i].step);
      const hi = seasonKey(e.series[i + 1].step);
      for (const s of sortedSeasons) {
        const k = seasonKey(s);
        if (k > lo && k < hi && !have.has(s)) {
          out.push({ entityId: e.id, kind: 'missed-season', step: s, detail: `no games in ${s}` });
        }
      }
    }

    // jump / plateau: per-season deltas against their own median.
    if (e.series.length >= 3) {
      const deltas = e.series.map((p, i) => (i === 0 ? p.value : p.value - e.series[i - 1].value));
      const med = median(deltas);
      if (med > 0) {
        for (let i = 0; i < e.series.length; i++) {
          const d = deltas[i];
          const step = e.series[i].step;
          if (d >= 1.8 * med) {
            const ratio = Number((d / med).toFixed(1));
            out.push({ entityId: e.id, kind: 'jump', step, value: d, detail: `${d} points in ${step}, ${ratio}x their usual` });
          } else if (d > 0 && d <= 0.3 * med) {
            out.push({ entityId: e.id, kind: 'plateau', step, value: d, detail: `only ${d} in ${step}` });
          }
        }
      }
    }

    for (const a of e.awards) {
      out.push({ entityId: e.id, kind: 'award', step: a.season, detail: `${a.name} (${a.season})` });
    }
  }

  out.sort((a, b) => a.entityId === b.entityId ? (a.step ?? '').localeCompare(b.step ?? '') : a.entityId.localeCompare(b.entityId));
  return out;
}

/**
 * What each chart can actually DRAW, per marker kind.
 *
 * `detectMarkers` answers "what is interesting in this data", which is a
 * question about the data and not about the picture. The brief then hands
 * those markers to the writer as "the story the numbers are hiding" — and the
 * writer, reasonably, builds beats on them. On a rebounds chart that meant
 * two of nine beats talking about MVP awards and championships: 42 award
 * markers reached the writer for a chart that has no way to show an award,
 * and the result was narration the picture could not answer.
 *
 * So a marker a chart cannot express is filtered out at assembly. The
 * detection is untouched — another chart (a timeline row, an award grid) may
 * want awards later, and deleting the detector would be the wrong fix.
 *
 * Keyed by `ChartId` so a typo does not compile. Only the two WIRED charts
 * (see `src/videoData.ts`) declare a set; every other chart is unfiltered,
 * which is the honest default — nothing is claimed about a chart nobody has
 * wired a composition for yet.
 *
 * What a cumulative line can show, and why each one is on or off the list:
 *   missed-season  a flat span where the line does not climb — drawn
 *   jump           a steep segment against its own neighbours — drawn
 *   plateau        a shallow segment, the same reading inverted — drawn
 *   short-career   a line that stops early along the axis — drawn
 *   leader         whichever line is highest at the right-hand edge — drawn
 *   rank-flip      two lines crossing, so MULTILINE only: a chase is one line
 *   record-gap     the distance to the threshold, so CHASE only: a multiline
 *                  chart has no record line to measure against
 *   award          nothing on this chart changes when a trophy is won
 *   undrafted      there is no draft axis, no pick, nothing to point at
 */
export const EXPRESSIBLE_MARKERS: Partial<Record<ChartId, readonly MarkerKind[]>> = {
  'cumulative-multiline': ['missed-season', 'jump', 'plateau', 'short-career', 'leader', 'rank-flip'],
  'cumulative-record-chase': ['missed-season', 'jump', 'plateau', 'short-career', 'leader', 'record-gap'],
};

/** The markers this chart can express, in the order they were detected. A
 *  chart with no declaration keeps all of them. */
export function expressibleMarkers(markers: Marker[], chart: string): Marker[] {
  const kinds = EXPRESSIBLE_MARKERS[chart as ChartId];
  return kinds ? markers.filter((m) => kinds.includes(m.kind)) : markers;
}

/**
 * One season-step format. ESPN's totals endpoint hands back a bare 4-digit
 * year for old seasons and a hyphenated label ("2003-04") for recent ones —
 * measured live: Wilt Chamberlain's steps came back "1969", "1970" while
 * LeBron James's came back "2003-04" in the SAME brief, so anchor_steps mixed
 * two formats and the writer could not anchor a beat reliably. A bare year Y
 * is read as the season ENDING in Y, matching ESPN's own hyphenated
 * convention for recent seasons (Y-1 through Y). An already-hyphenated step
 * passes through untouched.
 */
export function normaliseStep(step: string): string {
  const m = /^(\d{4})$/.exec(step);
  if (!m) return step;
  const y = Number(m[1]);
  return `${y - 1}-${String(y).slice(2)}`;
}

/** Every 4-digit year hiding in a season label ("2019-20" -> 2019, 2020) or a bare year ("2024" -> 2024).
 *  Exported: `assembleBrief` also uses it (via its last element) to turn a
 *  season label into the single calendar year "as of" makes sense in. */
export function yearsIn(label: string): number[] {
  const out: number[] = [];
  const m = label.match(/^(\d{4})(?:-(\d{2}))?$/);
  if (!m) return out;
  const y0 = Number(m[1]);
  out.push(y0);
  if (m[2]) out.push(Math.floor(y0 / 100) * 100 + Number(m[2]));
  return out;
}

/** Every number a script is allowed to say — nothing else survives verify.ts. */
export function allowedNumbers(entities: BriefEntity[], seasons: string[], record?: BriefRecord): number[] {
  const nums = new Set<number>();
  for (let i = 1; i <= 12; i++) nums.add(i);
  for (const s of seasons) for (const y of yearsIn(s)) nums.add(y);

  // A record chase's two headline numbers are the record and the gap, and a
  // script that may not say either cannot state the chase at all. The
  // holder's season count goes in for the same reason: "23,924 in 14 seasons
  // against 12,095 in 23" is the whole argument, and 14 is not in 1..12.
  if (record) {
    nums.add(record.value);
    nums.add(record.seasons);
    for (const g of record.gap) nums.add(Math.abs(g.short));
  }

  for (const e of entities) {
    nums.add(e.total);
    nums.add(e.rank);
    nums.add(e.seasons_played);
    // typeof guard, not `!== null`: an unknown pick is `undefined`, and
    // adding `undefined` into a Set<number> would poison the sort below.
    if (typeof e.pick === 'number') nums.add(e.pick);
    let prev = 0;
    for (const p of e.series) {
      nums.add(p.value);
      nums.add(p.value - prev);
      prev = p.value;
    }
    for (const a of e.awards) for (const y of yearsIn(a.season)) nums.add(y);
  }

  return [...nums].sort((a, b) => a - b);
}

/** A measured contract — the seven rules the density audit and the format demand. Do not paraphrase. */
export const STYLE_RULES: string[] = [
  'Hook mirrors the title: the first sentence names the subject and states the tension the question carries.',
  'One beat is ONE sentence carrying 2 to 4 events joined by and / but / then / while. Never one event per sentence.',
  'Present tense, third person, documentary register, B2 vocabulary, no hype slang.',
  "Specific numbers, never vague ones: 7,331 — not 'over 7,000'. Every number must appear in facts.allowed_numbers.",
  'The flip — the moment the expectation breaks — lands between 40% and 70% of the runtime, never in the last beat.',
  'The last beat uses exactly one ending variant: thesis, hard-cut, or open-question.',
  `Every beat fires at least ${MIN_ACCENTS_PER_BEAT} and at most ${MAX_ACCENTS_PER_BEAT} accents from visual.accent_kinds, at t values 0.12 apart; the script's TOTAL must land inside visual.accent_budget — that total, not a fixed per-beat count, is the law, because each beat is itself a visual event.`,
];

/**
 * How many NARRATIVE UNITS this brief has — how many things it actually has
 * to say — or null when its shape says nothing about that.
 *
 * This is the measurement that replaced a hardcoded 70-second target. That
 * constant demanded 203 words of a chase whose story was complete in 135:
 * the last three beats of a real 371e3032 draft introduced no new number at
 * all, and every figure in them (23,924; 12,095; 11,829) had already been
 * spoken earlier. The writer was not padding by choice — `style.target_words`
 * said 203 and `verifyDraft` raises `length` below tolerance, so padding was
 * the only legal move. A length that follows the content cannot ask for that.
 *
 * The two shapes, and what one unit is in each:
 *
 *  - a single-entity record chase: one unit per TEAM ERA (the contiguous runs
 *    `teamChanges` already finds, and `briefMd.ts` already prints as "Which
 *    team, which seasons"), plus one for the gap to the record. A career told
 *    city by city is the shape these scripts actually take, and the gap is the
 *    beat the whole video exists for. LeBron James: Cleveland, Miami,
 *    Cleveland, Los Angeles = 4 eras, + 1 gap = 5 units.
 *  - a multi-entity race: one unit per ENTITY. Each line on the chart is one
 *    thing the script has to account for.
 *
 * A series carrying no team at all (the C01 dataset has none) reports ONE era,
 * not zero: no change is visible in the data, so the honest reading is the
 * single unbroken run it looks like — never a guess at eras we cannot see.
 *
 * Null means neither shape — a lone entity with no record to chase. The
 * caller keeps the old constant for that case; see `lengthTarget`.
 */
export function narrativeUnits(entities: BriefEntity[], record?: BriefRecord): number | null {
  if (record && entities.length === 1) {
    const eras = teamChanges(entities[0].series).length + 1;
    return eras + 1;
  }
  if (entities.length > 1) return entities.length;
  return null;
}

/** Words one beat is worth. ONE definition: `target_words` is derived from it
 *  and `target_seconds` is derived from `target_words`, so the three can
 *  never disagree the way a separately-written seconds constant did. */
export const WORDS_PER_BEAT = 25;

/** A hook and a close sit either side of the units, so a 5-unit brief is 7
 *  beats. The clamp is the outer bound on that: below 5 beats there is no
 *  room for a flip between hook and close, and above 12 the accent budget
 *  stops fitting inside the density ceiling (12 beats already spend 12 of the
 *  ~31 events a 70s script may have). */
export const MIN_BEATS = 5;
export const MAX_BEATS = 12;

/** The fallback for a brief whose shape reports no units at all: the constant
 *  that used to be hardcoded for EVERY brief — 70s, 203 words, 8-12 beats.
 *  Kept rather than invented so a brief this measurement cannot read behaves
 *  exactly as it did before. */
export const FALLBACK_TARGET_SECONDS = 70;
export const FALLBACK_BEATS: readonly [number, number] = [8, 12];

export type LengthTarget = {
  /** null = neither shape; the fallback below is in force. */
  units: number | null;
  /** Degenerate ([n, n]) whenever the units are countable: the brief states
   *  its own beat count, and `verifyDraft` checks the draft against THIS,
   *  never against a literal. Only the fallback still names a range. */
  beats: [number, number];
  target_words: number;
  target_seconds: number;
};

/**
 * The length this brief should be, derived from what it has to say.
 *
 *     beats   = clamp(2 + units, 5, 12)      a hook, one beat per unit, a close
 *     words   = beats * WORDS_PER_BEAT
 *     seconds = words / WORDS_PER_SECOND
 *
 * Seconds LAST, and that ordering is the fix: the old code pinned 70 seconds
 * and multiplied to get words, so the word count was an answer to a question
 * nobody had asked about this video's content.
 */
export function lengthTarget(entities: BriefEntity[], record?: BriefRecord): LengthTarget {
  const units = narrativeUnits(entities, record);
  if (units === null) {
    return {
      units,
      beats: [...FALLBACK_BEATS] as [number, number],
      target_words: Math.round(FALLBACK_TARGET_SECONDS * WORDS_PER_SECOND),
      target_seconds: FALLBACK_TARGET_SECONDS,
    };
  }
  const beats = Math.min(MAX_BEATS, Math.max(MIN_BEATS, 2 + units));
  const target_words = Math.round(beats * WORDS_PER_BEAT);
  // One decimal, because the quotient rarely is one (175 / 2.9 = 60.34…) and
  // this number is printed in the brief and in every `length` violation.
  const target_seconds = Math.round((target_words / WORDS_PER_SECOND) * 10) / 10;
  return { units, beats: [beats, beats], target_words, target_seconds };
}

/**
 * Turn the measured density band into an absolute accent budget for one
 * video.
 *
 * The arithmetic that was WRONG, and why: `eventDensity` (accent.ts) counts
 * `beats.length + accents` — every beat is itself a visual event. An earlier
 * version budgeted `ceil(FLOOR * seconds)` to `floor(CEILING * seconds)`
 * accents and never subtracted the beats, so at the 70-second target it
 * handed out up to 31 accents on top of 8-12 beats: 39-43 events, 0.56-0.61
 * events/s, every one of them rejected by the verifier that issued the
 * budget. The beats are paid for FIRST; the accents get the remainder:
 *
 *     total_max = floor(CEILING * seconds) - beats
 *     total_min = max(beats, ceil(FLOOR * seconds) - beats)
 *
 * The `max(beats, ...)` term is the freeze guard: one accent per beat is the
 * structural minimum (MIN_ACCENTS_PER_BEAT), because a beat with none is the
 * frozen picture the audit measured at 0.08 events/s — even when the density
 * floor alone would be satisfied with fewer.
 *
 * `beats` arrives as the brief's own RANGE, not a single count, and the
 * budget has to hold everywhere inside it — the writer picks the beat count,
 * not this function. So the two ends are used asymmetrically, giving the one
 * envelope that is safe across the whole range: `total_max` subtracts the
 * MOST beats the writer may spend (worst case for the ceiling) and
 * `total_min` subtracts the FEWEST (worst case for the floor), while the
 * freeze guard uses the most. Pass a degenerate range (`[12, 12]`) to budget
 * an exact beat count.
 *
 * The arithmetic is stated, not clamped: at a short enough target the two
 * ends cross (40s with 8-12 beats gives total_min 12 > total_max 6), because
 * 12 beats cannot each carry an accent inside 18 events. That is a true
 * report that the beat range does not fit the target, not a budget to
 * silently repair — the fix is a shorter beat range or a longer target, and
 * the only caller today (70s, 8-12 beats) is well clear of it.
 *
 * `seconds` is `style.target_seconds` — one pinned number, NOT the midpoint
 * of `duration_s`. The midpoint was the second half of the same bug: the
 * budget was sized for 67.5s while the draft it judged was free to run
 * anywhere in [40, 95]s, so the same 16 accents were legal at 70s and 0.557
 * events/s at 43.1s. Beat text does not exist yet at brief time, so there is
 * no word count to run through WORDS_PER_SECOND — but there no longer needs
 * to be one, because the brief now tells the writer the length to hit.
 */
export function computeAccentBudget(targetSeconds: number, beats: [number, number]): AccentBudget {
  const [fewestBeats, mostBeats] = beats;
  const eventFloor = Math.ceil(DENSITY_FLOOR * targetSeconds);
  const eventCeiling = Math.floor(DENSITY_CEILING * targetSeconds);

  const total_max = eventCeiling - mostBeats;
  const total_min = Math.max(mostBeats * MIN_ACCENTS_PER_BEAT, eventFloor - fewestBeats);

  // The hint is DERIVED, never a fixed "2 or 3": at 70s and 12 beats the
  // budget is 12-19, and "2 per beat" (24) is already over it. So it is
  // stated as the structural floor plus however many extras the budget
  // actually leaves — capped by the per-beat ceiling, since a beat cannot
  // absorb more than MAX_ACCENTS_PER_BEAT of them.
  const spare = Math.max(0, Math.min(total_max - mostBeats, mostBeats * (MAX_ACCENTS_PER_BEAT - MIN_ACCENTS_PER_BEAT)));
  const beatsLabel = fewestBeats === mostBeats ? `${mostBeats}` : `${fewestBeats}-${mostBeats}`;
  // The totals are NOT restated here: `total_min`/`total_max` sit beside this
  // string in the same object, and briefMd.ts prints them on the same line.
  const per_beat_hint = spare > 0
    ? `${MIN_ACCENTS_PER_BEAT} accent on every beat, then ${spare} more to spend across the ${beatsLabel} beats where they land hardest — never more than ${MAX_ACCENTS_PER_BEAT} in one beat`
    : `exactly ${MIN_ACCENTS_PER_BEAT} accent on every beat, and no more — the beats alone already spend the budget`;

  return { total_min, total_max, per_beat_hint };
}

/**
 * Everything a WriterBrief needs once the dataset is already resolved into
 * BriefEntity rows: no ESPN calls, no filesystem, no randomness (`generated`
 * aside). Extracted from `buildBrief` so a second caller — `candidateBrief.ts`,
 * whose entities come from resolving free-text names instead of a fixed
 * dataset — can share the exact same rank/marker/route/schema logic instead
 * of re-deriving it.
 */
export type BriefInput = {
  topic: { id: string; question: string; angle: Angle; lane: Lane; hook_seed: string; why_fans_argue?: string; evidence?: string[] };
  unit: string;                       // 'points' | 'blocks' | 'dollars' ...
  seasons: string[];                  // anchor steps, ascending, e.g. '2019-20'
  entities: BriefEntity[];            // already resolved; `rank` is recomputed here from `total`
  cumulative: boolean;
  /** The all-time record this question chases, when it is one. Supplying it
   *  is what turns a cumulative chart into a record chase: it fixes the y
   *  scale, adds the threshold the router routes on, and puts the record and
   *  the gap on the writer's allowed-numbers list. */
  record?: CareerRecord;
};

export function assembleBrief(input: BriefInput): WriterBrief {
  // One season-step format from here on, regardless of what either caller
  // handed in: normalise every entity's own series steps AND re-derive the
  // season list from them (dedup + re-sort), rather than trusting
  // `input.seasons` as already normalised. assembleBrief is the single choke
  // point both buildBrief and candidateBrief funnel through, so fixing the
  // format here — not in each caller — is what actually guarantees it.
  const seasons = [...new Set(input.seasons.map(normaliseStep))].sort((a, b) => seasonKey(a) - seasonKey(b));

  // Rank comes from `total` alone, computed from a SORTED COPY — `entities`
  // below keeps the caller's own order (buildBrief's dataset order; a
  // candidate brief's resolution order), only the `rank` field (and now the
  // step format) changes.
  const rankOf = new Map([...input.entities].sort((a, b) => b.total - a.total).map((e, i) => [e.id, i + 1]));
  const entities: BriefEntity[] = input.entities.map((e) => ({
    ...e,
    rank: rankOf.get(e.id)!,
    series: e.series.map((p) => ({ ...p, step: normaliseStep(p.step) })),
  }));

  // The record becomes a BriefRecord here and nowhere else, so the label the
  // chart draws, the gaps the markers quote and the gaps `allowedNumbers`
  // permits are all derived from one arithmetic.
  const record: BriefRecord | undefined = input.record && {
    measure: input.record.measure,
    unit: input.record.unit,
    holder: input.record.holder,
    value: input.record.value,
    seasons: input.record.seasons,
    label: `${input.record.holder} · ${fmt.int(input.record.value)}`,
    gap: entities.map((e) => ({ entityId: e.id, short: input.record!.value - e.total })),
    source: input.record.source,
    as_of: input.record.asOf,
  };

  const allowed_numbers = allowedNumbers(entities, seasons, record);

  const shape: DataShape = {
    entities: entities.length,
    entityKind: 'player',
    measures: [{ name: input.unit, type: 'count' }],
    dims: [{ name: 'season', type: 'time', steps: seasons.length }],
    cumulative: input.cumulative,
    // One reference line, and the reason the router can tell a record chase
    // from an ordinary cumulative race without being told the topic.
    thresholds: record ? 1 : 0,
    imageKey: 'headshot',
  };
  const choice = route(shape);

  // Detected from the data, then filtered to what THIS chart can draw. The
  // order matters: the chart choice is what the filter is against, so the
  // markers cannot be assembled before the router has answered. See
  // EXPRESSIBLE_MARKERS for why a brief that offers an unshowable marker is a
  // brief that invites unshowable narration.
  const markers = expressibleMarkers(detectMarkers(entities, seasons, record), choice.chart);

  const exampleEntity = entities[0];
  const exampleStep = exampleEntity.series.at(-1)?.step;

  // Derived once so `visual.accent_budget` and `style.target_seconds`/`beats`
  // can never drift apart — the budget is meaningless if it is computed from
  // a different length than the one actually shipped in the brief.
  //
  // `durationS` stays the outer LEGAL bound (a 40s or a 95s Short is still a
  // Short). The target inside it is no longer a constant: it counts this
  // brief's own narrative units and sizes the script to them, because a fixed
  // 70s forced a story that finished at 47s to spend 30 more seconds saying
  // numbers it had already said. See `lengthTarget`.
  const durationS: [number, number] = [40, 95];
  const { beats: beatsRange, target_words: targetWords, target_seconds: targetSeconds } = lengthTarget(entities, record);
  const accentBudget = computeAccentBudget(targetSeconds, beatsRange);

  return {
    version: 1,
    generated: new Date().toISOString(),
    topic: {
      id: input.topic.id,
      question: input.topic.question,
      angle: input.topic.angle,
      lane: input.topic.lane,
      hook_seed: input.topic.hook_seed,
      why_fans_argue: input.topic.why_fans_argue,
      evidence: input.topic.evidence,
    },
    visual: {
      chart: choice.chart,
      alternates: choice.alternates,
      camera: choice.camera,
      accent_kinds: ACCENT_KINDS,
      anchor_steps: seasons,
      density: { floor: DENSITY_FLOOR, ceiling: DENSITY_CEILING, target: 0.30 },
      accent_budget: accentBudget,
    },
    facts: {
      unit: input.unit,
      record,
      // "as of" is a CALENDAR YEAR, not a season label: buildBrief's original
      // dataset carried its own bare-year axis (data.seasons, ending "2026"
      // for the 2025-26 season) separately from the season-label steps
      // (anchor_steps, ending "2025-26"). With only `input.seasons` to work
      // from, the equivalent value is the END year hiding in the last
      // label — yearsIn("2025-26").at(-1) === 2026 — which reproduces
      // buildBrief's exact original output byte-for-byte.
      as_of: (() => {
        const last = seasons.at(-1);
        if (!last) return '';
        const years = yearsIn(last);
        return years.length ? String(years.at(-1)) : last;
      })(),
      entities,
      markers,
      allowed_numbers,
    },
    style: {
      voice: 'present tense, third person, documentary; B2 vocabulary; no hype slang',
      rules: STYLE_RULES,
      duration_s: durationS,
      target_seconds: targetSeconds,
      target_words: targetWords,
      beats: beatsRange,
      ending_variants: ['thesis', 'hard-cut', 'open-question'],
      forbidden: [
        'any number not in facts.allowed_numbers',
        'any entityId not in facts.entities[].id',
        'any accent kind not in visual.accent_kinds',
        'any Anchor.step not in visual.anchor_steps',
        'pixel coordinates of any kind',
        'more than 3 accents in one beat',
        'a running accent total outside visual.accent_budget',
        'a total word count more than 15% away from style.target_words',
        'a beat count outside style.beats',
        'the same number carrying more than 2 beats',
        'a chart not in visual.alternates',
      ],
    },
    output: {
      format: 'json',
      schema: {
        type: 'object',
        additionalProperties: false,
        required: ['title', 'beats'],
        properties: {
          title: { type: 'string' },
          beats: {
            type: 'array',
            items: {
              type: 'object',
              additionalProperties: false,
              required: ['text', 'entityId'],
              properties: {
                text: { type: 'string' },
                entityId: { type: 'string' },
                accents: {
                  type: 'array',
                  items: {
                    type: 'object',
                    additionalProperties: false,
                    required: ['t', 'kind'],
                    properties: {
                      t: { type: 'number', minimum: 0, maximum: 1 },
                      kind: { type: 'string', enum: ACCENT_KINDS },
                      at: {
                        type: 'object',
                        additionalProperties: false,
                        properties: {
                          entityId: { type: 'string' },
                          step: { type: 'string' },
                          // `additionalProperties: false` means an anchor
                          // shape the schema does not name is simply not
                          // writable, so the record anchor has to be declared
                          // here or the writer cannot point at the line at all.
                          record: { type: 'boolean', enum: [true] },
                        },
                        required: ['entityId'],
                      },
                      // The second anchor, and for the same reason `record`
                      // is declared above: a `span` is unwritable unless the
                      // schema names the field it measures to.
                      to: {
                        type: 'object',
                        additionalProperties: false,
                        properties: {
                          entityId: { type: 'string' },
                          step: { type: 'string' },
                          record: { type: 'boolean', enum: [true] },
                        },
                        required: ['entityId'],
                      },
                      // Never on a span: that label is computed from the two
                      // anchors' own values, and an authored one is rejected.
                      text: { type: 'string' },
                    },
                  },
                },
                ending: { type: 'string', enum: ['thesis', 'hard-cut', 'open-question'] },
              },
            },
          },
        },
      },
      example: {
        title: input.topic.question,
        beats: [
          {
            text: `${exampleEntity.first} ${exampleEntity.last} leads the 2019 class, but the number one pick is not even second.`,
            entityId: exampleEntity.id,
            accents: [
              { t: 0.3, kind: 'spotlight', at: { entityId: exampleEntity.id, step: exampleStep } },
              { t: 0.7, kind: 'callout', at: { entityId: exampleEntity.id }, text: String(exampleEntity.total) },
            ],
          },
        ],
      },
    },
  };
}

export async function buildBrief(
  id: 'C01' | 'C01F',
  opts?: { angle?: Angle; lane?: Lane; question?: string; hook_seed?: string }
): Promise<WriterBrief> {
  const data = cumulative as typeof cumulative;

  const entities: BriefEntity[] = await Promise.all(
    data.series.map(async (s) => {
      let awards: { name: string; season: string }[] = [];
      try {
        const bio = await api.athleteBio(s.id);
        awards = (bio?.awards ?? []).flatMap((a: { name: string; seasons: string[] }) =>
          (a.seasons ?? []).map((season) => ({ name: a.name, season }))
        );
      } catch { awards = []; }

      return {
        id: s.id, name: s.name, first: s.first, last: s.last,
        pick: s.pick, total: s.total, rank: 0, seasons_played: s.points.length,
        series: s.points.map((p) => ({ step: p.season, value: p.value })),
        awards,
      };
    })
  );

  const seasonLabels = [...new Set(entities.flatMap((e) => e.series.map((p) => p.step)))]
    .sort((a, b) => seasonKey(a) - seasonKey(b));

  return assembleBrief({
    topic: {
      id: '2019-draft-total-points',
      question: opts?.question ?? 'Which 2019 draft pick has scored the most points?',
      angle: opts?.angle ?? 'cohort-fate',
      lane: opts?.lane ?? 'evergreen',
      hook_seed: opts?.hook_seed ?? 'The number one pick is not the one who scored the most.',
    },
    unit: 'points',
    seasons: seasonLabels,
    entities,
    cumulative: true,
  });
}
