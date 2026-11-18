// Turns untrusted model output into a lesson the player can always render.
//
// Language models are good at teaching order and wording, and unreliable at
// geometry and bookkeeping. This module therefore repairs instead of rejecting
// where it can: it clamps coordinates, fills defaults, de-duplicates ids, drops
// references to items that do not exist yet, and nudges new items away from
// ones already on the board. It only throws when there is nothing teachable.

import { BOARD_H, BOARD_W, COLORS, OPS, SIZES } from './types.ts';
import type { Action, Beat, Color, Lesson, Level, QuizQuestion, Size, Step } from './types.ts';
import { clamp, layoutText, overlaps, type Rect } from './geometry.ts';

export class LessonError extends Error {}

export const LIMITS = {
  steps: 8,
  beatsPerStep: 6,
  totalBeats: 32,
  actionsPerBeat: 6,
  sayChars: 320,
  textChars: 80,
  quiz: 3,
};

const MAX_TEXT_W = 44;

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v);
const str = (v: unknown, max: number) =>
  typeof v === 'string' ? v.replace(/\s+/g, ' ').trim().slice(0, max) : '';
const num = (v: unknown): number | undefined => {
  const n = typeof v === 'string' ? Number(v) : v;
  return typeof n === 'number' && Number.isFinite(n) ? n : undefined;
};
const oneOf = <T extends string>(v: unknown, allowed: readonly T[], fallback: T): T =>
  allowed.includes(v as T) ? (v as T) : fallback;
export const slug = (v: string) =>
  v.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 32);

/** Bounding box an item occupies, computed from its (already defaulted) action. */
export function itemRect(a: Action): Rect {
  const x = a.x ?? 50;
  const y = a.y ?? 31;
  switch (a.op) {
    case 'text': {
      const t = layoutText(a.text ?? '', a.size ?? 'md', MAX_TEXT_W);
      return { x: x - t.w / 2, y: y - t.h / 2, w: t.w, h: t.h };
    }
    case 'graph':
    case 'box': {
      const w = a.w ?? 22;
      const h = a.h ?? 8;
      return { x: x - w / 2, y: y - h / 2, w, h };
    }
    case 'circle': {
      const r = a.r ?? 6;
      return { x: x - r, y: y - r, w: r * 2, h: r * 2 };
    }
    default:
      return { x, y, w: 0, h: 0 };
  }
}

function fitInside(rect: Rect): Rect {
  return {
    ...rect,
    x: clamp(rect.x, 1, BOARD_W - 1 - rect.w),
    y: clamp(rect.y, 1, BOARD_H - 1 - rect.h),
  };
}

/** Moves a new item so it does not sit on top of existing ones. Tries down, up, right, left. */
function findFreeSpot(rect: Rect, occupied: Rect[]): Rect {
  const start = fitInside(rect);
  if (!occupied.some((o) => overlaps(start, o))) return start;
  const dirs = [
    [0, 1],
    [0, -1],
    [1, 0],
    [-1, 0],
  ];
  for (let dist = 1; dist <= 10; dist++) {
    for (const [dx, dy] of dirs) {
      const cand = fitInside({ ...start, x: start.x + dx * dist * 3, y: start.y + dy * dist * 2.5 });
      if (!occupied.some((o) => overlaps(cand, o))) return cand;
    }
  }
  return start; // board is crowded; accept overlap rather than drop content
}

interface BoardState {
  rects: Map<string, Rect>;
}

function normalizeAction(raw: unknown, board: BoardState, usedIds: Set<string>, beatId: string, n: number): Action | null {
  if (!isObj(raw)) return null;
  const op = oneOf(raw.op, OPS, 'text');
  if (!OPS.includes(raw.op as never)) return null;
  const color: Color = oneOf(raw.color, COLORS, 'ink');

  if (op === 'clear') {
    board.rects.clear();
    return { op };
  }

  if (op === 'highlight' || op === 'erase' || op === 'underline' || op === 'cross') {
    const target = slug(str(raw.target ?? raw.id, 40));
    if (!board.rects.has(target)) return null;
    if (op === 'erase') board.rects.delete(target);
    const c = op === 'cross' ? oneOf(raw.color, COLORS, 'red') : color;
    return { op, target, color: op === 'underline' || op === 'cross' ? c : undefined };
  }

  if (op === 'move') {
    const target = slug(str(raw.target ?? raw.id, 40));
    const rect = board.rects.get(target);
    const x = num(raw.x);
    const y = num(raw.y);
    if (!rect || x === undefined || y === undefined) return null;
    const moved = fitInside({ ...rect, x: x - rect.w / 2, y: y - rect.h / 2 });
    board.rects.set(target, moved);
    return { op, target, x: +(moved.x + moved.w / 2).toFixed(2), y: +(moved.y + moved.h / 2).toFixed(2) };
  }

  if (op === 'arrow' || op === 'line') {
    const from = slug(str(raw.from, 40));
    const to = slug(str(raw.to, 40));
    if (board.rects.has(from) && board.rects.has(to) && from !== to) {
      return { op, from, to, color, text: str(raw.text, 40) || undefined };
    }
    const x = num(raw.x);
    const y = num(raw.y);
    const x2 = num(raw.x2);
    const y2 = num(raw.y2);
    if (x === undefined || y === undefined || x2 === undefined || y2 === undefined) return null;
    return {
      op,
      x: clamp(x, 0, BOARD_W),
      y: clamp(y, 0, BOARD_H),
      x2: clamp(x2, 0, BOARD_W),
      y2: clamp(y2, 0, BOARD_H),
      color,
      text: str(raw.text, 40) || undefined,
    };
  }

  // Item-creating ops: text, box, circle, graph.
  const text = str(raw.text, LIMITS.textChars);
  if (op === 'text' && !text) return null;
  const points = op === 'graph' ? parsePoints(raw.points) : [];
  if (op === 'graph' && points.length < 2) return null;
  let id = slug(str(raw.id, 40)) || `${beatId}-${n}`;
  while (usedIds.has(id)) id = `${id}-x`;
  usedIds.add(id);

  const size: Size = oneOf(raw.size, SIZES, op === 'text' ? 'md' : 'sm');
  const action: Action = {
    op,
    id,
    text: text || undefined,
    color,
    size,
    x: clamp(num(raw.x) ?? 50, 0, BOARD_W),
    y: clamp(num(raw.y) ?? 31, 0, BOARD_H),
  };

  if (op === 'box') {
    const label = layoutText(text, size, 60);
    action.w = clamp(num(raw.w) ?? Math.max(14, label.w + 4), 6, 60);
    const inner = layoutText(text, size, action.w - 2);
    action.h = clamp(Math.max(num(raw.h) ?? 0, inner.h + 2.5), 4, 30);
  }
  if (op === 'circle') {
    const inner = layoutText(text, size, 12);
    const needed = Math.max(inner.w, inner.h) / 2 + 1.5;
    action.r = clamp(Math.max(num(raw.r) ?? 6, needed), 2, 20);
  }
  if (op === 'graph') {
    action.w = clamp(num(raw.w) ?? 40, 18, 70);
    action.h = clamp(num(raw.h) ?? 24, 12, 44);
    action.points = points;
  }

  const placed = findFreeSpot(itemRect(action), [...board.rects.values()]);
  const rect0 = itemRect(action);
  action.x = +(action.x! + (placed.x - rect0.x)).toFixed(2);
  action.y = +(action.y! + (placed.y - rect0.y)).toFixed(2);
  board.rects.set(id, placed);
  return action;
}

