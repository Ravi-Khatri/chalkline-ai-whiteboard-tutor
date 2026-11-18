// Generates the bundled sample lessons with the same live pipeline the app uses.
// Requires the API running locally (`npx wrangler dev --port 8790`).
//
//   node scripts/make-samples.mjs                 # all samples below
//   node scripts/make-samples.mjs binary-search   # just one
//
// Output: public/samples/<id>/lesson.json, one audio clip per spoken beat
// (<beatId>.mp3 with Aura-2, or <beatId>.wav downsampled to 22.05 kHz mono with
// MeloTTS), and public/samples/index.json. --revoice re-records existing lessons.

import { mkdir, writeFile, readFile } from 'node:fs/promises';
import { join } from 'node:path';

const API = process.env.API ?? 'http://127.0.0.1:8790';
const OUT = join(process.cwd(), 'public', 'samples');

const SAMPLES = [
  { id: 'binary-search', topic: 'How binary search works', level: 'beginner', blurb: 'Halve a sorted list until you find the target. Algorithms, worked example.' },
  { id: 'sky-blue', topic: 'Why the sky is blue', level: 'beginner', blurb: 'Sunlight, scattering and why sunsets turn red. Physics, intuition first.' },
  { id: 'compound-interest', topic: 'How compound interest works', level: 'beginner', blurb: 'Interest on interest, year by year, with real numbers. Personal finance.' },
];

async function post(path, body, tries = 3) {
  for (let attempt = 1; ; attempt++) {
    const res = await fetch(API + path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
    if (res.ok) return res;
    const text = await res.text();
    if (attempt >= tries || res.status === 400 || res.status === 429) throw new Error(`${path} ${res.status}: ${text}`);
    console.warn(`\n  retrying ${path} after ${res.status}`);
    await new Promise((r) => setTimeout(r, 1500 * attempt));
  }
}

/** Downsamples 16-bit PCM WAV by an integer factor (averaging), mono only. */
function downsampleWav(buf, targetRate = 22050) {
  const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  if (view.getUint32(0, false) !== 0x52494646) return buf; // not RIFF
  let p = 12;
  let fmt = null;
  let data = null;
  while (p + 8 <= buf.length) {
    const id = String.fromCharCode(...buf.subarray(p, p + 4));
    const size = view.getUint32(p + 4, true);
    if (id === 'fmt ') fmt = { channels: view.getUint16(p + 10, true), rate: view.getUint32(p + 12, true), bits: view.getUint16(p + 22, true) };
    if (id === 'data') data = { start: p + 8, size: Math.min(size, buf.length - p - 8) };
    p += 8 + size + (size % 2);
  }
  if (!fmt || !data || fmt.channels !== 1 || fmt.bits !== 16 || fmt.rate % targetRate !== 0 || fmt.rate === targetRate) return buf;
  const factor = fmt.rate / targetRate;
  const inSamples = Math.floor(data.size / 2);
  const outSamples = Math.floor(inSamples / factor);
  const out = Buffer.alloc(44 + outSamples * 2);
  out.write('RIFF', 0);
  out.writeUInt32LE(36 + outSamples * 2, 4);
  out.write('WAVEfmt ', 8);
  out.writeUInt32LE(16, 16);
  out.writeUInt16LE(1, 20);
  out.writeUInt16LE(1, 22);
  out.writeUInt32LE(targetRate, 24);
  out.writeUInt32LE(targetRate * 2, 28);
  out.writeUInt16LE(2, 32);
  out.writeUInt16LE(16, 34);
  out.write('data', 36);
  out.writeUInt32LE(outSamples * 2, 40);
  for (let i = 0; i < outSamples; i++) {
    let sum = 0;
    for (let k = 0; k < factor; k++) sum += view.getInt16(data.start + (i * factor + k) * 2, true);
    out.writeInt16LE(Math.round(sum / factor), 44 + i * 2);
  }
  return out;
}

const REVOICE = process.argv.includes('--revoice');

async function makeSample(s) {
  const dir = join(OUT, s.id);
  let lesson;
  if (REVOICE) {
    console.log(`\n▶ ${s.id}: re-recording narration for the existing lesson…`);
    lesson = JSON.parse(await readFile(join(dir, 'lesson.json'), 'utf8'));
  } else {
    console.log(`\n▶ ${s.id}: generating lesson for "${s.topic}"…`);
    lesson = await (await post('/api/lesson', { topic: s.topic, level: s.level })).json();
  }
  lesson.id = s.id;
  lesson.source = 'sample';
  delete lesson.cached;
  const beats = lesson.steps.flatMap((st) => st.beats);
  console.log(`  ${lesson.steps.length} steps, ${beats.length} beats. Recording narration…`);
  // Record everything in memory first, so a failure (e.g. quota) leaves the old sample intact.
  const clips = new Map();
  let i = 0;
  await Promise.all(
    Array.from({ length: 4 }, async () => {
      while (i < beats.length) {
        const b = beats[i++];
        const res = await post('/api/tts', { text: b.say, tier: 'premium' });
        const tier = res.headers.get('x-voice-tier') ?? 'premium';
        if (tier !== 'premium') throw new Error('Narration fell back to the economy voice (daily budget). Try again after the 05:30 IST reset.');
        lesson.voiceTier = 'premium';
        const audio = Buffer.from(await res.arrayBuffer());
        const isWav = audio.subarray(0, 4).toString() === 'RIFF';
        lesson.audio = isWav ? 'wav' : 'mp3';
        clips.set(b.id, isWav ? downsampleWav(audio) : audio);
        process.stdout.write('.');
      }
    }),
  );
  await mkdir(dir, { recursive: true });
  const { readdir, unlink } = await import('node:fs/promises');
  for (const f of await readdir(dir)) if (/\.(wav|mp3)$/.test(f)) await unlink(join(dir, f));
  for (const [id, buf] of clips) await writeFile(join(dir, `${id}.${lesson.audio}`), buf);
  await writeFile(join(dir, 'lesson.json'), JSON.stringify(lesson, null, 2));
  console.log(`\n  saved ${dir}`);
  return { id: s.id, title: lesson.title, topic: s.topic, blurb: s.blurb };
}

const only = process.argv.slice(2).filter((a) => !a.startsWith('--'));
const chosen = only.length ? SAMPLES.filter((s) => only.includes(s.id)) : SAMPLES;
let index = [];
try {
  index = JSON.parse(await readFile(join(OUT, 'index.json'), 'utf8'));
} catch {
  /* first run */
}
for (const s of chosen) {
  const info = await makeSample(s);
  index = [...index.filter((x) => x.id !== info.id), info];
}
index.sort((a, b) => SAMPLES.findIndex((s) => s.id === a.id) - SAMPLES.findIndex((s) => s.id === b.id));
await mkdir(OUT, { recursive: true });
await writeFile(join(OUT, 'index.json'), JSON.stringify(index, null, 2));
console.log('\nDone. Review each lesson in the app before committing it.');
