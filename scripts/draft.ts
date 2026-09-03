/**
 * `npx tsx scripts/draft.ts <id> <path/to/draft.json>`
 * `npx tsx scripts/draft.ts <id> -`                      (read the pasted JSON from stdin)
 *
 * Ingests what Gemini returned after being pasted prompts/WRITER_SKILL.md and
 * out/brief-<id>.md, checks it against the brief with verifyDraft, and writes
 * out/draft-<id>.json only when every rule passes. No network call anywhere
 * in this file — Gemini is a human pasting into a chat box here, never an API
 * this pipeline calls.
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { parseDraftText, verifyDraft } from '../src/verify';
import type { WriterBrief } from '../src/brief';

const id = process.argv[2];
const src = process.argv[3];
if (!id || !src) {
  console.error('usage: tsx scripts/draft.ts <id> <path/to/draft.json | ->');
  process.exit(1);
}

const briefPath = join(process.cwd(), 'out', `brief-${id}.json`);
if (!existsSync(briefPath)) {
  console.error(`no brief at ${briefPath} — run: npx tsx scripts/brief.ts ${id}`);
  process.exit(1);
}
const brief: WriterBrief = JSON.parse(readFileSync(briefPath, 'utf8'));

const raw = src === '-' ? readFileSync(0, 'utf8') : readFileSync(src, 'utf8');

const parsed = parseDraftText(raw);
if (!parsed.ok) {
  console.error(parsed.error);
  process.exit(1);
}
const { draft } = parsed;

const violations = verifyDraft(draft, brief);
if (violations.length > 0) {
  const sorted = [...violations].sort((a, b) => (a.beat ?? -1) - (b.beat ?? -1));
  for (const v of sorted) console.log(`beat ${v.beat ?? '-'} · ${v.rule} · ${v.detail}`);
  console.log(`${violations.length} violations — fix and paste again`);
  process.exit(1);
}

const WORDS_PER_SECOND = 2.9;   // matches verifyDraft's own default
const totalWords = draft.beats.reduce((n, b) => n + b.text.split(/\s+/).filter(Boolean).length, 0);
const totalAccents = draft.beats.reduce((n, b) => n + (b.accents?.length ?? 0), 0);
const seconds = totalWords / WORDS_PER_SECOND;
const events = draft.beats.length + totalAccents;
const perSecond = seconds > 0 ? events / seconds : 0;

console.log(`beats:    ${draft.beats.length}`);
console.log(`words:    ${totalWords}`);
console.log(`duration: ~${seconds.toFixed(1)}s estimated (${WORDS_PER_SECOND} words/s)`);
console.log(`events:   ${events} (${draft.beats.length} beats + ${totalAccents} accents)`);
console.log(`density:  ${perSecond.toFixed(3)} events/s (brief band ${brief.visual.density.floor}–${brief.visual.density.ceiling})`);

const outPath = join(process.cwd(), 'out', `draft-${id}.json`);
writeFileSync(outPath, JSON.stringify(draft, null, 2));
console.log(`wrote:    ${outPath}`);
console.log(`next:     npx tsx scripts/tts.ts ${id} ${outPath}`);
