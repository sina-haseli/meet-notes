import type { SpeakerInterval } from "../types";

/** Turns a stream of mic RMS levels into self-speaking intervals. */
export class SpeakingDetector {
  private kept: SpeakerInterval[] = [];
  private start: number | null = null; // open interval start
  private silentSince: number | null = null; // first silent sample of current silent run

  constructor(
    private name: string,
    private threshold = 0.02,
    private minOnMs = 300,
    private hangMs = 700,
  ) {}

  push(rms: number, tMs: number): void {
    if (rms >= this.threshold) {
      // A long-enough silent run ended with this sample: close the old interval first.
      if (this.silentSince !== null && tMs - this.silentSince >= this.hangMs) this.close(this.silentSince);
      if (this.start === null) this.start = tMs;
      this.silentSince = null;
      return;
    }
    if (this.start === null) return;
    if (this.silentSince === null) this.silentSince = tMs;
    if (tMs - this.silentSince >= this.hangMs) this.close(this.silentSince);
  }

  finish(tMs: number): SpeakerInterval[] {
    if (this.start !== null) this.close(this.silentSince ?? tMs);
    return [...this.kept].sort((a, b) => a.start_ms - b.start_ms);
  }

  private close(end: number): void {
    const start = this.start as number;
    if (end - start >= this.minOnMs) this.kept.push({ name: this.name, start_ms: start, end_ms: end });
    this.start = null;
    this.silentSince = null;
  }
}
