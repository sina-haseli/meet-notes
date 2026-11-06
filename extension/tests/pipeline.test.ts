import { describe, it, expect, vi } from "vitest";
import { processMeeting, type PipelineDeps } from "../src/lib/pipeline";
import { OpenRouterError } from "../src/lib/openrouter";
import type { MeetingRecord, Turn } from "../src/types";
import type { Settings } from "../src/lib/settings";

const SUMMARY_OK = "<<<SUMMARY>>>\nSummary\n<<<NOTES>>>\n# Notes";
const ONE_TURN = '[{"start":"00:01","end":"00:03","speaker":"S1","text":"hello"}]';

function rec(over: Partial<MeetingRecord> = {}): MeetingRecord {
  return {
    id: "m1", mode: "builtin", title: "T", type: "daily", startedAt: "2026-11-06T10:00:00+03:30",
    durationMs: 1200000, selfName: "S", participants: [], status: "queued", costUsd: 0,
    speakerLog: [], servicesContext: null, pcmSamples: 16000 * 1200, createdAt: 1, ...over,
  };
}

function setup(over: Partial<MeetingRecord> = {}, o: {
  key?: () => string; transcribe?: any; describe?: any; complete?: any; screens?: number;
} = {}) {
  let r = rec(over);
  const key = o.key ?? (() => "k");
  const transcribe = o.transcribe ?? vi.fn(async () => ({ text: ONE_TURN, cost: 0.01 }));
  const describe = o.describe ?? vi.fn(async () => ({ text: "A screen", cost: 0.002 }));
  const complete = o.complete ?? vi.fn(async () => ({ text: SUMMARY_OK, cost: 0.1 }));
  const screens = Array.from({ length: o.screens ?? 0 }, (_, i) => ({ atMs: (i + 1) * 1000, blob: new Blob(["x"]) }));
  const deps: PipelineDeps = {
    db: {
      getMeeting: async () => structuredClone(r),
      updateMeeting: async (_id: string, patch: Partial<MeetingRecord>) => { r = { ...r, ...patch }; return structuredClone(r); },
      getPcmRange: async (_id: string, from: number, to: number) =>
        Array.from({ length: to - from + 1 }, (_, i) => ({ seq: from + i, pcm: new Int16Array(160000) })),
      listScreens: async () => screens,
    } as any,
    settings: async () => ({ openrouterKey: key(), models: { transcribe: "mt", vision: "mv", notes: "mn" } } as Settings),
    transcribe, describe, complete,
    encode: () => new Blob(["mp3"]),
  };
  return { deps, get: () => r, transcribe, describe, complete };
}

