// On-device AI: writes lessons and answers questions with an open-source model
// running in the learner's browser (WebLLM, Apache-2.0, via WebGPU). No API key,
// no daily limit (narration still uses the cloud voice when available). Used when the learner chooses "My device",
// or when the free cloud allowance has run out.
//
// It reuses the exact prompts, line-format parser and validator of the cloud
// path (shared/), so lessons render and behave the same way. Small models are
// weaker writers, which the validator's repair step partly compensates for.

// WebLLM is ~6 MB of JavaScript, so it is only downloaded when on-device mode is used.
import type { ChatCompletionMessageParam, MLCEngineInterface } from '@mlc-ai/web-llm';
const webllm = () => import('@mlc-ai/web-llm');
import { askMessages, outlineMessages, STEP_COUNT, stepMessages, type Outline } from '../../shared/prompts.ts';
import { assembleRawLesson, checkOutline, extractJson } from '../../shared/assemble.ts';
import { parseStep, type RawBeat } from '../../shared/dsl.ts';
import { normalizeLesson } from '../../shared/validate.ts';
import type { AskRequest, AskResponse, Lesson, Level } from '../../shared/types.ts';

export interface DeviceModel {
  id: string;
  name: string;
  download: string;
  memory: string;
}

/** Open models offered for on-device use (WebLLM prebuilt, 4-bit quantised). */
export const DEVICE_MODELS: DeviceModel[] = [
  { id: 'Qwen2.5-3B-Instruct-q4f16_1-MLC', name: 'Qwen2.5 3B (better lessons)', download: '~1.7 GB', memory: '~2.5 GB GPU memory' },
  { id: 'Qwen2.5-1.5B-Instruct-q4f16_1-MLC', name: 'Qwen2.5 1.5B (lighter, faster)', download: '~0.9 GB', memory: '~1.6 GB GPU memory' },
];
export const DEFAULT_DEVICE_MODEL = DEVICE_MODELS[0].id;

type Gpu = { requestAdapter(): Promise<unknown | null> };

/** Whether this browser can run the on-device model (needs WebGPU). */
export async function deviceSupport(): Promise<{ ok: boolean; reason?: string }> {
  const gpu = (navigator as Navigator & { gpu?: Gpu }).gpu;
  if (!gpu) return { ok: false, reason: 'This browser does not support WebGPU. Use a recent desktop Chrome or Edge.' };
  try {
    const adapter = await gpu.requestAdapter();
    if (!adapter) return { ok: false, reason: 'No compatible graphics adapter was found for WebGPU on this device.' };
  } catch {
    return { ok: false, reason: 'WebGPU is blocked or unavailable on this device.' };
  }
  return { ok: true };
}

export async function isModelDownloaded(model: string): Promise<boolean> {
  try {
    return await (await webllm()).hasModelInCache(model);
  } catch {
    return false;
  }
}

let engine: MLCEngineInterface | null = null;
let engineModel = '';
let loading: Promise<MLCEngineInterface> | null = null;
let worker: Worker | null = null;

/**
 * Integrated GPUs (most laptops) share a small memory budget. A 3,072-token
 * context (our longest call needs ~2,400) and small prefill chunks keep the
 * working memory well below WebLLM's defaults (4,096 / 2,048).
 */
const LOW_MEMORY = { context_window_size: 3072, prefill_chunk_size: 512 };

/** Throws away a crashed engine (e.g. "Device was lost") so the next attempt reloads cleanly. */
export function resetDeviceEngine() {
  try {
    void engine?.unload();
  } catch {
    /* already gone */
  }
  worker?.terminate();
  worker = null;
  engine = null;
  engineModel = '';
}

const isGpuFailure = (err: unknown) => /device was lost|disposed|out of memory|GPUDevice/i.test(String((err as Error)?.message ?? err));

/** Turns low-level WebGPU/WebLLM failures into advice the learner can act on. */
export function explainDeviceError(err: unknown): string {
  if (isGpuFailure(err)) {
    return "Your graphics chip ran out of memory while running the model. On laptops with two graphics chips, set your browser to \"High performance\" in Windows Settings > System > Display > Graphics, then reload. Otherwise try the lighter model or the cloud.";
  }
  if (/failed to fetch|networkerror|load failed/i.test(String((err as Error)?.message ?? err))) {
    return 'The open-source model files could not be downloaded from huggingface.co. Check your internet connection, and allow huggingface.co and raw.githubusercontent.com if an ad blocker or firewall is active, then try again.';
  }
  return err instanceof Error ? err.message : String(err);
}

