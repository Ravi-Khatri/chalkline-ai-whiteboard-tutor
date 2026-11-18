import { describe, expect, it } from 'vitest';
import {
  audioKey,
  getCachedAudio,
  getCachedLesson,
  lessonKey,
  lessonsLeft,
  normaliseTopic,
  refundLesson,
  reserveLesson,
  putCachedAudio,
  putCachedLesson,
  recordSpend,
  spentToday,
  takeQuestion,
  voiceTier,
  type UsageEnv,
} from '../worker/usage.ts';

/** Minimal in-memory stand-in for a KV namespace. */
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
      store.set(key, typeof value === 'string' ? value : ArrayBuffer.isView(value) ? value.buffer.slice(value.byteOffset, value.byteOffset + value.byteLength) as ArrayBuffer : value);
    },
  } as unknown as KVNamespace;
}

const req = (ip: string) => new Request('https://x/api/lesson', { headers: { 'cf-connecting-ip': ip } });

describe('budget guard', () => {
  it('uses the premium voice until the budget would be exceeded', async () => {
    const env: UsageEnv = { CACHE: memoryKV(), PREMIUM_BUDGET: '6500' };
    expect(await voiceTier(env, 1500)).toBe('premium'); // ~4,100 neurons fits
    await recordSpend(env, 4800);
    expect(await spentToday(env)).toBe(4800);
    expect(await voiceTier(env, 1500)).toBe('economy'); // 4,800 + ~4,100 > 6,500
    expect(await voiceTier(env, 100)).toBe('premium'); // a short answer still fits
  });

  it('defaults to premium without KV (local dev without bindings)', async () => {
    expect(await voiceTier({}, 99999)).toBe('premium');
  });
});

describe('fair use', () => {
  it('limits new lessons per visitor and counts visitors separately', async () => {
    const env: UsageEnv = { CACHE: memoryKV(), FAIR_USE_LESSONS: '2' };
    expect(await lessonsLeft(env, req('1.1.1.1'))).toBe(2);
    expect(await reserveLesson(env, req('1.1.1.1'))).toBe(true);
    expect(await reserveLesson(env, req('1.1.1.1'))).toBe(true);
    expect(await reserveLesson(env, req('1.1.1.1'))).toBe(false); // reserved up front, so a third is refused
    expect(await lessonsLeft(env, req('1.1.1.1'))).toBe(0);
    expect(await lessonsLeft(env, req('2.2.2.2'))).toBe(2);
  });

  it('refunds a reserved lesson when generation fails', async () => {
    const env: UsageEnv = { CACHE: memoryKV(), FAIR_USE_LESSONS: '1' };
    expect(await reserveLesson(env, req('3.3.3.3'))).toBe(true);
    await refundLesson(env, req('3.3.3.3'));
    expect(await lessonsLeft(env, req('3.3.3.3'))).toBe(1);
  });

  it('fails open when KV is unavailable, instead of breaking the request', async () => {
    const broken = { get: async () => { throw new Error('KV down'); }, put: async () => { throw new Error('KV write limit'); } } as unknown as KVNamespace;
    const env = { CACHE: broken };
    expect(await takeQuestion(env, req('4.4.4.4'))).toBe(true);
    expect(await reserveLesson(env, req('4.4.4.4'))).toBe(true);
    await expect(recordSpend(env, 100)).resolves.toBeUndefined();
    expect(await getCachedLesson(env, 'k')).toBeNull();
  });
});

describe('question fair use', () => {
  it('allows a set number of questions per visitor per day', async () => {
    const env = { CACHE: memoryKV(), FAIR_USE_QUESTIONS: '2' };
    expect(await takeQuestion(env, req('9.9.9.9'))).toBe(true);
    expect(await takeQuestion(env, req('9.9.9.9'))).toBe(true);
    expect(await takeQuestion(env, req('9.9.9.9'))).toBe(false);
    expect(await takeQuestion(env, req('8.8.8.8'))).toBe(true);
    // Questions and lessons are counted separately.
    expect(await lessonsLeft(env, req('9.9.9.9'))).toBe(3);
  });
});

describe('cache', () => {
  it('normalises topics so trivial differences share one lesson', async () => {
    expect(await lessonKey('  How Binary-Search works? ', 'beginner', 'm')).toBe(await lessonKey('how binary search works', 'beginner', 'm'));
    expect(await lessonKey('photosynthesis', 'beginner', 'm')).not.toBe(await lessonKey('photosynthesis', 'advanced', 'm'));
    expect(await lessonKey('photosynthesis', 'beginner', 'm1')).not.toBe(await lessonKey('photosynthesis', 'beginner', 'm2'));
  });

  it('keeps different topics apart, including symbols and non-Latin scripts', async () => {
    const key = (t: string) => lessonKey(t, 'beginner', 'm');
    expect(await key('C++ pointers')).not.toBe(await key('C# pointers'));
    expect(await key('光合作用')).not.toBe(await key('日本の歴史'));
    expect(normaliseTopic('Fotosíntesis')).toBe('fotosíntesis');
    expect(normaliseTopic('光合作用')).toBe('光合作用');
    expect(await key('!!!')).not.toBe(await key('???')); // symbol-only topics never share an empty key
  });

  it('round-trips lessons and audio', async () => {
    const env: UsageEnv = { CACHE: memoryKV() };
    await putCachedLesson(env, 'k', { title: 'T' });
    expect(await getCachedLesson(env, 'k')).toEqual({ title: 'T' });
    const key = await audioKey('m', 'athena', 'hello');
    expect(key).toBe(await audioKey('m', 'athena', 'hello'));
    expect(key).not.toBe(await audioKey('m', 'orion', 'hello'));
    await putCachedAudio(env, key, new Uint8Array([1, 2, 3]));
    expect([...new Uint8Array((await getCachedAudio(env, key))!)]).toEqual([1, 2, 3]);
  });
});
