/** Bundle once, render the requested compositions to mp4. */
import { bundle } from '@remotion/bundler';
import { eventDensity, DENSITY_FLOOR, DENSITY_CEILING } from '../src/accent';
import { loadTimeline } from '../src/timeline';
import { selectComposition, renderMedia } from '@remotion/renderer';
import { appendLedger, latestById, readLedger } from '../src/content/ledger';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';

const OUT = join(process.cwd(), 'out');
mkdirSync(OUT, { recursive: true });
const argv = process.argv.slice(2);
const force = argv.includes('--force');
const ids = argv.filter((a) => !a.startsWith('--'));
if (!ids.length) throw new Error('pass composition ids');

/**
 * A chart video with too few visual events reads as a freeze frame, and that is
 * measured, not felt: the competitor audit put four winning Shorts at 0.24-0.38
 * cuts/sec and the one it judged "really bad" at 0.08. Refuse to ship below the
 * floor rather than find out after upload.
 */
for (const id of ids) {
  const tl = loadTimeline(id.split('-')[0]);
  if (!tl) continue;
  const d = eventDensity(tl.beats, tl.durationMs);
  const verdict = d.perSecond < DENSITY_FLOOR ? 'TOO STATIC'
    : d.perSecond > DENSITY_CEILING ? 'BUSY' : 'ok';
  console.log(`  ${id}: ${d.events} visual events / ${(tl.durationMs / 1000).toFixed(1)}s = ` +
              `${d.perSecond.toFixed(3)}/s  [${verdict}]`);
  if (d.perSecond > DENSITY_CEILING) {
    console.log(`     ^ above the ${DENSITY_CEILING}/s ceiling — accents will trip over each other. ` +
                `Drop ~${d.events - Math.floor(DENSITY_CEILING * tl.durationMs / 1000)}.`);
  }
  if (d.perSecond < DENSITY_FLOOR && !force) {
    const need = Math.ceil(DENSITY_FLOOR * tl.durationMs / 1000) - d.events;
    throw new Error(
      `${id} is below the ${DENSITY_FLOOR}/s floor. Add ~${need} more accents, ` +
      `or pass --force to render it anyway.`);
  }
}

const serveUrl = await bundle({ entryPoint: join(process.cwd(), 'src/index.ts') });
console.log('bundled');

for (const id of ids) {
  const composition = await selectComposition({ serveUrl, id });
  const t = Date.now();
  let last = -1;
  await renderMedia({
    composition, serveUrl,
    codec: 'h264',
    outputLocation: join(OUT, `${id}.mp4`),
    chromiumOptions: { gl: 'angle' },
    concurrency: 4,
    onProgress: ({ progress }) => {
      const pct = Math.floor(progress * 100);
      if (pct >= last + 25) { last = pct; process.stdout.write(`  ${id} ${pct}%\n`); }
    },
  });
  console.log(`  ${id} -> out/${id}.mp4  (${composition.durationInFrames}f, ${((Date.now() - t) / 1000).toFixed(1)}s)`);

  // Composition ids for generated videos are `<sessionId>-<chart>` — match
  // the session id EXACTLY (not by loose prefix) against the ledger. The
  // eleven C01…C11 demo ids match no session and are left alone, silently.
  const sessionId = id.split('-')[0];
  const prior = latestById(readLedger()).find((r) => r.session === sessionId);
  if (prior) {
    appendLedger({ ...prior, status: 'produced', at: new Date().toISOString() });
    console.log(`     ledger: ${prior.id} -> produced`);
  }
}
