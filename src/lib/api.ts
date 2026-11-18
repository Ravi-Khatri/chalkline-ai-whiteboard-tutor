import type { ApiError, AskRequest, AskResponse, Lesson, Level, VoiceTier } from '../../shared/types.ts';

export class ApiFailure extends Error {
  constructor(message: string, public code: ApiError['code'] | 'network', public status = 0) {
    super(message);
  }
}

async function post(path: string, body: unknown, signal?: AbortSignal): Promise<Response> {
  let res: Response;
  try {
    res = await fetch(path, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
      signal,
    });
  } catch (err) {
    if ((err as Error).name === 'AbortError') throw err;
    throw new ApiFailure('Could not reach the server. Check your connection and try again.', 'network');
  }
  if (!res.ok) {
    let data: Partial<ApiError> = {};
    try {
      data = await res.json();
    } catch {
      /* not JSON */
    }
    throw new ApiFailure(data.error ?? `Request failed (${res.status}).`, data.code ?? 'server', res.status);
  }
  return res;
}

export async function generateLesson(topic: string, level: Level, signal?: AbortSignal): Promise<Lesson> {
  const res = await post('/api/lesson', { topic, level }, signal);
  return res.json();
}

export async function synthesize(text: string, signal?: AbortSignal, tier: VoiceTier = 'premium'): Promise<ArrayBuffer> {
  const res = await post('/api/tts', { text, tier }, signal);
  return res.arrayBuffer();
}

export async function askTutor(req: AskRequest, signal?: AbortSignal): Promise<AskResponse> {
  const res = await post('/api/ask', req, signal);
  return res.json();
}

export interface SampleInfo {
  id: string;
  title: string;
  topic: string;
  blurb: string;
}

export async function listSamples(): Promise<SampleInfo[]> {
  const res = await fetch('/samples/index.json');
  if (!res.ok) return [];
  return res.json();
}

export async function loadSample(id: string, signal?: AbortSignal): Promise<Lesson> {
  const res = await fetch(`/samples/${id}/lesson.json`, { signal });
  if (!res.ok) throw new ApiFailure('Sample lesson not found.', 'not_found', res.status);
  return res.json();
}
