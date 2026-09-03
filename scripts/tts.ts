/**
 * Narrate a composition with local Chatterbox and write a real timeline.
 *
 *   npx tsx scripts/tts.ts C01
 *   npx tsx scripts/tts.ts C01F out/draft-C01F.json
 *
 * Third argument (optional): path to an accepted out/draft-<id>.json —
 * written by scripts/draft.ts once a Gemini-written script passes
 * verifyDraft. When given, its beats are narrated via draftToScriptLines()
 * instead of the hardcoded SCRIPTS[id] placeholder. Omit it to keep using
 * SCRIPTS[id] exactly as before.
 *
 * Produces src/data/timeline-<id>.json: beats bound to measured audio spans,
 * and word-level captions. Root.tsx picks it up automatically and falls back to
 * the syllable estimate when it is absent.
 */
import { execFileSync } from 'node:child_process';
import { writeFileSync, mkdirSync, existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { synthesize, toSentences } from '../src/tts/chatterbox';
import { SCRIPTS, draftToScriptLines } from '../src/scripts';
import type { Draft } from '../src/verify';

const id = (process.argv[2] ?? 'C01').toUpperCase();
const draftPath = process.argv[3];
const lines = draftPath
  ? draftToScriptLines(JSON.parse(readFileSync(draftPath, 'utf8')) as Draft)
  : SCRIPTS[id];
if (!lines) throw new Error(`no script for ${id}. Have: ${Object.keys(SCRIPTS).join(', ')}`);

// One chunk per sentence: the sentence boundary is where the measurement is
// exact, and Stage-equivalent beats line up with sentences by construction.
const chunks = lines.flatMap((l, beatIndex) =>
  toSentences(l.text).map((text) => ({ text, beatIndex })));

console.log(`${id}: ${lines.length} beats -> ${chunks.length} chunks`);
const t0 = Date.now();
const res = await synthesize(chunks, {
  voiceWav: process.env.CHATTERBOX_VOICE_WAV || undefined,
  exaggeration: Number(process.env.CHATTERBOX_EXAGGERATION ?? 0.5),
  cfgWeight: Number(process.env.CHATTERBOX_CFG_WEIGHT ?? 0.5),
  log: (s) => console.log(s),
});

// Chatterbox renders each sentence dry, so concatenating them back to back
// gives a read with no breath in it. Insert real silence — and shift the
// timeline by the same amounts, or the captions drift away from the voice.
const GAP_SENTENCE_MS = 170;   // between sentences inside one beat
const GAP_BEAT_MS = 340;       // between beats, where the chart also changes

const shifted: { startMs: number; endMs: number; beatIndex: number; text: string }[] = [];
const pauses: number[] = [];   // silence to insert BEFORE chunk i
let shift = 0;
res.perChunk.forEach((c, i) => {
  if (i > 0) {
    const gap = c.beatIndex === res.perChunk[i - 1].beatIndex ? GAP_SENTENCE_MS : GAP_BEAT_MS;
    pauses.push(gap);
    shift += gap;
  } else pauses.push(0);
  shifted.push({ ...c, startMs: c.startMs + shift, endMs: c.endMs + shift });
});

const shiftAt = (ms: number) => {
  // a word belongs to the chunk whose ORIGINAL span contains it
  const i = res.perChunk.findIndex((c) => ms >= c.startMs && ms <= c.endMs);
  const k = i < 0 ? res.perChunk.length - 1 : i;
  return ms + pauses.slice(0, k + 1).reduce((a, b) => a + b, 0);
};

const beats = lines.map((l, i) => {
  const mine = shifted.filter((c) => c.beatIndex === i);
  if (!mine.length) return null;
  return {
    entityId: l.entityId,
    startMs: mine[0].startMs,
    endMs: mine[mine.length - 1].endMs,
    accents: l.accents ?? undefined,
  };
}).filter(Boolean);

const captions = res.words.map((w) => ({
  text: w.word, startMs: shiftAt(w.startMs), endMs: shiftAt(w.endMs),
}));
const durationMs = shifted[shifted.length - 1].endMs;

mkdirSync(join(process.cwd(), 'public'), { recursive: true });
const wav = join(process.cwd(), 'public', `voice-${id}.wav`);

// ffmpeg concat, then two-pass loudnorm to -14 LUFS, which is what YouTube
// normalises to. The source video measured -21.9 LUFS, i.e. noticeably quiet.
const listFile = join(process.cwd(), 'public', `_concat-${id}.txt`);
// one silence file per distinct pause length, at the chunks' own rate so the
// concat demuxer accepts them without re-encoding
const silences = new Map<number, string>();
for (const ms of new Set(pauses.filter((p) => p > 0))) {
  const sp = join(process.cwd(), 'public', `_sil-${ms}.wav`);
  execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-f', 'lavfi',
    '-i', `anullsrc=r=${res.sampleRate}:cl=mono`, '-t', String(ms / 1000),
    '-c:a', 'pcm_s16le', '-y', sp]);
  silences.set(ms, sp);
}
const entries: string[] = [];
res.chunkWavs.forEach((p, i) => {
  const gap = pauses[i];
  if (gap > 0) entries.push(`file '${silences.get(gap)}'`);
  entries.push(`file '${p}'`);
});
writeFileSync(listFile, entries.join('\n'));
const raw = join(process.cwd(), 'public', `_raw-${id}.wav`);
execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-f', 'concat', '-safe', '0',
  '-i', listFile, '-c', 'copy', '-y', raw]);

