/**
 * Every generated video, DISCOVERED rather than named.
 *
 * A generated video is three files in `src/data/`, all keyed by the session id:
 *
 *   video-<id>.json     the chart — seasons, series, the record line
 *                       (server/index.ts writes it from the brief)
 *   draft-<id>.json     what is said, and where each accent lands
 *                       (src/writer.ts mirrors it out of out/)
 *   timeline-<id>.json  when it is said, measured off the WAV
 *                       (scripts/tts.ts writes it)
 *
 * They used to be three static imports plus a hand-written `stageFor(...)`
 * call in `src/Root.tsx` per video, which meant a new session could not be
 * rendered without a code edit — and the "Generate video" button in the Brief
 * screen offered to do exactly that, then failed on a composition that had
 * never been declared.
 *
 * `require.context` is webpack's build-time glob, and Remotion 4.0.520 bundles
 * with webpack 5 (rspack is opt-in and off), so the three families are
 * enumerated at bundle time instead. Verified against this version: it returns
 * every matching file and each `ctx(key)` is the parsed JSON object.
 *
 * THIS MODULE IS BROWSER-ONLY. `require.context` exists only inside a webpack
 * build; under `tsx`/node it would throw. Nothing outside the Remotion bundle
 * may import it — which is why the pure parts live in `./videoData` (the
 * shape, the wired-chart list) and `./drafts` / `./timeline` (which now take
 * their data as arguments instead of importing files themselves).
 */
import type { VideoData } from './videoData';

declare const require: {
  context(dir: string, deep: boolean, re: RegExp): { keys(): string[]; (key: string): unknown };
};

const ctx = require.context('./data', false, /^\.\/(video|draft|timeline)-.+\.json$/);

/** `"./video-8fd3d896.json"` -> `"video-8fd3d896"`. */
const nameOf = (key: string) => key.replace(/^\.\//, '').replace(/\.json$/, '');

// Sorted so the composition list — and therefore every render log, every
// `remotion compositions` run and every snapshot of them — is stable rather
// than dependent on the order the filesystem happened to hand back.
const files = new Map<string, unknown>(
  ctx.keys().sort().map((key) => [nameOf(key), ctx(key)])
);

/** The accepted draft mirrored for this id, or undefined when none was written. */
export const draftFor = (id: string): unknown => files.get(`draft-${id}`);

/** The measured timeline for this id, or undefined when it has not been narrated. */
export const timelineFor = (id: string): unknown => files.get(`timeline-${id}`);

/**
 * One entry per `video-<id>.json`. The id comes out of the FILE, not the
 * filename, so a file that was copied or renamed by hand cannot quietly claim
 * a composition id whose draft and timeline belong to a different session.
 */
export const VIDEOS: VideoData[] = [...files]
  .filter(([name]) => name.startsWith('video-'))
  .map(([, data]) => data as VideoData)
  .filter((v) => v && typeof v.id === 'string' && typeof v.chart === 'string');
