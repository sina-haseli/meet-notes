import type { SpeakerInterval, Turn } from "../types";

function overlap(aStart: number, aEnd: number, bStart: number, bEnd: number): number {
  return Math.max(0, Math.min(aEnd, bEnd) - Math.max(aStart, bStart));
}

/** A label gets a name only when that name dominates the logged overlap (minShare)
 * AND covers enough of the label's own speech (minCoverage). The coverage check stops a
 * partial log (e.g. only the mic self-log) from crediting a remote voice to a logged name. */
export function assignSpeakers(
  turns: Turn[],
  log: SpeakerInterval[],
  minShare = 0.6,
  minOverlapMs = 1000,
  minCoverage = 0.5,
): Turn[] {
  const keyOf = (t: Turn) => `${t.chunk}\u0000${t.label}`;
  const overlaps = new Map<string, Map<string, number>>();
  const durations = new Map<string, number>();
  for (const t of turns) {
    const key = keyOf(t);
    let perName = overlaps.get(key);
    if (!perName) overlaps.set(key, (perName = new Map()));
    durations.set(key, (durations.get(key) ?? 0) + Math.max(0, t.endMs - t.startMs));
    for (const entry of log) {
      const ms = overlap(t.startMs, t.endMs, entry.start_ms, entry.end_ms);
      if (ms > 0) perName.set(entry.name, (perName.get(entry.name) ?? 0) + ms);
    }
  }

  const resolved = new Map<string, string | null>();
  for (const [key, perName] of overlaps) {
    let total = 0;
    let name: string | null = null;
    let best = 0;
    for (const [n, ms] of perName) {
      total += ms;
      if (name === null || ms > best) { name = n; best = ms; }
    }
    const duration = durations.get(key) ?? 0;
    const confident =
      name !== null && best >= minOverlapMs && best / total >= minShare &&
      duration > 0 && best / duration >= minCoverage;
    resolved.set(key, confident ? name : null);
  }

  const numbers = new Map<string, number>();
  return turns.map((t) => {
    const key = keyOf(t);
    const name = resolved.get(key) ?? null;
    if (name !== null) return { ...t, speaker: name, uncertain: false };
    let n = numbers.get(key);
    if (n === undefined) { n = numbers.size + 1; numbers.set(key, n); }
    return { ...t, speaker: `Speaker ${n}`, uncertain: true };
  });
}

export function renameSpeaker(turns: Turn[], old: string, next: string): Turn[] {
  return turns.map((t) => (t.speaker === old ? { ...t, speaker: next, uncertain: false } : t));
}
