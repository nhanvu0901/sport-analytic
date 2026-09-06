/**
 * The writer: builds the prompt, spawns `agy`, parses its reply, verifies it
 * against the brief, caches it, and writes `out/draft-<id>.json` plus the
 * `src/data/` mirror the renderer reads.
 *
 * `scripts/write.ts` is a thin CLI over `writeDraft` below; `server/index.ts`
 * runs the same function as an SSE job (`POST /api/sessions/:id/write`).
 * Both callers get identical behaviour because there is only one
 * implementation — this file.
 *
 * Why `agy` and not `gemini`: they share `~/.gemini/` but NOT credentials.
 * `agy` is authenticated by `~/.gemini/antigravity-cli/antigravity-oauth-token`;
 * the `gemini` CLI has no `~/.gemini/settings.json` and no `oauth_creds.json`
 * here, so it exits in ~3s with `{"code":41}`. Both measured directly.
 *
 * Four things about the invocation are load-bearing, and each was measured.
 * They must stay in this one place — duplicating any of them into a second
 * writer is exactly how they would drift apart:
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
 * hash. `{ force: true }` bypasses it.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { parseDraftText, verifyDraft, type Draft, type Violation } from './verify';
import { separatorExample } from './drafts';
import type { WriterBrief } from './brief';

/** Where the renderer reads a draft from — see src/drafts.ts for why this is
 *  a mirror path rather than an import. */
const draftDataPath = (id: string) => join('src', 'data', `draft-${id}.json`);

/** One edit to change the writer's model. See note 3 in the header. */
export const MODEL = 'gemini-3.8-flash-high';

/** agy's own print-mode timeout. The measured run needs 96s; 10m is slack for
 *  a slow day, not an expectation. */
export const PRINT_TIMEOUT = '10m';

/** The credential `agy` actually uses. Absent means "not logged in", and is
 *  reported as such rather than as a mysterious CLI failure 90s later. */
export const AGY_TOKEN = join(homedir(), '.gemini', 'antigravity-cli', 'antigravity-oauth-token');

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
 * Three failure classes:
 *   auth    — no oauth token, agy missing from PATH, or agy reports an auth
 *             failure. Nothing was written; there is a one-line remedy.
 *   refused — agy ran and came back with `status: ERROR`, or with a
 *             `.response` that has no JSON object in it. agy's own `error`
 *             field is printed, because it is descriptive.
 *   rules   — a draft parsed, but `verifyDraft` returned violations.
 */
