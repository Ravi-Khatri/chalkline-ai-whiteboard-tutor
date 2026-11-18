import { describe, expect, it } from 'vitest';
import { encodeWav } from '../src/lib/clock.ts';
import { mapLimit } from '../src/lib/narration.ts';

describe('encodeWav', () => {
  it('writes a valid 16-bit mono PCM WAV with clamped samples', async () => {
    const samples = new Float32Array([0, 1, -1, 2, -2, 0.5]);
    const buffer = { sampleRate: 8000, length: samples.length, getChannelData: () => samples } as unknown as AudioBuffer;
    const bytes = new DataView(await encodeWav(buffer).arrayBuffer());
    const tag = (o: number) => String.fromCharCode(...[0, 1, 2, 3].map((i) => bytes.getUint8(o + i)));
    expect(tag(0)).toBe('RIFF');
    expect(tag(8)).toBe('WAVE');
    expect(bytes.getUint16(22, true)).toBe(1); // mono
    expect(bytes.getUint32(24, true)).toBe(8000); // sample rate
    expect(bytes.getUint16(34, true)).toBe(16); // bits
    expect(bytes.getUint32(40, true)).toBe(samples.length * 2); // data size
    const pcm = [0, 1, 2, 3, 4, 5].map((i) => bytes.getInt16(44 + i * 2, true));
    expect(pcm).toEqual([0, 32767, -32768, 32767, -32768, 16383]); // out-of-range values are clamped
  });
});

describe('mapLimit', () => {
  it('keeps at most `limit` tasks in flight and preserves order', async () => {
    let inFlight = 0;
    let peak = 0;
    const out = await mapLimit([1, 2, 3, 4, 5, 6], 2, async (n) => {
      inFlight++;
      peak = Math.max(peak, inFlight);
      await new Promise((r) => setTimeout(r, 5));
      inFlight--;
      return n * 10;
    });
    expect(out).toEqual([10, 20, 30, 40, 50, 60]);
    expect(peak).toBe(2);
  });

  it('starts no new work after the first failure (saves AI quota)', async () => {
    const started: number[] = [];
    await expect(
      mapLimit([1, 2, 3, 4, 5, 6, 7, 8], 2, async (n) => {
        started.push(n);
        await new Promise((r) => setTimeout(r, 2));
        if (n === 2) throw new Error('quota');
        return n;
      }),
    ).rejects.toThrow('quota');
    expect(started.length).toBeLessThanOrEqual(3);
  });
});
