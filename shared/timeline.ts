// Playback model. The narration audio is the single clock; the board is a pure
// function of (lesson, timeline, t). Because nothing is stored between frames,
// pause, resume, seek (in either direction) and restart are all the same
// operation: compute the board for the new time.

import type { Action, Color, Lesson, Size } from './types.ts';
import { edgePoint, layoutText, center, type Rect } from './geometry.ts';
import { itemRect } from './validate.ts';

/** Silence inserted after each beat, and extra pause at the end of a step. */
export const BEAT_GAP = 0.6;
export const STEP_GAP = 1.2;
const STAGGER = 0.5;
const MIN_DRAW = 0.6;

export interface TimedBeat {
  index: number; // global beat index
  stepIndex: number;
  beatIndex: number;
  start: number;
  /** When the spoken audio for this beat ends. */
  speechEnd: number;
  /** When the next beat starts (speech end + gap). */
  end: number;
}

export interface Timeline {
  beats: TimedBeat[];
  steps: { title: string; start: number; end: number }[];
  duration: number;
}

/** Builds the timeline from the measured duration (seconds) of each beat's audio clip. */
export function buildTimeline(lesson: Lesson, durations: number[]): Timeline {
  const beats: TimedBeat[] = [];
  const steps: Timeline['steps'] = [];
  let t = 0;
  let g = 0;
  lesson.steps.forEach((step, si) => {
    const stepStart = t;
    step.beats.forEach((_, bi) => {
      const d = Math.max(0.4, durations[g] ?? 2);
      const isLastInStep = bi === step.beats.length - 1;
      const gap = isLastInStep ? STEP_GAP : BEAT_GAP;
      beats.push({ index: g, stepIndex: si, beatIndex: bi, start: t, speechEnd: t + d, end: t + d + gap });
      t += d + gap;
      g++;
    });
    steps.push({ title: step.title, start: stepStart, end: t });
  });
  return { beats, steps, duration: t };
}

/** Estimated speaking time for text, used when real audio is unavailable. */
export function estimateSpeech(text: string, wordsPerSecond = 2.6): number {
  const words = text.trim().split(/\s+/).filter(Boolean).length;
  return Math.max(0.8, words / wordsPerSecond + 0.2);
}

export function beatAt(timeline: Timeline, t: number): number {
  const { beats } = timeline;
  if (!beats.length || t < 0) return -1;
  // Binary search for the last beat whose start <= t.
  let lo = 0;
  let hi = beats.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (beats[mid].start <= t) lo = mid;
    else hi = mid - 1;
  }
  return lo;
}

interface ShapeBase {
  key: string;
  id: string;
  /** Current bounding box (follows `move` animations). */
  rect: Rect;
  lines: string[];
  fontSize: number;
  color: Color;
  progress: number;
  highlighted: boolean;
  label: string;
  /** Set once the item has been crossed out; progress animates the X. */
  crossed?: { progress: number; color: Color };
}

export type ShapeItem =
  | (ShapeBase & { kind: 'text' | 'box' | 'circle' })
  | (ShapeBase & {
      kind: 'graph';
      /** Data points normalised to 0..1 within the plot area (y up). */
      points: [number, number][];
      /** Data ranges, for axis tick labels. */
      range: { x0: number; x1: number; y0: number; y1: number };
    });

export interface ConnectorItem {
  kind: 'arrow' | 'line' | 'underline';
  key: string;
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  label?: string;
  color: Color;
  progress: number;
}

export type RenderItem = ShapeItem | ConnectorItem;

export interface BoardFrame {
  items: RenderItem[];
  activeBeat: number;
}

function drawTime(a: Action): number {
  if (a.op === 'text') return Math.min(1.6, MIN_DRAW + (a.text?.length ?? 0) * 0.025);
  if (a.op === 'graph') return 2;
  if (a.op === 'box' || a.op === 'circle' || a.op === 'move') return 0.9;
  return 0.7;
}

/** When each action of a beat starts, spread across the beat's speech. */
export function actionStarts(tb: TimedBeat, count: number): number[] {
  if (count === 0) return [];
  const speech = tb.speechEnd - tb.start;
  const stagger = Math.min(STAGGER, Math.max(0.15, (speech - 0.6) / count));
  return Array.from({ length: count }, (_, k) => tb.start + k * stagger);
}

const ease = (p: number) => (p < 0.5 ? 2 * p * p : 1 - (-2 * p + 2) ** 2 / 2);
const lerp = (a: number, b: number, p: number) => a + (b - a) * p;

function normalisePoints(points: [number, number][]) {
  const xs = points.map((p) => p[0]);
  const ys = points.map((p) => p[1]);
  const x0 = Math.min(...xs);
  const x1 = Math.max(...xs);
  const y0 = Math.min(0, ...ys);
  const y1 = Math.max(...ys);
  const nx = (v: number) => (x1 === x0 ? 0.5 : (v - x0) / (x1 - x0));
  const ny = (v: number) => (y1 === y0 ? 0.5 : (v - y0) / (y1 - y0));
  return { points: points.map(([x, y]) => [nx(x), ny(y)] as [number, number]), range: { x0, x1, y0, y1 } };
}

