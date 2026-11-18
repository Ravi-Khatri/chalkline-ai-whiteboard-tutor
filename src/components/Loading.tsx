import { useEffect, useState } from 'react';
import { Check } from './Icons.tsx';

export interface LoadingState {
  label: string;
  stage: 'model' | 'writing' | 'voicing';
  done: number;
  total: number;
  startedAt: number;
  outline?: string[];
  /** 'device' = the lesson is written by an open model in this browser. */
  mode?: 'cloud' | 'device';
  modelFraction?: number;
  modelText?: string;
  step?: number;
  stepTotal?: number;
}

const WRITING_HINTS = [
  'Planning five steps and a running example…',
  'Writing each step and deciding what to draw…',
  'Checking every drawing fits on the board…',
];

const ORDER = ['model', 'writing', 'voicing'] as const;

export function Loading({ state, onCancel }: { state: LoadingState; onCancel: () => void }) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 500);
    return () => window.clearInterval(id);
  }, []);
  const elapsed = Math.round((now - state.startedAt) / 1000);
  const device = state.mode === 'device';
  const hint = WRITING_HINTS[Math.min(WRITING_HINTS.length - 1, Math.floor(elapsed / 15))];
  const voicePct = state.total ? Math.round((state.done / state.total) * 100) : 0;
  const modelPct = Math.round((state.modelFraction ?? 0) * 100);
  const stepPct = state.stepTotal ? Math.round(((state.step ?? 0) / state.stepTotal) * 100) : 0;
  const status = (s: (typeof ORDER)[number]) => {
    const cur = ORDER.indexOf(state.stage);
    const i = ORDER.indexOf(s);
    return i < cur ? 'is-done' : i === cur ? 'is-active' : '';
  };

  return (
    <main className="loading" aria-busy="true">
      <div className="loading-card">
        <p className="eyebrow">
          Preparing your lesson{device ? ' on your device' : ''} · {elapsed}s
        </p>
        <h1>{state.label}</h1>

        <ol className="loading-steps">
          {device && (
            <li className={status('model')}>
              <span className="dot">{status('model') === 'is-done' && <Check width={14} height={14} />}</span>
              <div>
                <strong>Loading the open-source AI model on your device</strong>
                {state.stage === 'model' && (
                  <>
                    <div className="progress" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={modelPct} aria-label="Model loaded">
                      <div style={{ width: `${modelPct}%` }} />
                    </div>
                    <p className="muted small">
                      {modelPct}% · The first time, the model is downloaded once and then kept by your browser. {state.modelText ? `(${state.modelText.slice(0, 90)})` : ''}
                    </p>
                  </>
                )}
              </div>
            </li>
          )}
          <li className={status('writing')}>
            <span className="dot">{status('writing') === 'is-done' && <Check width={14} height={14} />}</span>
            <div>
              <strong>Writing the lesson</strong>
              {state.stage === 'writing' &&
                (device ? (
                  <>
                    <div className="progress" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={stepPct} aria-label="Lesson steps written">
                      <div style={{ width: `${stepPct}%` }} />
                    </div>
                    <p className="muted small">
                      {state.step ? `Step ${state.step} of ${state.stepTotal}` : 'Planning the lesson'} · on your device, this usually takes 1 to 3 minutes.
                    </p>
                  </>
                ) : (
                  <p className="muted small">{hint} Usually 30 to 70 seconds on the free tier.</p>
                ))}
            </div>
          </li>
          <li className={status('voicing')}>
            <span className="dot" />
            <div>
              <strong>Recording narration</strong>
              {state.stage === 'voicing' && (
                <>
                  <div className="progress" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={voicePct} aria-label="Narration clips recorded">
                    <div style={{ width: `${voicePct}%` }} />
                  </div>
                  <p className="muted small">
                    {state.done} of {state.total || '…'} sentences
                  </p>
                </>
              )}
            </div>
          </li>
        </ol>

        {state.outline && (
          <div className="loading-outline">
            <p className="muted small">Lesson plan</p>
            <ol>
              {state.outline.map((s) => (
                <li key={s}>{s}</li>
              ))}
            </ol>
          </div>
        )}

        <button className="btn btn-ghost" onClick={onCancel}>
          Cancel
        </button>
        <p className="sr-only" aria-live="polite">
          {state.stage === 'model' ? `Loading model, ${modelPct} percent` : state.stage === 'writing' ? 'Writing the lesson' : `Recording narration, ${state.done} of ${state.total}`}
        </p>
      </div>
    </main>
  );
}
