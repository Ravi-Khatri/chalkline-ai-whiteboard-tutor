// Compares lesson-writing models on cost, speed and lesson quality signals.
// Requires the local API (`npx wrangler dev --port 8790`) and ALLOW_MODEL_OVERRIDE=1
// in .dev.vars. Benchmark requests bypass the lesson cache and fair-use limit.
//
//   node scripts/bench-models.mjs [outDir]
//
// Saves every generated lesson to outDir so they can be reviewed in full.

import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

const API = process.env.API ?? 'http://127.0.0.1:8790';
const OUT = process.argv[2] ?? 'bench-out';
const MODELS = (process.env.MODELS ?? '@cf/google/gemma-4-26b-a4b-it,@cf/qwen/qwen3-30b-a3b-fp8,@cf/meta/llama-3.1-8b-instruct-fp8-fast').split(',');
const TOPICS = (process.env.TOPICS ?? 'How bubble sort works|How compound interest works').split('|');
const DAILY = 10000;

await mkdir(OUT, { recursive: true });

async function run(model, topic) {
  const t0 = Date.now();
  const res = await fetch(`${API}/api/lesson`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ topic, level: 'beginner', model }),
  });
  const secs = (Date.now() - t0) / 1000;
  const body = await res.json();
  const row = { model: model.split('/').pop(), topic, status: res.status, secs: +secs.toFixed(1) };
  if (!res.ok) return { ...row, error: body.error };
  const beats = body.steps.flatMap((s) => s.beats);
  const actions = beats.flatMap((b) => b.actions);
  const ops = {};
  for (const a of actions) ops[a.op] = (ops[a.op] ?? 0) + 1;
  const neurons = Number(res.headers.get('x-ai-neurons')) || undefined;
  await writeFile(join(OUT, `${row.model}--${topic.replace(/\W+/g, '-')}.json`), JSON.stringify(body, null, 2));
  return {
    ...row,
    tokens: res.headers.get('x-ai-tokens'),
    neurons,
    // x-ai-neurons already includes the narration estimate.
    lessonsPerDay: neurons ? Math.floor(DAILY / neurons) : undefined,
    steps: body.steps.length,
    beats: beats.length,
    words: beats.map((b) => b.say).join(' ').split(/\s+/).length,
    actions: actions.length,
    demos: (ops.cross ?? 0) + (ops.move ?? 0) + (ops.graph ?? 0),
    ops,
    quiz: body.quiz.length,
  };
}

const rows = await Promise.all(MODELS.flatMap((m) => TOPICS.map((t) => run(m, t).catch((e) => ({ model: m, topic: t, error: String(e) })))));
for (const r of rows) console.log(JSON.stringify(r));
await writeFile(join(OUT, 'summary.json'), JSON.stringify(rows, null, 2));
console.log(`\nSaved lessons and summary to ${OUT}.`);
