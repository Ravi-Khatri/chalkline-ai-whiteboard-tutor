import { describe, expect, it } from 'vitest';
import { assembleRawLesson } from '../shared/assemble.ts';
import { normalizeLesson } from '../shared/validate.ts';
import type { Outline } from '../shared/prompts.ts';

// proseToBeats lives in the browser module; import it without loading WebLLM (it is lazily imported there).
const { proseToBeats } = await import('../src/lib/deviceAI.ts');

describe('small-model resilience', () => {
  it('turns prose that ignored the SAY/DRAW format into narration beats', () => {
    const beats = proseToBeats('Here is the step. Bubble sort compares neighbours in the list. It swaps them when they are out of order. Larger values drift to the end. DRAW: box id=x\nThis repeats until nothing moves.');
    expect(beats.length).toBeGreaterThanOrEqual(2);
    expect(beats.every((b) => b.actions.length === 0 && b.say.length > 0)).toBe(true);
    expect(beats.map((b) => b.say).join(' ')).not.toMatch(/DRAW/);
  });

  it('never starts a step on an empty board', () => {
    const outline = { title: 'T', summary: '', example: '', quiz: [], steps: [{ title: 'First idea', goal: '' }, { title: 'Second idea', goal: '' }] } as Outline;
    const say = (s: string) => ({ say: s, actions: [] });
    const lesson = normalizeLesson(assembleRawLesson(outline, [[say('One.'), say('Two.')], [say('Three.'), say('Four.')]]), {
      topic: 't',
      level: 'beginner',
      source: 'live',
    });
    for (const step of lesson.steps) {
      expect(step.beats[0].actions.some((a) => a.op === 'text' && a.text === step.title)).toBe(true);
    }
  });
});
