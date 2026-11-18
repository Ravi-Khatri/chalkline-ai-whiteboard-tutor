import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { Lesson, QuizQuestion } from '../../shared/types.ts';
import { boardAt } from '../../shared/timeline.ts';
import { askTutor, ApiFailure } from '../lib/api.ts';
import { askOnDevice, deviceEngineReady } from '../lib/deviceAI.ts';
import type { AskRequest, AskResponse } from '../../shared/types.ts';
import { speakAnswer, type PreparedNarration } from '../lib/narration.ts';
import { AudioClock } from '../lib/clock.ts';
import { Whiteboard } from './Whiteboard.tsx';
import { PlayerBar, fmt } from './PlayerBar.tsx';
import { Transcript } from './Transcript.tsx';
import { AskPanel, type ChatMessage } from './AskPanel.tsx';
import { QuizPanel } from './QuizPanel.tsx';
import { ArrowLeft, Chat, Info, List, Pen, Play, Quiz, Restart, Trash, Undo } from './Icons.tsx';
import { PenLayer, strokeBounds, type PenStroke } from './PenLayer.tsx';
import { overlaps } from '../../shared/geometry.ts';

type Tab = 'transcript' | 'ask' | 'quiz';

const prefersReducedMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;

export const DEFAULT_RATE = 0.9;

