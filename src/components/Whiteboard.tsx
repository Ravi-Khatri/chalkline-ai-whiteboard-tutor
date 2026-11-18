// Renders one BoardFrame as hand-drawn SVG. The frame is a pure function of
// playback time, so this component holds no drawing state of its own: seeking
// backwards simply renders an earlier frame.

import { memo } from 'react';
import rough from 'roughjs';
import type { Options } from 'roughjs/bin/core';
import { BOARD_H, BOARD_W, type Color } from '../../shared/types.ts';
import type { BoardFrame, ConnectorItem, RenderItem, ShapeItem } from '../../shared/timeline.ts';

const S = 10; // board units -> SVG pixels
export const INK: Record<Color, string> = {
  ink: '#1c1b29',
  blue: '#1d4ed8',
  red: '#c2410c',
  green: '#15803d',
  orange: '#b45309',
  purple: '#7c3aed',
};

const gen = rough.generator();
type PathInfo = { d: string; stroke: string; strokeWidth: number; fill?: string };
const pathCache = new Map<string, PathInfo[]>();

function seedFor(key: string): number {
  let h = 2166136261;
  for (let i = 0; i < key.length; i++) h = Math.imul(h ^ key.charCodeAt(i), 16777619);
  return (Math.abs(h) % 100000) + 1;
}

/** rough.js paths are random; a stable seed per item keeps them identical across frames. */
function roughPaths(cacheKey: string, make: (o: Options) => ReturnType<typeof gen.line>, color: string, width = 2.4): PathInfo[] {
  const k = `${cacheKey}|${color}|${width}`;
  let paths = pathCache.get(k);
  if (!paths) {
    const drawable = make({ seed: seedFor(cacheKey), stroke: color, strokeWidth: width, roughness: 1.1, bowing: 1.2 });
    paths = gen.toPaths(drawable).map((p) => ({ d: p.d, stroke: p.stroke, strokeWidth: p.strokeWidth, fill: p.fill }));
    if (pathCache.size > 2000) pathCache.clear();
    pathCache.set(k, paths);
  }
  return paths;
}

function Stroke({ paths, progress }: { paths: PathInfo[]; progress: number }) {
  return (
    <>
      {paths.map((p, i) => (
        <path
          key={i}
          d={p.d}
          stroke={p.stroke}
          strokeWidth={p.strokeWidth}
          fill="none"
          pathLength={1}
          strokeDasharray="1 1"
          strokeDashoffset={1 - progress}
          strokeLinecap="round"
        />
      ))}
    </>
  );
}

function revealLines(lines: string[], progress: number): string[] {
  const total = lines.reduce((n, l) => n + l.length, 0);
  let budget = Math.ceil(total * progress);
  return lines.map((l) => {
    const shown = l.slice(0, Math.max(0, budget));
    budget -= l.length;
    return shown;
  });
}

function Label({ lines, cx, cy, fontSize, color, progress }: { lines: string[]; cx: number; cy: number; fontSize: number; color: string; progress: number }) {
  const shown = revealLines(lines, progress);
  const lh = fontSize * 1.25 * S;
  const top = cy * S - ((lines.length - 1) * lh) / 2;
  return (
    <text className="board-text" fontSize={fontSize * S} fill={color} textAnchor="middle" dominantBaseline="central">
      {shown.map((l, i) => (
        <tspan key={i} x={cx * S} y={top + i * lh}>
          {l}
        </tspan>
      ))}
    </text>
  );
}

function Marker({ x, y, w, h }: { x: number; y: number; w: number; h: number }) {
  return <rect className="board-marker" x={(x - 1) * S} y={(y - 0.8) * S} width={(w + 2) * S} height={(h + 1.6) * S} rx={10} />;
}

function arrowHead(x1: number, y1: number, x2: number, y2: number): [number, number, number, number][] {
  const ang = Math.atan2(y2 - y1, x2 - x1);
  const len = 1.8;
  return [ang + 2.6, ang - 2.6].map((a) => [x2, y2, x2 + Math.cos(a) * len, y2 + Math.sin(a) * len] as [number, number, number, number]);
}

type Connector = ConnectorItem;
type Shape = ShapeItem;
const isConnector = (i: RenderItem): i is Connector => i.kind === 'arrow' || i.kind === 'line' || i.kind === 'underline';

