/**
 * Reject a draft before it ever reaches the renderer. Pure: no network, no
 * LLM — just the brief's own facts checked against the draft's own claims.
 * Every rule below maps to one line in `brief.style.rules` or `forbidden`.
 */
import { MIN_ACCENTS_PER_BEAT, MAX_ACCENTS_PER_BEAT, MIN_ACCENT_GAP, type Accent } from './accent';
import { teamBySlug, teamsNamedIn } from './teams';
import type { WriterBrief, EndingVariant } from './brief';

export type Draft = {
  title: string;
  beats: {
    text: string;
    entityId: string;
    accents?: Accent[];
    ending?: EndingVariant;
    /**
     * The measured moment — absolute ms into the narration — at which this
     * beat's anchored number is SPOKEN, so the line can arrive on the word
     * instead of at a fixed share of the beat. A writer never sets this and
     * cannot: it is written only onto the DERIVED draft by `src/sync.ts`,
     * after tts.ts has measured the audio, and it is meaningful only
     * alongside that same `timeline-<id>.json`.
     */
    arriveMs?: number;
  }[];
};

export type Violation = { beat: number | null; rule: string; detail: string };

/**
 * A chat box never returns clean JSON. Strip what it reliably adds — a
 * ```json fence around the whole reply, "Here is the script:" before it,
 * chatter after it, a trailing comma Gemini likes to leave — before parsing.
 * Pure: no I/O, so the CLI and the tests can share it.
 */
export function parseDraftText(raw: string): { ok: true; draft: Draft } | { ok: false; error: string } {
  let text = raw.trim();

  // A whole-reply fence: ```json ... ``` or ``` ... ```.
  if (text.startsWith('```')) {
    text = text.replace(/^```[a-zA-Z]*\n?/, '').replace(/\n?```$/, '').trim();
  }

  // Prose before the first { and after the last } — "Here is the script:"
  // preambles, trailing chatter. Slicing on brace position also mops up a
  // fence that survived the step above (e.g. one with no closing newline).
  const first = text.indexOf('{');
  const last = text.lastIndexOf('}');
  if (first === -1 || last === -1 || last < first) {
    return { ok: false, error: `no JSON object found in the input. First 200 characters received:\n${raw.slice(0, 200)}` };
  }
  text = text.slice(first, last + 1);

  // A trailing comma before a closing ] or }.
  text = text.replace(/,(\s*[}\]])/g, '$1');

  try {
    const parsed = JSON.parse(text);
    if (!parsed || typeof parsed !== 'object' || !Array.isArray((parsed as any).beats)) {
      return { ok: false, error: `parsed JSON has no "beats" array. First 200 characters received:\n${raw.slice(0, 200)}` };
    }
    return { ok: true, draft: parsed as Draft };
  } catch (e: any) {
    return { ok: false, error: `${e.message}\nFirst 200 characters received:\n${raw.slice(0, 200)}` };
  }
}

const CONNECTORS = /\b(and|but|then|while)\b/i;
const SENTENCE_END = /[.!?](?:\s|$)/g;

/**
 * Every number-shaped token in a beat, with a season label held together.
 *
 * The bug this alternation fixes: the tokeniser used to be the bare regex
 * `\d[\d,]*` with no season branch at all, which reads "2021-22" as TWO numbers — "2021" (in allowed_numbers, because
 * it is a season year) and "22" (not in it) — and rejected an otherwise-valid
 * draft for a fabricated number it had never written. A season label is one
 * token and is checked against the brief's own season labels
 * (`visual.anchor_steps`), which is where a season's validity actually lives;
 * `allowed_numbers` is a set of QUANTITIES and was never the right list for
 * it.
 *
 * The lookaround is what keeps the fix from swallowing real numbers: the
 * season branch only fires when the 4-2 shape is not part of a longer digit
 * run, so "2021-2022" still falls through to the bare-number branch (as
 * "2021" and "2022") rather than matching "2021-20" and orphaning a "22".
 * Bare numbers are otherwise tokenised exactly as before, so a fabricated
 * "9,999" or "45.9" is caught the same way it always was.
 */
