import { SLICE_SAMPLES } from "./audioChunks";

/**
 * Collects 16 kHz PCM batches into fixed-size slices and hands each one to `onSlice`, strictly in
 * order and one at a time. The last, partial slice is emitted on `flush`.
 */
export class SliceBuffer {
  private cur: Int16Array;
  private fill = 0;
  private seq = 0;
  private total = 0;
  private chain: Promise<void> = Promise.resolve();
  private error: unknown = null;

  constructor(
    private readonly onSlice: (seq: number, pcm: Int16Array) => Promise<void>,
    private readonly size = SLICE_SAMPLES,
  ) {
    this.cur = new Int16Array(size);
  }

  push(pcm: Int16Array): void {
    this.total += pcm.length;
    let off = 0;
    while (off < pcm.length) {
      const n = Math.min(this.size - this.fill, pcm.length - off);
      this.cur.set(pcm.subarray(off, off + n), this.fill);
      this.fill += n;
      off += n;
      if (this.fill === this.size) {
        this.emit(this.cur);
        this.cur = new Int16Array(this.size);
        this.fill = 0;
      }
    }
  }

  /** Emits the partial tail (if any) and waits for every slice write. Rejects with the first write error. */
  async flush(): Promise<void> {
    if (this.fill > 0) {
      this.emit(this.cur.slice(0, this.fill));
      this.cur = new Int16Array(this.size);
      this.fill = 0;
    }
    await this.chain;
    if (this.error !== null) {
      const e = this.error;
      this.error = null;
      throw e;
    }
  }

  get totalSamples(): number {
    return this.total;
  }

  private emit(slice: Int16Array): void {
    const seq = this.seq++;
    // A failed write must not block later slices; the first error surfaces on flush.
    this.chain = this.chain
      .then(() => this.onSlice(seq, slice))
      .catch((e: unknown) => {
        if (this.error === null) this.error = e;
      });
  }
}

/** Runs `write`, and once more if it fails (a transient IndexedDB error must not leave a gap). */
export async function retryOnce(write: () => Promise<void>): Promise<void> {
  try {
    await write();
  } catch (e) {
    console.warn("write failed, trying once more", e);
    await write();
  }
}