/** Accepts [[x,y],…], [{x,y},…] or a string like "0:1 1:2 2:4" / "0,1;1,2". Max 30 points, sorted by x. */
export function parsePoints(raw: unknown): [number, number][] {
  const pts: [number, number][] = [];
  if (typeof raw === 'string') {
    for (const m of raw.matchAll(/(-?\d+(?:\.\d+)?)\s*[:,]\s*(-?\d+(?:\.\d+)?)/g)) pts.push([Number(m[1]), Number(m[2])]);
  } else if (Array.isArray(raw)) {
    for (const p of raw) {
      const x = num(Array.isArray(p) ? p[0] : isObj(p) ? p.x : undefined);
      const y = num(Array.isArray(p) ? p[1] : isObj(p) ? p.y : undefined);
      if (x !== undefined && y !== undefined) pts.push([x, y]);
    }
  }
  return pts.slice(0, 30).sort((a, b) => a[0] - b[0]);
}

function normalizeQuiz(raw: unknown): QuizQuestion[] {
  if (!Array.isArray(raw)) return [];
  const out: QuizQuestion[] = [];
  for (const q of raw) {
    if (!isObj(q)) continue;
    const options = Array.isArray(q.options) ? q.options.map((o) => str(o, 120)).filter(Boolean).slice(0, 4) : [];
    const answer = num(q.answer);
    const question = str(q.q ?? q.question, 200);
    if (!question || options.length < 2 || answer === undefined) continue;
    const idx = Math.round(answer);
    if (idx < 0 || idx >= options.length) continue;
    out.push({ q: question, options, answer: idx, why: str(q.why, 300) });
    if (out.length >= LIMITS.quiz) break;
  }
  return out;
}

/** Validates and repairs a lesson object produced by a model (or loaded from a file). */
export function normalizeLesson(raw: unknown, opts: { topic: string; level: Level; source: Lesson['source']; model?: string }): Lesson {
  if (!isObj(raw)) throw new LessonError('Lesson is not an object');
  const rawSteps = Array.isArray(raw.steps) ? raw.steps : [];
  const board: BoardState = { rects: new Map() };
  const usedIds = new Set<string>();
  const steps: Step[] = [];
  let totalBeats = 0;

  for (const [si, rs] of rawSteps.slice(0, LIMITS.steps).entries()) {
    if (!isObj(rs)) continue;
    const stepId = `s${si + 1}`;
    const beats: Beat[] = [];
    const rawBeats = Array.isArray(rs.beats) ? rs.beats : [];
    for (const rb of rawBeats.slice(0, LIMITS.beatsPerStep)) {
      if (totalBeats >= LIMITS.totalBeats || !isObj(rb)) continue;
      const say = str(rb.say, LIMITS.sayChars);
      if (!say) continue;
      const beatId = `${stepId}b${beats.length + 1}`;
      const rawActions = Array.isArray(rb.actions) ? rb.actions : [];
      const actions: Action[] = [];
      for (const ra of rawActions.slice(0, LIMITS.actionsPerBeat)) {
        const a = normalizeAction(ra, board, usedIds, beatId, actions.length + 1);
        if (a) actions.push(a);
      }
      beats.push({ id: beatId, say, actions });
      totalBeats++;
    }
    if (beats.length) steps.push({ id: stepId, title: str(rs.title, 60) || `Part ${si + 1}`, beats });
  }

  if (steps.length < 2 || totalBeats < 4) throw new LessonError('Lesson is too short to teach from');

  return {
    id: `${opts.source}-${slug(opts.topic) || 'lesson'}-${Date.now().toString(36)}`,
    topic: opts.topic,
    title: str(raw.title, 80) || opts.topic,
    level: opts.level,
    summary: str(raw.summary, 280),
    steps,
    quiz: normalizeQuiz(raw.quiz),
    source: opts.source,
    model: opts.model,
  };
}
