import { describe, expect, it } from 'vitest';
import { normalizeLesson, parsePoints } from '../shared/validate.ts';
import { boardAt, buildTimeline, type ConnectorItem, type ShapeItem } from '../shared/timeline.ts';
import { parseStep } from '../shared/dsl.ts';

const lesson = normalizeLesson(
  {
    steps: [
      {
        title: 'Setup',
        beats: [
          { say: 'Two cards.', actions: [{ op: 'box', id: 'a', text: 'A', x: 20, y: 30, w: 10, h: 8 }, { op: 'box', id: 'b', text: 'B', x: 80, y: 30, w: 10, h: 8 }, { op: 'arrow', from: 'a', to: 'b' }] },
          { say: 'Swap them.', actions: [{ op: 'move', target: 'a', x: 80, y: 50 }] },
        ],
      },
      {
        title: 'Eliminate',
        beats: [
          { say: 'Rule out B.', actions: [{ op: 'cross', target: 'b' }] },
          { say: 'Growth.', actions: [{ op: 'graph', id: 'g', text: 'Balance', x: 50, y: 20, w: 40, h: 24, points: '0:1000 1:1100 2:1210' }] },
        ],
      },
    ],
  },
  { topic: 't', level: 'beginner', source: 'live' },
);
const timeline = buildTimeline(lesson, [2, 2, 2, 2]);
const shape = (t: number, id: string, instant = true) =>
  boardAt(lesson, timeline, t, { instant }).items.find((i) => 'id' in i && i.id === id) as ShapeItem | undefined;
const centreX = (s: ShapeItem) => s.rect.x + s.rect.w / 2;

describe('move', () => {
  const moveStart = timeline.beats[1].start;

  it('slides the item from its old to its new position over time', () => {
    expect(centreX(shape(moveStart - 0.01, 'a')!)).toBeCloseTo(20, 0);
    const mid = centreX(shape(moveStart + 0.45, 'a', false)!);
    expect(mid).toBeGreaterThan(20);
    expect(mid).toBeLessThan(80);
    expect(centreX(shape(moveStart + 5, 'a')!)).toBeCloseTo(80, 0);
  });

  it('rewinds exactly when seeking back before the move', () => {
    const before = JSON.stringify(shape(moveStart - 0.2, 'a'));
    shape(timeline.duration, 'a');
    expect(JSON.stringify(shape(moveStart - 0.2, 'a'))).toBe(before);
  });

  it('keeps connectors attached to an item that moved', () => {
    const t = moveStart + 5;
    const arrow = boardAt(lesson, timeline, t, { instant: true }).items.find((i) => i.kind === 'arrow') as ConnectorItem;
    const a = shape(t, 'a')!;
    // Arrow now starts near the moved box (x ~80), not where it was (x ~20).
    expect(Math.abs(arrow.x1 - centreX(a))).toBeLessThan(a.rect.w);
  });
});

describe('cross', () => {
  it('marks the item crossed from its beat onwards, and not before', () => {
    expect(shape(timeline.beats[2].start - 0.1, 'b')!.crossed).toBeUndefined();
    expect(shape(timeline.beats[2].start + 1, 'b')!.crossed?.progress).toBe(1);
  });
});

describe('graph', () => {
  it('parses and normalises points', () => {
    const g = shape(timeline.duration, 'g') as Extract<ShapeItem, { kind: 'graph' }>;
    expect(g.kind).toBe('graph');
    expect(g.points).toHaveLength(3);
    expect(g.points[2]).toEqual([1, 1]);
    expect(g.range).toMatchObject({ x0: 0, x1: 2, y1: 1210 });
  });

  it('accepts several point formats and drops graphs with too few points', () => {
    expect(parsePoints('0:1 1:2')).toEqual([[0, 1], [1, 2]]);
    expect(parsePoints('0,1; 1,2')).toEqual([[0, 1], [1, 2]]);
    expect(parsePoints([[1, 2], { x: 0, y: 5 }])).toEqual([[0, 5], [1, 2]]);
    const l = normalizeLesson(
      { steps: [{ title: 'A', beats: [{ say: 'x', actions: [{ op: 'graph', id: 'g', points: '1:1' }] }, { say: 'y', actions: [] }] }, { title: 'B', beats: [{ say: 'z', actions: [] }, { say: 'w', actions: [] }] }] },
      { topic: 't', level: 'beginner', source: 'live' },
    );
    expect(l.steps[0].beats[0].actions).toEqual([]);
  });

  it('round-trips through the model line format', () => {
    const [beat] = parseStep('SAY: Growth.\nDRAW: graph id=g text="Balance" x=50 y=30 points="0:100 1:110 2:121"');
    expect(beat.actions[0]).toMatchObject({ op: 'graph', points: '0:100 1:110 2:121' });
  });
});
