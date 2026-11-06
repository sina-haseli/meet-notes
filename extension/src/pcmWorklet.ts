// AudioWorklet processor "pcm-capture": downmixes its input to mono, downsamples it to 16 kHz and
// posts Int16Array batches of about 1 s to the offscreen document. Runs in AudioWorkletGlobalScope,
// so it must not touch DOM or chrome APIs (audioChunks is pure and bundled in by esbuild).
import { Downsampler, downmix, PCM_RATE } from "./lib/audioChunks";

// AudioWorkletGlobalScope globals (not in TS's DOM lib).
declare const sampleRate: number;
declare class AudioWorkletProcessor {
  readonly port: MessagePort;
  constructor();
}
declare function registerProcessor(name: string, ctor: new () => AudioWorkletProcessor): void;

const BATCH = PCM_RATE; // ~1 s of 16 kHz samples

class PcmCapture extends AudioWorkletProcessor {
  private ds = new Downsampler(sampleRate, PCM_RATE);
  private buf = new Int16Array(BATCH);
  private fill = 0;

  constructor() {
    super();
    // "flush": post the partial batch, then "flushed", so Stop doesn't lose the last second.
    this.port.onmessage = (e: MessageEvent) => {
      if (e.data === "flush") {
        this.post();
        this.port.postMessage("flushed");
      }
    };
  }

  process(inputs: Float32Array[][]): boolean {
    const input = inputs[0];
    if (!input || input.length === 0) return true;
    const pcm = this.ds.push(downmix(input));
    let off = 0;
    while (off < pcm.length) {
      const n = Math.min(BATCH - this.fill, pcm.length - off);
      this.buf.set(pcm.subarray(off, off + n), this.fill);
      this.fill += n;
      off += n;
      if (this.fill === BATCH) this.post();
    }
    return true;
  }

  private post(): void {
    if (this.fill === 0) return;
    const out = this.fill === BATCH ? this.buf : this.buf.slice(0, this.fill);
    this.port.postMessage(out, [out.buffer]);
    this.buf = new Int16Array(BATCH);
    this.fill = 0;
  }
}

registerProcessor("pcm-capture", PcmCapture);
