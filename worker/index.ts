// Cloudflare Worker: the API behind Chalkline. Static assets (the React app)
// are served by Workers Static Assets; only /api/* reaches this code.
//
//   POST /api/lesson  { topic, level }        -> Lesson JSON (Workers AI, Llama 3.3 70B)
//   POST /api/tts     { text, tier?, voice? } -> audio     (Workers AI: MeloTTS WAV by default, Aura-2 MP3 if configured)
//   POST /api/ask     AskRequest              -> { answer, highlight }
//   GET  /api/health                          -> configured models

import { normalizeLesson, LessonError } from '../shared/validate.ts';
import type { ApiError, AskRequest, AskResponse, Lesson, Level } from '../shared/types.ts';
import { askMessages, askSchema, outlineMessages, outlineSchema, stepMessages, STEP_COUNT, type Outline } from '../shared/prompts.ts';
import { parseStep, type RawBeat } from '../shared/dsl.ts';
import { assembleRawLesson, checkOutline, extractJson, stripThinking } from '../shared/assemble.ts';
import {
  audioKey,
  COST,
  getCachedAudio,
  getCachedLesson,
  lessonKey,
  lessonsLeft,
  refundLesson,
  reserveLesson,
  putCachedAudio,
  putCachedLesson,
  recordSpend,
  spentToday,
  takeQuestion,
  textNeurons,
  voiceTier,
  type UsageEnv,
} from './usage.ts';

export interface Env extends UsageEnv {
  AI: Ai;
  ASSETS: Fetcher;
  LESSON_MODEL: string;
  TTS_MODEL: string;
  TTS_VOICE?: string;
  ALLOW_MODEL_OVERRIDE?: string;
  /** Per-request token counter (set by handleLesson; not a real binding). */
  meter?: { in: number; out: number };
}

type AiRunner = { run(model: string, input: unknown): Promise<unknown> };

class HttpError extends Error {
  constructor(public status: number, public code: ApiError['code'], message: string) {
    super(message);
  }
}

const LEVELS: Level[] = ['beginner', 'intermediate', 'advanced'];

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' },
  });
}

/**
 * Rejects requests a browser marks as coming from another website. Requiring
 * Content-Type application/json also forces a CORS preflight for cross-site
 * browser calls, which this API never approves, so other sites cannot make a
 * visitor's browser spend the AI allowance ("simple" text/plain POSTs fail here).
 */
function assertSameSiteJson(request: Request) {
  const site = request.headers.get('sec-fetch-site');
  if (site === 'cross-site') throw new HttpError(403, 'bad_request', 'Cross-site requests are not allowed.');
  const type = request.headers.get('content-type') ?? '';
  if (!type.toLowerCase().startsWith('application/json')) {
    throw new HttpError(415, 'bad_request', 'Requests must be sent as JSON (Content-Type: application/json).');
  }
}

async function readJson(request: Request, maxBytes = 16_000): Promise<Record<string, unknown>> {
  assertSameSiteJson(request);
  // Check the declared size first so oversized bodies are not buffered at all.
  if (Number(request.headers.get('content-length')) > maxBytes) throw new HttpError(413, 'bad_request', 'Request is too large.');
  const text = await request.text();
  if (new TextEncoder().encode(text).length > maxBytes) throw new HttpError(413, 'bad_request', 'Request is too large.');
  try {
    const body = JSON.parse(text);
    if (typeof body !== 'object' || body === null) throw new Error();
    return body as Record<string, unknown>;
  } catch {
    throw new HttpError(400, 'bad_request', 'Request body must be JSON.');
  }
}

function isQuotaError(err: unknown): boolean {
  const msg = String((err as Error)?.message ?? err).toLowerCase();
  return msg.includes('4006') || msg.includes('free allocation') || msg.includes('neurons') || msg.includes('quota');
}

