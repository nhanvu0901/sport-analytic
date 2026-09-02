/** Bundle once, render the requested compositions to mp4. */
import { bundle } from '@remotion/bundler';
import { selectComposition, renderMedia } from '@remotion/renderer';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';

const OUT = join(process.cwd(), 'out');
mkdirSync(OUT, { recursive: true });
const ids = process.argv.slice(2);
if (!ids.length) throw new Error('pass composition ids');

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
}
