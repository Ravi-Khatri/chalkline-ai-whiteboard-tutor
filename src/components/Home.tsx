import { useEffect, useState, type FormEvent } from 'react';
import type { Level } from '../../shared/types.ts';
import { listSamples, type SampleInfo } from '../lib/api.ts';
import { DEFAULT_DEVICE_MODEL, DEVICE_MODELS, deviceSupport, isModelDownloaded } from '../lib/deviceAI.ts';
import type { AiMode } from '../App.tsx';
import { Board, Chat, Chip, Play, Quiz, Sparkle } from './Icons.tsx';

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
        <p className="eyebrow">
          <Sparkle width={16} height={16} /> AI whiteboard tutor
        </p>
        <h1>
          Learn anything the way a good teacher explains it: <span className="hl">out loud, at a whiteboard.</span>
        </h1>
        <p className="lede">
          Type a topic. Chalkline plans a two-minute lesson, draws it step by step while it talks, and stops to answer your questions about anything on the board.
        </p>

        <form className="topic-form" onSubmit={submit} noValidate>
          <label htmlFor="topic" className="field-label">
            What do you want to understand?
          </label>
          <div className="topic-row">
            <input
              id="topic"
              value={topic}
              onChange={(e) => setTopic(e.target.value)}
              placeholder="e.g. How does binary search work?"
              maxLength={120}
              autoComplete="off"
              aria-invalid={touched && tooShort}
              aria-describedby={touched && tooShort ? 'topic-error' : error ? 'start-error' : undefined}
            />
            <button className="btn btn-primary btn-lg" type="submit">
              <Play width={18} height={18} /> Teach me
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
                <button type="button" className="btn device-cta" onClick={() => onStart(topic.trim(), level, 'device', deviceModel)}>
                  <Chip width={18} height={18} /> Write it on my device instead (open-source model, no daily limit)
                </button>
              )}
            </div>
          )}

          <div className="level" role="radiogroup" aria-label="Your level">
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

          <fieldset className="ai-where">
            <legend className="field-label">Where should the AI run?</legend>
            <div className="level" role="radiogroup" aria-label="Where the AI runs">
              <button type="button" role="radio" aria-checked={mode === 'cloud'} className={`seg${mode === 'cloud' ? ' is-on' : ''}`} onClick={() => setMode('cloud')}>
                Cloud · best quality
              </button>
              <button
                type="button"
                role="radio"
                aria-checked={mode === 'device'}
                className={`seg${mode === 'device' ? ' is-on' : ''}`}
                onClick={() => setMode('device')}
                disabled={support !== null && !support.ok}
              >
                My device · private, no limit
              </button>
            </div>
            {support && !support.ok && <p className="muted small">On-device mode isn't available here: {support.reason}</p>}
            {mode === 'device' && support?.ok && (
              <div className="device-panel">
                <label className="small">
                  Open-source model:{' '}
                  <select value={deviceModel} onChange={(e) => setDeviceModel(e.target.value)}>
                    {DEVICE_MODELS.map((m) => (
                      <option key={m.id} value={m.id}>
                        {m.name}
                      </option>
                    ))}
                  </select>
                </label>
                <p className="muted small">
                  Runs entirely in your browser with WebLLM (no API key, no AI service, nothing sent to an AI company).{' '}
                  {downloaded
                    ? 'Already downloaded on this device.'
                    : `First use downloads ${chosen.download} once (needs ${chosen.memory}). Lessons are simpler than the cloud ones and take 1–3 minutes to write.`}
                </p>
              </div>
            )}
          </fieldset>

          <div className="suggestions" aria-label="Topic ideas">
            {SUGGESTIONS.map((s) => (
              <button type="button" className="chip" key={s} onClick={() => setTopic(s)}>
                {s}
              </button>
            ))}
          </div>
          <p className="muted small">
            Cloud lessons are written by an AI model on Cloudflare Workers AI and take about a minute to prepare. All AI lessons can contain mistakes.
          </p>
        </form>
      </section>

      {samples.length > 0 && (
        <section className="samples" aria-labelledby="samples-h">
          <h2 id="samples-h">Try a ready-made lesson</h2>
          <p className="muted small">Pre-generated with the same AI pipeline and shipped with the app, so they start instantly. Follow-up questions are still answered live.</p>
          <div className="sample-grid">
            {samples.map((s) => (
              <button key={s.id} className="sample-card" onClick={() => onSample(s.id)}>
                <span className="sample-tag">Sample</span>
                <strong>{s.title}</strong>
                <span className="muted small">{s.blurb}</span>
                <span className="sample-go">
                  <Play width={16} height={16} /> Play
                </span>
              </button>
            ))}
          </div>
        </section>
      )}

      <section className="how" aria-label="How it works">
        <div>
          <Board />
          <h3>Voice and drawing in sync</h3>
          <p className="muted">Each sentence is recorded separately, and its measured length decides exactly when the matching drawing appears.</p>
        </div>
        <div>
          <Play />
          <h3>Pause, rewind, jump</h3>
          <p className="muted">The board is recalculated for any moment, so seeking backwards rebuilds the drawing exactly as it was.</p>
        </div>
        <div>
          <Chat />
          <h3>Interrupt with questions</h3>
          <p className="muted">Click something on the board and ask. The tutor answers out loud with the lesson's context, then you resume.</p>
        </div>
        <div>
          <Quiz />
          <h3>Check understanding</h3>
          <p className="muted">Three quick questions at the end. Get one wrong and the tutor explains your specific mistake.</p>
        </div>
      </section>
    </main>
  );
}
