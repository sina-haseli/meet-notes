import { describe, expect, it } from "vitest";
import type { MeetingRecord, Turn } from "../src/types";
import { applyRename, helperMeetingUrl, mmss, rerunFailedPatch, speakersOf } from "../src/lib/meetingView";

const t = (speaker: string, text: string, uncertain = false): Turn => ({
  startMs: 0, endMs: 1000, speaker, text, uncertain, chunk: 0, label: "S1",
});

function rec(p: Partial<MeetingRecord>): MeetingRecord {
  return { id: "x", turns: [], summaryMd: "", notesMd: "", ...p } as MeetingRecord;
}

describe("applyRename", () => {
  it("updates turns, summary and notes", () => {
    const out = applyRename(
      rec({
        turns: [t("Speaker 1", "hi", true), t("Sara", "yo")],
        summaryMd: "Speaker 1 گفت که ...",
        notesMd: "- Speaker 1: owns the API\n- Sara",
      }),
      "Speaker 1",
      "Reza",
    );
    expect(out.turns!.map((x) => [x.speaker, x.uncertain])).toEqual([["Reza", false], ["Sara", false]]);
    expect(out.summaryMd).toBe("Reza گفت که ...");
    expect(out.notesMd).toBe("- Reza: owns the API\n- Sara");
  });

  it("inserts the new name literally ($ patterns are not expanded)", () => {
    const out = applyRename(rec({ turns: [t("Reza", "x")], summaryMd: "Reza and Reza", notesMd: "(Reza)" }), "Reza", "$1 $& $$");
    expect(out.summaryMd).toBe("$1 $& $$ and $1 $& $$");
    expect(out.notesMd).toBe("($1 $& $$)");
    expect(out.turns![0].speaker).toBe("$1 $& $$");
  });

  it("matches whole names only", () => {
    const out = applyRename(rec({ summaryMd: "Reza, Rezaei and Reza_x and AliReza" }), "Reza", "Sara");
    expect(out.summaryMd).toBe("Sara, Rezaei and Reza_x and AliReza");
    const n = applyRename(rec({ notesMd: "Speaker 1 / Speaker 10" }), "Speaker 1", "Ali");
    expect(n.notesMd).toBe("Ali / Speaker 10");
  });

  it("matches whole Persian names only", () => {
    const out = applyRename(rec({ summaryMd: "رضا و رضایی" }), "رضا", "سارا");
    expect(out.summaryMd).toBe("سارا و رضایی");
  });

  it("escapes regex characters in the old name", () => {
    const out = applyRename(rec({ summaryMd: "A.B and AxB" }), "A.B", "C");
    expect(out.summaryMd).toBe("C and AxB");
  });

  it("keeps missing documents missing", () => {
    const out = applyRename({ id: "x", turns: [t("A", "x")] } as MeetingRecord, "A", "B");
    expect(out.summaryMd).toBeUndefined();
    expect(out.notesMd).toBeUndefined();
  });
});

describe("speakersOf", () => {
  it("lists distinct speakers in order; uncertain only when every turn is", () => {
    const out = speakersOf([
      t("Speaker 1", "a", true), t("Sara", "b"), t("Speaker 1", "c", true), t("Ali", "d", true), t("Ali", "e"),
    ]);
    expect(out).toEqual([
      { name: "Speaker 1", uncertain: true },
      { name: "Sara", uncertain: false },
      { name: "Ali", uncertain: false },
    ]);
  });
});

describe("helpers", () => {
  it("mmss", () => {
    expect(mmss(65_000)).toBe("01:05");
    expect(mmss(3_725_000)).toBe("62:05");
  });
  it("helperMeetingUrl", () => {
    expect(helperMeetingUrl("http://127.0.0.1:47821/", "2026-11-06 a")).toBe(
      "http://127.0.0.1:47821/meetings/2026-11-06%20a",
    );
  });
  it("helperMeetingUrl is null without a helper URL (no relative link)", () => {
    expect(helperMeetingUrl("", "a")).toBeNull();
    expect(helperMeetingUrl("  ", "a")).toBeNull();
  });
  it("rerunFailedPatch turns a ready-without-notes meeting into a retryable error", () => {
    expect(rerunFailedPatch("offscreen gone")).toEqual({
      status: "error",
      error: "The notes could not be written again. Press Retry.",
      errorDetail: "offscreen gone",
    });
    expect(rerunFailedPatch(undefined).errorDetail).toBeUndefined();
  });
});