type EngineResult =
  | { ok: true; text: string; seconds: number }
  | { ok: false; kind: 'auth' | 'refused'; message: string; seconds: number };

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
async function runAgy(prompt: string, log: (line: string) => void): Promise<EngineResult> {
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
  log(`calling agy · model ${MODEL} · --print-timeout ${PRINT_TIMEOUT} · ${prompt.length} chars of prompt`);
  log('  (a measured run of this prompt took 96s — it is thinking, not hanging)');
  const tick = setInterval(() => log(`  ... ${elapsed().toFixed(0)}s`), 15000);

  const { code, stdout, stderr, spawnError } = await runProc('agy', args);
  clearInterval(tick);
  const seconds = elapsed();
  log(`agy exited ${code} after ${seconds.toFixed(1)}s`);

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

export type WriteOptions = {
  /** Bypass the draft cache and re-roll agy even for an unchanged brief. */
  force?: boolean;
  /** One line at a time, in the order they happen — a CLI prints them,
   *  an SSE job streams them. Defaults to doing nothing. */
  onLog?: (line: string) => void;
};

export type WriteSuccess = {
  ok: true;
  model: string;
  /** True when the reply came from `.cache/drafts/` rather than a fresh
   *  agy call — `seconds` is 0 in that case. */
  cacheHit: boolean;
  seconds: number;
  draft: Draft;
  title: string;
  beats: number;
  totalWords: number;
  targetWords: number;
  targetSeconds: number;
  totalAccents: number;
  accentBudget: { min: number; max: number };
  outPath: string;
  /** Null when `src/data/draft-<id>.json` does not exist yet — the renderer
   *  then falls back to `SCRIPTS[id]` until that file and the id are added. */
  mirrorPath: string | null;
};

export type WriteFailure =
  | { ok: false; kind: 'auth'; message: string; seconds: number }
  | { ok: false; kind: 'refused'; message: string; seconds: number }
  | { ok: false; kind: 'rules'; violations: Violation[] };

export type WriteResult = WriteSuccess | WriteFailure;

/**
 * Build the prompt for `id`, run it through agy (or reuse a cached reply),
 * verify the result against the brief, and — only on a clean pass — write
 * `out/draft-<id>.json` and its `src/data/` mirror.
 *
 * Throws only for a setup problem outside the three failure classes above
 * (missing brief files, missing skill file) — callers that already checked
 * the brief exists (as the server route does) will not hit this.
 */
export async function writeDraft(id: string, opts: WriteOptions = {}): Promise<WriteResult> {
  const log = opts.onLog ?? (() => {});

  const OUT = join(process.cwd(), 'out');
  const briefJsonPath = join(OUT, `brief-${id}.json`);
  const briefMdPath = join(OUT, `brief-${id}.md`);
  const skillPath = join(process.cwd(), 'prompts', 'WRITER_SKILL.md');

  for (const p of [briefJsonPath, briefMdPath]) {
    if (!existsSync(p)) throw new Error(`missing ${p} — run: npx tsx scripts/brief.ts ${id}`);
  }
  if (!existsSync(skillPath)) throw new Error(`missing ${skillPath}`);

  const briefJsonText = readFileSync(briefJsonPath, 'utf8');
  const briefMdText = readFileSync(briefMdPath, 'utf8');
  const skillMdText = readFileSync(skillPath, 'utf8');
  const brief: WriterBrief = JSON.parse(briefJsonText);

  // The English override FIRST — it has to beat a global instruction, so it
  // goes where nothing can bury it — then what a human pasting into a chat
  // box would paste, in the order WRITER_SKILL.md itself says to paste it:
  // the skill once, then the brief.
  const OVERRIDE = englishOverride(separatorExample(brief.facts.allowed_numbers));
  const PROMPT = `${OVERRIDE}\n\n${skillMdText}\n\n${briefMdText}\n`;

  const cacheDir = () => process.env.WRITE_CACHE_DIR || join(process.cwd(), '.cache/drafts');
  const sha1 = (s: string) => createHash('sha1').update(s).digest('hex');

  // `brief.generated` is an ISO timestamp, so hashing the raw brief TEXT would
  // make every `scripts/brief.ts` run invalidate every cached draft for that
  // id. That defeats the cache, which is the only thing standing in for the
  // seed a CLI engine does not have. Hash the brief's CONTENT instead.
  const { generated: _generated, ...content } = brief as WriterBrief & { generated?: string };
  const cacheKey = sha1(JSON.stringify({
    v: DRAFT_CACHE_VERSION,
    briefJson: JSON.stringify(content),
    skillMd: skillMdText,
    engine: 'agy',
    model: MODEL,
    override: OVERRIDE,
  }));
  const cachePath = join(cacheDir(), `${cacheKey}.json`);

  let rawText: string;
  let cacheHit = false;
  let seconds = 0;

  if (!opts.force && existsSync(cachePath)) {
    rawText = readFileSync(cachePath, 'utf8');
    cacheHit = true;
    log(`cache hit: ${cachePath} (no agy call made — pass --force to re-roll)`);
  } else {
    const result = await runAgy(PROMPT, log);
    seconds = result.seconds;

    if (!result.ok) {
      if (result.kind === 'auth') {
        log(`AUTH — agy cannot authenticate (after ${result.seconds.toFixed(1)}s).`);
        log(result.message);
        log(`Remedy: log the Antigravity CLI in so that ${AGY_TOKEN} exists and is current.`);
        return { ok: false, kind: 'auth', message: result.message, seconds: result.seconds };
      }
      log(`REFUSED — agy (${MODEL}) returned no usable draft (after ${result.seconds.toFixed(1)}s).`);
      log(result.message);
      return { ok: false, kind: 'refused', message: result.message, seconds: result.seconds };
    }

    rawText = result.text;
    mkdirSync(cacheDir(), { recursive: true });
    writeFileSync(cachePath, rawText);
    log(`cached: ${cachePath}`);
  }

  const parsed = parseDraftText(rawText);
  if (!parsed.ok) {
    log(`REFUSED — agy (${MODEL}) returned something that is not a draft.`);
    log(parsed.error);
    return { ok: false, kind: 'refused', message: parsed.error, seconds };
  }
  const { draft } = parsed;

  const violations = verifyDraft(draft, brief);
  if (violations.length > 0) {
    log(`RULES — ${violations.length} violation(s) — nothing written to out/:`);
    const sorted = [...violations].sort((a, b) => (a.beat ?? -1) - (b.beat ?? -1));
    for (const v of sorted) log(`beat ${v.beat ?? '-'} · ${v.rule} · ${v.detail}`);
    return { ok: false, kind: 'rules', violations };
  }

  const totalWords = draft.beats.reduce((n, b) => n + b.text.split(/\s+/).filter(Boolean).length, 0);
  const totalAccents = draft.beats.reduce((n, b) => n + (b.accents?.length ?? 0), 0);

  log(`model:    ${MODEL}`);
  log(`title:    ${draft.title}`);
  log(`beats:    ${draft.beats.length}`);
  log(`words:    ${totalWords} (target ${brief.style.target_words} for ${brief.style.target_seconds}s)`);
  log(`accents:  ${totalAccents} (budget ${brief.visual.accent_budget.total_min}-${brief.visual.accent_budget.total_max})`);

  mkdirSync(OUT, { recursive: true });
  const outPath = join(OUT, `draft-${id}.json`);
  const body = JSON.stringify(draft, null, 2);
  writeFileSync(outPath, body);
  log(`wrote:    ${outPath}`);

  // The renderer cannot read out/: a Remotion bundle is a browser bundle, so
  // it has no fs, and out/ is not in its module graph. Mirror the accepted
  // draft into src/data/ — see src/drafts.ts for the other half of this
  // convention.
  const mirror = join(process.cwd(), draftDataPath(id));
  let mirrorPath: string | null = null;
  if (existsSync(mirror)) {
    writeFileSync(mirror, body);
    mirrorPath = mirror;
    log(`wrote:    ${mirror}  (what the renderer reads)`);
  } else {
    log(`note:     ${mirror} does not exist, so the renderer will fall back to SCRIPTS[${id}].`);
    log(`          Create it (an empty {} is enough) and add the id to src/drafts.ts to have the picture follow this draft.`);
  }
  log(`next:     npx tsx scripts/tts.ts ${id} ${outPath}`);

  return {
    ok: true,
    model: MODEL,
    cacheHit,
    seconds,
    draft,
    title: draft.title,
    beats: draft.beats.length,
    totalWords,
    targetWords: brief.style.target_words,
    targetSeconds: brief.style.target_seconds,
    totalAccents,
    accentBudget: { min: brief.visual.accent_budget.total_min, max: brief.visual.accent_budget.total_max },
    outPath,
    mirrorPath,
  };
}
