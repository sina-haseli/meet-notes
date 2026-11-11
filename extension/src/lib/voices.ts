import type { Turn } from "../types";
import { UNKNOWN_PREFIX } from "./speakers";

export { UNKNOWN_PREFIX };

export interface Clip { startMs: number; endMs: number; text: string }
export interface Voice { key: string; name: string; fromMeet: boolean; talkMs: number; share: number; clips: Clip[] }

const dur = (t: Turn) => Math.max(0, t.endMs - t.startMs);

export function pickClips(turns: Turn[], maxClips = 5, minMs = 4000, maxMs = 12000): Clip[] {
  const long = turns.filter((t) => dur(t) >= minMs);
  const pool = long.length ? long : turns;
  const byChunk = new Map<number, Turn[]>();
  for (const t of pool) {
    const list = byChunk.get(t.chunk);
    if (list) list.push(t); else byChunk.set(t.chunk, [t]);
  }
  const queues = [...byChunk.values()]
    .map((l) => l.sort((a, b) => dur(b) - dur(a)))
    .sort((a, b) => dur(b[0]) - dur(a[0]));
  const picked: Turn[] = [];
  for (let round = 0; picked.length < maxClips; round++) {
    let added = false;
    for (const q of queues) {
      if (picked.length >= maxClips) break;
      if (round < q.length) { picked.push(q[round]); added = true; }
    }
    if (!added) break;
  }
  return picked
    .sort((a, b) => a.startMs - b.startMs)
    .map((t) => ({ startMs: t.startMs, endMs: Math.min(t.endMs, t.startMs + maxMs), text: t.text }));
}

export function voicesOf(turns: Turn[], minTalkMs = 5000, maxClips = 5): Voice[] {
  const groups = new Map<string, Turn[]>();
  let total = 0;
  for (const t of turns) {
    total += dur(t);
    const g = groups.get(t.speaker);
    if (g) g.push(t); else groups.set(t.speaker, [t]);
  }
  const voices: Voice[] = [];
  for (const [key, list] of groups) {
    const unknown = list.every((t) => t.uncertain);
    const talkMs = list.reduce((s, t) => s + dur(t), 0);
    if (unknown && talkMs < minTalkMs) continue;
    voices.push({
      key, name: unknown ? "" : key, fromMeet: !unknown, talkMs,
      share: total > 0 ? talkMs / total : 0, clips: pickClips(list, maxClips),
    });
  }
  return voices.sort((a, b) => b.talkMs - a.talkMs);
}

export function applyNames(turns: Turn[], names: Record<string, string>): Turn[] {
  return turns.map((t) => {
    const name = (names[t.speaker] ?? "").trim();
    return name ? { ...t, speaker: name, uncertain: false } : t;
  });
}
