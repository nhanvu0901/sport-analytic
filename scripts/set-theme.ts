import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { THEMES } from '../src/themes';

const name = process.argv[2];
if (!name || !THEMES[name]) {
  console.log('usage: npx tsx scripts/set-theme.ts <name>');
  for (const [k, t] of Object.entries(THEMES)) console.log(`  ${k.padEnd(11)} ${t.blurb}`);
  process.exit(1);
}
writeFileSync(join(process.cwd(), 'src/data/active-theme.json'), JSON.stringify({ theme: name }, null, 1) + '\n');
console.log(`theme -> ${name}: ${THEMES[name].blurb}`);