function aiFailure(err: unknown, what: string): HttpError {
  if (isQuotaError(err)) {
    console.warn(`${what}: AI quota error`, String((err as Error)?.message ?? err).slice(0, 300));
    return new HttpError(429, 'quota', "Today's free AI allowance for this demo has been used up. Try a sample lesson, or come back tomorrow.");
  }
  console.error(`${what} failed`, err);
  return new HttpError(502, 'ai_failed', `The AI service could not ${what} right now. Please try again.`);
}

/** Workers AI models answer either as { response } or in OpenAI chat-completions shape. */
function responseText(res: unknown): unknown {
  const r = res as { response?: unknown; choices?: { message?: { content?: unknown } }[] };
  const out = r?.response ?? r?.choices?.[0]?.message?.content;
  // Reasoning models (e.g. Qwen3) may prepend hidden "thinking"; only the answer matters here.
  return typeof out === 'string' ? stripThinking(out) : out;
}

/** Qwen3 thinks by default, which costs output tokens; "/no_think" switches that off. */
function withModelHints(model: string, messages: unknown[]): unknown[] {
  if (!/qwen3/i.test(model)) return messages;
  return (messages as { role: string; content: string }[]).map((m, i) => (i === 0 && m.role === 'system' ? { ...m, content: `/no_think\n${m.content}` } : m));
}

/** Adds a call's token usage (Workers AI reports it per call) to the request's meter, if any. */
function meterUsage(env: Env, res: unknown) {
  const u = (res as { usage?: { prompt_tokens?: number; completion_tokens?: number } })?.usage;
  if (env.meter && u) {
    env.meter.in += u.prompt_tokens ?? 0;
    env.meter.out += u.completion_tokens ?? 0;
  }
}

async function runText(env: Env, model: string, messages: unknown[], maxTokens: number, temperature = 0.5): Promise<string> {
  const res = await (env.AI as unknown as AiRunner).run(model, { messages: withModelHints(model, messages), max_tokens: maxTokens, temperature });
  meterUsage(env, res);
  const text = responseText(res);
  if (typeof text !== 'string' || !text.trim()) throw new Error('Empty model response');
  return text;
}

/**
 * Gets a JSON object from a chat model. Unconstrained generation is tried first
 * because Workers AI's schema-constrained JSON mode measured 3-5x slower; if the
 * text cannot be parsed, JSON mode is used as the reliable fallback.
 */
async function runJson(env: Env, model: string, messages: unknown[], schema: object, maxTokens: number): Promise<unknown> {
  try {
    return extractJson(await runText(env, model, messages, maxTokens, 0.4));
  } catch (err) {
    if (isQuotaError(err)) throw err;
    console.warn('Unconstrained JSON failed, retrying in JSON mode', String(err));
  }
  return runJsonMode(env, model, messages, schema, maxTokens);
}

async function runJsonMode(env: Env, model: string, messages: unknown[], schema: object, maxTokens: number): Promise<unknown> {
  try {
    const res = await (env.AI as unknown as AiRunner).run(model, {
      messages: withModelHints(model, messages),
      response_format: { type: 'json_schema', json_schema: schema },
      max_tokens: maxTokens,
      temperature: 0.4,
    });
    meterUsage(env, res);
    return extractJson(responseText(res));
  } catch (err) {
    if (isQuotaError(err)) throw err;
    console.warn('JSON mode failed, retrying unconstrained', String(err));
  }
  return extractJson(await runText(env, model, messages, maxTokens, 0.3));
}

/** Writes one step; retries once if the model returns too little to teach from. */
async function writeStep(env: Env, model: string, topic: string, level: Level, outline: Outline, i: number): Promise<RawBeat[]> {
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const text = await runText(env, model, stepMessages(topic, level, outline, i), 900, attempt ? 0.3 : 0.6);
      const beats = parseStep(text);
      if (beats.length >= 2) return beats;
      console.warn(`step ${i + 1} too short (attempt ${attempt + 1})`, text.slice(0, 500));
    } catch (err) {
      if (isQuotaError(err)) throw err;
      console.warn(`step ${i + 1} failed (attempt ${attempt + 1})`, String(err));
    }
  }
  return [];
}

