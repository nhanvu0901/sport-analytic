/**
 * `npx tsx scripts/write.ts <briefId> [--engine codex|gemini] [--force]`
 *
 * Replaces the "paste WRITER_SKILL.md then out/brief-<id>.md into a chat
 * box, paste the reply into scripts/draft.ts" loop with one real CLI call.
 * Same downstream pipeline as scripts/draft.ts (parseDraftText, verifyDraft,
 * out/draft-<id>.json) — the only thing this file adds is calling an engine
 * instead of a human.
 *
 * Default engine is `codex` (measured working + authenticated). `gemini` is
 * supported but, in this environment, is not authenticated — see
 * `runGemini` below for how that is detected and reported.
 *
 * Draft cache: an LLM CLI has no seed, so re-running this on an unchanged
 * brief would otherwise reshuffle the whole script every time — including
 * an already-approved one. Same pattern as src/tts/chatterbox.ts's
 * `cacheKey`: hash everything that affects the output (here: the brief JSON
 * text, the skill markdown text, the engine name, and the JSON schema) and
 * cache the engine's raw response under that hash. `--force` bypasses it.
 */
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { parseDraftText, verifyDraft } from '../src/verify';
import type { WriterBrief } from '../src/brief';
import { buildDraftSchema } from '../src/draftSchema';

type Engine = 'codex' | 'gemini';

/** Bump by hand when a change here (prompt shape, engine invocation, schema
 *  shape) should invalidate every cached draft even though the brief and
 *  skill text did not change. */
export const DRAFT_CACHE_VERSION = 'write-0.1.0';

type EngineResult =
  | { ok: true; text: string }
  | { ok: false; kind: 'auth' | 'refused' | 'error'; message: string };

/* --------------------------------------------------------------- args --- */

function parseArgs(argv: string[]): { id?: string; engine: Engine; force: boolean } {
  const id = argv[0];
  let engine: Engine = 'codex';
  let force = false;
  for (let i = 1; i < argv.length; i++) {
    if (argv[i] === '--engine') { engine = argv[++i] as Engine; }
    else if (argv[i] === '--force') { force = true; }
  }
  return { id, engine, force };
}

const { id, engine, force } = parseArgs(process.argv.slice(2));
if (!id) {
  console.error('usage: tsx scripts/write.ts <briefId> [--engine codex|gemini] [--force]');
  process.exit(1);
}
if (engine !== 'codex' && engine !== 'gemini') {
  console.error(`unknown --engine "${engine}" — expected "codex" or "gemini"`);
  process.exit(1);
}

/* ------------------------------------------------------------- inputs --- */

const OUT = join(process.cwd(), 'out');
const briefJsonPath = join(OUT, `brief-${id}.json`);
const briefMdPath = join(OUT, `brief-${id}.md`);
const skillPath = join(process.cwd(), 'prompts', 'WRITER_SKILL.md');

for (const p of [briefJsonPath, briefMdPath]) {
  if (!existsSync(p)) {
    console.error(`missing ${p} — run: npx tsx scripts/brief.ts ${id}`);
    process.exit(1);
  }
}
if (!existsSync(skillPath)) {
  console.error(`missing ${skillPath}`);
  process.exit(1);
}

const briefJsonText = readFileSync(briefJsonPath, 'utf8');
const briefMdText = readFileSync(briefMdPath, 'utf8');
const skillMdText = readFileSync(skillPath, 'utf8');
const brief: WriterBrief = JSON.parse(briefJsonText);
const schema = buildDraftSchema();

// What a human pasting into a chat box would paste, in the order
// WRITER_SKILL.md itself says to paste it: the skill once, then the brief.
const PROMPT = `${skillMdText}\n\n${briefMdText}\n`;

/* --------------------------------------------------------------- cache -- */

const cacheDir = () => process.env.WRITE_CACHE_DIR || join(process.cwd(), '.cache/drafts');
const sha1 = (s: string) => createHash('sha1').update(s).digest('hex');

