import type { ChunkPlan, Turn } from "../types";

export const TRANSCRIBE_PROMPT =
  "Transcribe this meeting audio (Persian speech mixed with English technical terms).\n" +
  "Output ONLY a JSON array, with no prose and no markdown. Each item must be an object " +
  '{"start": "MM:SS", "end": "MM:SS", "speaker": "S1", "text": "..."} where start/end are ' +
  "times from the beginning of this audio and speaker is S1, S2, ... Sn, consistent within this audio.\n" +
  "Rules:\n" +
  "- Write Persian in Persian script.\n" +
  "- Keep English words and technical terms (e.g. endpoint, refactor, story point, API names) " +
  "verbatim in Latin script. Never translate them and never transliterate them into Persian script.\n" +
  "- One item per speaker turn. Never merge different speakers into one item.\n" +
  "- Transcribe only what is said. Do not invent or summarize.";

export class TranscriptParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TranscriptParseError";
  }
}

function tsMs(value: unknown): number {
  if (typeof value !== "string") throw new TranscriptParseError(`bad timestamp: ${JSON.stringify(value)}`);
  const parts = value.trim().split(":");
  const nums = parts.map((p) => (p.trim() === "" ? NaN : Number(p)));
  if (nums.some((n) => !Number.isFinite(n))) throw new TranscriptParseError(`bad timestamp: ${JSON.stringify(value)}`);
  if (nums.length === 2) nums.unshift(0);
  if (nums.length !== 3) throw new TranscriptParseError(`bad timestamp: ${JSON.stringify(value)}`);
  const [h, m, s] = nums;
  return Math.round((h * 3600 + m * 60 + s) * 1000);
}

export function parseChunkOutput(raw: string, chunk: ChunkPlan): Turn[] {
  const first = raw.indexOf("[");
  const last = raw.lastIndexOf("]");
  if (first === -1 || last <= first) throw new TranscriptParseError("no JSON array in model output");
  let data: unknown;
  try {
    data = JSON.parse(raw.slice(first, last + 1));
  } catch (e) {
    throw new TranscriptParseError(`invalid JSON: ${(e as Error).message}`);
  }
  if (!Array.isArray(data)) throw new TranscriptParseError("expected a JSON array");
  return data.map((item): Turn => {
    if (
      typeof item !== "object" || item === null || Array.isArray(item) ||
      !["start", "end", "speaker", "text"].every((k) => k in item)
    ) {
      throw new TranscriptParseError(`bad item: ${JSON.stringify(item)}`);
    }
    const it = item as Record<string, unknown>;
    if (typeof it.speaker !== "string" || typeof it.text !== "string") {
      throw new TranscriptParseError(`bad item: ${JSON.stringify(item)}`);
    }
    return {
      startMs: tsMs(it.start) + chunk.offsetMs,
      endMs: tsMs(it.end) + chunk.offsetMs,
      speaker: it.speaker,
      text: it.text,
      uncertain: false,
      chunk: chunk.index,
      label: it.speaker,
    };
  });
}

export function mergeChunks(perChunk: Turn[][], chunkS = 600, overlapS = 5): Turn[] {
  const half = overlapS * 500;
  const merged: Turn[] = [];
  perChunk.forEach((turns, k) => {
    const hi = (k + 1) * chunkS * 1000 + half;
    const lo = k * chunkS * 1000 + half;
    for (const t of turns) {
      if (t.startMs < hi && (k === 0 || t.startMs >= lo)) merged.push(t);
    }
  });
  return merged;
}

export function mmss(ms: number): string {
  const s = Math.floor(ms / 1000);
  return `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
}

export function renderTranscriptMd(turns: Turn[]): string {
  return turns
    .map((t) => `**[${mmss(t.startMs)}] ${t.speaker}:** ${t.text}` + (t.uncertain ? " *(uncertain)*" : ""))
    .join("\n") + (turns.length ? "\n" : "");
}
