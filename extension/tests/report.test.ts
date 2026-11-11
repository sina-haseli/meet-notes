import { describe, it, expect } from "vitest";
import {
  parseReport, faNum, faDuration, jalaliDate, speakerStats, renameInReport,
  reportToMarkdown, reportToHtml, type Report,
} from "../src/lib/report";
import { NotesError } from "../src/lib/notes";
import type { Turn } from "../src/types";

const turn = (speaker: string, startMs: number, endMs: number, text: string, uncertain = false): Turn =>
  ({ startMs, endMs, speaker, text, uncertain, chunk: 0, label: speaker });

const empty: Report = {
  title: "", summary: [], decisions: [], actions: [], topics: [], people: [], followUps: [], codeServices: [],
};
const rec = { startedAt: "2026-11-11T10:00:00+03:30", durationMs: 2989000, type: "grooming" as const };

describe("parseReport", () => {
  it("accepts the object inside prose or a json fence", () => {
    expect(parseReport('بفرمایید {"title":"الف"} تمام').title).toBe("الف");
    expect(parseReport('```json\n{"title":"ب"}\n```').title).toBe("ب");
  });
  it("fills missing arrays, nulls, numbers and drops unknown fields", () => {
    const r = parseReport(JSON.stringify({
      title: "t", extra: 1,
      actions: [{ text: "x", owner: null, due: 5, junk: true }],
      summary: "یک پاراگراف",
    }));
    expect(r.summary).toEqual(["یک پاراگراف"]);
    expect(r.decisions).toEqual([]);
    expect(r.actions).toEqual([{ text: "x", owner: "", due: "5" }]);
    expect("extra" in r).toBe(false);
    expect("junk" in r.actions[0]).toBe(false);
  });
  it("strips brackets and spaces around `at`", () => {
    const r = parseReport(JSON.stringify({
      decisions: [{ text: "a", at: "[12:40]" }, { text: "b", at: " [ 03:05 ] " }, { text: "c", at: "[]" }],
      actions: [{ text: "x", owner: "", due: "", at: "[01:02]" }],
      followUps: [{ text: "f", at: " 07:08 " }],
    }));
    expect(r.decisions).toEqual([{ text: "a", at: "12:40" }, { text: "b", at: "03:05" }, { text: "c" }]);
    expect(r.actions[0].at).toBe("01:02");
    expect(r.followUps[0].at).toBe("07:08");
  });
  it("throws NotesError without an object", () => {
    expect(() => parseReport("no json")).toThrow(NotesError);
  });
});

describe("formatting", () => {
  it("formats durations and numbers", () => {
    expect(faDuration(2989000)).toBe("۴۹ دقیقه ۴۹ ثانیه");
    expect(faDuration(46000)).toBe("۴۶ ثانیه");
    expect(faDuration(3720000)).toBe("۱ ساعت ۲ دقیقه");
    expect(faNum(6164)).toBe("۶٬۱۶۴");
    expect(faNum(70.9, 1)).toBe("۷۰٫۹");
  });
  it("gives the Jalali calendar day written in the ISO string", () => {
    expect(jalaliDate("2026-11-11T10:00:00+03:30")).toBe("۲۰ آبان ۱۴۰۵");
  });
});

describe("speakerStats", () => {
  it("sums talk time and words, shares add to 1, sorted by talk", () => {
    const s = speakerStats([
      turn("A", 0, 1000, "یک دو"), turn("B", 1000, 4000, "سه چهار پنج"), turn("A", 4000, 5000, "شش"),
    ]);
    expect(s.speakers.map((x) => x.name)).toEqual(["B", "A"]);
    expect(s.speakers[0]).toMatchObject({ talkMs: 3000, words: 3 });
    expect(s.speakers[1]).toMatchObject({ talkMs: 2000, words: 3 });
    expect(s.words).toBe(6);
    expect(s.totalMs).toBe(5000);
    expect(s.speakers.reduce((a, x) => a + x.share, 0)).toBeCloseTo(1);
  });
});

describe("renameInReport", () => {
  it("renames whole words only", () => {
    const r = renameInReport({
      ...empty, summary: ["علی گفت"], actions: [{ text: "کار", owner: "علی", due: "" }],
      followUps: [{ text: "با علیرضا" }],
    }, "علی", "Ali");
    expect(r.summary[0]).toBe("Ali گفت");
    expect(r.actions[0].owner).toBe("Ali");
    expect(r.followUps[0].text).toBe("با علیرضا");
  });
});