const NUMERIC_TOKEN = /(?<!\d)\d{4}-\d{2}(?!\d)|\d[\d,]*/g;
const SEASON_LABEL = /^\d{4}-\d{2}$/;

/**
 * How far a draft's spoken length may sit from `style.target_words` before it
 * is a different video. The target itself is per-brief — derived from how many
 * narrative units it has (src/brief.ts's `lengthTarget`) — so this is the only
 * length figure that is a constant: +/-15% of whatever that brief asked for.
 *
 * This exists as its OWN rule, distinct from `density`, on purpose. A
 * 125-word draft with 8 beats and 16 accents measures 0.557 events/s and used
 * to be reported as a density violation — which is true and useless: nothing
 * was wrong with its 16 accents, it was 78 words too short. Naming the cause
 * "density" sent a reader hunting for accents to delete.
 */
export const LENGTH_TOLERANCE = 0.15;

/**
 * How many beats one number may carry, and the size below which the count is
 * not kept at all.
 *
 * Measured on a real 371e3032 draft: 23,924 carried beats 1, 6 AND 8, 12,095
 * carried 5 and 6, 11,829 carried 5 and 7 — and the last three beats
 * introduced no new number at all. That is what padding looks like from the
 * outside, and it is mechanically checkable in the same family as
 * `allowed_numbers`: restating a figure is not a style opinion, it is a beat
 * that added nothing.
 *
 * TWO, not one, because the limit has to leave room for the one honest echo
 * this format has: a closing thesis restating the headline figure the hook
 * opened with. A third beat on the same number is no longer an echo.
 *
 * The floor exempts what a script legitimately repeats — ordinals ("second",
 * "fourth"), ranks, season counts, draft picks. `allowedNumbers` puts 1..12 on
 * the list for exactly that reason, and a headline figure (a career total, a
 * record, a gap) is never that small: the smallest number this rule is meant
 * to catch, 3,861, is an order of magnitude above the floor. A season LABEL is
 * not counted at all — it is tokenised separately and checked against
 * `anchor_steps`, not against quantities.
 */
export const MAX_BEATS_PER_NUMBER = 2;
export const REPEATABLE_NUMBER_FLOOR = 300;

/**
 * The single source of truth for spoken pace. `verifyDraft` uses it to turn
 * a draft's word count into estimated seconds; `assembleBrief`'s accent
 * budget (src/brief.ts) is derived from the SAME density band this number
 * feeds into, so anything that needs "how many words per second does this
 * voice speak" imports this constant instead of writing its own `2.9`.
 */
export const WORDS_PER_SECOND = 2.9;

