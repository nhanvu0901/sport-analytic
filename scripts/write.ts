/**
 * `npx tsx scripts/write.ts <briefId> [--force]`
 *
 * The writer is Gemini, called through the Antigravity CLI (`agy`) instead of
 * a human pasting `prompts/WRITER_SKILL.md` and `out/brief-<id>.md` into a
 * chat box. Everything downstream is unchanged: `parseDraftText`,
 * `verifyDraft`, `out/draft-<id>.json`.
 *
 * There is no `--engine` flag and no codex path. `agy` is the only engine.
 *
 * Why `agy` and not `gemini`: they share `~/.gemini/` but NOT credentials.
 * `agy` is authenticated by `~/.gemini/antigravity-cli/antigravity-oauth-token`;
 * the `gemini` CLI has no `~/.gemini/settings.json` and no `oauth_creds.json`
 * here, so it exits in ~3s with `{"code":41}`. Both measured directly.
 *
 * Four things about the invocation are load-bearing, and each was measured:
 *
 *  1. The prompt is attached to the flag as ONE argv entry, `-p=<prompt>`.
 *     Passing it as a separate argument makes agy take the next flag as the
 *     prompt: `Error: -p took "--model" as its prompt`.
 *  2. No `--json-schema`. It makes the model emit a function CALL to satisfy
 *     the schema, which failed with `improperly formatted function call ...
 *     Retries remaining: 3` after ~19,600 thinking tokens — and the schema is
 *     advisory anyway: a trivial schema test still came back as prose with
 *     extra keys (`toolAction`, `toolSummary`) outside the schema. So the
 *     reply is plain text and `parseDraftText` does the tolerating, which it
 *     was written for.
 *  3. The model is `gemini-3.8-flash-high`, held in ONE constant below so
 *     changing it is one edit. `gemini-3.1-pro-high` took 230s and 303s on
 *     this same prompt and one of those runs died with `Print mode: timed out
 *     after 1495 polls`; flash-high did the same job in 96s.
 *  4. The prompt carries an explicit English override at the very top,
 *     because `~/.gemini/config/GEMINI.md` says to answer in Vietnamese and
 *     it WINS over this project's `GEMINI.md`: without the override, agy
 *     returned `"title": "Tuyển thủ năm 2019 nào ghi nhiều điểm nhất?"` and
 *     corrupted the year to `"2,019"`.
 *
 * A measured success looks like: 96s, 51,746 tokens (29,935 of them thinking),
 * `status: SUCCESS`, and a draft that passed `verifyDraft` with 0 violations —
 * 9 beats, 203 words against the 203-word target, 25 events at 0.357/s.
 *
 * Draft cache: an LLM CLI has no seed, so re-running this on an unchanged
 * brief would otherwise reshuffle the whole script every time — including an
 * already-approved one. Same pattern as `src/tts/chatterbox.ts`'s `cacheKey`:
 * hash everything that affects the output and cache the reply under that
 * hash. `--force` bypasses it.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { parseDraftText, verifyDraft } from '../src/verify';
import { separatorExample } from '../src/drafts';
import type { WriterBrief } from '../src/brief';

/**
 * Where the renderer reads a draft from. Deliberately written out here rather
 * than imported from `src/drafts.ts`: that module STATICALLY imports these
 * very files (a browser bundle cannot stat a path), so importing it from the
 * script that creates them would make this script refuse to start whenever one
 * of them is missing. `src/drafts.ts` is the other half of this convention and
 * says so.
 */
const draftDataPath = (briefId: string) => join('src', 'data', `draft-${briefId}.json`);

/** One edit to change the writer's model. See note 3 in the header. */
const MODEL = 'gemini-3.8-flash-high';

/** agy's own print-mode timeout. The measured run needs 96s; 10m is slack for
 *  a slow day, not an expectation. */
const PRINT_TIMEOUT = '10m';

/** The credential `agy` actually uses. Absent means "not logged in", and is
 *  reported as such rather than as a mysterious CLI failure 90s later. */
const AGY_TOKEN = join(homedir(), '.gemini', 'antigravity-cli', 'antigravity-oauth-token');

