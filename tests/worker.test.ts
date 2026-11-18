// Runs the real Worker fetch handler against a fake Workers AI binding and an
// in-memory KV, to cover request guards, caching, fair use and error mapping.
import { describe, expect, it } from 'vitest';
import worker, { type Env } from '../worker/index.ts';

function memoryKV(): KVNamespace {
  const store = new Map<string, string | ArrayBuffer>();
  return {
    async get(key: string, type?: string) {
      const v = store.get(key);
      if (v === undefined) return null;
      if (type === 'json') return JSON.parse(v as string);
      if (type === 'arrayBuffer') return v as ArrayBuffer;
      return v;
    },
    async put(key: string, value: string | ArrayBuffer | ArrayBufferView) {
      store.set(key, typeof value === 'string' ? value : ArrayBuffer.isView(value) ? (value.buffer.slice(value.byteOffset, value.byteOffset + value.byteLength) as ArrayBuffer) : value);
    },
  } as unknown as KVNamespace;
}

const OUTLINE = JSON.stringify({
  refusal: '',
  title: 'Bubble sort',
  summary: 'Swap neighbours until sorted.',
  example: 'sort 5 3 8',
  steps: ['Hook', 'Idea', 'How', 'Example', 'Recap'].map((t) => ({ title: t, goal: 'teach' })),
  quiz: [{ q: 'Q?', options: ['a', 'b', 'c'], answer: 1, why: 'because' }],
});
const STEP = 'SAY: First we look at the list of numbers here.\nDRAW: box id=a text="5" x=20 y=30\nSAY: Then we compare the first two numbers carefully.\nDRAW: highlight target=a';

/** Fake Workers AI: answers by request shape, and can be told to fail. */
function fakeAI(mode: 'ok' | 'quota' | 'broken' = 'ok') {
  const calls: string[] = [];
  const ai = {
    async run(model: string, input: { messages?: { content: string }[]; prompt?: string; text?: string }) {
      calls.push(model);
      if (mode === 'quota') throw new Error('4006: you have used up your daily free allocation of 10,000 neurons');
      if (mode === 'broken') return { response: 'not json and no SAY lines' };
      if (input.prompt || input.text) return { audio: btoa('RIFF....WAVEfake') }; // speech
      const system = input.messages?.[0]?.content ?? '';
      if (system.includes('planning a 2-minute whiteboard lesson')) return { response: OUTLINE, usage: { prompt_tokens: 100, completion_tokens: 200 } };
      if (system.includes('The learner paused the lesson')) return { response: JSON.stringify({ answer: 'Because larger values bubble up.', highlight: ['nope'] }) };
      return { response: STEP, usage: { prompt_tokens: 50, completion_tokens: 80 } };
    },
  };
  return { ai, calls };
}

function makeEnv(mode: 'ok' | 'quota' | 'broken' = 'ok', extra: Partial<Env> = {}) {
  const { ai, calls } = fakeAI(mode);
  const env = {
    AI: ai as unknown as Ai,
    ASSETS: { fetch: async () => new Response('asset') } as unknown as Fetcher,
    CACHE: memoryKV(),
    LESSON_MODEL: '@cf/meta/llama-3.3-70b-instruct-fp8-fast',
    TTS_MODEL: '@cf/myshell-ai/melotts',
    FAIR_USE_LESSONS: '2',
    ...extra,
  } as Env;
  return { env, calls };
}

function makeCtx() {
  const pending: Promise<unknown>[] = [];
  return { ctx: { waitUntil: (p: Promise<unknown>) => pending.push(p), passThroughOnException() {} } as unknown as ExecutionContext, flush: () => Promise.all(pending) };
}