const measure = execFileSync('ffmpeg', ['-hide_banner', '-nostdin', '-i', raw,
  '-af', 'loudnorm=I=-14:TP=-1.5:LRA=11:print_format=json', '-f', 'null', '-'],
  { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] } as any).toString();
let filter = 'loudnorm=I=-14:TP=-1.5:LRA=11';
const m = /\{[\s\S]*\}/.exec(measure);
if (m) {
  try {
    const j = JSON.parse(m[0]);
    filter += `:measured_I=${j.input_i}:measured_TP=${j.input_tp}:measured_LRA=${j.input_lra}` +
              `:measured_thresh=${j.input_thresh}:offset=${j.target_offset}:linear=true:print_format=summary`;
    console.log(`  loudnorm pass 1: measured ${j.input_i} LUFS`);
  } catch { /* single pass is still correct, just less exact */ }
}
execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-i', raw, '-af', filter, '-ar', '48000', '-y', wav]);

// Subtitles are burned in downstream, so hand that tool exact timings rather
// than making it re-transcribe audio it did not generate.
const srt = captions.map((c, i) => {
  const t = (ms: number) => {
    const h = Math.floor(ms / 3600000);
    const m = Math.floor(ms / 60000) % 60;
    const sec = Math.floor(ms / 1000) % 60;
    const cs = Math.floor(ms % 1000);
    return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')},${String(cs).padStart(3, '0')}`;
  };
  return `${i + 1}\n${t(c.startMs)} --> ${t(c.endMs)}\n${c.text}\n`;
}).join('\n');
writeFileSync(join(process.cwd(), 'out', `voice-${id}.srt`), srt);

const out = {
  composition: id,
  audio: `voice-${id}.wav`,
  provider: 'chatterbox-local',
  voice: process.env.CHATTERBOX_VOICE_WAV || '(built-in)',
  durationMs,
  beats, captions,
  // Persisted so a future "casting" step can read/override a specific
  // sentence's seed without regenerating the ones that already sound right.
  chunks: res.perChunk.map((c) => ({ text: c.text, beatIndex: c.beatIndex, seed: c.seed, key: c.key, cached: c.cached })),
};
writeFileSync(join(process.cwd(), 'src/data', `timeline-${id}.json`), JSON.stringify(out, null, 1));
console.log(`\n${(durationMs / 1000).toFixed(1)}s of narration (${(res.durationMs / 1000).toFixed(1)}s speech ` +
            `+ ${((durationMs - res.durationMs) / 1000).toFixed(1)}s of inserted pauses), ${captions.length} words, ` +
            `${((Date.now() - t0) / 1000).toFixed(0)}s wall clock ` +
            `(${((Date.now() - t0) / durationMs).toFixed(2)}x realtime)`);
console.log(`  -> public/voice-${id}.wav`);
console.log(`  -> src/data/timeline-${id}.json`);
console.log(`  -> out/voice-${id}.srt   (word-level, for the subtitle step)`);
