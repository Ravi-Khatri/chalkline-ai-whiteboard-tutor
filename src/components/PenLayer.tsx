// The learner's own ink on top of the whiteboard. Strokes are stored in board
// units, so they stay aligned at any screen size. They belong to the learner,
// not the lesson timeline, so seeking does not erase them.

import { useRef, useState, type PointerEvent } from 'react';
import { BOARD_H, BOARD_W } from '../../shared/types.ts';
import type { Rect } from '../../shared/geometry.ts';

const S = 10;
export type PenStroke = [number, number][];

function toPath(points: PenStroke): string {
  if (!points.length) return '';
  const [first, ...rest] = points;
  return `M${first[0] * S} ${first[1] * S}` + rest.map(([x, y]) => ` L${x * S} ${y * S}`).join('');
}

/** Bounding box of a stroke, in board units. */
export function strokeBounds(points: PenStroke): Rect {
  const xs = points.map((p) => p[0]);
  const ys = points.map((p) => p[1]);
  const x = Math.min(...xs);
  const y = Math.min(...ys);
  return { x, y, w: Math.max(...xs) - x, h: Math.max(...ys) - y };
}

export function PenLayer({ active, strokes, onStroke }: { active: boolean; strokes: PenStroke[]; onStroke: (s: PenStroke) => void }) {
  const svgRef = useRef<SVGSVGElement>(null);
  const [current, setCurrent] = useState<PenStroke | null>(null);

  const toBoard = (e: PointerEvent): [number, number] | null => {
    const svg = svgRef.current;
    const ctm = svg?.getScreenCTM();
    if (!svg || !ctm) return null;
    const p = new DOMPoint(e.clientX, e.clientY).matrixTransform(ctm.inverse());
    return [+(p.x / S).toFixed(2), +(p.y / S).toFixed(2)];
  };

  const down = (e: PointerEvent<SVGSVGElement>) => {
    if (!active) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    const p = toBoard(e);
    if (p) setCurrent([p]);
  };
  const move = (e: PointerEvent<SVGSVGElement>) => {
    if (!current) return;
    const p = toBoard(e);
    if (!p) return;
    const last = current[current.length - 1];
    if (Math.hypot(p[0] - last[0], p[1] - last[1]) > 0.25) setCurrent([...current, p]);
  };
  const up = () => {
    if (current && current.length > 1) onStroke(current);
    setCurrent(null);
  };

  return (
    <svg
      ref={svgRef}
      className={`pen-layer${active ? ' is-active' : ''}`}
      viewBox={`0 0 ${BOARD_W * S} ${BOARD_H * S}`}
      onPointerDown={down}
      onPointerMove={move}
      onPointerUp={up}
      onPointerCancel={up}
      aria-hidden={!active}
      role={active ? 'img' : undefined}
      aria-label={active ? 'Drawing area: draw with your mouse, finger or stylus' : undefined}
    >
      {[...strokes, ...(current ? [current] : [])].map((s, i) => (
        <path key={i} d={toPath(s)} className="pen-stroke" />
      ))}
    </svg>
  );
}
