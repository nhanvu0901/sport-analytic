/**
 * Local Chatterbox TTS. Audio AND word timings, without an API key.
 *
 * Chatterbox returns audio only, so timings come from measurement: synthesize
 * ONE CHUNK PER SENTENCE, read each chunk's real duration off its WAV header,
 * and spread that sentence's words inside its own span. Error is then bounded
 * by a single sentence — and every sentence boundary, which is what drives the
 * chart animation, is a measured number rather than an estimate.
 *
 * (ElevenLabs' `with-timestamps` gives per-character alignment and would beat
 * this on caption precision. This costs nothing and runs offline.)
 *
 * Seeding + cache: without a seed, regenerating after editing ONE sentence
 * reshuffles the delivery of every sentence, and the approved take is lost.
 * Each chunk gets a deterministic per-sentence seed (positional: 1000+i) and
 * its WAV is cached under a hash of everything that affects the audio (text,
 * seed, voice file CONTENTS, exaggeration, cfg, temperature, CACHE_VERSION).
 * Editing one sentence then costs one sentence; an unchanged script costs 0s
 * and reproduces the exact bytes already approved.
 */
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  mkdtempSync, mkdirSync, readFileSync, existsSync, writeFileSync, copyFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export type Chunk = { text: string; beatIndex: number; seed?: number };
export type WordTime = { word: string; startMs: number; endMs: number };

const WORKER = join(process.cwd(), 'src/tts/chatterbox_worker.py');
const VENV = process.env.CHATTERBOX_VENV
  ?? '/Users/nhanvu/Documents/code/comic-book-pipeline/.venv-chatterbox';

// Bump by hand when the model/venv changes (e.g. a chatterbox-tts upgrade
// changes what the same text+seed produces). Automating that detection is
// complexity not worth it — the venv is pinned by a human anyway.
export const CACHE_VERSION = 'chatterbox-0.1.7-v1';

// TTS_CACHE_DIR lets tests (and any future tool) point the cache at a tmp
// dir without touching the real .cache/tts. Read lazily, not at import time,
// so a test can set the env var after this module is already loaded.
const cacheDir = () => process.env.TTS_CACHE_DIR || join(process.cwd(), '.cache/tts');
const cachePath = (key: string) => join(cacheDir(), `${key}.wav`);

export const venvPython = () => {
  for (const rel of [['bin', 'python'], ['Scripts', 'python.exe']]) {
    const p = join(VENV, ...rel);
    if (existsSync(p)) return p;
  }
  return join(VENV, 'bin', 'python');
};

const sha1 = (data: string | Buffer) => createHash('sha1').update(data).digest('hex');

/**
 * Content-addressed key for one chunk's audio. The voice is hashed by file
 * CONTENTS, not path, so swapping the reference wav under the same filename
 * invalidates the cache correctly instead of silently reusing a stale take.
 */
export function cacheKey(
  c: { text: string; seed: number },
  opts: { voiceWav?: string; exaggeration?: number; cfgWeight?: number; temperature?: number }
): string {
  const voice = opts.voiceWav ? sha1(readFileSync(opts.voiceWav)) : 'default';
  return sha1(JSON.stringify({
    v: CACHE_VERSION,
    text: c.text,
    seed: c.seed,
    voice,
    exaggeration: opts.exaggeration ?? 0.5,
    cfg: opts.cfgWeight ?? 0.5,
    temperature: opts.temperature ?? 0.8,
  }));
}

