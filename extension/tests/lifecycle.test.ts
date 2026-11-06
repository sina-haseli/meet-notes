import { describe, it, expect } from "vitest";
import type { MeetingRecord, MeetingStatus } from "../src/types";
import {
  failedRunPatch,
  helperUploadUrl,
  isStuck,
  meetingPageOpen,
  shouldResumeOnPoll,
  STUCK_ERROR,
  recordsInterrupted,
  recordsToResume,
  shouldCloseOffscreen,
} from "../src/lib/lifecycle";
import { UPLOAD_URL } from "../src/messages";

function rec(id: string, status: MeetingStatus, createdAt: number, mode: "builtin" | "helper" = "builtin"): MeetingRecord {
  return {
    id,
    mode,
    title: "",
    type: "technical",
    startedAt: "2026-11-06T10:00:00.000+03:30",
    durationMs: 0,
    selfName: "",
    participants: [],
    status,
    costUsd: 0,
    speakerLog: [],
    servicesContext: null,
    pcmSamples: 0,
    createdAt,
  };
}

describe("shouldCloseOffscreen", () => {
  const idle = { recording: false, processing: false, queued: 0, helperUploadPending: false };

  it("offscreenStaysWhileProcessing", () => {
    expect(shouldCloseOffscreen({ ...idle, processing: true })).toBe(false);
    expect(shouldCloseOffscreen({ ...idle, recording: true })).toBe(false);
    expect(shouldCloseOffscreen(idle)).toBe(true);
  });

  it("offscreenStaysWhileQueuedOrHelperUploadPending", () => {
    expect(shouldCloseOffscreen({ ...idle, queued: 2 })).toBe(false);
    expect(shouldCloseOffscreen({ ...idle, helperUploadPending: true })).toBe(false);
  });
});

describe("recordsToResume", () => {
  it("resumeQueueOnStartup", () => {
    const all = [
      rec("new-queued", "queued", 300),
      rec("ready", "ready", 50),
      rec("old-processing", "processing", 100),
      rec("helper-queued", "queued", 10, "helper"),
      rec("err", "error", 20),
      rec("rec", "recording", 30),
      rec("int", "interrupted", 40),
      rec("mid-queued", "queued", 200),
    ];
    expect(recordsToResume(all)).toEqual(["old-processing", "mid-queued", "new-queued"]);
  });

  it("returnsNothingForAnEmptyStore", () => {
    expect(recordsToResume([])).toEqual([]);
  });
});

describe("recordsInterrupted", () => {
  it("interruptedExcludesLive", () => {
    const all = [
      rec("live", "recording", 300),
      rec("stale-a", "recording", 100),
      rec("stale-b", "recording", 200),
      rec("helper-rec", "recording", 50, "helper"),
      rec("queued", "queued", 60),
      rec("already", "interrupted", 70),
    ];
    expect(recordsInterrupted(all, "live").sort()).toEqual(["stale-a", "stale-b"]);
    expect(recordsInterrupted(all, undefined).sort()).toEqual(["live", "stale-a", "stale-b"]);
  });
});

describe("meetingPageOpen", () => {
  const page = "chrome-extension://abc/dist/meeting.html";

  it("matchesTheMeetingTabById", () => {
    const id = "2026-11-06_daily_شارژ";
    const urls = [`${page}?id=${encodeURIComponent(id)}`];
    expect(meetingPageOpen(urls, page, id)).toBe(true);
    expect(meetingPageOpen(urls, page, "2026-11-06_daily")).toBe(false);
  });

  it("ignoresOtherPagesAndBadUrls", () => {
    expect(meetingPageOpen(["chrome-extension://abc/dist/meetings.html?id=x", "not a url"], page, "x")).toBe(false);
    expect(meetingPageOpen([], page, "x")).toBe(false);
  });
});

describe("helperUploadUrl", () => {
  it("defaultHelperUrlGivesTheV1UploadUrl", () => {
    expect(helperUploadUrl("http://127.0.0.1:47821")).toBe(UPLOAD_URL);
    expect(helperUploadUrl("http://127.0.0.1:47821/")).toBe(UPLOAD_URL);
  });

  it("emptyUrlFallsBackToTheDefault", () => {
    expect(helperUploadUrl("")).toBe(UPLOAD_URL);
    expect(helperUploadUrl("  ")).toBe(UPLOAD_URL);
  });
});

describe("isStuck", () => {
  it("queuedOrProcessingWithoutOffscreenIsStuck", () => {
    expect(isStuck(rec("a", "processing", 1), false)).toBe(true);
    expect(isStuck(rec("a", "queued", 1), false)).toBe(true);
  });

  it("liveOffscreenOrOtherStatusesAreNotStuck", () => {
    expect(isStuck(rec("a", "processing", 1), true)).toBe(false);
    expect(isStuck(rec("a", "queued", 1), true)).toBe(false);
    for (const st of ["recording", "interrupted", "ready", "error"] as const) {
      expect(isStuck(rec("a", st, 1), false)).toBe(false);
    }
    expect(isStuck(rec("h", "processing", 1, "helper"), false)).toBe(false);
  });
});

describe("failedRunPatch", () => {
  it("aFailedRunLeftProcessingBecomesAnError", () => {
    expect(failedRunPatch(rec("a", "processing", 1), false)).toEqual({ status: "error", error: STUCK_ERROR });
    expect(STUCK_ERROR).toBe("Something went wrong while processing. Press Retry.");
  });

  it("leavesSavedErrorsAndSuccessfulRunsAlone", () => {
    expect(failedRunPatch(rec("a", "error", 1), false)).toBeNull();
    expect(failedRunPatch(rec("a", "ready", 1), false)).toBeNull();
    expect(failedRunPatch(rec("a", "processing", 1), true)).toBeNull();
    expect(failedRunPatch(undefined, false)).toBeNull();
  });
});

describe("shouldResumeOnPoll", () => {
  it("resumesOnlyWhenRowsWaitAndNoOffscreenRuns", () => {
    const all = [rec("r", "ready", 1), rec("q", "queued", 2)];
    expect(shouldResumeOnPoll(all, false)).toBe(true);
    expect(shouldResumeOnPoll(all, true)).toBe(false);
    expect(shouldResumeOnPoll([rec("r", "ready", 1), rec("e", "error", 2)], false)).toBe(false);
  });
});