const Item = memo(function Item({ item: anyItem, selected, pointed, onSelect }: { item: RenderItem; selected: boolean; pointed: boolean; onSelect?: (id: string) => void }) {
  const color = INK[anyItem.color];

  if (isConnector(anyItem)) {
    const item = anyItem;
    const { x1, y1, x2, y2 } = item;
    const body = roughPaths(`${item.key}:${x1},${y1},${x2},${y2}`, (o) => gen.line(x1 * S, y1 * S, x2 * S, y2 * S, o), color, item.kind === 'underline' ? 3 : 2.2);
    const heads =
      item.kind === 'arrow'
        ? arrowHead(x1, y1, x2, y2).flatMap(([a, b, c, d], i) =>
            roughPaths(`${item.key}:h${i}:${a},${b},${c},${d}`, (o) => gen.line(a * S, b * S, c * S, d * S, { ...o, roughness: 0.6 }), color, 2.2),
          )
        : [];
    const headProgress = Math.max(0, (item.progress - 0.75) / 0.25);
    return (
      <g>
        <Stroke paths={body} progress={Math.min(1, item.progress / 0.8)} />
        {heads.length > 0 && <Stroke paths={heads} progress={headProgress} />}
        {item.label && item.progress > 0.6 && (
          <text
            className="board-text"
            x={((x1 + x2) / 2) * S}
            y={((y1 + y2) / 2 - 1.6) * S}
            fontSize={2.3 * S}
            fill={color}
            textAnchor="middle"
            opacity={Math.min(1, (item.progress - 0.6) / 0.3)}
          >
            {item.label}
          </text>
        )}
      </g>
    );
  }

  const item = anyItem as Shape;
  const r = item.rect;
  const interactive = onSelect
    ? {
        role: 'button',
        tabIndex: 0,
        'aria-label': `Board item: ${item.label}. Select to ask about it.`,
        'aria-pressed': selected,
        onClick: () => onSelect(item.id),
        onKeyDown: (e: React.KeyboardEvent) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            onSelect(item.id);
          }
        },
      }
    : {};
  const emphasised = item.highlighted || pointed;
  // Shapes are drawn in local coordinates and positioned with a transform, so
  // a `move` animation slides the same hand-drawn strokes instead of redrawing them.
  const local = { x: 0, y: 0, w: r.w, h: r.h };

  return (
    <g className={`board-item${selected ? ' is-selected' : ''}`} transform={`translate(${r.x * S} ${r.y * S})`} {...interactive}>
      {emphasised && <Marker {...local} />}
      {selected && <rect className="board-selection" x={-1.4 * S} y={-1.2 * S} width={(r.w + 2.8) * S} height={(r.h + 2.4) * S} rx={12} />}
      {/* Transparent hit area so the whole item is clickable. */}
      <rect x={-1 * S} y={-1 * S} width={(r.w + 2) * S} height={(r.h + 2) * S} fill="transparent" />
      <g opacity={item.crossed ? 1 - 0.5 * item.crossed.progress : 1}>
        {item.kind === 'box' && <Stroke paths={roughPaths(`${item.key}:${r.w},${r.h}`, (o) => gen.rectangle(0, 0, r.w * S, r.h * S, o), color)} progress={item.progress} />}
        {item.kind === 'circle' && (
          <Stroke paths={roughPaths(`${item.key}:${r.w}`, (o) => gen.circle((r.w / 2) * S, (r.h / 2) * S, r.w * S, o), color)} progress={item.progress} />
        )}
        {item.kind === 'graph' && <Graph item={item} color={color} />}
        {item.kind !== 'graph' && item.lines.length > 0 && (
          <Label
            lines={item.lines}
            cx={r.w / 2}
            cy={r.h / 2}
            fontSize={item.fontSize}
            color={color}
            progress={item.kind === 'text' ? item.progress : Math.max(0, (item.progress - 0.4) / 0.6)}
          />
        )}
      </g>
      {item.crossed && (
        <Stroke
          paths={[
            ...roughPaths(`${item.key}:x1:${r.w},${r.h}`, (o) => gen.line(-0.5 * S, -0.5 * S, (r.w + 0.5) * S, (r.h + 0.5) * S, o), INK[item.crossed.color], 3),
            ...roughPaths(`${item.key}:x2:${r.w},${r.h}`, (o) => gen.line((r.w + 0.5) * S, -0.5 * S, -0.5 * S, (r.h + 0.5) * S, o), INK[item.crossed.color], 3),
          ]}
          progress={item.crossed.progress}
        />
      )}
    </g>
  );
});

