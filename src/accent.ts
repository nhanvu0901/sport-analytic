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
};

/** A closed set. The writer picks from these; anything else is a schema error. */
export type AccentKind = 'zoom' | 'refline' | 'callout' | 'arrow' | 'spotlight';

export type Accent = {
  /** When inside its beat, 0..1. */
  t: number;
  kind: AccentKind;
  at?: Anchor;
  /** Label for callout / arrow / refline. */
  text?: string;
};

export const ACCENT_KINDS: AccentKind[] = ['zoom', 'refline', 'callout', 'arrow', 'spotlight'];

/** Resolve an anchor to absolute frame pixels. Charts supply this; only they
 *  know their own scales. Returns null when the anchor names nothing. */
export type Resolve = (a: Anchor) => { x: number; y: number } | null;

/** 0 before the accent fires, 1 once it has fully landed. */
export const accentProgress = (accent: Accent, beatProgress: number, span = 0.22) =>
  easeOut(interpolate(beatProgress, [accent.t, Math.min(1, accent.t + span)], [0, 1], {
    extrapolateLeft: 'clamp', extrapolateRight: 'clamp',
  }));

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