function draftCacheKey(): string {
  // `brief.generated` is an ISO timestamp, so hashing the raw brief TEXT made
  // every `scripts/brief.ts` run invalidate every cached draft for that id.
  // That defeats the cache, which is the only thing standing in for the seed
  // a CLI engine does not have. Hash the brief's CONTENT instead.
  const { generated: _generated, ...content } = brief as WriterBrief & { generated?: string };
  return sha1(JSON.stringify({
    v: DRAFT_CACHE_VERSION,
    briefJson: JSON.stringify(content),
    skillMd: skillMdText,
    engine,
    schema,
  }));
}

const cacheKey = draftCacheKey();
const cachePath = join(cacheDir(), `${cacheKey}.json`);

/* -------------------------------------------------------------- procs --- */

function runProc(cmd: string, args: string[], stdin: string): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const proc = spawn(cmd, args, { stdio: ['pipe', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    proc.stdout.on('data', (d) => { stdout += d.toString(); });
    proc.stderr.on('data', (d) => { stderr += d.toString(); });
    proc.on('error', (err) => reject(new Error(`failed to spawn "${cmd}": ${err.message}`)));
    proc.on('close', (code) => resolve({ code: code ?? 1, stdout, stderr }));
    proc.stdin.write(stdin);
    proc.stdin.end();
  });
}

/**
 * `codex exec --skip-git-repo-check --sandbox read-only --output-schema
 * <schema.json> -o <out.json> - < prompt.txt` — measured: produced a valid
 * draft for C01F in 42s / 26,580 tokens, and `parseDraftText` read the `-o`
 * output file with no fence-stripping needed. The schema is OpenAI strict
 * structured output (see draftSchema.ts), so a malformed schema fails in
 * ~4s with `"code":"invalid_json_schema"` before the model is ever called —
 * that failure surfaces here as `kind: 'error'`, not `'auth'` or `'refused'`.
 *
 * codex's own auth-failure text was not measured in this environment (codex
 * was already authenticated) — the regex below is a best-effort guess at
 * likely wording, not a measured signature the way gemini's `code: 41` is.
 */
async function runCodex(prompt: string): Promise<EngineResult> {
  const schemaPath = join(mkdtempSync(join(tmpdir(), 'write-schema-')), 'schema.json');
  writeFileSync(schemaPath, JSON.stringify(schema, null, 2));
  const outPath = join(mkdtempSync(join(tmpdir(), 'write-out-')), 'draft.json');

  const args = ['exec', '--skip-git-repo-check', '--sandbox', 'read-only', '--output-schema', schemaPath, '-o', outPath, '-'];
  const { code, stdout, stderr } = await runProc('codex', args, prompt);
  const blob = `${stdout}\n${stderr}`.trim();

  if (/not logged in|not authenticated|please\s+(log|sign)\s*in|401\s*unauthorized|authentication required/i.test(blob)) {
    return { ok: false, kind: 'auth', message: blob.slice(0, 500) };
  }
  if (!existsSync(outPath)) {
    // codex exited without ever writing the -o file: either it crashed
    // (code !== 0) or it wrote prose to stdout instead of the schema'd
    // output. Either way there is no structured draft to parse.
    return {
      ok: false,
      kind: code !== 0 ? 'error' : 'refused',
      message: blob.slice(0, 1000) || `codex exited ${code} with no output file`,
    };
  }
  return { ok: true, text: readFileSync(outPath, 'utf8') };
}

/**
 * `gemini -o json` (== `--output-format json`) prints ONE JSON envelope to
 * stdout: `{ response: string, stats: {...} }` on success, or
 * `{ error: { message, code } }` on failure. Measured directly in this
 * environment, not authenticated: exits in ~3s with
 * `{"error":{"message":"Please set an Auth method in your
 * ~/.gemini/settings.json or specify one of the following environment
 * variables: GEMINI_API_KEY, GOOGLE_GENAI_USE_VERTEXAI,
 * GOOGLE_GENAI_USE_GCA","code":41}}`. `code: 41` is checked for
 * specifically so that case prints the one-line remedy instead of a
 * generic failure.
 */
