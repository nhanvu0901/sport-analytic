import { interpolate } from 'remotion';
import { easeOut } from './scale';

/**
 * Where an accent points — in DATA space, never pixels.
 *
 * The old annotations carried absolute frame coordinates
 * (`from: [430, 980]`), hardcoded by eye against one theme's plot box. Change
 * the theme and the arrow points at nothing, which is exactly what happened.
 * More importantly: the writer is Gemini, and Gemini cannot know pixels. It
 * CAN say "point at Zion in 2021-22", so that is the contract.
 */
export type Anchor = {
  entityId: string;
  /** Which step along that entity's series — a season label, a year, or an
   *  index. Omitted means its final point. */
  step?: string | number;
  /**
   * "The record line on this chart", not a point on a series.
   *
   * A record chase is one cumulative series plus one absolute threshold, and
   * until this existed the writer could not point at the threshold at all:
   * an Anchor could only name an entity and a step, and a record is neither.
   * So the interesting sentence in a chase video — the one that puts a
   * `refline` or an `arrow` on the mark being chased — was unwritable.
   *
   * `entityId` stays REQUIRED and names the entity whose chart this is, which
   * is what lets `Resolve` keep one signature and every existing anchor keep
   * working unchanged. A chart with no record resolves this to null rather
   * than guessing, and `verifyDraft` rejects it before that can matter.
   */
  record?: true;
  /**
   * Which fixed reference LINE this anchor names, on a chart that draws more
   * than one of them.
   *
   * `record` above can only ever mean "the one line on this chart". A salary
   * column has six places of that kind — the floor, the cap, the tax, the two
   * aprons, and the payroll's own top — so a boolean cannot say which, and a
   * boolean per line would not survive the seventh chart. A video about a team
   * sitting under the tax has to point at the TAX line specifically, and this
   * is the field that lets it.
   *
   * The vocabulary is NOT here: the brief publishes the keys it accepts as
   * `visual.threshold_keys` (built from `THRESHOLD_LINES` and `PAYROLL_KEY` in
   * src/videoData.ts) and `verifyDraft` checks the anchor against that list, so
   * this module stays free of CBA words and the next chart's lines cost it
   * nothing.
   *
   * `entityId` stays REQUIRED for exactly the reason it does on `record` — it
   * says whose chart this is, and it keeps `Resolve` to one signature.
   */
  threshold?: string;
};

/** A closed set. The writer picks from these; anything else is a schema error. */
export type AccentKind = 'zoom' | 'refline' | 'callout' | 'arrow' | 'spotlight' | 'span';

export type Accent = {
  /** When inside its beat, 0..1. */
  t: number;
  kind: AccentKind;
  at?: Anchor;
  /**
   * The SECOND anchor, and only a `span` uses it.
   *
   * A span is the one accent that is about the distance between two places
   * rather than about one place, so it is the one accent that cannot be
   * expressed with a single `at`. Before it existed the writer wrote the
   * relation into an arrow's text instead — `{ kind: 'arrow', at: record,
   * text: '11,829 short' }` on beat 5 of out/draft-371e3032.json — which
   * writes the sentence's own words beside a line without drawing anything.
   */
  to?: Anchor;
  /**
   * Label for callout / arrow / refline.
   *
   * Never for a `span`: a span's label is the measured difference between its
   * two anchors, computed where the values live, so it cannot be a number the
   * writer made up. `verifyDraft` rejects an authored `text` on one.
   */
  text?: string;
};

export const ACCENT_KINDS: AccentKind[] = ['zoom', 'refline', 'callout', 'arrow', 'spotlight', 'span'];

/** Resolve an anchor to absolute frame pixels. Charts supply this; only they
 *  know their own scales. Returns null when the anchor names nothing. */
export type Resolve = (a: Anchor) => { x: number; y: number } | null;

