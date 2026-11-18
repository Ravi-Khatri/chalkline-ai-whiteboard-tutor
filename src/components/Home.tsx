import { useEffect, useState, type FormEvent } from 'react';
import type { Level } from '../../shared/types.ts';
import { listSamples, type SampleInfo } from '../lib/api.ts';
import { DEFAULT_DEVICE_MODEL, DEVICE_MODELS, deviceSupport, isModelDownloaded } from '../lib/deviceAI.ts';
import type { AiMode } from '../App.tsx';
import { Board, Chat, Chip, Play, Quiz } from './Icons.tsx';
import { INK } from './Whiteboard.tsx';

const SUGGESTIONS = ['How binary search works', 'Why the sky is blue', 'Photosynthesis', 'Compound interest', 'How vaccines train the immune system', 'Pythagoras theorem'];
const LEVELS: { id: Level; label: string }[] = [
  { id: 'beginner', label: 'New to it' },
  { id: 'intermediate', label: 'Know the basics' },
  { id: 'advanced', label: 'Go deeper' },
];

export function Home({
  onStart,
  onSample,
  error,
  errorCode,
  initialTopic,
  initialLevel,
}: {
  onStart: (topic: string, level: Level, mode: AiMode, deviceModel?: string) => void;
  onSample: (id: string) => void;
  error?: string;
  errorCode?: string;
  initialTopic?: string;
  initialLevel?: Level;
}) {
  const [topic, setTopic] = useState(initialTopic ?? '');
  const [level, setLevel] = useState<Level>(initialLevel ?? 'beginner');
  const [mode, setMode] = useState<AiMode>('cloud');
  const [deviceModel, setDeviceModel] = useState(DEFAULT_DEVICE_MODEL);
  const [support, setSupport] = useState<{ ok: boolean; reason?: string } | null>(null);
  const [downloaded, setDownloaded] = useState(false);

  useEffect(() => {
    deviceSupport().then(setSupport).catch(() => setSupport({ ok: false, reason: 'WebGPU check failed.' }));
  }, []);
  useEffect(() => {
    // Only check the model cache (which loads WebLLM) once on-device mode is chosen.
    if (mode === 'device') isModelDownloaded(deviceModel).then(setDownloaded);
  }, [deviceModel, mode]);
  const chosen = DEVICE_MODELS.find((m) => m.id === deviceModel)!;
  const [samples, setSamples] = useState<SampleInfo[]>([]);
  const [touched, setTouched] = useState(false);

  useEffect(() => {
    listSamples().then(setSamples).catch(() => setSamples([]));
  }, []);

  const tooShort = topic.trim().length < 2;
  const submit = (e: FormEvent) => {
    e.preventDefault();
    setTouched(true);
    if (!tooShort) onStart(topic.trim(), level, mode, deviceModel);
  };

  return (
    <main className="home">
      <section className="hero">
        <div className="hero-copy">
          <p className="kicker">AI whiteboard tutor</p>
          <h1>
            Understand anything in two minutes, <em>explained at a whiteboard.</em>
          </h1>
          <p className="lede">Type a topic. Chalkline talks you through it while it draws, and stops to answer questions about anything on the board.</p>

          <form className="topic-form" onSubmit={submit} noValidate>
            <label htmlFor="topic" className="sr-only">
              What do you want to understand?
            </label>
            <div className={`prompt${touched && tooShort ? ' is-invalid' : ''}`}>
              <input
                id="topic"
                value={topic}
                onChange={(e) => setTopic(e.target.value)}
                placeholder="What do you want to understand?"
                maxLength={120}
                autoComplete="off"
                aria-invalid={touched && tooShort}
                aria-describedby={touched && tooShort ? 'topic-error' : error ? 'start-error' : undefined}
              />
              <button className="btn btn-primary" type="submit">
                <Play width={16} height={16} /> Teach me
              </button>
            </div>
            {touched && tooShort && (
              <p id="topic-error" className="field-error">
                Enter a topic of at least 2 characters.
              </p>
            )}
            {error && (
              <div id="start-error" className="field-error" role="alert">
                <p>{error}</p>
                {(errorCode === 'quota' || errorCode === 'limit') && support?.ok && !tooShort && (
                  <button type="button" className="btn btn-secondary btn-sm" onClick={() => onStart(topic.trim(), level, 'device', deviceModel)}>
                    <Chip width={16} height={16} /> Write it on my device instead
                  </button>
                )}
              </div>
            )}

            <div className="options">
              <div className="option">
                <span className="option-label" id="level-label">
                  Level
                </span>
                <div className="segmented" role="radiogroup" aria-labelledby="level-label">
                  {LEVELS.map((l) => (
                    <button
                      type="button"
                      key={l.id}
                      role="radio"
                      aria-checked={level === l.id}
                      className={`seg${level === l.id ? ' is-on' : ''}`}
                      onClick={() => setLevel(l.id)}
                    >
                      {l.label}
                    </button>
                  ))}
                </div>
              </div>
              <div className="option">
                <span className="option-label" id="where-label">
                  AI runs on
                </span>
                <div className="segmented" role="radiogroup" aria-labelledby="where-label">
                  <button
                    type="button"
                    role="radio"
                    aria-checked={mode === 'cloud'}
                    className={`seg${mode === 'cloud' ? ' is-on' : ''}`}
                    onClick={() => setMode('cloud')}
                    title="Cloudflare Workers AI: best lesson quality, limited free daily allowance"
                  >
                    Cloud
                  </button>
                  <button
                    type="button"
                    role="radio"
                    aria-checked={mode === 'device'}
                    className={`seg${mode === 'device' ? ' is-on' : ''}`}
                    onClick={() => setMode('device')}
                    disabled={support !== null && !support.ok}
                    title="An open-source model in your browser: no daily limit"
                  >
                    My device
                  </button>
                </div>
              </div>
            </div>

            {support && !support.ok && <p className="hint">On-device mode isn't available here: {support.reason}</p>}
            {mode === 'device' && support?.ok && (
              <div className="device-panel">
                <label>
                  <span className="option-label">Open-source model</span>
                  <select value={deviceModel} onChange={(e) => setDeviceModel(e.target.value)}>
                    {DEVICE_MODELS.map((m) => (
                      <option key={m.id} value={m.id}>
                        {m.name}
                      </option>
                    ))}
                  </select>
                </label>
                <p className="hint">
                  The lesson is written by an open-source model running in your browser (WebLLM), with no daily limit. Narration uses the cloud voice when available.{' '}
                  {downloaded
                    ? 'The model is already downloaded on this device.'
                    : `First use downloads ${chosen.download} once (needs ${chosen.memory}). Lessons are simpler than cloud ones and take 1–3 minutes to write.`}
                </p>
              </div>
            )}

            <div className="suggestions" aria-label="Topic ideas">
              {SUGGESTIONS.map((s) => (
                <button type="button" className="chip" key={s} onClick={() => setTopic(s)}>
                  {s}
                </button>
              ))}
            </div>
          </form>
        </div>

        <BoardPreview />
      </section>

      {samples.length > 0 && (
        <section className="samples" aria-labelledby="samples-h">
          <div className="section-head">
            <h2 id="samples-h">Ready-made lessons</h2>
            <p className="hint">Pre-generated with the same pipeline, so they start instantly. Questions are still answered live.</p>
          </div>
          <div className="sample-grid">
            {samples.map((s) => (
              <button key={s.id} className="sample-card" onClick={() => onSample(s.id)}>
                <span className="pill">Sample</span>
                <strong className="sample-title">{s.title}</strong>
                <span className="sample-blurb">{s.blurb}</span>
                <span className="sample-go">
                  <Play width={16} height={16} /> Play lesson
                </span>
              </button>
            ))}
          </div>
        </section>
      )}

      <section className="how" aria-labelledby="how-h">
        <h2 id="how-h" className="sr-only">
          How it works
        </h2>
        <div className="how-item">
          <Board width={20} height={20} />
          <h3>Voice and drawing in sync</h3>
          <p>Each sentence is recorded separately, and its measured length decides exactly when its drawing appears.</p>
        </div>
        <div className="how-item">
          <Play width={20} height={20} />
          <h3>Pause, rewind, jump</h3>
          <p>The board is recalculated for any moment, so seeking backwards rebuilds the drawing exactly.</p>
        </div>
        <div className="how-item">
          <Chat width={20} height={20} />
          <h3>Ask about what you see</h3>
          <p>Click or circle anything on the board and ask. The tutor answers out loud, then you resume.</p>
        </div>
        <div className="how-item">
          <Quiz width={20} height={20} />
          <h3>Check understanding</h3>
          <p>Three quick questions at the end; get one wrong and the tutor explains your mistake.</p>
        </div>
      </section>

      <p className="footnote">AI-written lessons can contain mistakes. Cloud lessons take about a minute to prepare.</p>
    </main>
  );
}

const ACCENT = '#4f46e5'; // matches --accent
const MARKER = '#fde68a'; // matches --marker

/** A static, decorative preview of a lesson board, drawn with the same ink palette as real lessons. */
function BoardPreview() {
  return (
    <figure className="board-preview" aria-hidden="true">
      <svg viewBox="0 0 1000 620">
        <text x="500" y="78" textAnchor="middle" className="board-text" fontSize="46" fill={INK.ink}>
          Compound interest
        </text>
        <rect x="80" y="190" width="210" height="92" rx="10" fill="none" stroke={INK.ink} strokeWidth="3" />
        <text x="185" y="248" textAnchor="middle" className="board-text" fontSize="36" fill={INK.ink}>
          ₹1,000
        </text>
        <path d="M300 236 H410 M396 224 l16 12 -16 12" stroke={ACCENT} strokeWidth="3" fill="none" strokeLinecap="round" />
        <text x="355" y="214" textAnchor="middle" className="board-text" fontSize="26" fill={ACCENT}>
          +10%
        </text>
        <rect x="420" y="190" width="230" height="92" rx="10" fill={MARKER} opacity="0.75" />
        <rect x="420" y="190" width="230" height="92" rx="10" fill="none" stroke={INK.ink} strokeWidth="3" />
        <text x="535" y="248" textAnchor="middle" className="board-text" fontSize="36" fill={INK.ink}>
          ₹1,100
        </text>
        <path d="M110 560 H900 M110 560 V350" stroke={INK.ink} strokeWidth="2.5" fill="none" />
        <path d="M110 545 C 360 525, 610 470, 900 360" stroke={INK.green} strokeWidth="4" fill="none" strokeLinecap="round" />
        <text x="770" y="342" className="board-text" fontSize="28" fill={INK.green}>
          after 10 years
        </text>
      </svg>
      <figcaption className="board-preview-cap">A lesson draws itself while the tutor speaks</figcaption>
    </figure>
  );
}