async function runGemini(prompt: string): Promise<EngineResult> {
  const { code, stdout, stderr } = await runProc('gemini', ['-o', 'json'], prompt);

  // Measured live: on the auth error, gemini writes its JSON envelope to
  // STDERR (with a Node punycode deprecation warning ahead of it on the
  // same stream) and exits with the error's own `code` as the process exit
  // code — stdout is empty. A successful `-o json` run is documented to
  // print its envelope to stdout instead, so try both, and fall back to
  // slicing out the first {...} block from whichever stream has one.
  let parsed: any = null;
  for (const candidate of [stdout.trim(), stderr.trim()]) {
    if (!candidate) continue;
    try { parsed = JSON.parse(candidate); break; } catch { /* try next */ }
    const first = candidate.indexOf('{');
    const last = candidate.lastIndexOf('}');
    if (first !== -1 && last > first) {
      try { parsed = JSON.parse(candidate.slice(first, last + 1)); break; } catch { /* try next */ }
    }
  }

  if (parsed?.error?.code === 41) {
    return { ok: false, kind: 'auth', message: parsed.error.message ?? 'auth method not set (code 41)' };
  }
  if (parsed?.error) {
    return { ok: false, kind: 'error', message: `${parsed.error.message ?? 'unknown error'} (code ${parsed.error.code ?? '?'})` };
  }
  if (typeof parsed?.response === 'string') {
    return { ok: true, text: parsed.response };
  }
  // Exited 0 with a JSON envelope but no `.response` and no `.error`, or
  // didn't produce parseable JSON at all — either way, not a draft.
  const blob = `${stdout}\n${stderr}`.trim();
  return {
    ok: false,
    kind: code !== 0 && !parsed ? 'error' : 'refused',
    message: blob.slice(0, 1000) || `gemini exited ${code} with no usable output`,
  };
}

/* --------------------------------------------------------------- main --- */

let rawText: string;

if (!force && existsSync(cachePath)) {
  rawText = readFileSync(cachePath, 'utf8');
  console.log(`cache hit: ${cachePath} (no ${engine} call made)`);
} else {
  console.log(`calling ${engine}...`);
  const result = engine === 'codex' ? await runCodex(PROMPT) : await runGemini(PROMPT);

  if (!result.ok) {
    if (result.kind === 'auth') {
      console.error(`AUTH — ${engine} is not logged in / has no auth method configured.`);
      console.error(result.message);
      if (engine === 'gemini') {
        console.error('Remedy: export GEMINI_API_KEY=<your key>  (or run `gemini` once and complete its own interactive login).');
      } else {
        console.error('Remedy: run `codex login` (or whatever this codex install\'s own auth command is) and retry.');
      }
      process.exit(2);
    }
    if (result.kind === 'refused') {
      console.error(`REFUSED — ${engine} did not return structured output.`);
      console.error(result.message);
      process.exit(3);
    }
    console.error(`ERROR — ${engine} failed.`);
    console.error(result.message);
    process.exit(5);
  }

  rawText = result.text;
  mkdirSync(cacheDir(), { recursive: true });
  writeFileSync(cachePath, rawText);
  console.log(`cached: ${cachePath}`);
}

const parsed = parseDraftText(rawText);
if (!parsed.ok) {
  console.error(`REFUSED — ${engine} returned prose instead of JSON.`);
  console.error(parsed.error);
  process.exit(3);
}
const { draft } = parsed;

const violations = verifyDraft(draft, brief);
if (violations.length > 0) {
  console.error(`RULES — ${violations.length} violation(s) — nothing written to out/:`);
  const sorted = [...violations].sort((a, b) => (a.beat ?? -1) - (b.beat ?? -1));
  for (const v of sorted) console.error(`beat ${v.beat ?? '-'} · ${v.rule} · ${v.detail}`);
  process.exit(4);
}

const totalWords = draft.beats.reduce((n, b) => n + b.text.split(/\s+/).filter(Boolean).length, 0);
const totalAccents = draft.beats.reduce((n, b) => n + (b.accents?.length ?? 0), 0);

console.log(`title:    ${draft.title}`);
console.log(`beats:    ${draft.beats.length}`);
console.log(`words:    ${totalWords} (target ${brief.style.target_words} for ${brief.style.target_seconds}s)`);
console.log(`accents:  ${totalAccents} (budget ${brief.visual.accent_budget.total_min}-${brief.visual.accent_budget.total_max})`);

mkdirSync(OUT, { recursive: true });
const outPath = join(OUT, `draft-${id}.json`);
writeFileSync(outPath, JSON.stringify(draft, null, 2));
console.log(`wrote:    ${outPath}`);
