// Parser for the compact line format the model uses to write one lesson step:
//
//   SAY: Sunlight looks white, but it is a mix of every colour.
//   DRAW: circle id=sun text="Sun" x=14 y=24 r=7 color=orange
//   DRAW: arrow from=sun to=air text="white light"
//
// Compared with nested JSON this needs ~40% fewer output tokens (faster), and a
// malformed line costs one drawing instead of the whole lesson.

import type { Action } from './types.ts';

const PAIR = /([a-zA-Z0-9]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|(\S+))/g;
const NUMERIC = new Set(['x', 'y', 'x2', 'y2', 'w', 'h', 'r']);

export function parseDrawLine(line: string): Action | null {
  const body = line.trim();
  const opMatch = body.match(/^([a-zA-Z]+)/);
  if (!opMatch) return null;
  const action: Record<string, unknown> = { op: opMatch[1].toLowerCase() };
  for (const m of body.slice(opMatch[0].length).matchAll(PAIR)) {
    const key = m[1].toLowerCase();
    const value = m[2] ?? m[3] ?? m[4] ?? '';
    action[key] = NUMERIC.has(key) ? Number(value) : value;
  }
  return action as unknown as Action;
}

export interface RawBeat {
  say: string;
  actions: Action[];
}

/** Parses SAY/DRAW lines into beats. DRAW lines attach to the most recent SAY. */
export function parseStep(text: string): RawBeat[] {
  const beats: RawBeat[] = [];
  const pendingDraws: Action[] = [];
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.replace(/^[\s>*\-\d.)]+(?=[A-Za-z])/, '').trim();
    const m = line.match(/^(SAY|DRAW)\s*:\s*(.*)$/i);
    if (!m) continue;
    const kind = m[1].toUpperCase();
    const rest = m[2].trim();
    if (kind === 'SAY') {
      if (!rest) continue;
      beats.push({ say: rest.replace(/^"|"$/g, ''), actions: pendingDraws.splice(0) });
    } else {
      const a = parseDrawLine(rest);
      if (!a) continue;
      if (beats.length) beats[beats.length - 1].actions.push(a);
      else pendingDraws.push(a); // drawing before the first sentence: attach to it
    }
  }
  return beats;
}

/**
 * Prefixes every id and id reference in a step so steps generated
 * independently cannot collide (each step's "title" becomes "s2-title").
 */
export function namespaceIds(beats: RawBeat[], prefix: string): RawBeat[] {
  const ns = (v: unknown) => (typeof v === 'string' && v ? `${prefix}-${v}` : v);
  return beats.map((b) => ({
    say: b.say,
    actions: b.actions.map((a) => ({
      ...a,
      id: ns(a.id) as string | undefined,
      from: ns(a.from) as string | undefined,
      to: ns(a.to) as string | undefined,
      target: ns(a.target) as string | undefined,
    })),
  }));
}