export function LessonView({ lesson, narration, onExit }: { lesson: Lesson; narration: PreparedNarration; onExit: () => void }) {
  const { clock, timeline } = narration;
  const [rate, setRate] = useState(DEFAULT_RATE);
  useEffect(() => {
    if (clock instanceof AudioClock) clock.setRate(rate);
  }, [clock, rate]);
  const [t, setT] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [started, setStarted] = useState(false);
  const [ended, setEnded] = useState(false);
  const [tab, setTab] = useState<Tab>('transcript');
  const [selectedId, setSelectedId] = useState<string>();
  const [pointedIds, setPointedIds] = useState<string[]>([]);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [busy, setBusy] = useState(false);
  const [draft, setDraft] = useState('');
  const [pausedForQuestion, setPausedForQuestion] = useState(false);
  const [penOn, setPenOn] = useState(false);
  const [navSlot, setNavSlot] = useState<HTMLElement | null>(null);
  useEffect(() => setNavSlot(document.getElementById('nav-lesson-slot')), []);
  // Captions on/off (like YouTube's CC button), remembered per browser.
  const [captionsOn, setCaptionsOn] = useState(() => {
    try {
      return localStorage.getItem('chalkline:captions') !== 'off';
    } catch {
      return true;
    }
  });
  const toggleCaptions = useCallback(() => {
    setCaptionsOn((on) => {
      try {
        localStorage.setItem('chalkline:captions', on ? 'off' : 'on');
      } catch {
        /* storage unavailable */
      }
      return !on;
    });
  }, []);
  // Video-style controls: hidden while playing and the pointer is idle.
  const [idle, setIdle] = useState(false);
  const idleTimer = useRef<number | undefined>(undefined);
  const wake = useCallback(() => {
    setIdle(false);
    window.clearTimeout(idleTimer.current);
    idleTimer.current = window.setTimeout(() => setIdle(true), 2500);
  }, []);
  useEffect(() => () => window.clearTimeout(idleTimer.current), []);
  const stageRef = useRef<HTMLDivElement>(null);
  const [isFullscreen, setIsFullscreen] = useState(false);
  useEffect(() => {
    const onChange = () => setIsFullscreen(document.fullscreenElement === stageRef.current);
    document.addEventListener('fullscreenchange', onChange);
    return () => document.removeEventListener('fullscreenchange', onChange);
  }, []);
  const toggleFullscreen = useCallback(() => {
    if (document.fullscreenElement) void document.exitFullscreen();
    else void stageRef.current?.requestFullscreen?.().catch(() => {});
  }, []);
  const [strokes, setStrokes] = useState<PenStroke[]>([]);
  const [circledIds, setCircledIds] = useState<string[]>([]);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const stopAnswer = useRef<() => void>(() => {});
  const askAbort = useRef<AbortController | null>(null);
  const reduced = useMemo(prefersReducedMotion, []);

  // Animation loop: while playing, re-read the clock every frame.
  useEffect(() => {
    if (!playing) return;
    let raf = 0;
    const loop = () => {
      setT(clock.time());
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [playing, clock]);

  useEffect(() => {
    clock.onEnded = () => {
      setPlaying(false);
      setT(clock.duration);
      setEnded(true);
      setTab('quiz');
    };
    return () => {
      clock.onEnded = undefined;
      clock.dispose();
      stopAnswer.current();
      askAbort.current?.abort();
    };
  }, [clock]);

  const frame = useMemo(() => boardAt(lesson, timeline, t, { instant: reduced }), [lesson, timeline, t, reduced]);

  const play = useCallback(() => {
    stopAnswer.current();
    setPointedIds([]);
    setPausedForQuestion(false);
    if (clock instanceof AudioClock) clock.setVolume(1);
    clock.play();
    setStarted(true);
    setEnded(false);
    setPlaying(true);
  }, [clock]);

  const pause = useCallback(() => {
    clock.pause();
    setPlaying(false);
    setT(clock.time());
  }, [clock]);

  const toggle = useCallback(() => (clock.playing ? pause() : play()), [clock, pause, play]);

  const seek = useCallback(
    (to: number) => {
      clock.seek(Math.max(0, Math.min(to, timeline.duration)));
      setT(clock.time());
      setEnded(false);
      setPlaying(clock.playing);
    },
    [clock, timeline.duration],
  );

  const restart = useCallback(() => {
    seek(0);
    play();
  }, [seek, play]);

  // Keyboard shortcuts (ignored while typing).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement;
      if (el.closest('input, textarea, select, [contenteditable="true"]')) return;
      // Like YouTube: inside the player, Space always means play/pause, even on a focused control.
      const inPlayer = !!el.closest('.video-chrome');
      if (el.closest('button, [role="button"]') && (e.key === 'Enter' || (e.key === ' ' && !inPlayer))) return;
      if (e.key === ' ' || e.key === 'k') {
        e.preventDefault();
        toggle();
      } else if (e.key === 'ArrowLeft') {
        e.preventDefault();
        seek(clock.time() - 5);
      } else if (e.key === 'ArrowRight') {
        e.preventDefault();
        seek(clock.time() + 5);
      } else if (e.key === 'r') {
        restart();
      } else if (e.key === 'f') {
        toggleFullscreen();
      } else if (e.key === 'c') {
        toggleCaptions();
      } else if (e.key === '/' || e.key === '?') {
        e.preventDefault();
        setTab('ask');
        requestAnimationFrame(() => inputRef.current?.focus());
      }
    };
    const onKeyWake = (e: KeyboardEvent) => {
      onKey(e);
      wake();
    };
    window.addEventListener('keydown', onKeyWake);
    return () => window.removeEventListener('keydown', onKeyWake);
  }, [toggle, seek, restart, clock, toggleFullscreen, toggleCaptions, wake]);

  const boardItems = frame.items.filter((i): i is Extract<typeof i, { id: string }> => 'id' in i);
  const selectedLabel = boardItems.find((i) => i.id === selectedId)?.label;
  const activeTb = timeline.beats[frame.activeBeat];
  const activeStep = activeTb ? lesson.steps[activeTb.stepIndex] : lesson.steps[0];
  const caption = started && activeTb ? activeStep.beats[activeTb.beatIndex].say : '';

  /** Device lessons are answered on the device; cloud lessons fall back to the device model if the cloud allowance is used up. */
  const askAnywhere = async (req: AskRequest, signal: AbortSignal): Promise<AskResponse> => {
    if (lesson.generatedOn === 'device') return askOnDevice(req);
    try {
      return await askTutor(req, signal);
    } catch (err) {
      if (err instanceof ApiFailure && err.code === 'quota' && deviceEngineReady()) return askOnDevice(req);
      throw err;
    }
  };

  const ask = async (question: string) => {
    if (clock.playing) {
      pause();
      setPausedForQuestion(true);
    }
    setTab('ask');
    const history = messages.filter((m) => m.role !== 'error').map((m) => ({ role: m.role as 'user' | 'tutor', text: m.text }));
    setMessages((m) => [...m, { role: 'user', text: question }]);
    setBusy(true);
    stopAnswer.current();
    askAbort.current?.abort();
    const ac = new AbortController();
    askAbort.current = ac;

    const heard = activeTb ? activeStep.beats.slice(0, activeTb.beatIndex + 1).map((b) => b.say).join(' ') : '';
    try {
      const res = await askAnywhere(
        {
          topic: lesson.topic,
          lessonTitle: lesson.title,
          stepTitle: activeStep.title,
          context: heard,
          board: boardItems.map((i) => ({ id: i.id, label: i.label })),
          selectedId,
          circled: circledIds,
          question,
          history,
        },
        ac.signal,
      );
      setMessages((m) => [...m, { role: 'tutor', text: res.answer }]);
      setPointedIds(res.highlight.length ? res.highlight : selectedId ? [selectedId] : []);
      setBusy(false);
      stopAnswer.current = await speakAnswer(res.answer, rate, ac.signal, res.voiceTier);
    } catch (err) {
      if ((err as Error).name === 'AbortError') return;
      const text = err instanceof ApiFailure ? err.message : (err as Error)?.message || 'Something went wrong while asking. Please try again.';
      setMessages((m) => [...m, { role: 'error', text }]);
      setBusy(false);
    }
  };

  const onSelect = (id: string) => {
    setSelectedId((cur) => (cur === id ? undefined : id));
    if (clock.playing) {
      pause();
      setPausedForQuestion(true);
    }
    setTab('ask');
    requestAnimationFrame(() => inputRef.current?.focus());
  };

  const togglePen = () => {
    if (!penOn && clock.playing) {
      pause();
      setPausedForQuestion(true);
    }
    setPenOn((v) => !v);
  };

  /** Finds the board items under the learner's last stroke and opens the question box about them. */
  const askAboutDrawing = () => {
    const last = strokes[strokes.length - 1];
    if (!last) return;
    const b = strokeBounds(last);
    const hit = boardItems.filter((i) => overlaps(i.rect, b, 0.5));
    setCircledIds(hit.map((i) => i.id));
    setPointedIds(hit.map((i) => i.id));
    setPenOn(false);
    setTab('ask');
    setDraft(hit.length ? 'Can you explain the part I marked?' : 'Can you explain what I marked on the board?');
    requestAnimationFrame(() => inputRef.current?.focus());
  };

  const circledLabels = boardItems.filter((i) => circledIds.includes(i.id)).map((i) => i.label);

  const explainMistake = (q: QuizQuestion, chosen: number) => {
    void ask(`In the quiz question "${q.q}" I chose "${q.options[chosen]}" but the answer is "${q.options[q.answer]}". Can you explain my mistake?`);
  };

  const onDevice = lesson.generatedOn === 'device';
  const sourceLabel = lesson.source === 'sample' ? 'Sample lesson' : onDevice ? 'On-device AI lesson' : lesson.cached ? 'Live AI lesson · cached' : 'Live AI lesson';
  const sourceHelp =
    lesson.source === 'sample'
      ? 'Pre-generated with the same pipeline and shipped with the app, so it plays instantly without using AI quota.'
      : onDevice
        ? `Written in your browser by the open-source model ${lesson.model?.replace(/-q4.*/, '')} (WebLLM). No AI service was used.`
      : lesson.cached
        ? `Generated by ${lesson.model?.split('/').pop() ?? 'Workers AI'} earlier for this same topic and level, and reused to save the free AI allowance.`
        : `Written just now by ${lesson.model?.split('/').pop() ?? 'Workers AI'}.`;
  const economy = lesson.voiceTier === 'economy';
  const voiceLabel = clock.kind !== 'audio' ? 'Browser voice' : 'AI voice';
  const voiceHelp =
    clock.kind !== 'audio'
      ? 'Your browser’s built-in speech voice.'
      : economy
        ? 'Narration generated by Workers AI (MeloTTS), a lightweight voice that lets the free demo create many more lessons per day.'
        : 'Narration generated by Workers AI (Deepgram Aura-2, voice “Athena”).';

  return (
    <div className="lesson">
      {/* The lesson's title and meta live in the app bar (see App.tsx), rendered there through a portal. */}
      {navSlot &&
        createPortal(
          <div className="bar-lesson">
            <button className="icon-btn bar-back" onClick={onExit} aria-label="Back to topics" title="Back to topics">
              <ArrowLeft width={20} height={20} />
            </button>
            <div className="bar-lesson-text">
              <h1 className="bar-title" title={lesson.title}>
                {lesson.title}
              </h1>
              <p className="bar-meta">
                <span className={`meta-source meta-${onDevice ? 'device' : lesson.source}`} title={sourceHelp}>
                  {sourceLabel}
                </span>
                <span className="meta-sep" aria-hidden="true">·</span>
                <span title={voiceHelp}>{voiceLabel}</span>
                <span className="meta-sep" aria-hidden="true">·</span>
                <span className="meta-level">{lesson.level}</span>
              </p>
            </div>
          </div>,
          navSlot,
        )}

      {narration.fallbackReason && (
        <div className="notice" role="status">
          <Info width={18} height={18} /> {narration.fallbackReason} Seeking jumps to the start of a sentence in this mode.
        </div>
      )}

      <div className="lesson-grid">
        <section className="stage" aria-label="Whiteboard and playback">
          <div
            ref={stageRef}
            className={`board-wrap${penOn ? ' is-drawing' : ''}${playing && idle ? ' is-idle' : ''}${isFullscreen ? ' is-fullscreen' : ''}`}
            onPointerMove={wake}
            onPointerDown={wake}
            onMouseLeave={() => playing && setIdle(true)}
            onClick={(e) => {
              // Like a video: clicking empty board space plays/pauses. Items and controls handle their own clicks.
              const el = e.target as Element;
              if (!penOn && started && !ended && (el.classList.contains('board-svg') || el.classList.contains('board-click'))) toggle();
            }}
          >
            <Whiteboard frame={frame} selectedId={selectedId} pointedIds={pointedIds} onSelect={penOn ? undefined : onSelect} caption={caption} />
            <PenLayer active={penOn} strokes={strokes} onStroke={(s) => setStrokes((all) => [...all, s])} />

            {started && !ended && !penOn && (
              <div className="video-chrome" onFocusCapture={wake}>
                {caption && captionsOn && <div className="video-caption">{caption}</div>}
                <PlayerBar
                  t={t}
                  timeline={timeline}
                  playing={playing}
                  onToggle={toggle}
                  onSeek={seek}
                  onRestart={restart}
                  rate={clock.kind === 'audio' ? rate : undefined}
                  onRate={setRate}
                  fullscreen={isFullscreen}
                  onFullscreen={toggleFullscreen}
                  captionsOn={captionsOn}
                  onCaptions={toggleCaptions}
                />
              </div>
            )}

            {!started && (
              <div className="board-overlay">
                <button className="start-btn" onClick={play}>
                  <Play width={28} height={28} /> Start lesson
                </button>
                <p className="muted small">
                  {fmt(timeline.duration)} · {lesson.steps.length} parts · sound on
                </p>
              </div>
            )}
            {ended && (
              <div className="board-overlay">
                <p className="overlay-title">Lesson complete</p>
                <div className="overlay-actions">
                  <button className="btn" onClick={restart}>
                    <Restart width={18} height={18} /> Replay
                  </button>
                  <button className="btn btn-primary" onClick={() => setTab('quiz')}>
                    <Quiz width={18} height={18} /> Check understanding
                  </button>
                </div>
              </div>
            )}
          </div>

          <div className="board-tools" role="toolbar" aria-label="Your notes on the board">
            <button className="tool-btn" aria-pressed={penOn} onClick={togglePen} title="Draw on the board (pauses the lesson)">
              <Pen width={16} height={16} /> {penOn ? 'Drawing… (click to stop)' : 'Draw'}
            </button>
            <button className="tool-btn" onClick={() => setStrokes((s) => s.slice(0, -1))} disabled={!strokes.length}>
              <Undo width={16} height={16} /> Undo
            </button>
            <button className="tool-btn" onClick={() => { setStrokes([]); setCircledIds([]); }} disabled={!strokes.length}>
              <Trash width={16} height={16} /> Clear notes
            </button>
            <button className="tool-btn" onClick={askAboutDrawing} disabled={!strokes.length}>
              <Chat width={16} height={16} /> Ask about my drawing
            </button>
            {penOn && <span className="hint muted small">Circle or underline anything, then ask about it.</span>}
          </div>

          <p className="shortcuts muted small">
            Space play/pause · ←/→ 5 seconds · R restart · C captions · F fullscreen · / ask a question · Click anything on the board to ask about it
          </p>
        </section>

        <aside className="side" aria-label="Lesson tools">
          <div className="tabs" role="tablist">
            {(
              [
                ['transcript', 'Transcript', List],
                ['ask', 'Ask tutor', Chat],
                ['quiz', 'Quiz', Quiz],
              ] as const
            ).map(([id, label, Icon]) => (
              <button key={id} role="tab" id={`tab-${id}`} aria-selected={tab === id} aria-controls={`panel-${id}`} className="tab" onClick={() => setTab(id)}>
                <Icon width={16} height={16} /> {label}
              </button>
            ))}
          </div>
          <div className="tab-panel" role="tabpanel" id={`panel-${tab}`} aria-labelledby={`tab-${tab}`}>
            {tab === 'transcript' && <Transcript lesson={lesson} timeline={timeline} activeBeat={started ? frame.activeBeat : -1} onSeek={(x) => { seek(x); if (!started) play(); }} />}
            {tab === 'ask' && (
              <AskPanel
                messages={messages}
                busy={busy}
                selectedLabel={selectedLabel ?? (circledLabels.length ? `what you marked (${circledLabels.join(', ')})` : undefined)}
                onClearSelection={() => {
                  setSelectedId(undefined);
                  setCircledIds([]);
                }}
                onAsk={ask}
                onResume={play}
                canResume={pausedForQuestion}
                inputRef={inputRef}
                draft={draft}
                setDraft={setDraft}
              />
            )}
            {tab === 'quiz' && <QuizPanel quiz={lesson.quiz} onExplain={explainMistake} />}
          </div>
        </aside>
      </div>
    </div>
  );
}