export const deviceEngineReady = () => engine !== null;
export const deviceEngineModel = () => engineModel;

/** Loads (downloading on first use) the model in a Web Worker. Reuses it across lessons. */
export async function loadDeviceModel(model: string, onProgress: (fraction: number, text: string) => void): Promise<MLCEngineInterface> {
  if (engine && engineModel === model) return engine;
  if (loading && engineModel === model) return loading;
  engineModel = model;
  const progress = { initProgressCallback: (r: { progress: number; text: string }) => onProgress(r.progress, r.text) };
  loading = (async () => {
    if (engine) {
      await engine.reload(model, LOW_MEMORY);
      return engine;
    }
    worker = new Worker(new URL('./llm.worker.ts', import.meta.url), { type: 'module' });
    engine = await (await webllm()).CreateWebWorkerMLCEngine(worker, model, progress, LOW_MEMORY);
    return engine;
  })();
  try {
    return await loading;
  } catch (err) {
    resetDeviceEngine();
    throw err;
  } finally {
    loading = null;
  }
}

async function chat(eng: MLCEngineInterface, messages: unknown[], maxTokens: number, temperature: number): Promise<string> {
  const res = await eng.chat.completions.create({
    messages: messages as ChatCompletionMessageParam[],
    max_tokens: maxTokens,
    temperature,
  });
  return res.choices[0]?.message?.content ?? '';
}

/**
 * Gets a JSON object from a small model. WebLLM's grammar-constrained
 * `json_object` mode is not used: in 0.2.87 it fails to initialise
 * ("GrammarMatcherInitError"). Instead: one try, one stricter retry.
 */
async function chatJson(eng: MLCEngineInterface, messages: unknown[], maxTokens: number): Promise<unknown> {
  try {
    return extractJson(await chat(eng, messages, maxTokens, 0.4));
  } catch {
    const stricter = [
      ...(messages as { role: string; content: string }[]),
      { role: 'user', content: 'Reply with ONLY the JSON object, starting with { and ending with }. No other text.' },
    ];
    return extractJson(await chat(eng, stricter, maxTokens, 0.2));
  }
}

