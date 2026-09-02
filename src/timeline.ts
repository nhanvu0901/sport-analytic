import type { Beat } from './motion';

/** Word-level timing, kept for the downstream subtitle tool, not rendered. */
export type Caption = { text: string; startMs: number; endMs: number };
import c01 from './data/timeline-C01.json';
import c01f from './data/timeline-C01F.json';

/**
 * A timeline produced by scripts/tts.ts from real audio: beat boundaries are
 * measured off the WAVs rather than estimated from syllable counts. The file is
 * always present (empty until the first `npx tsx scripts/tts.ts` run) because a
 * bundler cannot statically import a path that may not exist.
 */
export type Timeline = { beats: Beat[]; captions: Caption[]; durationMs: number; audio?: string };

const FILES: Record<string, any> = { C01: c01, C01F: c01f };

export function loadTimeline(id: string): Timeline | null {
  const t = FILES[id];
  if (!t || !Array.isArray(t.beats) || t.beats.length === 0) return null;
  return { beats: t.beats, captions: t.captions, durationMs: t.durationMs, audio: t.audio };
}
