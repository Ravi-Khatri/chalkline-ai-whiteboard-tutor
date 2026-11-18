import type { Timeline } from '../../shared/timeline.ts';
import { Back5, ExitFull, Full, Fwd5, Pause, Play, Restart } from './Icons.tsx';

export const fmt = (s: number) => {
  const t = Math.max(0, Math.floor(s));
  return `${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}`;
};

export function PlayerBar({
  t,
  timeline,
  playing,
  onToggle,
  onSeek,
  onRestart,
  rate,
  onRate,
  fullscreen,
  onFullscreen,
  captionsOn,
  onCaptions,
}: {
  captionsOn?: boolean;
  onCaptions?: () => void;
  fullscreen?: boolean;
  onFullscreen?: () => void;
  t: number;
  timeline: Timeline;
  playing: boolean;
  onToggle: () => void;
  onSeek: (t: number) => void;
  onRestart: () => void;
  /** Narration speed; undefined hides the control (browser-voice mode). */
  rate?: number;
  onRate: (r: number) => void;
}) {
  const d = timeline.duration || 1;
  const stepIndex = timeline.steps.findIndex((s) => t >= s.start && t < s.end);
  const current = timeline.steps[stepIndex === -1 ? timeline.steps.length - 1 : stepIndex];

  return (
    <div className="player" role="group" aria-label="Lesson playback">
      <div className="player-buttons">
        <button className="icon-btn" onClick={onRestart} aria-label="Restart lesson" title="Restart (R)">
          <Restart />
        </button>
        <button className="icon-btn" onClick={() => onSeek(t - 5)} aria-label="Back 5 seconds" title="Back 5s (←)">
          <Back5 />
        </button>
        <button className="play-btn" onClick={onToggle} aria-label={playing ? 'Pause' : 'Play'} title="Play / pause (Space)">
          {playing ? <Pause width={20} height={20} /> : <Play width={20} height={20} />}
        </button>
        <button className="icon-btn" onClick={() => onSeek(t + 5)} aria-label="Forward 5 seconds" title="Forward 5s (→)">
          <Fwd5 />
        </button>
      </div>

      <div className="scrub">
        <div className="scrub-track" aria-hidden="true">
          {timeline.steps.map((s, i) => (
            <div
              key={i}
              className={`scrub-seg${i === stepIndex ? ' is-current' : ''}`}
              style={{ width: `${((s.end - s.start) / d) * 100}%` }}
              title={s.title}
            />
          ))}
          <div className="scrub-fill" style={{ width: `${(Math.min(t, d) / d) * 100}%` }} />
        </div>
        <input
          className="scrub-input"
          type="range"
          min={0}
          max={d}
          step={0.1}
          value={Math.min(t, d)}
          onChange={(e) => onSeek(Number(e.target.value))}
          aria-label="Seek"
          aria-valuetext={`${fmt(t)} of ${fmt(d)}${current ? `, ${current.title}` : ''}`}
        />
      </div>

      <div className="player-time" aria-hidden="true">
        <span className="tabular">{fmt(t)}</span>
        <span className="muted"> / {fmt(d)}</span>
      </div>

      {rate !== undefined && (
        <label className="speed">
          <span className="sr-only">Narration speed</span>
          <select value={rate} onChange={(e) => onRate(Number(e.target.value))} title="Narration speed">
            {[0.75, 0.9, 1, 1.15].map((r) => (
              <option key={r} value={r}>
                {r}×
              </option>
            ))}
          </select>
        </label>
      )}

      {onCaptions && (
        <button
          className={`icon-btn cc-btn${captionsOn ? ' is-on' : ''}`}
          onClick={onCaptions}
          aria-pressed={captionsOn}
          aria-label="Captions"
          title={`Captions ${captionsOn ? 'on' : 'off'} (C)`}
        >
          <span aria-hidden="true">CC</span>
        </button>
      )}

      {onFullscreen && (
        <button className="icon-btn" onClick={onFullscreen} aria-label={fullscreen ? 'Exit full screen' : 'Full screen'} title="Full screen (F)">
          {fullscreen ? <ExitFull /> : <Full />}
        </button>
      )}
    </div>
  );
}
