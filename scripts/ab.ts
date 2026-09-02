/**
 * Build the voice A/B: the original host, then our Chatterbox read, on the
 * exact same words. One file so it can be judged by ear in one listen.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const OUT = join(process.cwd(), 'out/ab');
const human = join(OUT, 'original_human.wav');
const ai = join(process.cwd(), 'public/voice-C01F.wav');
for (const p of [human, ai]) if (!existsSync(p)) throw new Error(`missing ${p}`);

const dur = (p: string) =>
  Number(execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration',
    '-of', 'default=nw=1:nk=1', p], { encoding: 'utf8' }).trim());

// A 1.2s marker between the two so it is obvious where one ends
const marker = join(OUT, '_marker.wav');
execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-f', 'lavfi',
  '-i', 'sine=frequency=520:duration=0.18:sample_rate=48000', '-f', 'lavfi',
  '-i', 'anullsrc=r=48000:cl=mono', '-filter_complex',
  '[0:a]volume=0.18[b];[1:a]atrim=duration=1.0[s];[b][s]concat=n=2:v=0:a=1[a]',
  '-map', '[a]', '-ac', '1', '-ar', '48000', '-y', marker]);

const list = join(OUT, '_list.txt');
writeFileSync(list, [human, marker, ai].map((p) => `file '${p}'`).join('\n'));
const out = join(OUT, 'voice-ab.wav');
execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-f', 'concat', '-safe', '0',
  '-i', list, '-ac', '1', '-ar', '48000', '-y', out]);

const dh = dur(human), da = dur(ai);
console.log(`A/B -> out/ab/voice-ab.wav`);
console.log(`  0:00 – ${dh.toFixed(1)}s   original host (with its music bed)`);
console.log(`  ${(dh + 1.2).toFixed(1)}s – ${(dh + 1.2 + da).toFixed(1)}s   Chatterbox, built-in voice, same words`);
console.log(`  pace: human ${(284 / dh * 60).toFixed(0)} wpm, Chatterbox ${(284 / da * 60).toFixed(0)} wpm`);
