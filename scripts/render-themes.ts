/**
 * Render the same two charts in every theme so the identity can be judged by
 * eye rather than described. Bundles once per theme, because the theme is
 * resolved at bundle time.
 */
import { bundle } from '@remotion/bundler';
import { selectComposition, renderStill } from '@remotion/renderer';
import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { THEMES } from '../src/themes';

const OUT = join(process.cwd(), 'out/themes');
mkdirSync(OUT, { recursive: true });
const SHOTS: [string, number][] = [
  ['C01-cumulative-lines', 700],
  ['C04-diverging-bar', 250],
];
const active = join(process.cwd(), 'src/data/active-theme.json');
const restore = process.argv[2] ?? 'court';

for (const name of Object.keys(THEMES)) {
  writeFileSync(active, JSON.stringify({ theme: name }, null, 1) + '\n');
  const serveUrl = await bundle({ entryPoint: join(process.cwd(), 'src/index.ts') });
  for (const [id, frame] of SHOTS) {
    const composition = await selectComposition({ serveUrl, id });
    await renderStill({
      composition, serveUrl, frame,
      output: join(OUT, `${name}__${id}.png`),
      imageFormat: 'png', chromiumOptions: { gl: 'angle' },
    });
    console.log(`  ${name} / ${id}`);
  }
}
writeFileSync(active, JSON.stringify({ theme: restore }, null, 1) + '\n');
console.log(`done (theme left at ${restore})`);