/** Turns plain prose into narration beats (two sentences each, up to four beats), with no drawings. */
export function proseToBeats(text: string): RawBeat[] {
  const clean = text
    .split(/\r?\n/)
    .filter((l) => !/^\s*DRAW\s*:/i.test(l))
    .join('\n')
    .replace(/DRAW\s*:[^\n]*/gi, ' ')
    .replace(/SAY\s*:\s*/gi, '')
    .replace(/[*#_`>]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  const sentences = clean.match(/[^.!?]+[.!?]+/g)?.map((s) => s.trim()).filter((s) => s.split(' ').length >= 4) ?? [];
  const beats: RawBeat[] = [];
  for (let i = 0; i < sentences.length && beats.length < 4; i += 2) beats.push({ say: sentences.slice(i, i + 2).join(' '), actions: [] });
  return beats;
}

/** Standard five-part plan, used if a small model cannot produce a valid outline. */
function defaultOutline(topic: string): Outline {
  return {
    title: topic.charAt(0).toUpperCase() + topic.slice(1),
    summary: `A short introduction to ${topic}.`,
    example: `one simple, concrete example of ${topic} with real values`,
    steps: [
      { title: 'The big question', goal: `Hook the learner with the question ${topic} answers, and draw the key idea.` },
      { title: 'The core idea', goal: `Explain the central idea of ${topic} in plain words and draw its main parts.` },
      { title: 'How it works', goal: 'Show the mechanism step by step, drawing each part and arrows between them.' },
      { title: 'A worked example', goal: 'Walk through the running example with real values, demonstrating each change on the board.' },
      { title: 'Recap', goal: 'Summarise the three most important points and point back at the key drawing.' },
    ],
    quiz: [],
  };
}

export type DeviceStage = { stage: 'model'; fraction: number; text: string } | { stage: 'writing'; step: number; total: number };

/** Writes a full lesson on the learner's device. Steps run one after another (one model instance). */
export async function generateLessonOnDevice(...args: Parameters<typeof writeLessonOnDevice>): Promise<Lesson> {
  try {
    return await writeLessonOnDevice(...args);
  } catch (err) {
    if ((err as Error)?.name === 'AbortError') throw err;
    if (isGpuFailure(err)) resetDeviceEngine();
    throw new Error(explainDeviceError(err));
  }
}

async function writeLessonOnDevice(
  topic: string,
  level: Level,
  model: string,
  onStage: (s: DeviceStage) => void,
  signal: AbortSignal,
): Promise<Lesson> {
  const eng = await loadDeviceModel(model, (fraction, text) => onStage({ stage: 'model', fraction, text }));
  const abort = () => {
    if (signal.aborted) {
      eng.interruptGenerate();
      throw new DOMException('Cancelled', 'AbortError');
    }
  };

  onStage({ stage: 'writing', step: 0, total: STEP_COUNT });
  let outline: Outline;
  try {
    const rawOutline = (await chatJson(eng, outlineMessages(topic, level), 900)) as Outline;
    if (typeof rawOutline?.refusal === 'string' && rawOutline.refusal.trim()) throw Object.assign(new Error(rawOutline.refusal.trim()), { refusal: true });
    outline = checkOutline(rawOutline, STEP_COUNT);
    // Too short a plan makes a thin lesson: keep the model's title and quiz, use the standard five parts.
    if (outline.steps.length < 4) outline = { ...defaultOutline(topic), title: outline.title || topic, quiz: outline.quiz };
  } catch (err) {
    if ((err as { refusal?: boolean }).refusal || isGpuFailure(err)) throw err;
    // Small models sometimes can't produce a valid plan; a standard plan still yields a good lesson.
    console.warn('On-device outline unusable, using the standard five-part plan', String(err));
    outline = defaultOutline(topic);
  }
  abort();

  const stepBeats: RawBeat[][] = [];
  for (let i = 0; i < outline.steps.length; i++) {
    onStage({ stage: 'writing', step: i + 1, total: outline.steps.length });
    let beats: RawBeat[] = [];
    let lastText = '';
    for (let attempt = 0; attempt < 2 && beats.length < 2; attempt++) {
      lastText = await chat(eng, stepMessages(topic, level, outline, i), 700, attempt ? 0.3 : 0.6);
      const parsed = parseStep(lastText);
      if (parsed.length > beats.length) beats = parsed;
      abort();
    }
    // Small models sometimes ignore the SAY/DRAW format and write prose; keep the prose as narration.
    if (!beats.length) beats = proseToBeats(lastText);
    stepBeats.push(beats);
  }

  const lesson = normalizeLesson(assembleRawLesson(outline, stepBeats), { topic, level, source: 'live', model });
  lesson.generatedOn = 'device';
  lesson.voiceTier = 'economy';
  return lesson;
}

/** Answers a follow-up question on the device. */
export async function askOnDevice(req: AskRequest): Promise<AskResponse> {
  if (!engine) throw new Error('The on-device model is not loaded.');
  let text: string;
  try {
    text = await chat(engine, askMessages(req), 300, 0.4);
  } catch (err) {
    if (isGpuFailure(err)) resetDeviceEngine();
    throw new Error(explainDeviceError(err));
  }
  let answer = '';
  let highlight: string[] = [];
  try {
    const r = extractJson(text) as { answer?: unknown; highlight?: unknown };
    answer = typeof r.answer === 'string' ? r.answer : '';
    highlight = Array.isArray(r.highlight) ? r.highlight.filter((h): h is string => typeof h === 'string') : [];
  } catch {
    answer = text; // small models sometimes answer in plain text; that is fine
  }
  const ids = new Set(req.board.map((b) => b.id));
  answer = answer.replace(/\s+/g, ' ').trim().slice(0, 900);
  if (!answer) throw new Error('The on-device model could not form an answer. Please rephrase your question.');
  return { answer, highlight: highlight.filter((h) => ids.has(h)).slice(0, 2), voiceTier: 'economy' };
}
