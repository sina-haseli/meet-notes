import { describe, expect, it } from "vitest";
import type { MeetingRecord } from "../src/types";
import { gmailComposeUrl, meetingSubject } from "../src/lib/gmail";

const base = { type: "grooming", startedAt: "2026-11-06T23:30:00.000+03:30" } as MeetingRecord;

describe("gmail", () => {
  it("builds a compose URL whose subject round-trips (Persian and &)", () => {
    const subject = "جلسه R&D — 2026-11-06";
    const url = gmailComposeUrl(subject);
    expect(url.startsWith("https://mail.google.com/mail/?view=cm&fs=1&su=")).toBe(true);
    const u = new URL(url);
    expect(u.searchParams.get("su")).toBe(subject);
    expect(u.searchParams.get("view")).toBe("cm");
    expect(u.searchParams.get("fs")).toBe("1");
  });

  it("subject is the title and the local date", () => {
    expect(meetingSubject({ ...base, title: " Sprint 42 " })).toBe("Sprint 42 — 2026-11-06");
  });

  it("subject falls back to the type label", () => {
    expect(meetingSubject({ ...base, title: "" })).toBe("Grooming — 2026-11-06");
  });
});
