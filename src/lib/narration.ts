// Prepares narration for a lesson: fetches one audio clip per beat, measures
// each clip, builds the timeline from the real durations, and merges the clips
// into a single seekable buffer. Falls back to the browser voice if audio
// cannot be produced.

import type { Lesson, VoiceTier } from '../../shared/types.ts';
import { buildTimeline, estimateSpeech, type Timeline } from '../../shared/timeline.ts';
import { ApiFailure, synthesize } from './api.ts';
import { AudioClock, SpeechClock, type Clock } from './clock.ts';

export interface PreparedNarration {
  timeline: Timeline;
  clock: Clock;
  /** Why we fell back to the browser voice, if we did. */
  fallbackReason?: string;
}

const CONCURRENCY = 4;

export function beatTexts(lesson: Lesson): string[] {
  return lesson.steps.flatMap((s) => s.beats.map((b) => b.say));
}

async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T, i: number) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i], i);
    }
  });
  await Promise.all(workers);
  return out;
}

async function fetchClip(lesson: Lesson, text: string, beatId: string, signal: AbortSignal): Promise<ArrayBuffer> {
  if (lesson.source === 'sample') {
    const id = lesson.id;
    const res = await fetch(`/samples/${id}/${beatId}.${lesson.audio ?? 'wav'}`, { signal });
    if (!res.ok) throw new ApiFailure('Sample audio missing.', 'not_found', res.status);
    return res.arrayBuffer();
  }
  try {
    return await synthesize(text, signal, lesson.voiceTier);
  } catch (err) {
    if (err instanceof ApiFailure && err.code !== 'quota' && err.code !== 'bad_request') {
      return synthesize(text, signal, lesson.voiceTier); // one retry for transient failures
    }
    throw err;
  }
}

/** Places each clip at its beat's start time in one buffer, with silence in the gaps. */
function mergeClips(ctx: AudioContext, clips: AudioBuffer[], timeline: Timeline): AudioBuffer {
  const rate = ctx.sampleRate;
  const out = ctx.createBuffer(1, Math.ceil((timeline.duration + 0.05) * rate), rate);
  const data = out.getChannelData(0);
  clips.forEach((clip, i) => {
    const at = Math.round(timeline.beats[i].start * rate);
    const src = clip.getChannelData(0);
    data.set(src.subarray(0, Math.min(src.length, data.length - at)), at);
  });
  return out;
}

export async function prepareNarration(
  lesson: Lesson,
  ctx: AudioContext,
  opts: { signal: AbortSignal; onProgress: (done: number, total: number) => void },
): Promise<PreparedNarration> {
  const texts = beatTexts(lesson);
  const ids = lesson.steps.flatMap((s) => s.beats.map((b) => b.id));
  let done = 0;
  opts.onProgress(0, texts.length);

  try {
    const clips = await mapLimit(texts, CONCURRENCY, async (text, i) => {
      const bytes = await fetchClip(lesson, text, ids[i], opts.signal);
      const buf = await ctx.decodeAudioData(bytes);
      opts.onProgress(++done, texts.length);
      return buf;
    });
    const timeline = buildTimeline(lesson, clips.map((c) => c.duration));
    return { timeline, clock: new AudioClock(mergeClips(ctx, clips, timeline), timeline.duration) };
  } catch (err) {
    if ((err as Error).name === 'AbortError') throw err;
    const reason = lesson.generatedOn === 'device'
      ? "This lesson was written on your device and the cloud voice isn't available right now, so your browser's built-in voice narrates it."
      : err instanceof ApiFailure && err.code === 'quota'
        ? "Today's free AI voice allowance is used up, so the browser's built-in voice is narrating instead."
        : "AI narration could not be generated, so the browser's built-in voice is narrating instead.";
    if (!('speechSynthesis' in window)) throw err;
    const timeline = buildTimeline(lesson, texts.map((t) => estimateSpeech(t)));
    return { timeline, clock: new SpeechClock(timeline, texts), fallbackReason: reason };
  }
}

/** Speaks a tutor answer at the learner's chosen speed. Returns a function that stops it. */
export async function speakAnswer(text: string, rate: number, signal: AbortSignal, tier: VoiceTier = 'premium'): Promise<() => void> {
  try {
    const bytes = await synthesize(text, signal, tier);
    const url = URL.createObjectURL(new Blob([bytes]));
    const audio = new Audio(url);
    audio.preservesPitch = true;
    audio.playbackRate = rate;
    audio.addEventListener('ended', () => URL.revokeObjectURL(url));
    await audio.play();
    return () => audio.pause();
  } catch (err) {
    if ((err as Error).name === 'AbortError') return () => {};
    if (!('speechSynthesis' in window)) return () => {};
    const u = new SpeechSynthesisUtterance(text);
    window.speechSynthesis.cancel();
    window.speechSynthesis.speak(u);
    return () => window.speechSynthesis.cancel();
  }
}
