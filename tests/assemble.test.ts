import { describe, expect, it } from 'vitest';
import { assembleRawLesson, checkOutline, extractJson, stripThinking } from '../shared/assemble.ts';
import { normalizeLesson } from '../shared/validate.ts';
import { parseStep } from '../shared/dsl.ts';
import type { Outline } from '../shared/prompts.ts';

describe('extractJson', () => {
  it('finds JSON wrapped in chatter or code fences, and ignores model "thinking"', () => {
    expect(extractJson('Sure!\n```json\n{"a":1}\n```')).toEqual({ a: 1 });
    expect(extractJson('<think>maybe {"wrong":true}</think>{"right":true}')).toEqual({ right: true });
    expect(extractJson({ already: 'object' })).toEqual({ already: 'object' });
    expect(() => extractJson('no json here')).toThrow();
  });

  it('strips unterminated leading thinking', () => {
    expect(stripThinking('lots of reasoning </think> answer')).toBe('answer');
  });
});

describe('checkOutline', () => {
  it('rejects outlines without enough steps and trims extra ones', () => {
    expect(() => checkOutline({ steps: [{ title: 'one' }] }, 5)).toThrow();
    const o = checkOutline({ title: 'T', steps: Array.from({ length: 7 }, (_, i) => ({ title: `s${i}`, goal: '' })) }, 5);
    expect(o.steps).toHaveLength(5);
    expect(o.quiz).toEqual([]);
  });
});

describe('assembleRawLesson', () => {
  it('joins independently written steps into a valid lesson with a clean board per step', () => {
    const outline = { title: 'Bubble sort', summary: 's', example: 'e', quiz: [], steps: [{ title: 'A', goal: '' }, { title: 'B', goal: '' }] } as Outline;
    const step = parseStep('SAY: First.\nDRAW: box id=x text="X" x=20 y=30\nSAY: Second.\nDRAW: highlight target=x');
    const lesson = normalizeLesson(assembleRawLesson(outline, [step, step]), { topic: 't', level: 'beginner', source: 'live' });
    expect(lesson.steps).toHaveLength(2);
    // Same id in both steps is namespaced, so both survive and references stay correct.
    const ids = lesson.steps.flatMap((s) => s.beats.flatMap((b) => b.actions.map((a) => a.id ?? a.target ?? a.op)));
    expect(ids).toEqual(['s1-x', 's1-x', 'clear', 's2-x', 's2-x']);
  });
});
