import { describe, expect, it } from "vitest";
import type { Turn } from "../src/types";
import { applyNames, pickClips, voicesOf } from "../src/lib/voices";

function T(speaker: string, startMs: number, endMs: number, opts: { uncertain?: boolean; chunk?: number; text?: string } = {}): Turn {
  return { startMs, endMs, speaker, text: opts.text ?? "متن", uncertain: opts.uncertain ?? false, chunk: opts.chunk ?? 0, label: "S1" };
}

describe("voicesOf", () => {
  it("merges turns of one Meet name into one voice", () => {
    const v = voicesOf([T("دانیال", 0, 6000), T("علی", 6000, 9000), T("دانیال", 9000, 15000, { chunk: 1 })]);
    const d = v.find((x) => x.key === "دانیال")!;
    expect(v.filter((x) => x.key === "دانیال")).toHaveLength(1);
    expect(d).toMatchObject({ name: "دانیال", fromMeet: true, talkMs: 12000 });
  });

  it("drops unknown voices under the minimum, keeps longer ones with empty name", () => {
    const short = voicesOf([T("گوینده ۳", 0, 3000, { uncertain: true })]);
    expect(short).toEqual([]);
    const kept = voicesOf([T("گوینده ۳", 0, 6000, { uncertain: true })]);
    expect(kept).toHaveLength(1);
    expect(kept[0]).toMatchObject({ key: "گوینده ۳", name: "", fromMeet: false });
  });

  it("an old Speaker N label that is not uncertain is a named voice", () => {
    const v = voicesOf([T("Speaker 1", 0, 2000)]);
    expect(v[0]).toMatchObject({ name: "Speaker 1", fromMeet: true });
  });

  it("sorts by talk time and share includes dropped voices", () => {
    const v = voicesOf([
      T("علی", 0, 10000), T("سارا", 10000, 40000), T("گوینده ۱", 40000, 42000, { uncertain: true }),
    ]);
    expect(v.map((x) => x.key)).toEqual(["سارا", "علی"]);
    expect(v[0].share).toBeCloseTo(30000 / 42000);
    expect(v[1].share).toBeCloseTo(10000 / 42000);
  });
});

describe("pickClips", () => {
  it("takes one clip per chunk before repeating a chunk", () => {
    const turns = [
      T("a", 0, 9000, { chunk: 0 }), T("a", 20000, 28000, { chunk: 0 }),
      T("a", 600000, 607000, { chunk: 1 }), T("a", 1200000, 1206000, { chunk: 2 }),
    ];
    const clips = pickClips(turns, 3);
    expect(clips.map((c) => c.startMs).sort((x, y) => x - y)).toEqual([0, 600000, 1200000]);
  });

  it("clips a long turn to exactly maxMs from its start", () => {
    const [c] = pickClips([T("a", 5000, 35000, { text: "long" })]);
    expect(c).toEqual({ startMs: 5000, endMs: 17000, text: "long" });
  });

  it("uses short turns only when nothing else exists", () => {
    expect(pickClips([T("a", 0, 2000), T("a", 5000, 15000)]).map((c) => c.startMs)).toEqual([5000]);
    expect(pickClips([T("a", 0, 2000)])).toHaveLength(1);
  });

  it("reuses a chunk once every chunk is used", () => {
    const turns = [T("a", 0, 9000), T("a", 20000, 28000), T("a", 40000, 48000)];
    expect(pickClips(turns, 5)).toHaveLength(3);
  });
});

describe("applyNames", () => {
  const turns = [
    T("گوینده ۱", 0, 1000, { uncertain: true }), T("گوینده ۲", 1000, 2000, { uncertain: true }),
    T("علیرضا", 2000, 3000), T("گوینده ۴", 3000, 9000, { uncertain: true }),
  ];

  it("trims, ignores empty and leaves other speakers", () => {
    const out = applyNames(turns, { "گوینده ۱": "  علی ", "گوینده ۲": "" });
    expect(out[0]).toMatchObject({ speaker: "علی", uncertain: false });
    expect(out[1]).toMatchObject({ speaker: "گوینده ۲", uncertain: true });
    expect(out[2]).toEqual(turns[2]);
    expect(turns[0].speaker).toBe("گوینده ۱");
  });

  it("merges the same name given to two keys", () => {
    const out = applyNames(turns, { "گوینده ۱": "سینا", "گوینده ۴": "سینا" });
    const v = voicesOf(out, 0).filter((x) => x.key === "سینا");
    expect(v).toHaveLength(1);
    expect(v[0].talkMs).toBe(7000);
  });
});
