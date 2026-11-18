import { describe, expect, it } from 'vitest';
import { normalizeLesson } from '../shared/validate.ts';
import { boardAt, buildTimeline, beatAt, BEAT_GAP, STEP_GAP } from '../shared/timeline.ts';

const raw = {
  title: 'Binary search',
  summary: 'Halve the list each time.',
  quiz: [{ q: 'Q?', options: ['a', 'b', 'c'], answer: 1, why: 'because' }],
  steps: [
    {
      title: 'Setup',
      beats: [
        { say: 'Here is a sorted list.', actions: [{ op: 'text', id: 'title', text: 'Binary search', x: 50, y: 5, size: 'lg' }, { op: 'box', id: 'list', text: '3 8 15 23', x: 50, y: 25 }] },
        { say: 'We look at the middle.', actions: [{ op: 'circle', id: 'mid', text: 'mid', x: 50, y: 40 }, { op: 'arrow', from: 'mid', to: 'list' }] },
      ],
    },
    {
      title: 'Compare',
      beats: [
        { say: 'Compare with the target.', actions: [{ op: 'highlight', target: 'mid' }] },
        { say: 'Start fresh.', actions: [{ op: 'clear' }, { op: 'text', id: 'done', text: 'Found it', x: 50, y: 30 }] },
      ],
    },
  ],
};

const lesson = normalizeLesson(raw, { topic: 'binary search', level: 'beginner', source: 'live' });
const durations = [2, 3, 1.5, 2.5];
const timeline = buildTimeline(lesson, durations);

describe('buildTimeline', () => {
  it('places beats back to back using measured clip lengths plus gaps', () => {
    const expected = [0, 2 + BEAT_GAP, 5 + BEAT_GAP + STEP_GAP, 6.5 + 2 * BEAT_GAP + STEP_GAP];
    timeline.beats.forEach((b, i) => expect(b.start).toBeCloseTo(expected[i], 9));
    expect(timeline.duration).toBeCloseTo(9 + 2 * BEAT_GAP + 2 * STEP_GAP);
    expect(timeline.steps).toHaveLength(2);
  });

  it('finds the active beat for any time', () => {
    expect(beatAt(timeline, -1)).toBe(-1);
    expect(beatAt(timeline, 0)).toBe(0);
    expect(beatAt(timeline, 2.1)).toBe(0); // in the gap after beat 0
    expect(beatAt(timeline, timeline.beats[2].start + 0.01)).toBe(2);
    expect(beatAt(timeline, 999)).toBe(3);
  });
});

describe('boardAt', () => {
  const ids = (t: number) => boardAt(lesson, timeline, t, { instant: true }).items.map((i) => ('id' in i ? i.id : i.kind));

  it('shows nothing before the lesson starts and items as their beat begins', () => {
    expect(ids(-0.1)).toEqual([]);
    expect(ids(0.01)).toContain('title');
    expect(ids(1.9)).not.toContain('mid');
    expect(ids(timeline.beats[1].start + 1)).toEqual(expect.arrayContaining(['title', 'list', 'mid', 'arrow']));
  });

  it('is deterministic: seeking back reproduces the earlier frame exactly', () => {
    const t1 = timeline.beats[1].start + 0.3;
    const before = JSON.stringify(boardAt(lesson, timeline, t1));
    boardAt(lesson, timeline, timeline.duration); // "play to the end"
    expect(JSON.stringify(boardAt(lesson, timeline, t1))).toBe(before);
  });

  it('animates drawing progress from 0 to 1 based only on time', () => {
    const start = timeline.beats[0].start;
    const p = (t: number) => (boardAt(lesson, timeline, t).items.find((i) => 'id' in i && i.id === 'title') as { progress: number }).progress;
    expect(p(start)).toBe(0);
    expect(p(start + 0.3)).toBeGreaterThan(0);
    expect(p(start + 0.3)).toBeLessThan(1);
    expect(p(start + 5)).toBe(1);
  });

  it('highlights only while the highlighting beat is active', () => {
    const hi = (t: number) => (boardAt(lesson, timeline, t, { instant: true }).items.find((i) => 'id' in i && i.id === 'mid') as { highlighted: boolean } | undefined)?.highlighted;
    expect(hi(timeline.beats[1].start + 0.5)).toBe(false);
    expect(hi(timeline.beats[2].start + 0.1)).toBe(true);
  });

  it('clear wipes everything drawn before it', () => {
    expect(ids(timeline.duration)).toEqual(['done']);
  });
});

describe('normalizeLesson', () => {
  it('drops references to items that do not exist and invalid ops', () => {
    const l = normalizeLesson(
      {
        steps: [
          { title: 'A', beats: [{ say: 'one', actions: [{ op: 'highlight', target: 'ghost' }, { op: 'explode' }, { op: 'text', id: 'a', text: 'A' }] }, { say: 'two', actions: [] }] },
          { title: 'B', beats: [{ say: 'three', actions: [{ op: 'arrow', from: 'a', to: 'nowhere' }] }, { say: 'four', actions: [] }] },
        ],
      },
      { topic: 't', level: 'beginner', source: 'live' },
    );
    const ops = l.steps.flatMap((s) => s.beats.flatMap((b) => b.actions.map((a) => a.op)));
    expect(ops).toEqual(['text']);
  });

  it('clamps coordinates to the board and de-duplicates ids', () => {
    const l = normalizeLesson(
      {
        steps: [
          { title: 'A', beats: [{ say: 'x', actions: [{ op: 'box', id: 'b', text: 'B', x: 500, y: -40 }, { op: 'box', id: 'b', text: 'B2', x: 10, y: 10 }] }, { say: 'y', actions: [] }] },
          { title: 'B', beats: [{ say: 'z', actions: [] }, { say: 'w', actions: [] }] },
        ],
      },
      { topic: 't', level: 'beginner', source: 'live' },
    );
    const [a, b] = l.steps[0].beats[0].actions;
    expect(a.x).toBeLessThanOrEqual(100);
    expect(a.y).toBeGreaterThanOrEqual(0);
    expect(a.id).not.toBe(b.id);
  });

  it('nudges a new item away from one already in the same spot', () => {
    const l = normalizeLesson(
      {
        steps: [
          { title: 'A', beats: [{ say: 'x', actions: [{ op: 'box', id: 'one', text: 'One', x: 50, y: 30 }, { op: 'box', id: 'two', text: 'Two', x: 50, y: 30 }] }, { say: 'y', actions: [] }] },
          { title: 'B', beats: [{ say: 'z', actions: [] }, { say: 'w', actions: [] }] },
        ],
      },
      { topic: 't', level: 'beginner', source: 'live' },
    );
    const [one, two] = l.steps[0].beats[0].actions;
    expect(one.x !== two.x || one.y !== two.y).toBe(true);
  });

  it('rejects output with nothing teachable', () => {
    expect(() => normalizeLesson({ steps: [] }, { topic: 't', level: 'beginner', source: 'live' })).toThrow();
  });
});
