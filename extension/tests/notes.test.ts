import { describe, it, expect } from "vitest";
import { buildNotesPrompt, splitNotesOutput, NotesError, NOTES_MAX_TOKENS } from "../src/lib/notes";
import { TEMPLATES } from "../src/lib/templates";
import type { MeetingType } from "../src/types";

describe("splitNotesOutput", () => {
  it("splits summary and notes", () => {
    expect(splitNotesOutput("<<<SUMMARY>>>\nسلام\n<<<NOTES>>>\n# T\n")).toEqual({ summaryMd: "سلام", notesMd: "# T" });
  });
  it.each(["just text", "<<<SUMMARY>>>\nx", "<<<SUMMARY>>>\n\n<<<NOTES>>>\nN", "<<<SUMMARY>>>\nE\n<<<NOTES>>>\n  \n"])(
    "bad output raises: %j", (text) => {
      expect(() => splitNotesOutput(text)).toThrow(NotesError);
    });
});

describe("buildNotesPrompt", () => {
  const types: MeetingType[] = ["grooming", "planning", "technical", "daily"];
  it.each(types)("promptHasTemplateInfoScreensTranscript %s", (type) => {
    const p = buildNotesPrompt(
      { title: "W", type, startedAt: "2026-11-06T10:00:00", durationMs: 300000, participants: ["Reza", "Sina"] },
      "**[00:03] Reza:** hi",
      [{ atMs: 500, description: "Figma" }],
      null,
    );
    expect(p).toContain(`## Meeting type: ${type}`);
    expect(p).toContain("Duration: 05:00");
    expect(p).toContain("- screens/500.jpg [00:00]: Figma");
    expect(p).toContain("**[00:03] Reza:** hi");
    expect(p).toContain("2026-11-06");
    expect(p).toContain("## Services context\n(none)");
  });
  it("includes services context", () => {
    const p = buildNotesPrompt({ title: "W", type: "daily", startedAt: "2026-11-06T10:00:00", durationMs: 0, participants: [] }, "t", [], "### svc");
    expect(p).toContain("## Services context\n### svc");
    expect(p).toContain("## Screenshots\n(none)");
  });
  it("has a token cap", () => expect(NOTES_MAX_TOKENS).toBe(16000));
});

describe("templates", () => {
  it("dailyTemplateSections", () => {
    const d = TEMPLATES.daily;
    for (const s of ["## Per person", "## Blockers", "دیروز", "امروز", "موانع"]) expect(d).toContain(s);
    expect(d).not.toContain("Story points");
  });
  it("noReadGrepGlobInTemplates", () => {
    for (const t of Object.values(TEMPLATES)) expect(t).not.toContain("Read, Grep, Glob");
  });
  it("use the new markers", () => {
    for (const t of Object.values(TEMPLATES)) {
      expect(t).toContain("<<<SUMMARY>>>");
      expect(t).not.toContain("<<<EMAIL>>>");
    }
  });
});
