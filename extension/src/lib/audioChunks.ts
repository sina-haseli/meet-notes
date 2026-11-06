import type { ChunkPlan } from "../types";

export const PCM_RATE = 16000;
export const SLICE_SAMPLES = 160000; // 10 s per stored PCM slice

/** Port of split_audio boundaries: chunk k starts at k*chunkS, lasts chunkS+overlapS (or the rest). */
export function planChunks(totalMs: number, chunkS = 600, overlapS = 5): ChunkPlan[] {
  const chunkMs = chunkS * 1000;
  const overlapMs = overlapS * 1000;
  const count = Math.max(1, Math.ceil(totalMs / chunkMs));
  const plans: ChunkPlan[] = [];
  for (let k = 0; k < count; k++) {
    const offsetMs = k * chunkMs;
    if (k > 0 && totalMs - offsetMs <= overlapMs) break;
    plans.push({ index: k, offsetMs, durationMs: Math.min(chunkMs + overlapMs, totalMs - offsetMs) });
  }
  return plans;
}

/** Streaming mono downsampler: averages the input window of each output sample. */
export class Downsampler {
  private readonly ratio: number;
  private acc = 0;
  private cnt = 0;
  private seen = 0; // absolute input samples consumed
  private nextEnd: number; // absolute input position where the current output window ends

  constructor(inRate: number, outRate = PCM_RATE) {
    this.ratio = inRate / outRate;
    this.nextEnd = this.ratio;
  }

  push(input: Float32Array): Int16Array {
    const out: number[] = [];
    for (let i = 0; i < input.length; i++) {
      this.acc += input[i];
      this.cnt++;
      this.seen++;
      // epsilon guards float error at exact integer ratios
      if (this.seen >= this.nextEnd - 1e-9) {
        const avg = Math.max(-1, Math.min(1, this.acc / this.cnt));
        out.push(Math.round(avg * 32767));
        this.acc = 0;
        this.cnt = 0;
        this.nextEnd += this.ratio;
      }
    }
    return Int16Array.from(out);
  }
}

export function downmix(channels: Float32Array[]): Float32Array {
  if (channels.length === 1) return channels[0];
  const n = channels[0].length;
  const out = new Float32Array(n);
  for (const ch of channels) for (let i = 0; i < n; i++) out[i] += ch[i];
  for (let i = 0; i < n; i++) out[i] /= channels.length;
  return out;
}

/** One stored 16 kHz PCM slice and its position (slice `seq` starts at seq * SLICE_SAMPLES). */
export interface PcmSlice {
  seq: number;
  pcm: Int16Array;
}

/** Timeline position (in samples) just after slice `seq` of length `len`. */
export function sliceEnd(seq: number, len: number): number {
  return seq * SLICE_SAMPLES + len;
}

/**
 * The chunk's samples, each slice placed at its own seq position. A slice that failed to save is
 * zero-filled, so later audio keeps its true time (and stays aligned with the speaker log).
 */
export async function assembleChunk(
  plan: ChunkPlan,
  readSlices: (fromSeq: number, toSeq: number) => Promise<PcmSlice[]>,
): Promise<Int16Array> {
  const startSample = Math.round((plan.offsetMs * PCM_RATE) / 1000);
  const endSample = startSample + Math.round((plan.durationMs * PCM_RATE) / 1000);
  const fromSeq = Math.floor(startSample / SLICE_SAMPLES);
  const toSeq = Math.floor((endSample - 1) / SLICE_SAMPLES);
  const slices = (await readSlices(fromSeq, toSeq)).filter((s) => s.seq >= fromSeq && s.seq <= toSeq);
  // Ends where the recorded audio ends (the last stored sample), never past the plan.
  const dataEnd = slices.reduce((n, s) => Math.max(n, sliceEnd(s.seq, s.pcm.length)), 0);
  const end = Math.min(endSample, dataEnd);
  const out = new Int16Array(Math.max(0, end - startSample));
  for (const s of slices) {
    const at = s.seq * SLICE_SAMPLES;
    const from = Math.max(at, startSample);
    const to = Math.min(at + s.pcm.length, end);
    if (to > from) out.set(s.pcm.subarray(from - at, to - at), from - startSample);
  }
  return out;
}
