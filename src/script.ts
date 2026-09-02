import type { Beat } from './motion';
import type { Accent } from './accent';
import type { Caption } from './timeline';

/**
 * PLACEHOLDER TIMING.
 *
 * In the real pipeline this whole module is replaced by the ElevenLabs
 * `with-timestamps` response, which returns per-character alignment alongside
 * the audio — so beat and caption timings come from the actual voice track and
 * cannot drift. Until that is wired up, timings are estimated from syllable
 * count at a fixed speaking rate, which is enough to prove the animation
 * layer works.
 */
const WORDS_PER_MIN = 165;
const MS_PER_WORD = (60 / WORDS_PER_MIN) * 1000;
const GAP_MS = 240;

export type ScriptLine = { entityId: string; text: string; accents?: Accent[] };

const weight = (word: string) => {
  const vowels = (word.toLowerCase().match(/[aeiouy]+/g) ?? []).length || 1;
  return Math.max(0.55, Math.min(2.2, vowels * 0.62));
};

export function buildTimeline(lines: ScriptLine[], startMs = 400) {
  const beats: Beat[] = [];
  const captions: Caption[] = [];
  let t = startMs;

  for (const line of lines) {
    const words = line.text.split(/\s+/).filter(Boolean);
    const beatStart = t;
    for (const w of words) {
      const dur = MS_PER_WORD * weight(w);
      captions.push({ text: w.replace(/[^\w'’"%$.,+\-→]/g, ''), startMs: t, endMs: t + dur });
      t += dur;
    }
    beats.push({ entityId: line.entityId, startMs: beatStart, endMs: t, accents: line.accents });
    t += GAP_MS;
  }
  return { beats, captions, durationMs: t };
}

export const framesFor = (durationMs: number, fps: number, tailMs = 900) =>
  Math.ceil(((durationMs + tailMs) / 1000) * fps);
