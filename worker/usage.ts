// Keeps a public demo useful all day on the Workers AI free allowance
// (10,000 neurons/day). Three mechanisms, all optional: if the CACHE KV binding
// is missing, everything still works, just without caching or budgeting.
//
// 1. Cache: a lesson for the same topic + level, and the audio for the same
//    sentence + voice, are stored in KV and served again at zero AI cost.
// 2. Budget guard: an estimate of today's spend is kept in KV. While it is
//    under PREMIUM_BUDGET, narration uses the natural Aura-2 voice; after that,
//    new narration uses MeloTTS (a small fraction of the cost) so the demo keeps
//    working instead of hitting the hard limit.
// 3. Fair use: each visitor can generate a few new (uncached) lessons per day,
//    so one person cannot spend everyone's allowance. Visitors are identified
//    by a salted daily hash of their IP address; the IP itself is never stored.
//
// KV is eventually consistent, so the budget is an estimate, which is fine for
// a soft limit. Neuron costs below are derived from Cloudflare's published
// per-model prices (1,000 neurons = $0.011).

export interface UsageEnv {
  CACHE?: KVNamespace;
  PREMIUM_BUDGET?: string;
  FAIR_USE_LESSONS?: string;
}

export const COST = {
  lessonText: 700, // Llama 3.3 70B: outline + 5 steps
  askText: 50,
  auraPerChar: 2.73, // $0.030 per 1k characters
  meloPerChar: 0.02, // $0.000205 per audio minute, ~900 chars/minute
};

/** Neurons per million [input, output] tokens, from Cloudflare's Workers AI pricing page. */
const TEXT_PRICES: Record<string, [number, number]> = {
  '@cf/meta/llama-3.3-70b-instruct-fp8-fast': [26668, 204805],
  '@cf/google/gemma-4-26b-a4b-it': [9091, 27273],
  '@cf/qwen/qwen3-30b-a3b-fp8': [4625, 30475],
  '@cf/meta/llama-3.1-8b-instruct-fp8-fast': [4119, 34868],
  '@cf/zai-org/glm-4.7-flash': [5500, 36400],
  '@cf/meta/llama-3.2-3b-instruct': [4625, 30475],
};

/** Measured cost of the text calls for one request, or undefined for an unknown model. */
export function textNeurons(model: string, tokens: { in: number; out: number }): number | undefined {
  const p = TEXT_PRICES[model];
  if (!p || (!tokens.in && !tokens.out)) return undefined;
  return (tokens.in * p[0] + tokens.out * p[1]) / 1e6;
}

const DAY_TTL = 60 * 60 * 36;
const CACHE_TTL = 60 * 60 * 24 * 30;

const today = () => new Date().toISOString().slice(0, 10);

