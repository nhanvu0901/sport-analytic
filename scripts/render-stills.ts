/** Bundle once, then render every still from the same bundle. */
import { bundle } from '@remotion/bundler';
import { selectComposition, renderStill } from '@remotion/renderer';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';

const OUT = join(process.cwd(), 'out/stills');
mkdirSync(OUT, { recursive: true });

const SHOTS: [string, number][] = [
  ['C01-cumulative-lines', 700],
  ['C01F-cumulative-lines-source-script', 900],
  ['C02-stacked-column-thresholds', 400],
  ['C03-ranked-bar', 300],
  ['C04-diverging-bar', 250],
  ['C05-proportion-bar', 260],
  ['C06-bar-delta', 300],
  ['C07-scatter-image', 260],
  ['C08-dot-strip', 220],
];

console.log('bundling…');
const serveUrl = await bundle({
  entryPoint: join(process.cwd(), 'src/index.ts'),
  onProgress: (p) => p === 100 && process.stdout.write('  bundled\n'),
});

for (const [id, frame] of SHOTS) {
  const composition = await selectComposition({ serveUrl, id });
  const t = Date.now();
  await renderStill({
    composition, serveUrl, frame,
    output: join(OUT, `${id}.png`),
    imageFormat: 'png',
    chromiumOptions: { gl: 'angle' },
  });
  console.log(`  ${id} @${frame}  ${Date.now() - t}ms`);
}
console.log('done');
