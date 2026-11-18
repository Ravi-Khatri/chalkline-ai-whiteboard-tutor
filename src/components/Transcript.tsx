import { useEffect, useRef } from 'react';
import type { Lesson } from '../../shared/types.ts';
import type { Timeline } from '../../shared/timeline.ts';
import { fmt } from './PlayerBar.tsx';

/** Chapters and every spoken line. Clicking a line seeks to it. */
export function Transcript({ lesson, timeline, activeBeat, onSeek }: { lesson: Lesson; timeline: Timeline; activeBeat: number; onSeek: (t: number) => void }) {
  const activeRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    activeRef.current?.scrollIntoView({ block: 'nearest', behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
  }, [activeBeat]);

  let g = 0;
  return (
    <ol className="transcript">
      {lesson.steps.map((step, si) => (
        <li key={step.id} className="transcript-step">
          <button className="transcript-step-title" onClick={() => onSeek(timeline.steps[si].start)}>
            <span className="step-num">{si + 1}</span>
            <span>{step.title}</span>
            <span className="muted tabular">{fmt(timeline.steps[si].start)}</span>
          </button>
          <ol>
            {step.beats.map((beat) => {
              const i = g++;
              const tb = timeline.beats[i];
              const state = i === activeBeat ? 'is-active' : i < activeBeat ? 'is-past' : '';
              return (
                <li key={beat.id}>
                  <button
                    ref={i === activeBeat ? activeRef : undefined}
                    className={`transcript-line ${state}`}
                    onClick={() => onSeek(tb.start)}
                    aria-current={i === activeBeat ? 'true' : undefined}
                  >
                    {beat.say}
                  </button>
                </li>
              );
            })}
          </ol>
        </li>
      ))}
    </ol>
  );
}
