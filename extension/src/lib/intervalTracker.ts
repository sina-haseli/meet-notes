import type { SpeakerInterval } from "../types";

/** Turns snapshots of "who is speaking" into per-name intervals. */
export class IntervalTracker {
  private open = new Map<string, number>();
  private done: SpeakerInterval[] = [];

  update(speaking: Set<string>, tMs: number): void {
    for (const [name, start] of this.open) {
      if (!speaking.has(name)) {
        this.done.push({ name, start_ms: start, end_ms: tMs });
        this.open.delete(name);
      }
    }
    for (const name of speaking) if (!this.open.has(name)) this.open.set(name, tMs);
  }

  finish(tMs: number): SpeakerInterval[] {
    for (const [name, start] of this.open) this.done.push({ name, start_ms: start, end_ms: tMs });
    this.open.clear();
    return [...this.done].sort((a, b) => a.start_ms - b.start_ms || a.name.localeCompare(b.name));
  }
}
