import type { SpeakerInterval } from "../types";

/**
 * Turns snapshots of "who is speaking" into per-name intervals. A name that stops and starts
 * again within `mergeGapMs` continues the same interval, so short pauses don't explode the log.
 */
export class IntervalTracker {
  private open = new Map<string, number>(); // name -> start
  private paused = new Map<string, { start: number; end: number }>(); // stopped, may still resume
  private done: SpeakerInterval[] = [];

  constructor(private readonly mergeGapMs = 1000) {}

  update(speaking: Set<string>, tMs: number): void {
    for (const [name, p] of this.paused) {
      if (speaking.has(name) && tMs - p.end <= this.mergeGapMs) {
        this.open.set(name, p.start); // resume the same interval
        this.paused.delete(name);
      } else if (speaking.has(name) || tMs - p.end > this.mergeGapMs) {
        this.done.push({ name, start_ms: p.start, end_ms: p.end });
        this.paused.delete(name);
      }
    }
    for (const [name, start] of this.open) {
      if (!speaking.has(name)) {
        this.paused.set(name, { start, end: tMs });
        this.open.delete(name);
      }
    }
    for (const name of speaking) if (!this.open.has(name)) this.open.set(name, tMs);
  }

  finish(tMs: number): SpeakerInterval[] {
    for (const [name, p] of this.paused) this.done.push({ name, start_ms: p.start, end_ms: p.end });
    for (const [name, start] of this.open) this.done.push({ name, start_ms: start, end_ms: tMs });
    this.paused.clear();
    this.open.clear();
    return [...this.done].sort((a, b) => a.start_ms - b.start_ms || a.name.localeCompare(b.name));
  }
}