/** Split into sentences, then split any sentence over the cap at a comma. */
export function toSentences(text: string, maxChars = 320): string[] {
  const clean = String(text ?? '').split(/\s+/).filter(Boolean).join(' ');
  const out: string[] = [];
  for (const sent of clean.split(/(?<=[.!?])["'”’)]*\s+(?=["'“(\[]?[A-Z0-9])/).map((s) => s.trim()).filter(Boolean)) {
    if (sent.length <= maxChars) { out.push(sent); continue; }
    let buf = '';
    for (const part of sent.split(/(?<=,)\s+/)) {
      if (buf && buf.length + part.length + 1 > maxChars) { out.push(buf); buf = part; }
      else buf = `${buf} ${part}`.trim();
    }
    if (buf) out.push(buf);
  }
  return out;
}

/** Duration in seconds straight from the RIFF header — no decoding needed. */
export function wavDurationSec(path: string): number {
  const b = readFileSync(path);
  if (b.length < 44 || b.toString('ascii', 0, 4) !== 'RIFF') return 0;
  const byteRate = b.readUInt32LE(28);
  // walk the chunks to find `data`; a WAV may carry LIST/fact before it
  let off = 12;
  while (off + 8 <= b.length) {
    const id = b.toString('ascii', off, off + 4);
    const size = b.readUInt32LE(off + 4);
    if (id === 'data') return byteRate ? size / byteRate : 0;
    off += 8 + size + (size % 2);
  }
  return 0;
}

/** Spread one sentence's words across its own measured span. */
export function spreadWords(text: string, startMs: number, durMs: number): WordTime[] {
  const words = text.split(/\s+/).filter(Boolean);
  if (!words.length || durMs <= 0) return [];
  // Longer words take longer to say; a flat split makes short words drag.
  const weight = (w: string) => Math.max(1, (w.toLowerCase().match(/[aeiouy]+/g) ?? []).length);
  const total = words.reduce((s, w) => s + weight(w), 0);
  let t = startMs;
  return words.map((w) => {
    const d = (weight(w) / total) * durMs;
    const out = { word: w, startMs: Math.round(t), endMs: Math.round(t + d) };
    t += d;
    return out;
  });
}

export type WorkerJob = {
  chunks: { text: string; key: string; seed: number; exaggeration: number; cfg_weight: number }[];
  out_dir: string;
  audio_prompt: string | null;
  temperature: number;
  device: string | null;
};

/** The real worker launch, extracted so tests can inject a stub instead. */
async function runWorkerReal(job: WorkerJob, log: (s: string) => void): Promise<void> {
  const py = venvPython();
  if (!existsSync(py)) {
    throw new Error(
      `Chatterbox venv missing at ${VENV}.\n  python3 -m venv ${VENV} && ${py} -m pip install chatterbox-tts "setuptools<81"`
    );
  }
  const dir = mkdtempSync(join(tmpdir(), 'chatterbox-'));
  const jobPath = join(dir, 'job.json');
  writeFileSync(jobPath, JSON.stringify(job));

  await new Promise<void>((resolve, reject) => {
    const proc = spawn(py, [WORKER, jobPath], { stdio: ['ignore', 'pipe', 'pipe'] });
    let buf = '';
    const tail: string[] = [];
    const onLine = (line: string) => {
      if (!line.trim()) return;
      if (!line.startsWith('{')) { tail.push(line.trim()); return; }
      try {
        const m = JSON.parse(line);
        if (m.ready) log(`  model on ${m.device} @ ${m.sr}Hz (loaded in ${m.load_sec}s)`);
        else if (m.error) log(`  ⚠ chunk ${m.i} failed: ${String(m.error).slice(0, 120)}`);
        else log(`  chunk ${m.i + 1}/${job.chunks.length}: ${m.sec}s audio in ${m.gen_sec}s`);
      } catch { /* not our JSON */ }
    };
    proc.stdout.on('data', (d) => {
      buf += d.toString();
      const lines = buf.split('\n');
      buf = lines.pop() ?? '';
      lines.forEach(onLine);
    });
    // The worker's stderr carries torch/HF noise but also real import failures.
    proc.stderr.on('data', (d) => { for (const l of d.toString().split('\n')) if (l.trim()) tail.push(l.trim()); });
    proc.on('close', (code) =>
      code === 0 ? resolve() : reject(new Error(`worker exit ${code}\n  ${tail.slice(-14).join('\n  ')}`)));
  });
}

export type SynthResult = {
  chunkWavs: string[];
  perChunk: { text: string; beatIndex: number; seed: number; key: string; cached: boolean; startMs: number; endMs: number }[];
  words: WordTime[];
  durationMs: number;
  sampleRate: number;
};

export async function synthesize(
  chunks: Chunk[],
  opts: {
    voiceWav?: string; exaggeration?: number; cfgWeight?: number; temperature?: number;
    log?: (s: string) => void; runWorker?: (job: WorkerJob) => Promise<void>;
  } = {}
): Promise<SynthResult> {
  const log = opts.log ?? (() => {});

  // Seed is positional by default (1000+i): stable across runs as long as the
  // sentence count and order don't change, which is what makes an untouched
  // script reproduce byte-identical audio. A caller-supplied seed overrides it.
  const keyed = chunks.map((c, i) => {
    const seed = c.seed ?? 1000 + i;
    return { ...c, seed, key: cacheKey({ text: c.text, seed }, opts) };
  });

  mkdirSync(cacheDir(), { recursive: true });
  const misses = keyed.filter((c) => !existsSync(cachePath(c.key)));
  log(`  ${keyed.length - misses.length} cached, ${misses.length} to synthesize`);

  if (misses.length > 0) {
    // Only spawn the worker (and pay the ~11s model load) when something is
    // actually missing from the cache.
    const runWorker = opts.runWorker ?? ((job: WorkerJob) => runWorkerReal(job, log));
    const work = mkdtempSync(join(tmpdir(), 'chatterbox-'));
    const outDir = join(work, 'wav');
    const job: WorkerJob = {
      chunks: misses.map((c) => ({
        text: c.text, key: c.key, seed: c.seed,
        exaggeration: opts.exaggeration ?? 0.5, cfg_weight: opts.cfgWeight ?? 0.5,
      })),
      out_dir: outDir,
      audio_prompt: opts.voiceWav ?? null,
      temperature: opts.temperature ?? 0.8,
      device: null,
    };
    await runWorker(job);
    // Copy only what the worker actually produced into the cache — one bad
    // chunk must not lose the run, same policy as before.
    for (const c of misses) {
      const src = join(outDir, `${c.key}.wav`);
      if (existsSync(src)) copyFileSync(src, cachePath(c.key));
    }
  }

  const missKeys = new Set(misses.map((c) => c.key));
  const chunkWavs: string[] = [];
  const perChunk: SynthResult['perChunk'] = [];
  const words: WordTime[] = [];
  let t = 0;
  let sampleRate = 24000;
  for (const c of keyed) {
    const p = cachePath(c.key);
    if (!existsSync(p)) continue;                 // failed chunk: no audio, no words
    const durMs = wavDurationSec(p) * 1000;
    const b = readFileSync(p);
    sampleRate = b.readUInt32LE(24);
    chunkWavs.push(p);
    perChunk.push({
      text: c.text, beatIndex: c.beatIndex, seed: c.seed, key: c.key, cached: !missKeys.has(c.key),
      startMs: Math.round(t), endMs: Math.round(t + durMs),
    });
    words.push(...spreadWords(c.text, t, durMs));
    t += durMs;
  }
  if (!chunkWavs.length) throw new Error(`Chatterbox produced no audio in ${cacheDir()}`);
  if (chunkWavs.length < keyed.length) {
    // Loud, not silent: a missing chunk means missing WORDS, and the chart
    // animation is cut off word positions.
    log(`  ⚠ ${keyed.length - chunkWavs.length} chunk(s) produced no audio and were DROPPED`);
  }
  return { chunkWavs, perChunk, words, durationMs: Math.round(t), sampleRate };
}
