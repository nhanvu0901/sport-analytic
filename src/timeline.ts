import type { Beat } from './motion';

/** Word-level timing, kept for the downstream subtitle tool, not rendered. */
export type Caption = { text: string; startMs: number; endMs: number };

/**
 * A timeline produced by scripts/tts.ts from real audio: beat boundaries are
 * measured off the WAVs rather than estimated from syllable counts.
 */
export type Timeline = {
  beats: Beat[];
  captions: Caption[];
  durationMs: number;
  audio?: string;
  /**
   * One entry per synthesised sentence, in order, tagged with the beat it
   * belongs to — the timeline's own record of what the WAV actually says.
   * `src/drafts.ts` reads it to decide whether a draft's accents may be laid
   * over these measured spans, or whether the audio narrates a different
   * script entirely. Absent in a timeline written before it was persisted.
   */
  chunks?: { text: string; beatIndex: number }[];
};

/**
 * A parsed `timeline-<id>.json`, or null when there is nothing usable in it.
 *
 * This module no longer imports the files itself. The renderer gets them from
 * `src/videos.ts`, which globs `src/data/` at bundle time; node callers
 * (`scripts/render-videos.ts`) read them off disk. Keeping the validation here
 * and the loading out there is what lets a new session be rendered without an
 * import being added by hand — the bug this replaced.
 */
export function asTimeline(raw: unknown): Timeline | null {
  const t = raw as Partial<Timeline> | undefined | null;
  if (!t || !Array.isArray(t.beats) || t.beats.length === 0) return null;
  return {
    beats: t.beats,
    captions: t.captions ?? [],
    durationMs: t.durationMs ?? 0,
    audio: t.audio,
    chunks: t.chunks,
  };
}