const post = (path: string, body: unknown, headers: Record<string, string> = {}) =>
  new Request(`https://chalkline.test${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'cf-connecting-ip': '1.2.3.4', ...headers },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });

async function call(env: Env, req: Request) {
  const { ctx, flush } = makeCtx();
  const res = await worker.fetch(req, env, ctx);
  await flush();
  return res;
}

describe('request guards', () => {
  it('rejects non-JSON content types (blocks simple cross-site form/text posts)', async () => {
    const { env } = makeEnv();
    const res = await call(env, post('/api/lesson', '{"topic":"x"}', { 'content-type': 'text/plain' }));
    expect(res.status).toBe(415);
  });

  it('rejects requests a browser marks as cross-site', async () => {
    const { env } = makeEnv();
    const res = await call(env, post('/api/ask', { question: 'hi' }, { 'sec-fetch-site': 'cross-site' }));
    expect(res.status).toBe(403);
  });

  it('rejects oversized and malformed bodies', async () => {
    const { env } = makeEnv();
    expect((await call(env, post('/api/ask', { question: 'x'.repeat(20000) }))).status).toBe(413);
    expect((await call(env, post('/api/ask', '{not json'))).status).toBe(400);
  });

  it('validates the topic and unknown routes', async () => {
    const { env } = makeEnv();
    expect((await call(env, post('/api/lesson', { topic: 'x' }))).status).toBe(400);
    expect((await call(env, post('/api/nope', {}))).status).toBe(404);
  });

  it('ignores the model override in production (no ALLOW_MODEL_OVERRIDE)', async () => {
    const { env, calls } = makeEnv();
    const res = await call(env, post('/api/lesson', { topic: 'Bubble sort', model: '@cf/evil/model' }));
    expect(res.status).toBe(200);
    expect(calls.every((m) => m === env.LESSON_MODEL)).toBe(true);
  });
});

describe('/api/lesson', () => {
  it('generates a lesson, then serves the same topic from the cache without AI calls', async () => {
    const { env, calls } = makeEnv();
    const first = await call(env, post('/api/lesson', { topic: 'Bubble sort', level: 'beginner' }));
    expect(first.status).toBe(200);
    const lesson = (await first.json()) as { steps: unknown[]; cached?: boolean };
    expect(lesson.steps.length).toBe(5);
    const aiCalls = calls.length;
    const second = await call(env, post('/api/lesson', { topic: '  bubble SORT? ', level: 'beginner' }));
    expect(((await second.json()) as { cached?: boolean }).cached).toBe(true);
    expect(calls.length).toBe(aiCalls);
  });

  it('enforces the per-visitor limit, and refunds a lesson whose generation failed', async () => {
    const { env } = makeEnv('broken');
    // Generation fails (unparseable output) -> 502, and the reserved lesson is given back.
    expect((await call(env, post('/api/lesson', { topic: 'Topic one' }))).status).toBe(502);
    expect((await call(env, post('/api/lesson', { topic: 'Topic two' }))).status).toBe(502);
    expect((await call(env, post('/api/lesson', { topic: 'Topic three' }))).status).toBe(502); // still not 429
    const ok = makeEnv('ok');
    expect((await call(ok.env, post('/api/lesson', { topic: 'Topic one' }))).status).toBe(200);
    expect((await call(ok.env, post('/api/lesson', { topic: 'Topic two' }))).status).toBe(200);
    expect((await call(ok.env, post('/api/lesson', { topic: 'Topic three' }))).status).toBe(429);
  });

  it('maps an exhausted daily allowance to 429 "quota"', async () => {
    const { env } = makeEnv('quota');
    const res = await call(env, post('/api/lesson', { topic: 'Bubble sort' }));
    expect(res.status).toBe(429);
    expect(((await res.json()) as { code: string }).code).toBe('quota');
  });
});

describe('/api/ask', () => {
  const board = [{ id: 'a', label: '5' }];
  it('answers, and drops highlight ids that are not on the board', async () => {
    const { env } = makeEnv();
    const res = await call(env, post('/api/ask', { question: 'Why?', board, topic: 't', lessonTitle: 't', stepTitle: 's' }));
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ answer: 'Because larger values bubble up.', highlight: [] });
  });

  it('limits questions per visitor per day', async () => {
    const { env } = makeEnv('ok', { FAIR_USE_QUESTIONS: '1' } as Partial<Env>);
    expect((await call(env, post('/api/ask', { question: 'One?', board }))).status).toBe(200);
    expect((await call(env, post('/api/ask', { question: 'Two?', board }))).status).toBe(429);
  });
});

describe('/api/tts', () => {
  it('returns WAV audio from MeloTTS and serves repeats from the cache', async () => {
    const { env, calls } = makeEnv();
    const a = await call(env, post('/api/tts', { text: 'Hello there.' }));
    expect(a.status).toBe(200);
    expect(a.headers.get('content-type')).toBe('audio/wav');
    expect(a.headers.get('x-cache')).toBe('miss');
    const b = await call(env, post('/api/tts', { text: 'Hello there.' }));
    expect(b.headers.get('x-cache')).toBe('hit');
    expect(calls.length).toBe(1);
  });

  it('rejects empty text', async () => {
    const { env } = makeEnv();
    expect((await call(env, post('/api/tts', { text: '   ' }))).status).toBe(400);
  });
});