/** A small hand-drawn line chart: axes, the data line, dots and range labels. */
function Graph({ item, color }: { item: Extract<RenderItem, { kind: 'graph' }>; color: string }) {
  const { w, h } = item.rect;
  const hasTitle = item.lines.length > 0;
  const pad = { l: 5, r: 1.5, t: hasTitle ? 4.5 : 1.5, b: 3.5 };
  const px0 = pad.l;
  const px1 = w - pad.r;
  const py0 = pad.t;
  const py1 = h - pad.b;
  const pt = ([nx, ny]: [number, number]): [number, number] => [(px0 + nx * (px1 - px0)) * S, (py1 - ny * (py1 - py0)) * S];
  const axes = [
    ...roughPaths(`${item.key}:ax:${w},${h}`, (o) => gen.line(px0 * S, py1 * S, px1 * S, py1 * S, { ...o, roughness: 0.6 }), INK.ink, 2),
    ...roughPaths(`${item.key}:ay:${w},${h}`, (o) => gen.line(px0 * S, py1 * S, px0 * S, py0 * S, { ...o, roughness: 0.6 }), INK.ink, 2),
  ];
  // The data points are part of the cache key: two lessons can reuse the same graph id and size.
  const dataKey = item.points.map(([x, y]) => `${x.toFixed(4)},${y.toFixed(4)}`).join(';');
  const curve = roughPaths(`${item.key}:c:${w},${h}:${dataKey}`, (o) => gen.linearPath(item.points.map(pt), { ...o, roughness: 0.8 }), color, 3);
  const pAxes = Math.min(1, item.progress / 0.3);
  const pCurve = Math.max(0, (item.progress - 0.3) / 0.7);
  const fmtN = (v: number) => (Math.abs(v) >= 1000 ? `${+(v / 1000).toFixed(1)}k` : `${+v.toFixed(2)}`);
  const tick = { className: 'board-text', fontSize: 1.9 * S, fill: INK.ink, opacity: pAxes };
  return (
    <>
      <Stroke paths={axes} progress={pAxes} />
      <Stroke paths={curve} progress={pCurve} />
      {item.points.length <= 12 &&
        item.points.map((p, i) => {
          const [cx, cy] = pt(p);
          const shown = pCurve >= (item.points.length === 1 ? 0 : i / (item.points.length - 1)) - 0.001;
          return shown ? <circle key={i} cx={cx} cy={cy} r={0.6 * S} fill={color} /> : null;
        })}
      <text {...tick} x={(px0 - 0.6) * S} y={py0 * S} textAnchor="end" dominantBaseline="hanging">{fmtN(item.range.y1)}</text>
      <text {...tick} x={(px0 - 0.6) * S} y={py1 * S} textAnchor="end">{fmtN(item.range.y0)}</text>
      <text {...tick} x={px0 * S} y={(py1 + 0.6) * S} dominantBaseline="hanging">{fmtN(item.range.x0)}</text>
      <text {...tick} x={px1 * S} y={(py1 + 0.6) * S} textAnchor="end" dominantBaseline="hanging">{fmtN(item.range.x1)}</text>
      {hasTitle && <Label lines={item.lines.slice(0, 1)} cx={w / 2} cy={1.8} fontSize={item.fontSize} color={color} progress={pAxes} />}
    </>
  );
}

export function Whiteboard({
  frame,
  selectedId,
  pointedIds,
  onSelect,
  caption,
}: {
  frame: BoardFrame;
  selectedId?: string;
  pointedIds?: string[];
  onSelect?: (id: string) => void;
  caption?: string;
}) {
  return (
    <svg
      className="board-svg"
      viewBox={`0 0 ${BOARD_W * S} ${BOARD_H * S}`}
      role="img"
      aria-label={caption ? `Whiteboard. Currently: ${caption}` : 'Whiteboard'}
    >
      {frame.items.map((item) => (
        <Item
          key={item.key}
          item={item}
          selected={'id' in item && item.id === selectedId}
          pointed={'id' in item && !!pointedIds?.includes(item.id)}
          onSelect={'id' in item ? onSelect : undefined}
        />
      ))}
    </svg>
  );
}
