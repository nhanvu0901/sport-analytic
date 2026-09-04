import type { Beat } from './motion';
import type { Draft } from './verify';
import { buildTimeline, type ScriptLine } from './script';
import { draftToScriptLines } from './scripts';
import { loadTimeline, type Timeline } from './timeline';

import draftC01 from './data/draft-C01.json';
import draftC01F from './data/draft-C01F.json';
import draft371e3032 from './data/draft-371e3032.json';

/**
 * A generated script reaching the PICTURE, not just the audio.
 *
 * `scripts/write.ts` writes the accepted draft to `out/draft-<id>.json` — what
 * `scripts/tts.ts` narrates — and mirrors it to `src/data/draft-<id>.json`,
 * which is what this module reads. The mirror exists because a Remotion bundle
 * is a browser bundle: it has no `fs`, and `out/` is not in its module graph.
 * Same reason `src/timeline.ts` reads `src/data/timeline-<id>.json` instead of
 * measuring a WAV at render time. `scripts/write.ts` writes the other half of
 * this convention and points back here.
 *
 * The files are always present (an empty `{}` until the first write) because a
 * bundler cannot statically import a path that may not exist — which is also
 * why adding an id here is two edits, the import and `FILES`, and not a glob.
 *
 * Everything in here runs ONCE, at module scope, and returns plain data. No
 * hook, no state, no frame arithmetic — the components that consume these
 * beats keep their transforms a pure function of time.
 */

const FILES: Record<string, unknown> = { C01: draftC01, C01F: draftC01F, '371e3032': draft371e3032 };

/** The accepted draft for a brief id, or null when none has been written. */
export function loadDraft(id: string): Draft | null {
  const d = FILES[id] as Draft | undefined;
  if (!d || !Array.isArray(d.beats) || d.beats.length === 0) return null;
  return d;
}

/**
 * What one composition should draw: a title, beats carrying accents, a
 * duration, and the audio to play under it.
 *
 * Precedence, and the reason for each rank:
 *
 *  - TIMING comes from the measured timeline whenever there is one. It was
 *    measured off the WAV that is actually playing, so nothing may override
 *    it or every accent drifts off the voice.
 *  - CONTENT — title, entity order, accents — comes from the draft. When the
 *    timeline's own record of what it narrated matches the draft beat for
 *    beat, the draft's accents are laid over the measured spans: the draft's
 *    picture on the voice's clock.
 *  - When they do NOT match, the audio narrates something else (a draft
 *    written after the WAV, or `SCRIPTS[id]`). The audio wins, because it is
 *    what the viewer hears, and the mismatch is logged with the command that
 *    fixes it — Remotion forwards browser console output into the render log,
 *    and Studio shows it directly.
 *  - With no timeline at all, the draft is timed by `buildTimeline`'s
 *    syllable estimate, exactly as a hardcoded script is.
 *  - With no draft at all, `SCRIPTS[id]` drives everything, exactly as before
 *    — which is what keeps the eleven demo compositions working.
 */
export type Stage = {
  title: string;
  beats: Beat[];
  durationMs: number;
  audio?: string;
  /** For the render log: which of the four cases above actually fired. */
  source: string;
};

const norm = (s: string) => s.replace(/\s+/g, ' ').trim();

/**
 * Does this measured timeline's audio actually say this draft?
 *
 * Reconstructs what the WAV says, one entry per beat, from the per-sentence
 * chunks `scripts/tts.ts` persists (`toSentences` normalises whitespace and
 * splits on sentence boundaries, so re-joining the chunks of one beat with
 * single spaces reproduces that beat's text).
 *
 * Beat COUNT alone cannot answer this, and that is not hypothetical:
 * `out/draft-C01F.json` and the source-video transcript in `SCRIPTS.C01F` are
 * both exactly ten beats long, so counting would happily overlay one's accents
 * onto the other's timings and put every arrow on the wrong sentence.
 *
 * False for a timeline written before chunks were persisted — the conservative
 * answer, since there is then no evidence either way.
 */
export function narratesDraft(t: Pick<Timeline, 'chunks'>, draft: Draft): boolean {
  if (!t.chunks?.length) return false;
  const byBeat: string[][] = [];
  for (const c of t.chunks) (byBeat[c.beatIndex] ??= []).push(c.text);
  const said = Array.from(byBeat, (parts) => norm((parts ?? []).join(' ')));
  return said.length === draft.beats.length
    && said.every((text, i) => text === norm(draft.beats[i].text));
}

export function stageFor(id: string, fallback: ScriptLine[], fallbackTitle: string): Stage {
  const draft = loadDraft(id);
  const measured = loadTimeline(id);
  const title = draft?.title ?? fallbackTitle;

  if (!measured) {
    const est = buildTimeline(draft ? draftToScriptLines(draft) : fallback);
    return {
      title, beats: est.beats, durationMs: est.durationMs,
      source: draft ? 'draft, estimated timing (no audio yet)' : 'SCRIPTS, estimated timing (no audio yet)',
    };
  }

  const base = { durationMs: measured.durationMs, audio: measured.audio };
  if (!draft) return { title, beats: measured.beats, ...base, source: 'measured audio + SCRIPTS' };

  if (!narratesDraft(measured, draft)) {
    console.warn(
      `[${id}] src/data/draft-${id}.json is NOT what public/${measured.audio ?? 'the audio'} narrates, `
      + 'so the measured timeline is being drawn as-is and the draft\'s accents are ignored. '
      + `Fix: npx tsx scripts/tts.ts ${id} out/draft-${id}.json`
    );
    return { title, beats: measured.beats, ...base, source: 'measured audio, draft ignored (script mismatch)' };
  }

  // Same script: measured spans, the draft's entities and accents.
  const beats = measured.beats.map((b, i) => ({
    ...b,
    entityId: draft.beats[i].entityId,
    accents: draft.beats[i].accents,
  }));
  return { title, beats, ...base, source: 'measured audio + draft accents' };
}

/** The largest number in this brief that carries a thousands separator, which
 *  is what the rule is about. Falls back to the measured 8,391 for a brief
 *  whose numbers are all small. */
export function separatorExample(allowed: readonly (number | string)[]): string {
  const big = allowed
    .map((n) => (typeof n === 'number' ? n : Number(String(n).replace(/,/g, ''))))
    .filter((n) => Number.isFinite(n) && n >= 1000);
  return big.length ? Math.max(...big).toLocaleString('en-US') : '8,391';
}
