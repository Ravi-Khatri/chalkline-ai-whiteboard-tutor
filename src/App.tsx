import { useEffect, useRef, useState } from 'react';
import type { Lesson, Level } from '../shared/types.ts';
import { ApiFailure, generateLesson, loadSample } from './lib/api.ts';
import { prepareNarration, type PreparedNarration } from './lib/narration.ts';
import { Home } from './components/Home.tsx';
import { LessonView } from './components/LessonView.tsx';
import { Loading, type LoadingState } from './components/Loading.tsx';
import { generateLessonOnDevice } from './lib/deviceAI.ts';
import { GitHub, Plus } from './components/Icons.tsx';

export type AiMode = 'cloud' | 'device';

type Phase =
  | { name: 'home'; error?: string; errorCode?: string; topic?: string; level?: Level }
  | ({ name: 'loading' } & LoadingState)
  | { name: 'lesson'; lesson: Lesson; narration: PreparedNarration };

/** The Workers AI free allowance resets at 00:00 UTC; say when that is for this visitor. */
export function quotaMessage(now = new Date()): string {
  const reset = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1));
  const time = reset.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  const hours = Math.max(1, Math.round((reset.getTime() - now.getTime()) / 3_600_000));
  return `Today's free AI allowance for this demo is used up, so new lessons can't be written right now. It resets at ${time} your time (in about ${hours} hour${hours === 1 ? '' : 's'}). Meanwhile, the ready-made lessons below work fully.`;
}

export function App() {
  const [phase, setPhase] = useState<Phase>({ name: 'home' });
  const ctxRef = useRef<AudioContext | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  // The AudioContext must be created from a user gesture (browser autoplay rules).
  const audioContext = () => {
    if (!ctxRef.current) ctxRef.current = new AudioContext();
    void ctxRef.current.resume();
    return ctxRef.current;
  };

  useEffect(() => () => abortRef.current?.abort(), []);

  const run = async (label: string, topic: string, getLesson: (signal: AbortSignal) => Promise<Lesson>, mode: AiMode = 'cloud', level?: Level) => {
    const ctx = audioContext();
    abortRef.current?.abort();
    const ac = new AbortController();
    abortRef.current = ac;
    const startedAt = Date.now();
    setPhase({ name: 'loading', label, stage: mode === 'device' ? 'model' : 'writing', done: 0, total: 0, startedAt, mode });
    try {
      const lesson = await getLesson(ac.signal);
      setPhase({ name: 'loading', label: lesson.title, stage: 'voicing', done: 0, total: 0, startedAt, mode, outline: lesson.steps.map((s) => s.title) });
      const narration = await prepareNarration(lesson, ctx, {
        signal: ac.signal,
        onProgress: (done, total) =>
          setPhase((p) => (p.name === 'loading' ? { ...p, done, total } : p)),
      });
      if (ac.signal.aborted) return;
      setPhase({ name: 'lesson', lesson, narration });
    } catch (err) {
      if ((err as Error).name === 'AbortError') return;
      let message = err instanceof ApiFailure ? err.message : 'Something went wrong while preparing the lesson. Please try again.';
      if (err instanceof ApiFailure && err.code === 'quota') message = quotaMessage();
      if (mode === 'device') {
        console.error('On-device generation failed', err);
        const detail = err instanceof Error ? err.message : typeof err === 'string' ? err : JSON.stringify(err);
        message = `The on-device model could not write this lesson. ${detail || 'Unknown error.'}`;
      }
      const errorCode = err instanceof ApiFailure ? err.code : mode === 'device' ? 'device' : undefined;
      setPhase({ name: 'home', error: message, errorCode, topic, level });
    }
  };

  const startLive = (topic: string, level: Level, mode: AiMode = 'cloud', deviceModel?: string) =>
    mode === 'device' && deviceModel
      ? run(
          topic,
          topic,
          (signal) =>
            generateLessonOnDevice(
              topic,
              level,
              deviceModel,
              (s) =>
                setPhase((p) =>
                  p.name !== 'loading'
                    ? p
                    : s.stage === 'model'
                      ? { ...p, stage: 'model', modelFraction: s.fraction, modelText: s.text }
                      : { ...p, stage: 'writing', step: s.step, stepTotal: s.total },
                ),
              signal,
            ),
          'device',
          level,
        )
      : run(topic, topic, (signal) => generateLesson(topic, level, signal), 'cloud', level);

  const startSample = (id: string) => run('Sample lesson', '', () => loadSample(id));

  const cancel = () => {
    abortRef.current?.abort();
    setPhase({ name: 'home' });
  };

  return (
    <div className="app">
      <a className="skip" href="#main">
        Skip to content
      </a>
      <header className={`topbar${phase.name === 'lesson' ? ' in-lesson' : ''}`}>
        <button className="brand" onClick={cancel} aria-label="Chalkline home">
          <svg width="26" height="26" viewBox="0 0 32 32" aria-hidden="true">
            <rect x="2" y="5" width="28" height="20" rx="5" fill="var(--color-primary)" />
            <path d="M8 18c3-6 6-6 8-2s5 4 8-3" stroke="#fff" strokeWidth="2.4" fill="none" strokeLinecap="round" />
            <path d="M12 29h8M16 25v4" stroke="var(--color-primary)" strokeWidth="2.4" strokeLinecap="round" />
          </svg>
          <span className="brand-name">Chalkline</span>
        </button>
        {/* Filled by LessonView (back button, title, meta) while a lesson is open. */}
        <div id="nav-lesson-slot" className="topbar-center" />
        <div className="topbar-right">
          {phase.name === 'lesson' ? (
            <button className="btn btn-sm btn-primary" onClick={() => setPhase({ name: 'home' })}>
              <Plus width={16} height={16} /> <span className="hide-sm">New lesson</span>
            </button>
          ) : (
            <span className="status-pill" title="Runs on the Cloudflare Workers Free plan, or on an open-source model in your browser">
              <span className="status-dot" aria-hidden="true" /> Free · open source
            </span>
          )}
          <a
            className="icon-btn"
            href="https://github.com/Ravi-Khatri/chalkline-ai-whiteboard-tutor"
            target="_blank"
            rel="noreferrer"
            aria-label="Source code on GitHub"
            title="Source code on GitHub"
          >
            <GitHub width={20} height={20} />
          </a>
        </div>
      </header>
      <div id="main">
        {phase.name === 'home' && (
          <Home onStart={startLive} onSample={startSample} error={phase.error} errorCode={phase.errorCode} initialTopic={phase.topic} initialLevel={phase.level} />
        )}
        {phase.name === 'loading' && <Loading state={phase} onCancel={cancel} />}
        {phase.name === 'lesson' && (
          <LessonView key={phase.lesson.id} lesson={phase.lesson} narration={phase.narration} onExit={() => setPhase({ name: 'home' })} />
        )}
      </div>
    </div>
  );
}