/** Bump by hand when a change here (prompt shape, engine invocation, model)
 *  should invalidate every cached draft even though the brief and skill text
 *  did not change. */
export const DRAFT_CACHE_VERSION = 'write-0.2.0';

/**
 * The block measured to work. Without it the global `~/.gemini/config/GEMINI.md`
 * wins and agy returns a Vietnamese title with the year corrupted to "2,019".
 *
 * The separator example is drawn from THIS brief's own `allowed_numbers` rather
 * than hardcoded. It used to read `8,391`, a C01F figure, which meant a number
 * belonging to one video was planted in the prompt of every other one. That is
 * exactly the direction a fabricated number travels, and `verifyDraft` catching
 * it downstream is not a reason to put it there.
 */
function englishOverride(example: string): string {
  return `## OUTPUT LANGUAGE — OVERRIDES EVERY OTHER INSTRUCTION

Every string you generate — title, beat text, accent labels — MUST be in ENGLISH.
This overrides any global instruction to answer in Vietnamese.
Write years as plain digits, no thousands separator: 2019, never 2,019.
Keep point totals exactly as the brief writes them: ${example}.

Do NOT call any tool. Do NOT write files. Reply with the JSON object as plain text and nothing else.`;
}


/**
 * Three failure classes, three exit codes:
 *   auth    (2) — no oauth token, agy missing from PATH, or agy reports an
 *                 auth failure. Nothing was written; there is a one-line remedy.
 *   refused (3) — agy ran and came back with `status: ERROR`, or with a
 *                 `.response` that has no JSON object in it. agy's own `error`
 *                 field is printed, because it is descriptive.
 *   rules   (4) — a draft parsed, but `verifyDraft` returned violations.
 */
type EngineResult =
  | { ok: true; text: string; seconds: number }
  | { ok: false; kind: 'auth' | 'refused'; message: string; seconds: number };

/* --------------------------------------------------------------- args --- */

function parseArgs(argv: string[]): { id?: string; force: boolean } {
  const id = argv[0];
  let force = false;
  for (let i = 1; i < argv.length; i++) {
    if (argv[i] === '--force') { force = true; continue; }
    // A stale `--engine codex` invocation should say why it stopped working,
    // not silently write a draft from the wrong writer.
    if (argv[i] === '--engine') {
      console.error('the --engine flag is gone: agy (Gemini) is the only writer, and codex was removed.');
      process.exit(1);
    }
    console.error(`unknown argument "${argv[i]}" — usage: tsx scripts/write.ts <briefId> [--force]`);
    process.exit(1);
  }
  return { id, force };
}

