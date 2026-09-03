/** `npx tsx scripts/brief.ts <C01|C01F> [--md-only]` — build the writer brief
 *  and drop it in out/: JSON for scripts/draft.ts, Markdown for pasting. */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { buildBrief } from '../src/brief';
import { renderBriefMd } from '../src/briefMd';

const id = process.argv[2] as 'C01' | 'C01F' | undefined;
const mdOnly = process.argv.includes('--md-only');
if (id !== 'C01' && id !== 'C01F') {
  console.error('usage: tsx scripts/brief.ts <C01|C01F> [--md-only]');
  process.exit(1);
}

const brief = await buildBrief(id);

const OUT = join(process.cwd(), 'out');
mkdirSync(OUT, { recursive: true });

const jsonPath = join(OUT, `brief-${id}.json`);
if (!mdOnly) writeFileSync(jsonPath, JSON.stringify(brief, null, 2));

const mdPath = join(OUT, `brief-${id}.md`);
writeFileSync(mdPath, renderBriefMd(brief));

const tally = new Map<string, number>();
for (const m of brief.facts.markers) tally.set(m.kind, (tally.get(m.kind) ?? 0) + 1);

console.log(`entities:        ${brief.facts.entities.length}`);
console.log(`markers:         ${brief.facts.markers.length} (${[...tally.entries()].map(([k, n]) => `${k}=${n}`).join(', ')})`);
console.log(`allowed_numbers: ${brief.facts.allowed_numbers.length}`);
console.log(`chart:           ${brief.visual.chart}`);
if (!mdOnly) console.log(`wrote:           ${jsonPath}`);
console.log(`wrote:           ${mdPath}`);
