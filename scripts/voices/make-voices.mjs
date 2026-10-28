// Records the crew's intercom lines (src/lines.js) as small MP3s the game loads as it needs them,
// public/audio/voice/<line>.<version>.<voice>.mp3.
//   node scripts/voices/make-voices.mjs [work folder]          (records, then packs; default .voices)
//   node scripts/voices/make-voices.mjs [work folder] --pack   (only packs what's recorded)
// Records with Chatterbox (each man's voice copied from a sample, <work folder>/ref-all/<voice>.wav), three
// takes a line with the best kept (speak_chatterbox.py), in .voices/cb:
//   python -m venv .voices/cb
//   .voices/cb/Scripts/python -m pip install torch==2.6.0 torchaudio==2.6.0 --index-url https://download.pytorch.org/whl/cu124
//   .voices/cb/Scripts/python -m pip install chatterbox-tts soundfile
// The samples are Kokoro's voices (make_refs.py, in .voices/venv: pip install torch kokoro soundfile).
// And ffmpeg on the PATH. Clips already recorded in the work folder are kept: delete a WAV to record it again.
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { allClips, VOICES } from '../../src/lines.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const args = process.argv.slice(2), packOnly = args.includes('--pack');
const work = resolve(args.find((a) => !a.startsWith('--')) ?? join(root, '.voices'));
const wavs = join(work, 'wav');
mkdirSync(wavs, { recursive: true });

// 1. what to record: each clip in its man's voice, with his feeling
const clips = allClips();
const jobs = clips.map((c) => ({ id: c.id, text: c.text, ref: join(work, 'ref-all', `${VOICES[c.voice].ref}.wav`),
  exaggeration: c.exaggeration, cfg: c.cfg }));
// a clip whose words or delivery changed since it was recorded is recorded again (its WAV and takes deleted)
const madeFile = join(work, 'made.json'), made = existsSync(madeFile) ? JSON.parse(readFileSync(madeFile, 'utf8')) : {};
for (const j of jobs) {
  const now = { text: j.text, exaggeration: j.exaggeration, cfg: j.cfg };
  if (JSON.stringify(made[j.id]) === JSON.stringify(now)) continue;
  for (const f of [join(wavs, `${j.id}.wav`), ...[0, 1, 2, 3, 4, 5].map((k) => join(wavs, 'takes', `${j.id}.${k}.wav`))]) if (existsSync(f)) rmSync(f);
  made[j.id] = now;
}
writeFileSync(madeFile, JSON.stringify(made, null, 1));
writeFileSync(join(work, 'jobs.json'), JSON.stringify(jobs));
if (!packOnly) execFileSync(join(root, '.voices/cb/Scripts/python'), [join(root, 'scripts/voices/speak_chatterbox.py'), join(work, 'jobs.json'), wavs], { stdio: 'inherit' });

// 2. each clip's samples, the silence trimmed off both ends
function pcm(file) {
  const b = readFileSync(file);
  let at = 12, rate = 0, data = null;
  while (at < b.length - 8) {
    const id = b.toString('ascii', at, at + 4), len = b.readUInt32LE(at + 4);
    if (id === 'fmt ') rate = b.readUInt32LE(at + 12);
    if (id === 'data') { data = new Int16Array(b.buffer.slice(b.byteOffset + at + 8, b.byteOffset + at + 8 + len)); break; }
    at += 8 + len + (len & 1);
  }
  const loud = (s) => Math.abs(s) > 500;
  let a = data.findIndex(loud), z = data.length - 1;
  while (z > a && !loud(data[z])) z--;
  const pad = Math.round(rate * 0.03);
  return { rate, s: data.slice(Math.max(0, a - pad), Math.min(data.length, z + pad)) };
}

// 3. each one encoded on its own (the game fetches a line when it's about to be said)
const outDir = join(root, 'public/audio/voice');
mkdirSync(outDir, { recursive: true });
const want = new Set(clips.map((c) => `${c.id}.mp3`));
for (const f of readdirSync(outDir)) if (!want.has(f)) rmSync(join(outDir, f)); // (lines no longer in the script)
let secs = 0, bytes = 0;
for (const c of clips) {
  const { rate, s } = pcm(join(wavs, `${c.id}.wav`)), mp3 = join(outDir, `${c.id}.mp3`);
  // (the intercom carries 300 Hz to 3.4 kHz: 22 kHz keeps the breath and edges of a voice, the rest isn't heard)
  execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-f', 's16le', '-ar', String(rate), '-ac', '1', '-i', 'pipe:0',
    '-af', 'highpass=f=150,lowpass=f=6000', '-ar', '22050', '-ac', '1', '-c:a', 'libmp3lame', '-b:a', '24k', mp3], { input: Buffer.from(s.buffer, s.byteOffset, s.byteLength) });
  secs += s.length / rate; bytes += statSync(mp3).size;
}
console.log(`${clips.length} clips, ${(secs / 60).toFixed(1)} min, ${(bytes / 1e6).toFixed(2)} MB`);