const { id, force } = parseArgs(process.argv.slice(2));
if (!id || id.startsWith('-')) {
  console.error('usage: tsx scripts/write.ts <briefId> [--force]');
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

// The English override FIRST — it has to beat a global instruction, so it goes
// where nothing can bury it — then what a human pasting into a chat box would
// paste, in the order WRITER_SKILL.md itself says to paste it: the skill once,
// then the brief.
const OVERRIDE = englishOverride(separatorExample(brief.facts.allowed_numbers));
const PROMPT = `${OVERRIDE}\n\n${skillMdText}\n\n${briefMdText}\n`;

/* --------------------------------------------------------------- cache -- */

const cacheDir = () => process.env.WRITE_CACHE_DIR || join(process.cwd(), '.cache/drafts');
const sha1 = (s: string) => createHash('sha1').update(s).digest('hex');

function draftCacheKey(): string {
  // `brief.generated` is an ISO timestamp, so hashing the raw brief TEXT made
  // every `scripts/brief.ts` run invalidate every cached draft for that id.
  // That defeats the cache, which is the only thing standing in for the seed
  // a CLI engine does not have. Hash the brief's CONTENT instead.
  //
  // The JSON schema used to be part of this key; there is no schema any more
  // (see note 2 in the header), so it is gone from here too. The model name
  // and the language override are in, because changing either changes the
  // reply.
  const { generated: _generated, ...content } = brief as WriterBrief & { generated?: string };
  return sha1(JSON.stringify({
    v: DRAFT_CACHE_VERSION,
    briefJson: JSON.stringify(content),
    skillMd: skillMdText,
    engine: 'agy',
    model: MODEL,
    override: OVERRIDE,
  }));
}

const cacheKey = draftCacheKey();
const cachePath = join(cacheDir(), `${cacheKey}.json`);

/* -------------------------------------------------------------- procs --- */

function runProc(cmd: string, args: string[]): Promise<{ code: number; stdout: string; stderr: string; spawnError?: string }> {
  return new Promise((resolve) => {
    const proc = spawn(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    proc.stdout.on('data', (d) => { stdout += d.toString(); });
    proc.stderr.on('data', (d) => { stderr += d.toString(); });
    // Resolve rather than reject: a missing binary is a reportable outcome
    // with a remedy, not a crash.
    proc.on('error', (err) => resolve({ code: 127, stdout, stderr, spawnError: err.message }));
    proc.on('close', (code) => resolve({ code: code ?? 1, stdout, stderr }));
  });
}

/** agy prints ONE JSON envelope; be forgiving about what surrounds it. */
function parseEnvelope(text: string): any | null {
  const s = text.trim();
  if (!s) return null;
  try { return JSON.parse(s); } catch { /* fall through to brace slicing */ }
  const first = s.indexOf('{');
  const last = s.lastIndexOf('}');
  if (first !== -1 && last > first) {
    try { return JSON.parse(s.slice(first, last + 1)); } catch { /* not JSON */ }
  }
  return null;
}

/** The outermost `{...}` inside agy's `.response` string. `parseDraftText`
 *  does its own slicing, but doing it here is what distinguishes "the model
 *  answered with prose and no JSON at all" (refused) from a parse failure. */
function extractJsonObject(text: string): string | null {
  const first = text.indexOf('{');
  const last = text.lastIndexOf('}');
  return first !== -1 && last > first ? text.slice(first, last + 1) : null;
}

const AUTH_WORDS = /not logged in|not authenticated|log ?in again|re-?auth|unauthorized|401|permission denied|credential|oauth|token expired|invalid_grant/i;

/**
 * `agy --model <model> --print-timeout 10m --output-format json -p=<prompt>`
 *
 * Success is `{ status: "SUCCESS", response: "<the model's text>", ... }` on
 * stdout, and the draft lives inside that `.response` string as plain text —
 * possibly fenced, possibly with prose around it.
 */
async function runAgy(prompt: string): Promise<EngineResult> {
  // Cheapest check first: agy with no credential fails, but only after it has
  // started up and gone to the network. The token's absence is knowable here.
  if (!existsSync(AGY_TOKEN)) {
    return { ok: false, kind: 'auth', seconds: 0, message: `no oauth token at ${AGY_TOKEN}` };
  }

  const args = ['--model', MODEL, '--print-timeout', PRINT_TIMEOUT, '--output-format', 'json', `-p=${prompt}`];

  const t0 = Date.now();
  const elapsed = () => (Date.now() - t0) / 1000;
  // 96s of silence looks exactly like a hang, so say what is running and keep
  // saying it.
  console.log(`calling agy · model ${MODEL} · --print-timeout ${PRINT_TIMEOUT} · ${prompt.length} chars of prompt`);
  console.log('  (a measured run of this prompt took 96s — it is thinking, not hanging)');
  const tick = setInterval(() => console.log(`  ... ${elapsed().toFixed(0)}s`), 15000);

  const { code, stdout, stderr, spawnError } = await runProc('agy', args);
  clearInterval(tick);
  const seconds = elapsed();
  console.log(`agy exited ${code} after ${seconds.toFixed(1)}s`);

  if (spawnError) {
    return {
      ok: false, kind: 'auth', seconds,
      message: `could not run "agy": ${spawnError}\n`
        + 'agy is the Antigravity CLI, expected at ~/.local/bin/agy — put it on PATH.',
    };
  }

  const envelope = parseEnvelope(stdout) ?? parseEnvelope(stderr);
  const blob = `${stdout}\n${stderr}`.trim();
  // agy's own error text is descriptive; print it rather than paraphrasing.
  const agyError = typeof envelope?.error === 'string'
    ? envelope.error
    : envelope?.error ? JSON.stringify(envelope.error) : '';

  if (AUTH_WORDS.test(agyError) || (!envelope && AUTH_WORDS.test(blob))) {
    return { ok: false, kind: 'auth', seconds, message: agyError || blob.slice(0, 1000) };
  }
  if (!envelope) {
    return {
      ok: false, kind: 'refused', seconds,
      message: blob.slice(0, 1500) || `agy exited ${code} with no output at all`,
    };
  }
  if (envelope.status && envelope.status !== 'SUCCESS') {
    return {
      ok: false, kind: 'refused', seconds,
      message: `status: ${envelope.status}\n${agyError || blob.slice(0, 1500)}`,
    };
  }

  // `.response` is documented as a string; tolerate an object in case a
  // future agy version hands back the parsed reply instead.
  const response = typeof envelope.response === 'string'
    ? envelope.response
    : envelope.response ? JSON.stringify(envelope.response) : '';
  if (!response) {
    return {
      ok: false, kind: 'refused', seconds,
      message: `no .response field in agy's output.\n${agyError}\n${blob.slice(0, 1000)}`.trim(),
    };
  }

  const json = extractJsonObject(response);
  if (!json) {
    return {
      ok: false, kind: 'refused', seconds,
      message: `agy replied with no JSON object in it.\n${agyError ? `${agyError}\n` : ''}`
        + `First 1000 characters of the reply:\n${response.slice(0, 1000)}`,
    };
  }
  return { ok: true, text: json, seconds };
}

/* --------------------------------------------------------------- main --- */

let rawText: string;

if (!force && existsSync(cachePath)) {
  rawText = readFileSync(cachePath, 'utf8');
  console.log(`cache hit: ${cachePath} (no agy call made — pass --force to re-roll)`);
} else {
  const result = await runAgy(PROMPT);

  if (!result.ok) {
    if (result.kind === 'auth') {
      console.error(`AUTH — agy cannot authenticate (after ${result.seconds.toFixed(1)}s).`);
      console.error(result.message);
      console.error(`Remedy: log the Antigravity CLI in so that ${AGY_TOKEN} exists and is current.`);
      process.exit(2);
    }
    console.error(`REFUSED — agy (${MODEL}) returned no usable draft (after ${result.seconds.toFixed(1)}s).`);
    console.error(result.message);
    process.exit(3);
  }

  rawText = result.text;
  mkdirSync(cacheDir(), { recursive: true });
  writeFileSync(cachePath, rawText);
  console.log(`cached: ${cachePath}`);
}

const parsed = parseDraftText(rawText);
if (!parsed.ok) {
  console.error(`REFUSED — agy (${MODEL}) returned something that is not a draft.`);
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

console.log(`model:    ${MODEL}`);
console.log(`title:    ${draft.title}`);
console.log(`beats:    ${draft.beats.length}`);
console.log(`words:    ${totalWords} (target ${brief.style.target_words} for ${brief.style.target_seconds}s)`);
console.log(`accents:  ${totalAccents} (budget ${brief.visual.accent_budget.total_min}-${brief.visual.accent_budget.total_max})`);

mkdirSync(OUT, { recursive: true });
const outPath = join(OUT, `draft-${id}.json`);
const body = JSON.stringify(draft, null, 2);
writeFileSync(outPath, body);
console.log(`wrote:    ${outPath}`);

// The renderer cannot read out/: a Remotion bundle is a browser bundle, so it
// has no fs, and out/ is not in its module graph. Mirror the accepted draft
// into src/data/ — the directory every other generated input the bundler reads
// already lives in (timeline-<id>.json, cumulative.json) — so Root.tsx can
// render this script's beats and accents, not just narrate them.
const mirror = join(process.cwd(), draftDataPath(id));
if (existsSync(mirror)) {
  writeFileSync(mirror, body);
  console.log(`wrote:    ${mirror}  (what the renderer reads)`);
} else {
  console.log(`note:     ${mirror} does not exist, so the renderer will fall back to SCRIPTS[${id}].`);
  console.log(`          Create it (an empty {} is enough) and add the id to src/drafts.ts to have the picture follow this draft.`);
}
console.log(`next:     npx tsx scripts/tts.ts ${id} ${outPath}`);
