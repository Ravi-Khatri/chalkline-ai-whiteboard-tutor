// Small inline SVG icon set (Lucide-style strokes). Decorative by default;
// buttons carry their own accessible labels.
import type { SVGProps } from 'react';

type P = SVGProps<SVGSVGElement>;
const base = (props: P) => ({
  width: 20,
  height: 20,
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 2,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
  'aria-hidden': true,
  ...props,
});

export const Play = (p: P) => (
  <svg {...base(p)}><path d="M7 4.5v15l12-7.5z" fill="currentColor" /></svg>
);
export const Pause = (p: P) => (
  <svg {...base(p)}><rect x="6" y="4.5" width="4" height="15" rx="1" fill="currentColor" /><rect x="14" y="4.5" width="4" height="15" rx="1" fill="currentColor" /></svg>
);
export const Restart = (p: P) => (
  <svg {...base(p)}><path d="M3 12a9 9 0 1 0 3-6.7" /><path d="M3 4v5h5" /></svg>
);
export const Back5 = (p: P) => (
  <svg {...base(p)}><path d="M11 17l-5-5 5-5" /><path d="M18 17l-5-5 5-5" /></svg>
);
export const Fwd5 = (p: P) => (
  <svg {...base(p)}><path d="M13 17l5-5-5-5" /><path d="M6 17l5-5-5-5" /></svg>
);
export const Send = (p: P) => (
  <svg {...base(p)}><path d="M22 2 11 13" /><path d="M22 2 15 22l-4-9-9-4z" /></svg>
);
export const Sparkle = (p: P) => (
  <svg {...base(p)}><path d="M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8z" /><path d="M19 17l.7 2 2 .7-2 .7-.7 2-.7-2-2-.7 2-.7z" /></svg>
);
export const Chat = (p: P) => (
  <svg {...base(p)}><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" /></svg>
);
export const List = (p: P) => (
  <svg {...base(p)}><path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01" /></svg>
);
export const Check = (p: P) => (
  <svg {...base(p)}><path d="M20 6 9 17l-5-5" /></svg>
);
export const X = (p: P) => (
  <svg {...base(p)}><path d="M18 6 6 18M6 6l12 12" /></svg>
);
export const ArrowLeft = (p: P) => (
  <svg {...base(p)}><path d="M19 12H5M12 19l-7-7 7-7" /></svg>
);
export const Quiz = (p: P) => (
  <svg {...base(p)}><circle cx="12" cy="12" r="10" /><path d="M9.1 9a3 3 0 0 1 5.8 1c0 2-3 3-3 3M12 17h.01" /></svg>
);
export const Board = (p: P) => (
  <svg {...base(p)}><rect x="2" y="3" width="20" height="14" rx="2" /><path d="M8 21h8M12 17v4M6 8l3 3 4-4 5 5" /></svg>
);
export const Pen = (p: P) => (
  <svg {...base(p)}><path d="M12 20h9" /><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z" /></svg>
);
export const Undo = (p: P) => (
  <svg {...base(p)}><path d="M3 7v6h6" /><path d="M21 17a9 9 0 0 0-15-6.7L3 13" /></svg>
);
export const Trash = (p: P) => (
  <svg {...base(p)}><path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6" /></svg>
);
export const Full = (p: P) => (
  <svg {...base(p)}><path d="M8 3H5a2 2 0 0 0-2 2v3M21 8V5a2 2 0 0 0-2-2h-3M3 16v3a2 2 0 0 0 2 2h3M16 21h3a2 2 0 0 0 2-2v-3" /></svg>
);
export const ExitFull = (p: P) => (
  <svg {...base(p)}><path d="M8 3v3a2 2 0 0 1-2 2H3M21 8h-3a2 2 0 0 1-2-2V3M3 16h3a2 2 0 0 1 2 2v3M16 21v-3a2 2 0 0 1 2-2h3" /></svg>
);
export const Chip = (p: P) => (
  <svg {...base(p)}><rect x="5" y="5" width="14" height="14" rx="2" /><path d="M9 9h6v6H9zM9 1v4M15 1v4M9 19v4M15 19v4M1 9h4M1 15h4M19 9h4M19 15h4" /></svg>
);
export const Info = (p: P) => (
  <svg {...base(p)}><circle cx="12" cy="12" r="10" /><path d="M12 16v-4M12 8h.01" /></svg>
);
