import { describe, it, expect } from "vitest";
import { planChunks, Downsampler, downmix, assembleChunk, sliceEnd, PCM_RATE, SLICE_SAMPLES } from "../src/lib/audioChunks";

describe("planChunks", () => {
  it("single chunk for 30 s", () => {
    expect(planChunks(30000)).toEqual([{ index: 0, offsetMs: 0, durationMs: 30000 }]);
  });
  it("1250 s gives three chunks with overlap", () => {
    const p = planChunks(1250000);
    expect(p.map((c) => c.offsetMs)).toEqual([0, 600000, 1200000]);
    expect(p.map((c) => c.durationMs)).toEqual([605000, 605000, 50000]);
  });
  it("skips a trailing piece within the overlap", () => {
    expect(planChunks(1203000)).toHaveLength(2);
  });
  it("custom chunk and overlap", () => {
    expect(planChunks(21000, 10, 5).map((c) => c.offsetMs)).toEqual([0, 10000]);
  });
});

describe("Downsampler", () => {
  it("downsamplerLengthAndDc", () => {
    const d = new Downsampler(48000);
    const input = new Float32Array(48000).fill(0.5);
    const cuts = [0, 1000, 5003, 9000, 20001, 33333, 40000, 48000];
    const out: number[] = [];
    for (let i = 0; i < cuts.length - 1; i++) out.push(...d.push(input.subarray(cuts[i], cuts[i + 1])));
    expect(Math.abs(out.length - 16000)).toBeLessThanOrEqual(1);
    for (const v of out) expect(Math.abs(v - 16384)).toBeLessThanOrEqual(2);
  });
  it("downsamplerSine", () => {
    const n = 48000;
    const input = new Float32Array(n);
    for (let i = 0; i < n; i++) input[i] = 0.5 * Math.sin((2 * Math.PI * 440 * i) / 48000);
    const out = new Downsampler(48000).push(input);
    const rms = (a: ArrayLike<number>, s: number) => {
      let t = 0;
      for (let i = 0; i < a.length; i++) t += (a[i] * s) ** 2;
      return Math.sqrt(t / a.length);
    };
    const inR = rms(input, 1);
    const outR = rms(out, 1 / 32767);
    expect(Math.abs(outR - inR) / inR).toBeLessThan(0.1);
  });
  it("clamps out-of-range input", () => {
    const out = new Downsampler(16000).push(new Float32Array([2, -2]));
    expect(Array.from(out)).toEqual([32767, -32767]);
  });
});

describe("downmix", () => {
  it("averages channels", () => {
    const m = downmix([new Float32Array([1, 0]), new Float32Array([0, 1])]);
    expect(Array.from(m)).toEqual([0.5, 0.5]);
  });
});

describe("assembleChunk", () => {
  it("readsOnlyOverlappingSlices", async () => {
    const calls: [number, number][] = [];
    const readSlices = async (from: number, to: number) => {
      calls.push([from, to]);
      return Array.from({ length: to - from + 1 }, (_, i) => ({ seq: from + i, pcm: new Int16Array(SLICE_SAMPLES) }));
    };
    const pcm = await assembleChunk({ index: 1, offsetMs: 600000, durationMs: 605000 }, readSlices);
    expect(calls).toEqual([[60, 120]]);
    expect(pcm.length).toBe(605000 * 16);
    expect(PCM_RATE).toBe(16000);
  });
  it("returns fewer samples at the end", async () => {
    const readSlices = async () => [
      { seq: 0, pcm: new Int16Array(SLICE_SAMPLES).fill(1) },
      { seq: 1, pcm: new Int16Array(100).fill(2) },
    ];
    const pcm = await assembleChunk({ index: 0, offsetMs: 9000, durationMs: 5000 }, readSlices);
    expect(pcm.length).toBe(160000 + 100 - 144000);
    expect(pcm[0]).toBe(1);
    expect(pcm[pcm.length - 1]).toBe(2);
  });
  it("missingMiddleSliceIsZeroFilledAndLaterSamplesKeepTheirPositions", async () => {
    // Slice 1 failed to save: slices 0 and 2 are stored, 2 is the partial tail.
    const stored = [
      { seq: 0, pcm: new Int16Array(SLICE_SAMPLES).fill(1) },
      { seq: 2, pcm: new Int16Array(500).fill(3) },
    ];
    const readSlices = async (from: number, to: number) => stored.filter((s) => s.seq >= from && s.seq <= to);
    const pcm = await assembleChunk({ index: 0, offsetMs: 0, durationMs: 605000 }, readSlices);
    expect(pcm.length).toBe(2 * SLICE_SAMPLES + 500); // up to the end of what was recorded
    expect(pcm[SLICE_SAMPLES - 1]).toBe(1);
    expect(pcm[SLICE_SAMPLES]).toBe(0);
    expect(pcm[2 * SLICE_SAMPLES - 1]).toBe(0);
    expect(pcm[2 * SLICE_SAMPLES]).toBe(3); // 20 s in, not shifted back to 10 s
    expect(pcm[2 * SLICE_SAMPLES + 499]).toBe(3);
  });
  it("chunkStartingInsideAGapStartsWithZeros", async () => {
    const stored = [{ seq: 2, pcm: new Int16Array(SLICE_SAMPLES).fill(7) }];
    const pcm = await assembleChunk({ index: 0, offsetMs: 15000, durationMs: 10000 }, async () => stored);
    expect(pcm.length).toBe(10 * PCM_RATE);
    expect(pcm[0]).toBe(0); // 15 s: inside the missing slice 1
    expect(pcm[5 * PCM_RATE - 1]).toBe(0);
    expect(pcm[5 * PCM_RATE]).toBe(7); // 20 s: slice 2 starts
  });
  it("sliceEndIsTheTimelinePosition", () => {
    expect(sliceEnd(0, 100)).toBe(100);
    expect(sliceEnd(3, 500)).toBe(3 * SLICE_SAMPLES + 500);
  });
});