/**
 * How long an accent takes to land, in WALL-CLOCK milliseconds.
 *
 * This used to be `span = 0.22` — a fraction of the beat — and that is why
 * accents crawled into view. Beats in out/371e3032-cumulative-record-chase.mp4
 * run 7.1-10.2s, so 0.22 of a beat is 1.56-2.25s (avg 1.87s) of ease-in: even
 * an accent placed on exactly the right word was still fading up nearly two
 * seconds after the word was spoken. A pop is a pop at any beat length, so the
 * duration is fixed and the beat fraction is derived from it per beat.
 */
export const ACCENT_LAND_MS = 350;

/**
 * The minimum distance between two accents in one beat, as a fraction of the
 * beat. `verifyDraft` rejects a draft that breaks it and `src/sync.ts` restores
 * it after snapping accents onto measured words; prompts/WRITER_SKILL.md states
 * it to the writer. One constant so the three cannot drift apart.
 */
export const MIN_ACCENT_GAP = 0.12;

/** `ACCENT_LAND_MS` as a share of THIS beat, which is the unit `t` lives in. */
export const accentSpan = (beatMs: number, landMs = ACCENT_LAND_MS) =>
  beatMs > 0 ? Math.min(1, landMs / beatMs) : 1;

/**
 * 0 before the accent fires, 1 once it has fully landed.
 *
 * `beatMs` is the beat's own duration, and it is required: the landing span is
 * wall-clock (`ACCENT_LAND_MS`), so the conversion to beat-relative `t` can
 * only happen here, where the beat is known. Still a pure function of time.
 */
export const accentProgress = (
  accent: Accent,
  beatProgress: number,
  beatMs: number,
  landMs = ACCENT_LAND_MS
) => {
  const to = Math.min(1, accent.t + accentSpan(beatMs, landMs));
  // `interpolate` needs a strictly increasing range, and an accent snapped to
  // the last word of a beat can sit at t=1 with nowhere left to travel.
  if (to <= accent.t) return beatProgress >= accent.t ? 1 : 0;
  return easeOut(interpolate(beatProgress, [accent.t, to], [0, 1], {
    extrapolateLeft: 'clamp', extrapolateRight: 'clamp',
  }));
};

/**
 * Visual events per second — the number the competitor audit measured.
 *
 * Their four winning videos sat at 0.24–0.38 cuts/sec; the video they judged
 * "really bad" sat at 0.08. A chart video has no cuts, so the equivalent is a
 * discrete visual event: a beat starting, or an accent firing.
 */
export function eventDensity(
  beats: { accents?: Accent[] }[],
  durationMs: number
): { events: number; perSecond: number } {
  const events = beats.reduce((n, b) => n + 1 + (b.accents?.length ?? 0), 0);
  const seconds = durationMs / 1000;
  return { events, perSecond: seconds > 0 ? events / seconds : 0 };
}

/**
 * The measured band, not a preference: the competitor audit put four winning
 * Shorts at 0.24-0.38 visual events per second and the one it judged
 * "really bad" at 0.08. Below the floor reads as a freeze frame; far above the
 * ceiling reads as noise.
 */
export const DENSITY_FLOOR = 0.22;
export const DENSITY_CEILING = 0.45;

/**
 * Per-beat accent bounds, as a closed interval.
 *
 * The floor is 1, not 2, and that is load-bearing: `eventDensity` above
 * counts the BEAT ITSELF as an event, so a 12-beat script at the 70-second
 * target paying "2 accents per beat" spends 12 + 24 = 36 events — 0.514/s,
 * clear of the 0.45 ceiling — before the writer has written anything wrong.
 * Two per beat is a preference the absolute budget in brief.ts grants only
 * when the arithmetic leaves room for it; one per beat is the structural
 * minimum that always holds, because a beat with NO accent is exactly the
 * frozen picture the audit measured at 0.08 events/s.
 *
 * The ceiling of 3 is the same 3 `style.forbidden` names ("more than 3
 * accents in one beat"): more than three emphases inside one spoken
 * sentence stop reading as emphasis.
 */
export const MIN_ACCENTS_PER_BEAT = 1;
export const MAX_ACCENTS_PER_BEAT = 3;
