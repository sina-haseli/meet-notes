import { describe, expect, it } from "vitest";
import type { Turn } from "../src/types";
import { assignSpeakers, renameSpeaker } from "../src/lib/speakers";

function T(s: number, e: number, label: string, chunk = 0): Turn {
  return { startMs: s, endMs: e, speaker: label, text: "x", uncertain: false, chunk, label };
}
function U(s: number, e: number, speaker: string, text: string, uncertain = false): Turn {
  return { startMs: s, endMs: e, speaker, text, uncertain, chunk: 0, label: "" };
}
const iv = (name: string, start_ms: number, end_ms: number) => ({ name, start_ms, end_ms });

describe("speakers", () => {
  it("label maps to dominant name", () => {
    const log = [iv("Reza", 0, 5000), iv("Sara", 5000, 9000)];
    const out = assignSpeakers([T(0, 4800, "S1"), T(5100, 8900, "S2")], log);
    expect(out.map((t) => [t.speaker, t.uncertain])).toEqual([["Reza", false], ["Sara", false]]);
  });

  it("no log gives numbered uncertain speakers", () => {
    const out = assignSpeakers([T(0, 1000, "S1"), T(1000, 2000, "S2"), T(2000, 3000, "S1")], []);
    expect(out.map((t) => t.speaker)).toEqual(["گوینده ۱", "گوینده ۲", "گوینده ۱"]);
    expect(out.every((t) => t.uncertain)).toBe(true);
  });

  it("same label in different chunks mapped independently", () => {
    const log = [iv("Reza", 0, 1000), iv("Sara", 600000, 601000)];
    const out = assignSpeakers([T(0, 1000, "S1", 0), T(600000, 601000, "S1", 1)], log);
    expect(out.map((t) => t.speaker)).toEqual(["Reza", "Sara"]);
  });

  it("rename merges into existing name and clears uncertain", () => {
    const out = renameSpeaker([U(0, 1, "گوینده ۴", "a", true), U(1, 2, "Reza", "b")], "گوینده ۴", "Reza");
    expect(new Set(out.map((t) => t.speaker))).toEqual(new Set(["Reza"]));
    expect(out.some((t) => t.uncertain)).toBe(false);
  });

  it("split overlap below share is uncertain and numbering is global", () => {
    const log = [iv("Reza", 0, 2000), iv("Sara", 2000, 4000)];
    const out = assignSpeakers([T(0, 4000, "S1", 0), T(0, 4000, "S1", 1), T(0, 4000, "S2", 1)], log);
    expect(out.map((t) => t.speaker)).toEqual(["گوینده ۱", "گوینده ۲", "گوینده ۳"]);
    expect(out.every((t) => t.uncertain)).toBe(true);
  });

  it("overlap below minimum is uncertain", () => {
    const out = assignSpeakers([T(0, 500, "S1")], [iv("Reza", 0, 500)]);
    expect(out[0].speaker).toBe("گوینده ۱");
    expect(out[0].uncertain).toBe(true);
  });

  it("inputs not mutated and rename leaves others", () => {
    const turns = [T(0, 1000, "S1")];
    assignSpeakers(turns, []);
    expect(turns[0].speaker).toBe("S1");
    const out = renameSpeaker([U(0, 1, "A", "a", true), U(1, 2, "B", "b", true)], "A", "C");
    expect(out.map((t) => [t.speaker, t.uncertain])).toEqual([["C", false], ["B", true]]);
  });

  it("partial log coverage is uncertain", () => {
    const log = [iv("Sina", 10000, 10850), iv("Sina", 30000, 30850)];
    const out = assignSpeakers([T(0, 60000, "S2")], log);
    expect(out[0].speaker).toBe("گوینده ۱");
    expect(out[0].uncertain).toBe(true);
  });

  it("coverage counts all turns of the label", () => {
    const log = [iv("Reza", 0, 3000)];
    let out = assignSpeakers([T(0, 3000, "S1"), T(10000, 12000, "S1")], log);
    expect(out.map((t) => [t.speaker, t.uncertain])).toEqual([["Reza", false], ["Reza", false]]);
    out = assignSpeakers([T(0, 3000, "S1"), T(10000, 14000, "S1")], log);
    expect(out.every((t) => t.speaker === "گوینده ۱" && t.uncertain)).toBe(true);
  });
});