export async function sha256(text: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Normalises a topic for cache lookup. Unicode-aware, so non-Latin topics keep
 * their letters ("光合作用" stays distinct from "日本の歴史"), and "+"/"#" are
 * kept so "C++" and "C#" do not collide.
 */
export const normaliseTopic = (topic: string) =>
  topic
    .normalize('NFKC')
    .toLocaleLowerCase('en')
    .replace(/[^\p{L}\p{N}\p{M}+#]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();

/** KV reads that fail (rate limits, outages) should never break a request. */
async function kvNumber(env: UsageEnv, key: string): Promise<number> {
  try {
    return Number(await env.CACHE!.get(key)) || 0;
  } catch (err) {
    console.warn('KV read failed', key, String(err));
    return 0;
  }
}

/** KV writes are best-effort: a failed counter write must not fail the user's request. */
async function kvPut(env: UsageEnv, key: string, value: string | ArrayBuffer | Uint8Array, ttl: number): Promise<void> {
  try {
    await env.CACHE!.put(key, value, { expirationTtl: ttl });
  } catch (err) {
    console.warn('KV write failed', key, String(err));
  }
}

// ---------------------------------------------------------------------------
// Budget
// ---------------------------------------------------------------------------

export async function spentToday(env: UsageEnv): Promise<number> {
  if (!env.CACHE) return 0;
  return kvNumber(env, `usage:${today()}`);
}

export async function recordSpend(env: UsageEnv, neurons: number): Promise<void> {
  if (!env.CACHE || neurons <= 0) return;
  const key = `usage:${today()}`;
  const current = await kvNumber(env, key);
  await kvPut(env, key, String(Math.round(current + neurons)), DAY_TTL);
}

/** Which voice tier new narration should use right now. */
export async function voiceTier(env: UsageEnv, upcomingChars = 0): Promise<'premium' | 'economy'> {
  if (!env.CACHE) return 'premium';
  const budget = Number(env.PREMIUM_BUDGET) || 6500;
  const spent = await spentToday(env);
  return spent + upcomingChars * COST.auraPerChar <= budget ? 'premium' : 'economy';
}

// ---------------------------------------------------------------------------
// Fair use
// ---------------------------------------------------------------------------

async function visitorKey(request: Request): Promise<string> {
  const ip = request.headers.get('cf-connecting-ip') ?? 'local';
  return `fair:${today()}:${(await sha256(`${today()}|${ip}|chalkline`)).slice(0, 24)}`;
}

/** Returns the number of new lessons this visitor may still generate today. */
export async function lessonsLeft(env: UsageEnv, request: Request): Promise<number> {
  if (!env.CACHE) return Infinity;
  const limit = Number(env.FAIR_USE_LESSONS) || 3;
  return Math.max(0, limit - (await kvNumber(env, await visitorKey(request))));
}

/**
 * Reserves one of today's lessons for this visitor BEFORE generating, so
 * parallel requests cannot all pass a check and then all generate. Returns
 * false if the visitor has none left. KV has no atomic increment, so this is a
 * soft limit, but the race window shrinks from the ~60 s of generation to a
 * single read-then-write.
 */
export async function reserveLesson(env: UsageEnv, request: Request): Promise<boolean> {
  if (!env.CACHE) return true;
  const limit = Number(env.FAIR_USE_LESSONS) || 3;
  const key = await visitorKey(request);
  const used = await kvNumber(env, key);
  if (used >= limit) return false;
  await kvPut(env, key, String(used + 1), DAY_TTL);
  return true;
}

/** Gives a reserved lesson back when generation failed, so errors don't use up the visitor's allowance. */
export async function refundLesson(env: UsageEnv, request: Request): Promise<void> {
  if (!env.CACHE) return;
  const key = await visitorKey(request);
  const used = await kvNumber(env, key);
  if (used > 0) await kvPut(env, key, String(used - 1), DAY_TTL);
}

/**
 * Per-visitor daily allowance for follow-up questions, so a script cannot spend
 * the whole free AI allowance by asking thousands of questions.
 * Returns false (and does not count) when the visitor is over the limit.
 * Fails open: if KV is unavailable, the question is still answered.
 */
export async function takeQuestion(env: UsageEnv & { FAIR_USE_QUESTIONS?: string }, request: Request): Promise<boolean> {
  if (!env.CACHE) return true;
  const limit = Number(env.FAIR_USE_QUESTIONS) || 40;
  const key = (await visitorKey(request)).replace('fair:', 'fairq:');
  const used = await kvNumber(env, key);
  if (used >= limit) return false;
  await kvPut(env, key, String(used + 1), DAY_TTL);
  return true;
}

// ---------------------------------------------------------------------------
// Cache
// ---------------------------------------------------------------------------

/**
 * Cache key for a lesson: level + model + a hash of the normalised topic.
 * Hashing keeps keys short and safe for any script; "v2" retires older keys
 * that were built from an ASCII-only normalisation (which collided).
 */
export async function lessonKey(topic: string, level: string, model: string): Promise<string> {
  const normalised = normaliseTopic(topic) || topic.trim();
  return `lesson:v2:${level}:${model}:${await sha256(normalised)}`;
}

export async function getCachedLesson<T>(env: UsageEnv, key: string): Promise<T | null> {
  if (!env.CACHE) return null;
  try {
    return await env.CACHE.get<T>(key, 'json');
  } catch (err) {
    console.warn('KV read failed', key, String(err));
    return null;
  }
}

export async function putCachedLesson(env: UsageEnv, key: string, lesson: unknown): Promise<void> {
  if (!env.CACHE) return;
  await kvPut(env, key, JSON.stringify(lesson), CACHE_TTL);
}

export const audioKey = async (model: string, voice: string, text: string) => `tts:v1:${model}:${voice}:${await sha256(text)}`;

export async function getCachedAudio(env: UsageEnv, key: string): Promise<ArrayBuffer | null> {
  if (!env.CACHE) return null;
  try {
    return await env.CACHE.get(key, 'arrayBuffer');
  } catch (err) {
    console.warn('KV read failed', key, String(err));
    return null;
  }
}

export async function putCachedAudio(env: UsageEnv, key: string, bytes: Uint8Array): Promise<void> {
  if (!env.CACHE) return;
  await kvPut(env, key, bytes, CACHE_TTL);
}