/**
 * Two-stage generation: a short JSON outline (plan, running example, quiz),
 * then every step written in parallel in the compact SAY/DRAW format. Parallel
 * steps keep latency close to the time of one step, and give each call a
 * focused, bounded job, which keeps lessons at the intended length.
 */
async function handleLesson(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
  const body = await readJson(request);
  const topic = String(body.topic ?? '').replace(/\s+/g, ' ').trim();
  const level = LEVELS.includes(body.level as Level) ? (body.level as Level) : 'beginner';
  if (topic.length < 2 || topic.length > 120) {
    throw new HttpError(400, 'bad_request', 'Enter a topic between 2 and 120 characters.');
  }

  // Local benchmarking only: .dev.vars can set ALLOW_MODEL_OVERRIDE=1 (never set in production).
  // A benchmark run bypasses the cache and the fair-use limit.
  const benchmarking = env.ALLOW_MODEL_OVERRIDE === '1' && typeof body.model === 'string';
  const model = benchmarking ? String(body.model) : env.LESSON_MODEL;
  env = { ...env, meter: { in: 0, out: 0 } };

  // Same topic, level and model already generated (by anyone): serve it at zero AI cost.
  const cacheKey = await lessonKey(topic, level, model);
  const cached = benchmarking ? null : await getCachedLesson<Lesson>(env, cacheKey);
  if (cached) return json({ ...cached, id: `${cached.id}-c${Date.now().toString(36)}`, cached: true });

  // Reserve one of the visitor's lessons before generating (refunded below if generation fails).
  if (!benchmarking && !(await reserveLesson(env, request))) {
    throw new HttpError(
      429,
      'limit',
      `To share the free AI allowance fairly, each visitor can create ${env.FAIR_USE_LESSONS ?? 3} new lessons a day. Try a ready-made lesson or one of the suggested topics: those are free.`,
    );
  }
  try {
    return await generateLesson(env, ctx, { topic, level, model, cacheKey, benchmarking });
  } catch (err) {
    // A failed generation still spent AI calls: record that, and give the visitor their lesson back.
    const spent = textNeurons(model, env.meter!) ?? 0;
    ctx.waitUntil(Promise.all([recordSpend(env, spent), benchmarking ? null : refundLesson(env, request)]).catch(() => {}));
    throw err;
  }
}

async function generateLesson(
  env: Env,
  ctx: ExecutionContext,
  { topic, level, model, cacheKey, benchmarking }: { topic: string; level: Level; model: string; cacheKey: string; benchmarking: boolean },
): Promise<Response> {
  const started = Date.now();

  let outline: Outline;
  try {
    outline = (await runJson(env, model, outlineMessages(topic, level), outlineSchema, 1200)) as Outline;
  } catch (err) {
    throw aiFailure(err, 'plan the lesson');
  }
  if (typeof outline?.refusal === 'string' && outline.refusal.trim()) {
    throw new HttpError(422, 'bad_request', outline.refusal.trim());
  }
  try {
    outline = checkOutline(outline, STEP_COUNT);
  } catch {
    throw new HttpError(502, 'invalid_output', 'The AI could not plan this lesson. Please try again or rephrase the topic.');
  }
  const planned = Date.now();

  let stepBeats: RawBeat[][];
  try {
    stepBeats = await Promise.all(outline.steps.map((_, i) => writeStep(env, model, topic, level, outline, i)));
  } catch (err) {
    throw aiFailure(err, 'write the lesson');
  }
  console.log(`lesson by ${model}: outline ${planned - started}ms, steps ${Date.now() - planned}ms, tokens in ${env.meter!.in} out ${env.meter!.out}`);

  const raw = assembleRawLesson(outline, stepBeats);

  try {
    const lesson = normalizeLesson(raw, { topic, level, source: 'live', model });
    // Decide the narration voice now, and pre-book its cost, so lessons
    // generated at the same moment see each other's spending.
    const chars = lesson.steps.reduce((n, s) => n + s.beats.reduce((m, b) => m + b.say.length, 0), 0);
    lesson.voiceTier = env.TTS_MODEL.includes('melotts') ? 'economy' : await voiceTier(env, chars);
    const narration = chars * (lesson.voiceTier === 'premium' ? COST.auraPerChar : COST.meloPerChar);
    const textCost = textNeurons(model, env.meter!) ?? COST.lessonText;
    ctx.waitUntil(
      Promise.all([
        recordSpend(env, textCost + narration),
        benchmarking ? null : putCachedLesson(env, cacheKey, lesson),
      ]).catch((e) => console.warn('usage bookkeeping failed', String(e))),
    );
    const res = json(lesson);
    res.headers.set('x-ai-tokens', `${env.meter!.in},${env.meter!.out}`);
    res.headers.set('x-ai-neurons', String(Math.round(textCost + narration)));
    return res;
  } catch (err) {
    if (err instanceof LessonError) {
      throw new HttpError(502, 'invalid_output', 'The AI returned a lesson that was too short to teach from. Please try again or rephrase the topic.');
    }
    throw err;
  }
}

