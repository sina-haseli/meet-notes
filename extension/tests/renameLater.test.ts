import { describe, it, expect } from "vitest";
import { renamePatch, renameVoices } from "../src/lib/renameLater";
import type { Report } from "../src/lib/report";
import type { MeetingRecord, Turn } from "../src/types";

const turn = (speaker: string, startMs: number, endMs: number, uncertain = false): Turn =>
  ({ startMs, endMs, speaker, text: "متن", uncertain, chunk: 0, label: "S1" });

const report: Report = {
  title: "جلسه با دانیال",
  summary: ["دانیال گفت که سینا کار را تمام کند. نظر دانیال‌ها مهم نیست."],
  decisions: [{ text: "سینا مسئول است", at: "01:00" }],
  actions: [{ text: "ویرایش من", owner: "دانیال", due: "" }],
  topics: [{ heading: "موضوع", body: "گوینده ۱ پرسید" }],
  people: [], followUps: [], codeServices: [],
};

const rec = {
  turns: [
    turn("دانیال", 0, 60_000), turn("سینا", 60_000, 90_000), turn("گوینده ۱", 90_000, 100_000, true),
    turn("دانیال", 100_000, 110_000),
  ],
  speakerLog: [{ name: "دانیال", start_ms: 0, end_ms: 60_000 }],
  report,
  notesMd: "Daniel: دانیال owns it. سینا reviews.",
} as unknown as MeetingRecord;

describe("renameVoices", () => {
  it("groups by current name and marks only names that came from Google Meet", () => {
    const v = renameVoices(rec);
    expect(v.map((x) => [x.key, x.name, x.fromMeet])).toEqual([
      ["دانیال", "دانیال", true],
      ["سینا", "سینا", false], // given by the user when the names were confirmed
      ["گوینده ۱", "", false],
    ]);
  });
});

describe("renamePatch", () => {
  it("returns null when nothing changed or a box was left empty", () => {
    expect(renamePatch(rec, { "دانیال": "دانیال", "سینا": "  ", "گوینده ۱": "" })).toBeNull();
  });

  it("renames turns, every report field and the notes, whole-word, keeping other edits", () => {
    const p = renamePatch(rec, { "دانیال": "دانیال", "سینا": "سینا حسلی", "گوینده ۱": "مهران" })!;
    expect(p.turns!.map((t) => [t.speaker, t.uncertain])).toEqual([
      ["دانیال", false], ["سینا حسلی", false], ["مهران", false], ["دانیال", false],
    ]);
    expect(p.report!.summary[0]).toBe("دانیال گفت که سینا حسلی کار را تمام کند. نظر دانیال‌ها مهم نیست.");
    expect(p.report!.decisions[0]).toEqual({ text: "سینا حسلی مسئول است", at: "01:00" });
    expect(p.report!.topics[0].body).toBe("مهران پرسید");
    expect(p.report!.actions[0]).toEqual({ text: "ویرایش من", owner: "دانیال", due: "" });
    expect(p.notesMd).toBe("Daniel: دانیال owns it. سینا حسلی reviews.");
  });

  it("swaps two names instead of merging them", () => {
    const p = renamePatch(rec, { "دانیال": "سینا", "سینا": "دانیال" })!;
    expect(p.turns!.map((t) => t.speaker)).toEqual(["سینا", "دانیال", "گوینده ۱", "سینا"]);
    expect(p.report!.title).toBe("جلسه با سینا");
    expect(p.report!.decisions[0].text).toBe("دانیال مسئول است");
    expect(p.report!.actions[0].owner).toBe("سینا");
  });

  it("leaves a missing report or notes absent", () => {
    const p = renamePatch({ ...rec, report: undefined, notesMd: undefined }, { "سینا": "علی" })!;
    expect("report" in p).toBe(false);
    expect("notesMd" in p).toBe(false);
    expect(p.turns![1].speaker).toBe("علی");
  });
});
