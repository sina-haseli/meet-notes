import { describe, expect, it } from "vitest";
import { strFromU8, unzipSync } from "fflate";
import type { MeetingRecord } from "../src/types";
import { buildMeetingZip, zipFileName } from "../src/lib/exportZip";
import { renderTranscriptMd } from "../src/lib/transcript";
import { reportToMarkdown, type Report } from "../src/lib/report";

function rec(): MeetingRecord {
  return {
    id: "2026-11-06_technical_sync",
    mode: "builtin",
    title: "Sync",
    type: "technical",
    startedAt: "2026-11-06T10:00:00.000+03:30",
    durationMs: 60_000,
    selfName: "Sina",
    participants: ["Sina", "Reza"],
    status: "ready",
    step: "done",
    costUsd: 0.12,
    speakerLog: [],
    servicesContext: "### secret-service\nmanifest: -",
    chunks: [{ index: 0, offsetMs: 0, durationMs: 60_000 }],
    chunkTurns: [[]],
    turns: [
      { startMs: 0, endMs: 2000, speaker: "Reza", text: "سلام endpoint", uncertain: false, chunk: 0, label: "S1" },
    ],
    screens: [{ atMs: 65_000, description: "A diagram" }],
    summaryMd: "# خلاصه\n- مورد",
    notesMd: "# Notes\n- item",
    pcmSamples: 960_000,
    createdAt: 1,
  };
}

describe("buildMeetingZip", () => {
  it("zips notes, summary, transcript, meta and screens", async () => {
    const r = rec();
    const shot = new Uint8Array([0xff, 0xd8, 1, 2, 3]);
    const blob = await buildMeetingZip(r, [{ atMs: 65_000, blob: new Blob([shot], { type: "image/jpeg" }) }]);
    const files = unzipSync(new Uint8Array(await blob.arrayBuffer()));
    expect(Object.keys(files).sort()).toEqual(
      ["meta.json", "notes.md", "screens/65000.jpg", "summary.md", "transcript.md"].sort(),
    );
    expect(strFromU8(files["notes.md"])).toBe(r.notesMd);
    expect(strFromU8(files["summary.md"])).toBe(r.summaryMd);
    expect(strFromU8(files["transcript.md"])).toBe(renderTranscriptMd(r.turns!));
    expect(Array.from(files["screens/65000.jpg"])).toEqual(Array.from(shot));
    const meta = JSON.parse(strFromU8(files["meta.json"]));
    expect(meta).not.toHaveProperty("servicesContext");
    expect(meta).not.toHaveProperty("chunkTurns");
    expect(meta).not.toHaveProperty("turns");
    expect(meta).not.toHaveProperty("chunks");
    expect(meta.id).toBe(r.id);
    expect(meta.screens).toEqual(r.screens);
    expect(meta.notesMd).toBe(r.notesMd);
  });

  it("adds report.html and a markdown summary.md for a record with a structured report", async () => {
    const report: Report = {
      title: "بررسی تسک‌های داشبورد", summary: ["خلاصه کوتاه"], decisions: [{ text: "تصمیم اول" }],
      actions: [{ text: "کار اول", owner: "Reza", due: "امروز" }], topics: [], people: [], followUps: [], codeServices: [],
    };
    const r = { ...rec(), summaryMd: undefined, report };
    const files = unzipSync(new Uint8Array(await (await buildMeetingZip(r, [])).arrayBuffer()));
    expect(Object.keys(files).sort()).toEqual(["meta.json", "notes.md", "report.html", "summary.md", "transcript.md"]);
    const html = strFromU8(files["report.html"]);
    expect(html.startsWith("<!doctype html>")).toBe(true);
    expect(html).toContain("بررسی تسک‌های داشبورد");
    expect(strFromU8(files["summary.md"])).toBe(reportToMarkdown(report, r, r.turns!));
    expect(JSON.parse(strFromU8(files["meta.json"]))).not.toHaveProperty("report");
  });

  it("leaves an old record with only summaryMd unchanged and adds no report.html", async () => {
    const r = rec();
    const files = unzipSync(new Uint8Array(await (await buildMeetingZip(r, [])).arrayBuffer()));
    expect(files).not.toHaveProperty("report.html");
    expect(strFromU8(files["summary.md"])).toBe(r.summaryMd);
  });

  it("writes empty documents when nothing was generated", async () => {
    const r = { ...rec(), summaryMd: undefined, notesMd: undefined, turns: undefined };
    const files = unzipSync(new Uint8Array(await (await buildMeetingZip(r, [])).arrayBuffer()));
    expect(strFromU8(files["notes.md"])).toBe("");
    expect(strFromU8(files["summary.md"])).toBe("");
    expect(strFromU8(files["transcript.md"])).toBe("");
  });

  it("names the download after the meeting id", () => {
    expect(zipFileName(rec())).toBe("2026-11-06_technical_sync.zip");
  });
});
