// Turning raw model text into a lesson. Shared by the Cloudflare Worker and the
// on-device (WebLLM) path, so both produce lessons through the same parser,
// repair and validation code.

import { namespaceIds, type RawBeat } from './dsl.ts';
import type { Outline } from './prompts.ts';

/** Removes hidden reasoning that some models (e.g. Qwen3) emit before the answer. */
export function stripThinking(text: string): string {
  return text.replace(/<think>[\s\S]*?<\/think>/gi, '').replace(/^[\s\S]*<\/think>/i, '').trim();
}

/** Parses a model response that may be an object already or a string containing JSON. */
export function extractJson(response: unknown): unknown {
  if (typeof response === 'object' && response !== null) return response;
  if (typeof response !== 'string') throw new Error('Empty model response');
  const text = stripThinking(response);
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start < 0 || end <= start) throw new Error('No JSON object in model response');
  return JSON.parse(text.slice(start, end + 1));
}

/** Checks the outline is usable and trims it to the expected number of steps. */
export function checkOutline(outline: unknown, maxSteps: number): Outline {
  const o = outline as Outline;
  if (!Array.isArray(o?.steps) || o.steps.length < 2) throw new Error('The AI could not plan this lesson.');
  o.steps = o.steps.filter((s) => s && typeof s.title === 'string').slice(0, maxSteps);
  if (o.steps.length < 2) throw new Error('The AI could not plan this lesson.');
  if (!Array.isArray(o.quiz)) o.quiz = [];
  return o;
}

/** Combines the outline and the independently written steps into one raw lesson for normalizeLesson. */
export function assembleRawLesson(outline: Outline, stepBeats: RawBeat[][]) {
  return {
    title: outline.title,
    summary: outline.summary,
    quiz: outline.quiz,
    steps: outline.steps.map((s, i) => {
      const beats = namespaceIds(stepBeats[i] ?? [], `s${i + 1}`);
      // Each step starts on a clean board (steps are written independently).
      if (i > 0 && beats.length) beats[0].actions.unshift({ op: 'clear' });
      return { title: s.title, beats };
    }),
  };
}
