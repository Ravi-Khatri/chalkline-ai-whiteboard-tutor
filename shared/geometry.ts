import type { Size } from './types.ts';

export const FONT_SIZE: Record<Size, number> = { sm: 2.4, md: 3.1, lg: 4.3 };
/** Average glyph width as a fraction of font size for the handwriting font. */
const GLYPH = 0.5;
const LINE_HEIGHT = 1.25;

export interface TextLayout {
  lines: string[];
  w: number;
  h: number;
  fontSize: number;
}

/** Greedy word wrap measured in board units. Shared so validation and rendering agree. */
export function layoutText(text: string, size: Size, maxW: number): TextLayout {
  const fontSize = FONT_SIZE[size];
  const maxChars = Math.max(6, Math.floor(maxW / (fontSize * GLYPH)));
  const words = text.trim().split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let line = '';
  for (const word of words) {
    const next = line ? `${line} ${word}` : word;
    if (next.length > maxChars && line) {
      lines.push(line);
      line = word;
    } else {
      line = next;
    }
  }
  if (line) lines.push(line);
  if (lines.length === 0) lines.push('');
  const longest = Math.max(...lines.map((l) => l.length));
  return {
    lines,
    w: Math.min(maxW, longest * fontSize * GLYPH),
    h: lines.length * fontSize * LINE_HEIGHT,
    fontSize,
  };
}

export interface Rect {
  x: number; // left
  y: number; // top
  w: number;
  h: number;
}

export function overlaps(a: Rect, b: Rect, margin = 0.8): boolean {
  return (
    a.x < b.x + b.w + margin &&
    a.x + a.w + margin > b.x &&
    a.y < b.y + b.h + margin &&
    a.y + a.h + margin > b.y
  );
}

export function center(r: Rect): { x: number; y: number } {
  return { x: r.x + r.w / 2, y: r.y + r.h / 2 };
}

/** Point where the ray from the rect centre towards (tx, ty) leaves the rect, plus padding. */
export function edgePoint(r: Rect, tx: number, ty: number, pad = 1): { x: number; y: number } {
  const c = center(r);
  const dx = tx - c.x;
  const dy = ty - c.y;
  if (dx === 0 && dy === 0) return c;
  const hw = r.w / 2 + pad;
  const hh = r.h / 2 + pad;
  const scale = 1 / Math.max(Math.abs(dx) / hw, Math.abs(dy) / hh);
  return { x: c.x + dx * scale, y: c.y + dy * scale };
}

export const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
