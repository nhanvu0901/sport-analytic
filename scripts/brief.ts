/** `npx tsx scripts/brief.ts <id>` — build the writer brief and drop it in out/. */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { buildBrief } from '../src/brief';

const id = process.argv[2] as 'C01' | 'C01F' | undefined;
if (id !== 'C01' && id !== 'C01F') {
  console.error('usage: tsx scripts/brief.ts <C01|C01F>');
  process.exit(1);
}

const brief = await buildBrief(id);

const OUT = join(process.cwd(), 'out');
mkdirSync(OUT, { recursive: true });
const path = join(OUT, `brief-${id}.json`);
writeFileSync(path, JSON.stringify(brief, null, 2));

const tally = new Map<string, number>();
for (const m of brief.facts.markers) tally.set(m.kind, (tally.get(m.kind) ?? 0) + 1);

console.log(`entities:        ${brief.facts.entities.length}`);
console.log(`markers:         ${brief.facts.markers.length} (${[...tally.entries()].map(([k, n]) => `${k}=${n}`).join(', ')})`);
console.log(`allowed_numbers: ${brief.facts.allowed_numbers.length}`);
console.log(`chart:           ${brief.visual.chart}`);
console.log(`wrote:           ${path}`);