describe("reportToHtml", () => {
  const turns = [turn("علی", 0, 3000, "سلام دنیا")];
  it("escapes, omits empty sections, honours timestamps", () => {
    const r = { ...empty, title: "T", decisions: [{ text: "<img src=x onerror=alert(1)>", at: "05:07" }] };
    const html = reportToHtml(r, rec, turns);
    expect(html).toContain("&lt;img");
    expect(html).not.toContain("<img");
    expect(html).toContain("[۰۵:۰۷]");
    expect(html).not.toContain("اقدام‌ها");
    expect(html).toContain("ساخته‌شده با Meet Notes");
    expect(reportToHtml(r, rec, turns, { timestamps: false })).not.toContain("[");
    expect(reportToHtml({ ...r, decisions: [] }, rec, turns)).not.toContain("تصمیم‌ها");
  });
  it("inline writes style attributes for email and still escapes", () => {
    const r = {
      ...empty, title: "<img src=x onerror=alert(1)>",
      decisions: [{ text: "<img src=x onerror=alert(1)>", at: "05:07" }],
      actions: [{ text: "کار", owner: "علی", due: "" }],
    };
    const html = reportToHtml(r, rec, turns, { inline: true, timestamps: false });
    expect(html).toContain("&lt;img");
    expect(html).not.toContain("<img");
    expect(html).toMatch(/^<div class="report" dir="rtl" lang="fa" style="direction:rtl;text-align:right;font-family:Vazirmatn,Tahoma,sans-serif[^"]*">/);
    expect(html).toMatch(/<h1 style="[^"]*color:#4f46e5/);
    expect(html).toMatch(/<h2 style="[^"]*color:#4f46e5/);
    expect(html).toMatch(/<div class="rule" style="[^"]*#4f46e5/);
    expect(html).toMatch(/<table style="border-collapse:collapse;width:100%/);
    expect(html).toMatch(/<th style="background:#efeefe;color:#4f46e5;text-align:right;padding:6px 10px/);
    expect(html).toMatch(/<td class="n" style="border-bottom:1px solid #e5e5ea;padding:6px 10px;vertical-align:top/);
    expect(html).toMatch(/<td style="border-bottom:1px solid #e5e5ea;padding:6px 10px;vertical-align:top/);
    expect(html.match(/<th[ >]/g)!.length).toBe(html.match(/<th style=/g)!.length);
    expect(html.match(/<td[ >]/g)!.length).toBe(html.match(/<td[^>]* style=/g)!.length);
    expect(reportToHtml(r, rec, turns)).not.toContain("style=");
  });
  it("standalone is a full rtl page with inline css", () => {
    const html = reportToHtml(empty, rec, turns, { standalone: true });
    expect(html.startsWith("<!doctype html>")).toBe(true);
    expect(html).toContain('dir="rtl"');
    expect(html).toContain("<style>");
    expect(html).toContain("Vazirmatn");
    expect(reportToHtml(empty, rec, turns)).not.toContain("<html");
  });
  it("shows the meta line and named speakers only", () => {
    const html = reportToHtml(empty, rec, [turn("علی", 0, 1000, "a"), turn("گوینده ۳", 1000, 2000, "b", true)]);
    expect(html).toContain("۲ گوینده");
    expect(html).toContain("حاضران: علی");
    expect(html).not.toContain("حاضران: علی،");
  });
});

describe("reportToMarkdown", () => {
  it("writes timestamps in Persian digits", () => {
    const r: Report = {
      ...empty, title: "T",
      decisions: [{ text: "تصمیم", at: "12:40" }],
      actions: [{ text: "کار", owner: "", due: "", at: "01:05" }],
      followUps: [{ text: "پیگیری", at: "33:09" }],
    };
    const md = reportToMarkdown(r, rec, []);
    expect(md).toContain("تصمیم [۱۲:۴۰]");
    expect(md).toContain("کار [۰۱:۰۵]");
    expect(md).toContain("پیگیری [۳۳:۰۹]");
    expect(md).not.toMatch(/\[\d/);
  });
  it("renders the daily layout", () => {
    const r: Report = {
      ...empty, title: "دیلی",
      people: [{ person: "سینا", yesterday: ["الف"], today: ["ب"], blockers: ["ج"] }],
      actions: [{ text: "مانع", person: "سینا", owner: "", due: "" }],
    };
    const md = reportToMarkdown(r, { ...rec, type: "daily" }, []);
    expect(md).toContain("### سینا");
    expect(md).toContain("دیروز");
    expect(md).toContain("امروز");
    expect(md).toContain("موانع");
    expect(md).toContain("| مانع | فرد | رفع‌کننده |");
    expect(md).toContain("| ۱ | مانع | سینا | — |");
  });
});
