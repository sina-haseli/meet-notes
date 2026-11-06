import { describe, expect, it } from "vitest";
import type { ChunkPlan, Turn } from "../src/types";
import {
  TRANSCRIBE_PROMPT, TranscriptParseError, mergeChunks, parseChunkOutput, renderTranscriptMd,
} from "../src/lib/transcript";

const chunkAt600s: ChunkPlan = { index: 1, offsetMs: 600000, durationMs: 5000 };

const RAW = '```json\n[{"start":"00:03","end":"00:09","speaker":"S1","text":"این endpoint رو باید refactor کنیم"},' +
  '{"start":"01:02","end":"01:05","speaker":"S2","text":"۵ story point"}]\n```';

function T(startMs: number, endMs: number, speaker: string, text: string, o: Partial<Turn> = {}): Turn {
  return { startMs, endMs, speaker, text, uncertain: false, chunk: 0, label: "", ...o };
}

describe("transcript", () => {
  it("parse strips fences and offsets", () => {
    const turns = parseChunkOutput(RAW, chunkAt600s);
    expect(turns[0].startMs).toBe(603000);
    expect(turns[0].label).toBe("S1");
    expect(turns[0].chunk).toBe(1);
    expect(turns[0].speaker).toBe("S1");
    expect(turns[1].startMs).toBe(662000);
    expect(turns[0].text).toContain("endpoint");
    expect(turns[0].text).toContain("refactor");
  });

  it("parse bare array, prose around it, and H:MM:SS", () => {
    const arr = '[{"start":"01:00:01","end":"01:00:02","speaker":"S1","text":"x"}]';
    expect(parseChunkOutput(arr, chunkAt600s)[0].startMs).toBe(3601000 + 600000);
    expect(parseChunkOutput("Here you go:\n" + arr + "\nDone.", chunkAt600s)[0].text).toBe("x");
  });

  it("parseEmptyArray", () => {
    expect(parseChunkOutput("[]", chunkAt600s)).toEqual([]);
  });

  it.each([
    "sorry I can't", '{"a":1}', "[1,2]", '[{"start":"00:01","end":"00:02","speaker":"S1"}]',
    '[{"start":"bad","end":"00:02","speaker":"S1","text":"t"}]',
  ])("parse garbage raises: %s", (raw) => {
    expect(() => parseChunkOutput(raw, chunkAt600s)).toThrow(TranscriptParseError);
  });

  it("merge uses overlap midpoint", () => {
    const a = [T(598000, 604000, "S1", "end of a", { chunk: 0, label: "S1" })];
    const b = [
      T(601000, 604000, "S1", "dup", { chunk: 1, label: "S1" }),
      T(603000, 610000, "S2", "b", { chunk: 1, label: "S2" }),
    ];
    expect(mergeChunks([a, b], 600, 5).map((t) => t.text)).toEqual(["end of a", "b"]);
  });

  it("render", () => {
    const md = renderTranscriptMd([
      T(65000, 70000, "Sina", "سلام API", { uncertain: true }),
      T(0, 1000, "Ali", "hi"),
    ]);
    const lines = md.split("\n");
    expect(lines[0]).toBe("**[01:05] Sina:** سلام API *(uncertain)*");
    expect(lines[1]).toBe("**[00:00] Ali:** hi");
    expect(renderTranscriptMd([])).toBe("");
  });

  it("prompt requires Latin terms", () => {
    expect(TRANSCRIBE_PROMPT).toContain("Latin");
    expect(TRANSCRIBE_PROMPT).toContain("JSON");
  });
});
