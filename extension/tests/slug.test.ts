import { describe, it, expect } from "vitest";
import { slugify, meetingId } from "../src/lib/slug";

describe("slugify", () => {
  it("keeps Persian and strips Windows-illegal chars", () => {
    expect(slugify('Wallet top-up: v2 / "شارژ"')).toBe("Wallet-top-up-v2-شارژ");
    expect(slugify("   ")).toBe("meeting");
  });
  it("strips backslash", () => {
    expect(slugify("a\\b")).toBe("a-b");
  });
  it("caps length at 80 without trailing dash", () => {
    expect(slugify("x".repeat(200)).length).toBe(80);
    const s = slugify("a".repeat(79) + " tail");
    expect(s).toBe("a".repeat(79));
    expect(s.endsWith("-")).toBe(false);
  });
});

describe("meetingId", () => {
  it("builds date_type_slug", () => {
    expect(meetingId("2026-11-06T10:00:00+03:30", "planning", "Sprint 12", () => false)).toBe(
      "2026-11-06_planning_Sprint-12",
    );
  });
  it("omits the slug when the title is empty", () => {
    expect(meetingId("2026-11-06T10:00:00+03:30", "daily", "  ", () => false)).toBe("2026-11-06_daily");
  });
  it("meetingIdAddsSuffix", () => {
    const taken = new Set(["2026-11-06_planning_Sprint-12"]);
    expect(meetingId("2026-11-06T10:00:00+03:30", "planning", "Sprint 12", (i) => taken.has(i))).toBe(
      "2026-11-06_planning_Sprint-12-2",
    );
    taken.add("2026-11-06_planning_Sprint-12-2");
    expect(meetingId("2026-11-06T10:00:00+03:30", "planning", "Sprint 12", (i) => taken.has(i))).toBe(
      "2026-11-06_planning_Sprint-12-3",
    );
  });
});