/**
 * The board as it looks at time t. Items created by beats that have already
 * started are present; drawing and movement progress depend only on t.
 */
export function boardAt(lesson: Lesson, timeline: Timeline, t: number, opts: { instant?: boolean } = {}): BoardFrame {
  const active = beatAt(timeline, t);
  const items = new Map<string, RenderItem>();
  const rects = new Map<string, Rect>();
  // Connectors are resolved at the end so they follow items that moved.
  const conns: { item: ConnectorItem; from?: string; to?: string; under?: string }[] = [];
  let anon = 0;
  let g = 0;

  outer: for (const step of lesson.steps) {
    for (const beat of step.beats) {
      const tb = timeline.beats[g];
      if (!tb || tb.start > t) break outer;
      const starts = actionStarts(tb, beat.actions.length);
      beat.actions.forEach((a, k) => {
        const s = starts[k];
        if (s > t) return;
        const progress = opts.instant ? 1 : Math.min(1, (t - s) / drawTime(a));
        apply(a, progress, g === active && t < tb.end);
      });
      g++;
    }
  }

  for (const c of conns) {
    if (c.under) {
      const r = rects.get(c.under);
      if (!r) continue;
      Object.assign(c.item, { x1: r.x, y1: r.y + r.h + 0.6, x2: r.x + r.w, y2: r.y + r.h + 0.6 });
    } else if (c.from && c.to) {
      const fr = rects.get(c.from);
      const tr = rects.get(c.to);
      if (!fr || !tr) continue;
      const fc = center(fr);
      const tc = center(tr);
      const p1 = edgePoint(fr, tc.x, tc.y);
      const p2 = edgePoint(tr, fc.x, fc.y);
      Object.assign(c.item, { x1: p1.x, y1: p1.y, x2: p2.x, y2: p2.y });
    }
    items.set(c.item.key, c.item);
  }
  return { items: [...items.values()], activeBeat: active };

  function apply(a: Action, progress: number, beatIsActive: boolean) {
    switch (a.op) {
      case 'clear':
        items.clear();
        rects.clear();
        conns.length = 0;
        return;
      case 'erase':
        if (a.target) {
          items.delete(a.target);
          rects.delete(a.target); // connectors to it are dropped when resolved
        }
        return;
      case 'highlight': {
        const it = a.target ? items.get(a.target) : undefined;
        if (it && 'highlighted' in it && beatIsActive) it.highlighted = true;
        return;
      }
      case 'cross': {
        const it = a.target ? items.get(a.target) : undefined;
        if (it && 'highlighted' in it) it.crossed = { progress, color: a.color ?? 'red' };
        return;
      }
      case 'move': {
        const it = a.target ? items.get(a.target) : undefined;
        const from = a.target ? rects.get(a.target) : undefined;
        if (!it || !from || !('rect' in it)) return;
        const p = ease(progress);
        const to = { ...from, x: a.x! - from.w / 2, y: a.y! - from.h / 2 };
        const rect = { ...from, x: lerp(from.x, to.x, p), y: lerp(from.y, to.y, p) };
        rects.set(a.target!, rect);
        it.rect = rect;
        return;
      }
      case 'underline':
        if (!a.target || !rects.has(a.target)) return;
        conns.push({
          item: { kind: 'underline', key: `ul-${a.target}-${anon++}`, x1: 0, y1: 0, x2: 0, y2: 0, color: a.color ?? 'red', progress },
          under: a.target,
        });
        return;
      case 'arrow':
      case 'line': {
        const item: ConnectorItem = {
          kind: a.op,
          key: `${a.op}-${anon++}`,
          x1: a.x ?? 0,
          y1: a.y ?? 0,
          x2: a.x2 ?? 0,
          y2: a.y2 ?? 0,
          label: a.text,
          color: a.color ?? 'ink',
          progress,
        };
        if (a.from || a.to) {
          if (!a.from || !a.to || !rects.has(a.from) || !rects.has(a.to)) return;
          conns.push({ item, from: a.from, to: a.to });
        } else {
          conns.push({ item });
        }
        return;
      }
      case 'text':
      case 'box':
      case 'circle':
      case 'graph': {
        const rect = itemRect(a);
        const size = (a.size ?? (a.op === 'text' ? 'md' : 'sm')) as Size;
        const innerW = a.op === 'text' ? rect.w + 0.01 : a.op === 'box' ? rect.w - 2 : a.op === 'circle' ? rect.w * 0.8 : rect.w;
        const layout = layoutText(a.text ?? '', size, innerW);
        rects.set(a.id!, rect);
        const base: ShapeBase = {
          key: a.id!,
          id: a.id!,
          rect,
          lines: a.text ? layout.lines : [],
          fontSize: layout.fontSize,
          color: a.color ?? 'ink',
          progress,
          highlighted: false,
          label: a.text ?? a.id!,
        };
        if (a.op === 'graph') items.set(a.id!, { ...base, kind: 'graph', ...normalisePoints(a.points ?? []) });
        else items.set(a.id!, { ...base, kind: a.op });
        return;
      }
    }
  }
}
