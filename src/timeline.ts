import type { Beat } from './motion';

/** Word-level timing, kept for the downstream subtitle tool, not rendered. */
export type Caption = { text: string; startMs: number; endMs: number };
import c01 from './data/timeline-C01.json';
import c01f from './data/timeline-C01F.json';
import s371e3032 from './data/timeline-371e3032.json';

/**
 * A timeline produced by scripts/tts.ts from real audio: beat boundaries are
 * measured off the WAVs rather than estimated from syllable counts. The file is
 * always present (empty until the first `npx tsx scripts/tts.ts` run) because a
 * bundler cannot statically import a path that may not exist.
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

const FILES: Record<string, any> = { C01: c01, C01F: c01f, '371e3032': s371e3032 };

export function loadTimeline(id: string): Timeline | null {
  const t = FILES[id];
  if (!t || !Array.isArray(t.beats) || t.beats.length === 0) return null;
  return {
    beats: t.beats, captions: t.captions, durationMs: t.durationMs,
    audio: t.audio, chunks: t.chunks,
  };
}