export function verifyDraft(draft: Draft, brief: WriterBrief, wordsPerSecond = WORDS_PER_SECOND): Violation[] {
  const out: Violation[] = [];
  const entityIds = new Set(brief.facts.entities.map((e) => e.id));
  const allowed = new Set(brief.facts.allowed_numbers);
  const accentKinds = new Set(brief.visual.accent_kinds);
  const anchorSteps = new Set(brief.visual.anchor_steps);
  const endingVariants = new Set(brief.style.ending_variants);
  const entityById = new Map(brief.facts.entities.map((e) => [e.id, e]));
  /** Older briefs — and sources that never carried a team, like C01 — have no
   *  per-season team at all. The `team-era` rule is skipped entirely for them
   *  rather than firing on every beat that happens to name a city. */
  const hasTeams = brief.facts.entities.some((e) => e.series.some((s) => s.team));
  /** Every number the script says, and which beats say it — collected in the
   *  same pass that checks `allowed_numbers`, and judged after the loop by
   *  the `repeat-number` rule. `text` is the first spelling seen, so the
   *  message quotes the draft rather than a re-formatted number. */
  const saidIn = new Map<number, { text: string; beats: number[] }>();

  // Against the BRIEF's own number, never a literal: the beat count is
  // derived from how many narrative units the brief has (src/brief.ts's
  // `lengthTarget`), so it is normally a single number stated twice.
  const [fewestBeats, mostBeats] = brief.style.beats;
  if (draft.beats.length < fewestBeats || draft.beats.length > mostBeats) {
    out.push({
      beat: null, rule: 'beat-count',
      detail: `${draft.beats.length} beats, expected `
        + (fewestBeats === mostBeats ? `exactly ${mostBeats}` : `between ${fewestBeats} and ${mostBeats}`),
    });
  }

  draft.beats.forEach((beat, i) => {
    if (!entityIds.has(beat.entityId)) {
      out.push({ beat: i, rule: 'unknown-entity', detail: `entityId "${beat.entityId}" is not in facts.entities` });
    }

    for (const m of beat.text.match(NUMERIC_TOKEN) ?? []) {
      if (SEASON_LABEL.test(m)) {
        if (!anchorSteps.has(m)) {
          out.push({ beat: i, rule: 'fabricated-number', detail: `season "${m}" is not in visual.anchor_steps` });
        }
        continue;
      }
      const n = Number(m.replace(/,/g, ''));
      if (!allowed.has(n)) {
        out.push({ beat: i, rule: 'fabricated-number', detail: `"${m}" is not in facts.allowed_numbers` });
      }
      const seen = saidIn.get(n) ?? { text: m, beats: [] };
      // Beats arrive in order, so the last entry is the only one that can be
      // this beat: a number said twice in ONE sentence still carries one beat.
      if (seen.beats.at(-1) !== i) seen.beats.push(i);
      saidIn.set(n, seen);
    }

    const accents = beat.accents ?? [];
    /** Both anchors are checked by the same three rules — an unresolvable
     *  `to` draws nothing exactly the way an unresolvable `at` does. `which`
     *  only names the field in the message. */
    const checkAnchor = (a: Accent['at'], which: 'at' | 'to') => {
      if (!a) return;
      if (!entityIds.has(a.entityId)) {
        out.push({ beat: i, rule: 'accent-anchor', detail: `accent ${which} points at unknown entityId "${a.entityId}"` });
      } else if (a.step !== undefined && !anchorSteps.has(String(a.step))) {
        out.push({ beat: i, rule: 'accent-anchor', detail: `accent ${which} step "${a.step}" is not in visual.anchor_steps` });
      }
      // `record: true` points at the record line, which only a record chase
      // has. On any other chart the chart's own Resolve returns null and the
      // accent silently draws nothing — a beat that looks accented in the
      // draft and is frozen on screen. Caught here instead.
      if (a.record && !brief.facts.record) {
        out.push({
          beat: i, rule: 'accent-anchor',
          detail: `accent points at the record line (${which}.record), but this brief has no facts.record`,
        });
      }
    };

    for (const a of accents) {
      if (!accentKinds.has(a.kind)) {
        out.push({ beat: i, rule: 'accent-kind', detail: `kind "${a.kind}" is not in visual.accent_kinds` });
      }
      checkAnchor(a.at, 'at');
      checkAnchor(a.to, 'to');

      // A span is a MEASUREMENT between two anchors, so a missing or
      // unresolvable second anchor is the same failure as an `at.record` on a
      // brief with no record: the chart can resolve nothing, draws nothing,
      // and the beat is frozen while the draft claims an accent.
      if (a.kind === 'span') {
        if (!a.at || !a.to) {
          out.push({
            beat: i, rule: 'accent-anchor',
            detail: `a span measures between two anchors and this one has ${!a.at && !a.to ? 'neither' : !a.at ? 'no at' : 'no to'}`,
          });
        }
        // The label is computed from the data at draw time (the gap between
        // the two anchors' own values), so an authored one is either a
        // duplicate or a number nobody checked. Rejected rather than ignored:
        // a typed number is exactly what `fabricated-number` exists to stop.
        if (a.text !== undefined) {
          out.push({
            beat: i, rule: 'accent-text',
            detail: `a span carries text "${a.text}", but its number is computed from the two anchors — do not write one`,
          });
        }
      } else if (a.to) {
        out.push({
          beat: i, rule: 'accent-anchor',
          detail: `a "${a.kind}" accent carries a second anchor (to), which only a span uses`,
        });
      }

      if (a.t < 0 || a.t > 1) {
        out.push({ beat: i, rule: 'accent-t', detail: `t=${a.t} is outside [0,1]` });
      }
    }
    for (let x = 0; x < accents.length; x++) {
      for (let y = x + 1; y < accents.length; y++) {
        if (Math.abs(accents[x].t - accents[y].t) < MIN_ACCENT_GAP) {
          out.push({ beat: i, rule: 'accent-t', detail: `accents at t=${accents[x].t} and t=${accents[y].t} are closer than ${MIN_ACCENT_GAP}` });
        }
      }
    }
    // 1, not 2, as the floor — see MIN_ACCENTS_PER_BEAT in accent.ts. A flat
    // "2 or 3 per beat" is arithmetically impossible against the accent
    // budget at the top of the beat range: 12 beats x 2 accents is 36 events
    // at the 70s target, 0.514/s, over the ceiling. The absolute budget
    // decides how many beats can afford a second or third one; this check
    // only holds the structural bounds every beat obeys regardless.
    if (accents.length < MIN_ACCENTS_PER_BEAT || accents.length > MAX_ACCENTS_PER_BEAT) {
      out.push({
        beat: i, rule: 'accents-per-beat',
        detail: `${accents.length} accents, expected ${MIN_ACCENTS_PER_BEAT} to ${MAX_ACCENTS_PER_BEAT}`,
      });
    }

    /**
     * The voice and the picture must agree on which jersey this season was.
     *
     * A beat's `at.step` draws the line to that season AND puts a team logo
     * on it; a beat that says "Cleveland" while its anchored 2013-14 draws
     * the Miami mark is the scene contradicting the narration, which is
     * worse than a wrong jersey. Measured on a real draft before this rule
     * existed.
     *
     * Three deliberate narrowings, each of which would otherwise reject a
     * correct beat:
     *  - a beat that names no team, or anchors no step, is not checked — it
     *    claims nothing about an era;
     *  - ANY named team matching is enough, so a transition sentence ("he
     *    left Cleveland for Miami") passes without a special case;
     *  - the step's team is looked up under the ACCENT's own entityId, not
     *    the beat's, because that is whose line the anchor moves.
     */
    if (hasTeams) {
      const said = teamsNamedIn(beat.text);
      // Deduped: two accents on the same season are one claim about the era,
      // and naming it twice in the message reads as two separate faults.
      const byStep = new Map<string, string>();
      for (const a of accents) {
        if (!a.at || a.at.step === undefined) continue;
        const step = String(a.at.step);
        const team = entityById.get(a.at.entityId)?.series.find((s) => s.step === step)?.team;
        if (team) byStep.set(step, team);
      }
      const anchored = [...byStep].map(([step, team]) => ({ step, team }));
      if (said.length && anchored.length && !anchored.some((x) => said.includes(x.team))) {
        const nameOf = (slug: string) => teamBySlug(slug)?.name ?? slug;
        out.push({
          beat: i, rule: 'team-era',
          detail: `text names ${said.map(nameOf).join(' / ')}, but its anchored `
            + `${anchored.map((x) => `${x.step} was ${nameOf(x.team)}`).join(', ')}`,
        });
      }
    }

    if (i === 0) {
      const named = brief.facts.entities.some((e) =>
        beat.text.toLowerCase().includes(e.first.toLowerCase()) || beat.text.toLowerCase().includes(e.last.toLowerCase())
      );
      if (!named) out.push({ beat: i, rule: 'hook', detail: 'first beat names no entity by first or last name' });
    }

    const isLast = i === draft.beats.length - 1;
    if (isLast) {
      if (!beat.ending || !endingVariants.has(beat.ending)) {
        out.push({ beat: i, rule: 'ending', detail: `last beat's ending "${beat.ending ?? ''}" is not one of ${[...endingVariants].join(', ')}` });
      }
    } else if (beat.ending) {
      out.push({ beat: i, rule: 'ending', detail: `beat ${i} carries an ending, but only the last beat may` });
    }

    const sentences = beat.text.match(SENTENCE_END)?.length ?? 0;
    if (sentences > 1) {
      out.push({ beat: i, rule: 'one-sentence', detail: `${sentences} sentence terminators, expected 1` });
    }

    if (!CONNECTORS.test(beat.text)) {
      out.push({ beat: i, rule: 'chain', detail: 'no and/but/then/while connecting multiple events' });
    }
  });

  // A number may carry at most MAX_BEATS_PER_NUMBER beats. The third beat on
  // the same figure is the shape padding takes when a length target is longer
  // than the story — see MAX_BEATS_PER_NUMBER for the measurement.
  for (const [n, seen] of saidIn) {
    if (n < REPEATABLE_NUMBER_FLOOR || seen.beats.length <= MAX_BEATS_PER_NUMBER) continue;
    out.push({
      beat: null, rule: 'repeat-number',
      detail: `${seen.text} carries beats ${seen.beats.join(', ')} — a number may carry at most `
        + `${MAX_BEATS_PER_NUMBER}, and the ${seen.beats.length}${seen.beats.length === 3 ? 'rd' : 'th'} says nothing new`,
    });
  }

  const totalWords = draft.beats.reduce((n, b) => n + b.text.split(/\s+/).filter(Boolean).length, 0);
  const totalAccents = draft.beats.reduce((n, b) => n + (b.accents?.length ?? 0), 0);
  const seconds = totalWords / wordsPerSecond;
  const events = draft.beats.length + totalAccents;

  // Length BEFORE density, and reported separately: density is a ratio, so a
  // script that is simply too short shows up in it as "too many accents".
  // Guarded on presence rather than assumed: a brief serialised before
  // `target_words` existed (and a hand-built fixture pinning one other rule)
  // has no target to measure against, and inventing one from `duration_s`
  // here would resurrect the very range-vs-target bug this rule closes.
  const targetWords = brief.style.target_words;
  if (typeof targetWords === 'number' && targetWords > 0 && totalWords > 0) {
    const lo = Math.round(targetWords * (1 - LENGTH_TOLERANCE));
    const hi = Math.round(targetWords * (1 + LENGTH_TOLERANCE));
    if (totalWords < lo || totalWords > hi) {
      out.push({
        beat: null, rule: 'length',
        detail: `${totalWords} words (~${seconds.toFixed(1)}s spoken), expected ${targetWords} words `
          + `+/-${Math.round(LENGTH_TOLERANCE * 100)}% (${lo}-${hi}) for a ${brief.style.target_seconds}s script — `
          + `${totalWords < lo ? 'too short' : 'too long'} by ${totalWords < lo ? lo - totalWords : totalWords - hi} words`,
      });
    }
  }
  const perSecond = seconds > 0 ? events / seconds : 0;
  if (seconds > 0 && (perSecond < brief.visual.density.floor || perSecond > brief.visual.density.ceiling)) {
    out.push({
      beat: null, rule: 'density',
      detail: `${perSecond.toFixed(3)} events/s, expected between ${brief.visual.density.floor} and ${brief.visual.density.ceiling}`,
    });
  }

  return out;
}
