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
