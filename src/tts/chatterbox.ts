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
 */
import { spawn } from 'node:child_process';
import { mkdtempSync, readFileSync, existsSync, writeFileSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export type Chunk = { text: string; beatIndex: number };
export type WordTime = { word: string; startMs: number; endMs: number };

const WORKER = join(process.cwd(), 'src/tts/chatterbox_worker.py');
const VENV = process.env.CHATTERBOX_VENV
  ?? '/Users/nhanvu/Documents/code/comic-book-pipeline/.venv-chatterbox';

export const venvPython = () => {
  for (const rel of [['bin', 'python'], ['Scripts', 'python.exe']]) {
    const p = join(VENV, ...rel);
    if (existsSync(p)) return p;
  }
  return join(VENV, 'bin', 'python');
};

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

export type SynthResult = {
  chunkWavs: string[];
  perChunk: { text: string; beatIndex: number; startMs: number; endMs: number }[];
  words: WordTime[];
  durationMs: number;
  sampleRate: number;
};

export async function synthesize(
  chunks: Chunk[],
  opts: { voiceWav?: string; exaggeration?: number; cfgWeight?: number; temperature?: number; log?: (s: string) => void } = {}
): Promise<SynthResult> {
  const log = opts.log ?? (() => {});
  const py = venvPython();
  if (!existsSync(py)) {
    throw new Error(
      `Chatterbox venv missing at ${VENV}.\n  python3 -m venv ${VENV} && ${py} -m pip install chatterbox-tts "setuptools<81"`
    );
  }

  const dir = mkdtempSync(join(tmpdir(), 'chatterbox-'));
  const outDir = join(dir, 'wav');
  const jobPath = join(dir, 'job.json');
  writeFileSync(jobPath, JSON.stringify({
    chunks: chunks.map((c) => ({
      text: c.text,
      exaggeration: opts.exaggeration ?? 0.5,
      cfg_weight: opts.cfgWeight ?? 0.5,
    })),
    out_dir: outDir,
    audio_prompt: opts.voiceWav ?? null,
    temperature: opts.temperature ?? 0.8,
    device: null,
  }));

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
        else log(`  chunk ${m.i + 1}/${chunks.length}: ${m.sec}s audio in ${m.gen_sec}s`);
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

  const chunkWavs: string[] = [];
  const perChunk: SynthResult['perChunk'] = [];
  const words: WordTime[] = [];
  let t = 0;
  let sampleRate = 24000;
  for (let i = 0; i < chunks.length; i++) {
    const p = join(outDir, `chunk_${String(i).padStart(5, '0')}.wav`);
    if (!existsSync(p)) continue;                 // failed chunk: no audio, no words
    const durMs = wavDurationSec(p) * 1000;
    const b = readFileSync(p);
    sampleRate = b.readUInt32LE(24);
    chunkWavs.push(p);
    perChunk.push({ text: chunks[i].text, beatIndex: chunks[i].beatIndex, startMs: Math.round(t), endMs: Math.round(t + durMs) });
    words.push(...spreadWords(chunks[i].text, t, durMs));
    t += durMs;
  }
  if (!chunkWavs.length) throw new Error(`Chatterbox produced no audio in ${outDir} (${readdirSync(outDir).length} files)`);
  if (chunkWavs.length < chunks.length) {
    // Loud, not silent: a missing chunk means missing WORDS, and the chart
    // animation is cut off word positions.
    log(`  ⚠ ${chunks.length - chunkWavs.length} chunk(s) produced no audio and were DROPPED`);
  }
  return { chunkWavs, perChunk, words, durationMs: Math.round(t), sampleRate };
}
