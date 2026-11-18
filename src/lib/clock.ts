// Two interchangeable playback clocks. The player and the whiteboard only ever
// ask a clock "what time is it?", so seeking and pausing behave the same in
// both modes.
//
// AudioClock   - real narration audio (Workers AI speech) merged into one
//                track. Time comes from the media element playing it, so
//                drawings can never drift from the voice. Seeks are exact,
//                and the speed can be lowered with the pitch preserved.
// SpeechClock  - fallback when generated audio is unavailable (for example the
//                free AI quota is used up). Uses the browser's built-in voice
//                with estimated beat lengths; seeks restart at a beat boundary.

import type { Timeline } from '../../shared/timeline.ts';
import { beatAt } from '../../shared/timeline.ts';

export interface Clock {
  readonly kind: 'audio' | 'speech';
  readonly duration: number;
  readonly playing: boolean;
  time(): number;
  play(): void;
  pause(): void;
  seek(t: number): void;
  dispose(): void;
  /** Frees large resources once the lesson is closed for good (optional). */
  release?(): void;
  onEnded?: () => void;
}

const clampTime = (t: number, d: number) => Math.min(d, Math.max(0, t));

export class AudioClock implements Clock {
  readonly kind = 'audio' as const;
  onEnded?: () => void;
  private audio: HTMLAudioElement;
  private url: string;
  private rate = 1;

  /**
   * Plays the merged narration through an <audio> element (rather than raw Web
   * Audio) so the learner can slow it down with the pitch preserved. Media time
   * is lesson time at any playback rate, so the board stays in sync.
   */
  constructor(buffer: AudioBuffer, readonly duration = buffer.duration) {
    this.url = URL.createObjectURL(encodeWav(buffer));
    this.audio = new Audio(this.url);
    this.audio.preload = 'auto';
    this.audio.preservesPitch = true;
    this.audio.addEventListener('ended', () => this.onEnded?.());
  }

  get playing() {
    return !this.audio.paused && !this.audio.ended;
  }

  time() {
    return clampTime(this.audio.currentTime, this.duration);
  }

  play() {
    if (this.released) return;
    if (this.audio.ended || this.audio.currentTime >= this.duration - 0.05) this.audio.currentTime = 0;
    this.audio.playbackRate = this.rate;
    // If the browser refuses playback (e.g. autoplay policy) the element simply
    // stays paused; the UI reads `playing` and shows the play button again.
    void this.audio.play().catch((err) => console.warn('Narration playback was blocked', err));
  }

  pause() {
    this.audio.pause();
  }

  seek(t: number) {
    this.audio.currentTime = clampTime(t, this.duration);
  }

  setRate(r: number) {
    this.rate = r;
    this.audio.playbackRate = r;
  }

  /** Lower the narration while the tutor answers a question. */
  setVolume(v: number) {
    this.audio.volume = v;
  }

  dispose() {
    // Only pause: React StrictMode (development) runs cleanup and then reuses
    // the same clock, so the element must stay usable. release() frees memory.
    this.audio.pause();
  }

  private released = false;

  /**
   * Frees the merged narration (a 2-minute lesson is ~10–15 MB of WAV). Called
   * by the app when the learner leaves the lesson, after which the clock is unusable.
   */
  release() {
    if (this.released) return;
    this.released = true;
    this.audio.pause();
    this.audio.removeAttribute('src');
    this.audio.load();
    URL.revokeObjectURL(this.url);
  }
}

/** Encodes a mono AudioBuffer as a 16-bit PCM WAV blob. */
export function encodeWav(buffer: AudioBuffer): Blob {
  const data = buffer.getChannelData(0);
  const rate = buffer.sampleRate;
  const out = new DataView(new ArrayBuffer(44 + data.length * 2));
  const str = (o: number, s: string) => [...s].forEach((c, i) => out.setUint8(o + i, c.charCodeAt(0)));
  str(0, 'RIFF');
  out.setUint32(4, 36 + data.length * 2, true);
  str(8, 'WAVEfmt ');
  out.setUint32(16, 16, true);
  out.setUint16(20, 1, true);
  out.setUint16(22, 1, true);
  out.setUint32(24, rate, true);
  out.setUint32(28, rate * 2, true);
  out.setUint16(32, 2, true);
  out.setUint16(34, 16, true);
  str(36, 'data');
  out.setUint32(40, data.length * 2, true);
  for (let i = 0; i < data.length; i++) {
    const s = Math.max(-1, Math.min(1, data[i]));
    out.setInt16(44 + i * 2, s < 0 ? s * 0x8000 : s * 0x7fff, true);
  }
  return new Blob([out.buffer], { type: 'audio/wav' });
}
export class SpeechClock implements Clock {
  readonly kind = 'speech' as const;
  playing = false;
  onEnded?: () => void;
  private offset = 0;
  private startedAt = 0;
  private spokenBeat = -1;
  private speaking = false;
  private timer: number | null = null;

  constructor(private timeline: Timeline, private texts: string[]) {}

  get duration() {
    return this.timeline.duration;
  }

  time() {
    if (!this.playing) return this.offset;
    let t = this.offset + (performance.now() - this.startedAt) / 1000;
    // If the voice is slower than our estimate, hold the clock at the end of
    // the beat until the sentence finishes, so the board never runs ahead.
    const b = this.timeline.beats[this.spokenBeat];
    if (b && this.speaking && t > b.speechEnd) {
      t = b.speechEnd;
      this.offset = t;
      this.startedAt = performance.now();
    }
    return clampTime(t, this.duration);
  }

  play() {
    if (this.playing) return;
    if (this.offset >= this.duration - 0.05) this.offset = 0;
    this.playing = true;
    this.startedAt = performance.now();
    this.spokenBeat = -1;
    this.tick();
  }

  pause() {
    if (!this.playing) return;
    this.offset = this.time();
    this.playing = false;
    this.stopSpeech();
  }

  seek(t: number) {
    const wasPlaying = this.playing;
    this.pause();
    this.offset = clampTime(t, this.duration);
    // Browser speech cannot start mid-sentence, so snap to the beat start.
    const i = beatAt(this.timeline, this.offset);
    if (i >= 0) this.offset = this.timeline.beats[i].start;
    if (wasPlaying) this.play();
  }

  dispose() {
    this.playing = false;
    this.stopSpeech();
  }

  private stopSpeech() {
    if (this.timer !== null) window.clearTimeout(this.timer);
    this.timer = null;
    this.speaking = false;
    this.spokenBeat = -1;
    window.speechSynthesis?.cancel();
  }

  private tick = () => {
    if (!this.playing) return;
    const t = this.time();
    if (t >= this.duration - 0.01 && !this.speaking) {
      this.playing = false;
      this.offset = this.duration;
      this.onEnded?.();
      return;
    }
    const i = beatAt(this.timeline, t);
    if (i >= 0 && i !== this.spokenBeat) {
      this.spokenBeat = i;
      this.speak(this.texts[i]);
    }
    this.timer = window.setTimeout(this.tick, 50);
  };

  private speak(text: string) {
    const synth = window.speechSynthesis;
    if (!synth) return;
    synth.cancel();
    const u = new SpeechSynthesisUtterance(text);
    u.rate = 1;
    this.speaking = true;
    u.onend = u.onerror = () => {
      if (this.spokenBeat >= 0) this.speaking = false;
    };
    synth.speak(u);
  }
}
