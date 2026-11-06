import { describe, it, expect } from "vitest";
import type { MeetingRecord, Turn } from "../src/types";
import { localIso } from "../src/lib/localIso";
import {
  badgeFor,
  dateLine,
  displayTitle,
  fmtTimer,
  progressFor,
  stepText,
  stripMeetSuffix,
} from "../src/lib/popupView";
import { keyCheckText } from "../src/lib/setupFlow";
import { checkKey } from "../src/lib/openrouter";

function rec(patch: Partial<MeetingRecord> = {}): MeetingRecord {
  return {
    id: "m1",
    mode: "builtin",
    title: "Daily standup",
    type: "daily",
    startedAt: localIso(new Date(2026, 10, 6, 10, 0).getTime()),
    durationMs: 14 * 60_000,
    selfName: "Sina",
    participants: [],
    status: "ready",
    costUsd: 0,
    speakerLog: [],
    servicesContext: null,
    pcmSamples: 0,
    createdAt: 1,
    ...patch,
  };
}

const turn: Turn = { startMs: 0, endMs: 1, speaker: "A", text: "x", uncertain: false, chunk: 0, label: "" };
const chunks = (n: number) => Array.from({ length: n }, (_, i) => ({ index: i, offsetMs: i, durationMs: 1 }));

describe("popupView", () => {
  it("transcribingStepCountsDoneChunks", () => {
    const r = rec({ status: "processing", step: "transcribing", chunks: chunks(6), chunkTurns: [[turn], null, null, null, null, null] });
    expect(stepText(r)).toBe("Transcribing part 2 of 6…");
    // All transcribed: capped at n.
    const all = rec({ status: "processing", step: "transcribing", chunks: chunks(2), chunkTurns: [[turn], []] });
    expect(stepText(all)).toBe("Transcribing part 2 of 2…");
  });

  it("otherStepTexts", () => {
    expect(stepText(rec({ status: "processing", step: "screens" }))).toBe("Describing screens…");
    expect(stepText(rec({ status: "processing", step: "notes" }))).toBe("Writing notes…");
    expect(stepText(rec({ status: "queued" }))).toBe("Queued…");
    expect(stepText(rec({ status: "ready" }))).toBeNull();
  });

  it("progressGrowsWithSteps", () => {
    const t1 = progressFor(rec({ status: "processing", step: "transcribing", chunks: chunks(4), chunkTurns: [null, null, null, null] }));
    const t2 = progressFor(rec({ status: "processing", step: "transcribing", chunks: chunks(4), chunkTurns: [[], [], null, null] }));
    const sc = progressFor(rec({ status: "processing", step: "screens" }));
    const no = progressFor(rec({ status: "processing", step: "notes" }));
    expect(t1).toBeLessThan(t2);
    expect(t2).toBeLessThan(sc);
    expect(sc).toBeLessThan(no);
    expect(no).toBeLessThan(1);
  });

  it("dateLineTodayYesterdayOlder", () => {
    const now = new Date(2026, 10, 6, 18, 30);
    expect(dateLine(rec(), now)).toBe("Today 10:00 · 14 min");
    const y = rec({ startedAt: localIso(new Date(2026, 10, 5, 9, 5).getTime()), durationMs: 52 * 60_000 });
    expect(dateLine(y, now)).toBe("Yesterday 09:05 · 52 min");
    const old = rec({ startedAt: localIso(new Date(2026, 9, 28, 14, 0).getTime()), durationMs: 75 * 60_000 });
    expect(dateLine(old, now)).toBe("Oct 28 14:00 · 1 h 15 min");
    expect(dateLine(rec({ durationMs: 20_000 }), now)).toBe("Today 10:00 · <1 min");
    expect(dateLine(rec({ status: "recording", durationMs: 0 }), now)).toBe("Today 10:00 · recording now");
  });

  it("badges", () => {
    expect(badgeFor(rec())).toEqual({ cls: "ready", text: "Ready" });
    expect(badgeFor(rec({ status: "queued" }))).toEqual({ cls: "processing", text: "Queued" });
    expect(badgeFor(rec({ status: "processing" }))).toEqual({ cls: "processing", text: "Processing" });
    expect(badgeFor(rec({ status: "error" }))).toEqual({ cls: "error", text: "Failed" });
    expect(badgeFor(rec({ status: "interrupted" }))).toEqual({ cls: "interrupted", text: "Interrupted" });
    expect(badgeFor(rec({ status: "recording" }))).toEqual({ cls: "recording", text: "Recording" });
  });

  it("titles", () => {
    expect(displayTitle(rec({ title: "  " }))).toBe("Daily meeting");
    expect(stripMeetSuffix("Sprint 42 grooming - Google Meet")).toBe("Sprint 42 grooming");
    expect(stripMeetSuffix("Meet - abc-defg-hij")).toBe("Meet - abc-defg-hij");
    expect(stripMeetSuffix("Google Meet")).toBe("");
  });

  it("timer", () => {
    expect(fmtTimer(65_000)).toBe("01:05");
    expect(fmtTimer(3_725_000)).toBe("1:02:05");
  });

  it("keyCheckText", () => {
    expect(keyCheckText({ ok: true, remainingUsd: 1.981 })).toBe("Connected · $1.98 left");
    expect(keyCheckText({ ok: true, remainingUsd: null })).toBe("Connected");
    expect(keyCheckText({ ok: false, userMessage: "Nope." })).toBe("Nope.");
  });

  it("keyCheckTextRejectedKeyFromRealCheck", async () => {
    const deps = {
      fetch: (async () => new Response("unauthorized", { status: 401 })) as unknown as typeof fetch,
      sleep: async () => undefined,
    };
    const res = await checkKey("sk-bad", deps);
    expect(keyCheckText(res)).toBe("OpenRouter rejected your API key. Check that you pasted the whole key.");
  });
});