describe("processMeeting", () => {
  it("happyPathReady", async () => {
    const s = setup({}, { screens: 2 });
    const out = await processMeeting("m1", s.deps);
    expect(out.status).toBe("ready");
    expect(out.step).toBe("done");
    expect(out.readyAt).toBeTypeOf("number");
    expect(out.chunks).toHaveLength(2);
    expect(out.turns!.length).toBeGreaterThan(0);
    expect(out.screens).toEqual([{ atMs: 1000, description: "A screen" }, { atMs: 2000, description: "A screen" }]);
    expect(out.summaryMd).toBe("Summary");
    expect(out.notesMd).toBe("# Notes");
    expect(out.error).toBeUndefined();
    expect(out.costUsd).toBeCloseTo(0.01 * 2 + 0.002 * 2 + 0.1, 9);
  });

  it("parseFailureRetriesOnceThenErrorsNamingPart", async () => {
    let n = 0;
    const transcribe = vi.fn(async () => (++n <= 1 ? { text: ONE_TURN, cost: 0.01 } : { text: "garbage", cost: 0.01 }));
    const s = setup({}, { transcribe });
    const out = await processMeeting("m1", s.deps);
    expect(out.status).toBe("error");
    expect(out.error).toBe("The transcription of part 2 came back unreadable. Press Retry.");
    expect(transcribe).toHaveBeenCalledTimes(3);
  });

  it("resumesWithoutRedoingDoneChunks", async () => {
    const t: Turn[] = [{ startMs: 1000, endMs: 2000, speaker: "S1", text: "x", uncertain: false, chunk: 0, label: "S1" }];
    const s = setup({
      pcmSamples: 16000 * 1500,
      chunks: [
        { index: 0, offsetMs: 0, durationMs: 605000 },
        { index: 1, offsetMs: 600000, durationMs: 605000 },
        { index: 2, offsetMs: 1200000, durationMs: 300000 },
      ],
      chunkTurns: [t, null, [{ ...t[0], chunk: 2, startMs: 1201000, endMs: 1202000 }]],
    });
    const out = await processMeeting("m1", s.deps);
    expect(out.status).toBe("ready");
    expect(s.transcribe).toHaveBeenCalledTimes(1);
  });

  it("retryResumesFromFailedStep", async () => {
    let n = 0;
    const complete = vi.fn(async () => {
      if (++n === 1) throw new OpenRouterError("busy", "d", 503);
      return { text: SUMMARY_OK, cost: 0.1 };
    });
    const s = setup({}, { complete, screens: 1 });
    const first = await processMeeting("m1", s.deps);
    expect(first.status).toBe("error");
    const tCalls = s.transcribe.mock.calls.length;
    const dCalls = s.describe.mock.calls.length;
    const second = await processMeeting("m1", s.deps);
    expect(second.status).toBe("ready");
    expect(second.error).toBeUndefined();
    expect(s.transcribe.mock.calls.length).toBe(tCalls);
    expect(s.describe.mock.calls.length).toBe(dCalls);
  });

  it("costKeptWhenStepFails", async () => {
    const complete = vi.fn(async () => { throw new OpenRouterError("busy", "d", 503); });
    const s = setup({}, { complete });
    const out = await processMeeting("m1", s.deps);
    expect(out.status).toBe("error");
    expect(out.error).toBe("busy");
    expect(out.costUsd).toBeCloseTo(0.02, 9);
    expect(s.get().costUsd).toBeCloseTo(0.02, 9);
  });

  it("notes format failure keeps cost and uses the format message", async () => {
    const complete = vi.fn(async () => ({ text: "no markers", cost: 0.1 }));
    const out = await processMeeting("m1", setup({}, { complete }).deps);
    expect(out.error).toBe("The notes came back in an unexpected format. Press Retry.");
    expect(out.costUsd).toBeCloseTo(0.12, 9);
  });

  it("retryReadsKeyAtRunTime", async () => {
    let key = "bad";
    const transcribe = vi.fn(async (k: string) => {
      if (k === "bad") throw new OpenRouterError("OpenRouter rejected your API key. Check it in Settings, then press Retry.", "401", 401);
      return { text: ONE_TURN, cost: 0.01 };
    });
    const s = setup({}, { key: () => key, transcribe });
    const first = await processMeeting("m1", s.deps);
    expect(first.error).toContain("rejected your API key");
    key = "good";
    const second = await processMeeting("m1", s.deps);
    expect(second.status).toBe("ready");
    expect(transcribe.mock.calls.at(-1)![0]).toBe("good");
  });

  it("emptyTranscriptAndNoScreensStillReady", async () => {
    const transcribe = vi.fn(async () => ({ text: "[]", cost: 0 }));
    const s = setup({}, { transcribe });
    const out = await processMeeting("m1", s.deps);
    expect(out.status).toBe("ready");
    expect(out.turns).toEqual([]);
    expect(out.screens).toEqual([]);
    expect(s.complete).toHaveBeenCalledTimes(1);
    expect(s.describe).not.toHaveBeenCalled();
  });

  it("emptyKeyFailsWithoutNetwork", async () => {
    const s = setup({}, { key: () => "" });
    const out = await processMeeting("m1", s.deps);
    expect(out.status).toBe("error");
    expect(out.error).toBe("Add your OpenRouter key in Settings, then press Retry.");
    expect(s.transcribe).not.toHaveBeenCalled();
    expect(s.describe).not.toHaveBeenCalled();
    expect(s.complete).not.toHaveBeenCalled();
  });

  it("servicesContextPassedToPrompt", async () => {
    const s = setup({ servicesContext: "### pay" });
    await processMeeting("m1", s.deps);
    const content = (s.complete.mock.calls[0] as any[])[2] as { text: string }[];
    expect(content[0].text).toContain("### pay");
  });

  it("zero-duration chunk is transcribed-empty without calling transcribe (R4)", async () => {
    const s = setup({ pcmSamples: 16000 * 10, chunks: [{ index: 0, offsetMs: 0, durationMs: 0 }], chunkTurns: [null] });
    const out = await processMeeting("m1", s.deps);
    expect(out.status).toBe("ready");
    expect(s.transcribe).not.toHaveBeenCalled();
  });

  it("unknown failures get the generic step message", async () => {
    const complete = vi.fn(async () => { throw new Error("boom"); });
    const out = await processMeeting("m1", setup({}, { complete }).deps);
    expect(out.error).toBe("Something went wrong while processing (notes). Press Retry.");
    expect(out.errorDetail).toBe("boom");
  });
});