/** Makes narration text safe and pleasant for the speech engine. */
export function cleanForSpeech(text: string): string {
  return text
    .replace(/[*_#`>~|]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 600);
}

function base64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

/** Aura-2 English voices allowed by the API (a request may pick one; anything else uses the default). */
const AURA_VOICES = new Set(['athena', 'asteria', 'luna', 'thalia', 'helena', 'cora', 'orion', 'arcas', 'apollo', 'draco', 'hermes', 'odysseus']);

const ECONOMY_TTS = '@cf/myshell-ai/melotts';

async function handleTts(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
  const body = await readJson(request, 4_000);
  const text = cleanForSpeech(String(body.text ?? ''));
  if (!text) throw new HttpError(400, 'bad_request', 'Nothing to say.');

  // The lesson decided its voice tier when it was generated. As a safety net,
  // premium requests are also downgraded once the day's spend is well past budget.
  const hardCap = (Number(env.PREMIUM_BUDGET) || 6500) + 2500;
  const economy = body.tier === 'economy' || (await spentToday(env)) > hardCap;
  const model = economy ? ECONOMY_TTS : env.TTS_MODEL;
  const isMelo = model.includes('melotts');
  const voice = isMelo ? 'melo' : AURA_VOICES.has(String(body.voice)) ? String(body.voice) : env.TTS_VOICE || 'athena';

  // MeloTTS returns WAV; Aura returns MP3. Sniff the bytes for the content type.
  const respond = (bytes: Uint8Array, cached: boolean) => {
    const isWav = bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46; // "RIFF"
    return new Response(bytes as unknown as BodyInit, {
      headers: {
        'content-type': isWav ? 'audio/wav' : 'audio/mpeg',
        'cache-control': 'no-store',
        'x-voice-tier': isMelo ? 'economy' : 'premium',
        'x-cache': cached ? 'hit' : 'miss',
      },
    });
  };

  const key = await audioKey(model, voice, text);
  const hit = await getCachedAudio(env, key);
  if (hit) return respond(new Uint8Array(hit), true);

  let out: unknown;
  try {
    out = await (env.AI as unknown as AiRunner).run(model, isMelo ? { prompt: text, lang: 'en' } : { text, speaker: voice, encoding: 'mp3' });
  } catch (err) {
    throw aiFailure(err, 'generate narration');
  }

  let bytes: Uint8Array | null = null;
  if (out instanceof ReadableStream) bytes = new Uint8Array(await new Response(out).arrayBuffer());
  else if (out instanceof ArrayBuffer) bytes = new Uint8Array(out);
  else if (out instanceof Uint8Array) bytes = out;
  else if (typeof (out as { audio?: unknown })?.audio === 'string') bytes = base64ToBytes((out as { audio: string }).audio);
  if (!bytes) throw new HttpError(502, 'ai_failed', 'The speech service returned no audio.');

  ctx.waitUntil(putCachedAudio(env, key, bytes).catch((e) => console.warn('audio cache write failed', String(e))));
  return respond(bytes, false);
}

function parseAsk(body: Record<string, unknown>): AskRequest {
  const s = (v: unknown, max: number) => String(v ?? '').replace(/\s+/g, ' ').trim().slice(0, max);
  const question = s(body.question, 500);
  if (!question) throw new HttpError(400, 'bad_request', 'Type a question first.');
  const board = Array.isArray(body.board)
    ? body.board.slice(0, 40).map((b) => ({ id: s((b as AskRequest['board'][0])?.id, 40), label: s((b as AskRequest['board'][0])?.label, 80) }))
    : [];
  const history = Array.isArray(body.history)
    ? body.history.slice(-6).map((m) => ({
        role: (m as { role?: string })?.role === 'tutor' ? ('tutor' as const) : ('user' as const),
        text: s((m as { text?: string })?.text, 600),
      }))
    : [];
  return {
    topic: s(body.topic, 120),
    lessonTitle: s(body.lessonTitle, 120),
    stepTitle: s(body.stepTitle, 120),
    context: s(body.context, 1500),
    board: board.filter((b) => b.id),
    selectedId: s(body.selectedId, 40) || undefined,
    circled: Array.isArray(body.circled) ? body.circled.slice(0, 10).map((c) => s(c, 40)).filter(Boolean) : [],
    question,
    history,
  };
}

async function handleAsk(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
  const req = parseAsk(await readJson(request));
  if (!(await takeQuestion(env, request))) {
    throw new HttpError(429, 'limit', 'To share the free AI allowance fairly, each visitor can ask 40 questions a day. Please come back tomorrow.');
  }
  let raw: unknown;
  try {
    raw = await runJson(env, env.LESSON_MODEL, askMessages(req), askSchema, 400);
  } catch (err) {
    throw aiFailure(err, 'answer the question');
  }
  const r = raw as { answer?: unknown; highlight?: unknown };
  const answer = typeof r.answer === 'string' ? r.answer.trim().slice(0, 900) : '';
  if (!answer) throw new HttpError(502, 'invalid_output', 'The tutor could not form an answer. Please rephrase your question.');
  const ids = new Set(req.board.map((b) => b.id));
  const highlight = Array.isArray(r.highlight) ? r.highlight.filter((h): h is string => typeof h === 'string' && ids.has(h)).slice(0, 2) : [];
  // Spoken answers follow the same budget rule as lesson narration.
  const tier = env.TTS_MODEL.includes('melotts') ? 'economy' : await voiceTier(env, answer.length);
  const spend = COST.askText + answer.length * (tier === 'premium' ? COST.auraPerChar : COST.meloPerChar);
  ctx.waitUntil(recordSpend(env, spend).catch(() => {}));
  return json({ answer, highlight, voiceTier: tier } satisfies AskResponse);
}

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);
    try {
      if (url.pathname === '/api/health' && request.method === 'GET') {
        return json({
          ok: true,
          lessonModel: env.LESSON_MODEL,
          ttsModel: env.TTS_MODEL,
          caching: Boolean(env.CACHE),
          voiceTierNow: env.TTS_MODEL.includes('melotts') ? 'economy' : await voiceTier(env),
          lessonsLeftForYou: await lessonsLeft(env, request),
        });
      }
      if (request.method === 'POST') {
        if (url.pathname === '/api/lesson') return await handleLesson(request, env, ctx);
        if (url.pathname === '/api/tts') return await handleTts(request, env, ctx);
        if (url.pathname === '/api/ask') return await handleAsk(request, env, ctx);
      }
      if (url.pathname.startsWith('/api/')) throw new HttpError(404, 'not_found', 'Unknown API route.');
      return env.ASSETS.fetch(request);
    } catch (err) {
      if (err instanceof HttpError) return json({ error: err.message, code: err.code } satisfies ApiError, err.status);
      console.error('Unhandled error', err);
      return json({ error: 'Something went wrong on the server.', code: 'server' } satisfies ApiError, 500);
    }
  },
} satisfies ExportedHandler<Env>;
