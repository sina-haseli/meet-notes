// The meeting's .zip export: notes, summary (and report.html), transcript, metadata and screenshots.
import { strToU8, zipSync, type Zippable } from "fflate";
import type { MeetingRecord } from "../types";
import { renderTranscriptMd } from "./transcript";
import { reportToHtml, reportToMarkdown } from "./report";

export function zipFileName(rec: Pick<MeetingRecord, "id">): string {
  return `${rec.id}.zip`;
}

export async function buildMeetingZip(rec: MeetingRecord, screens: { atMs: number; blob: Blob }[]): Promise<Blob> {
  // The services folder context and the raw transcription data stay out of the export.
  const { servicesContext: _s, chunkTurns: _ct, turns: _t, chunks: _c, report: _r, ...meta } = rec;
  const files: Zippable = {
    "notes.md": strToU8(rec.notesMd ?? ""),
    "summary.md": strToU8(rec.report ? reportToMarkdown(rec.report, rec, rec.turns ?? []) : (rec.summaryMd ?? "")),
    "transcript.md": strToU8(renderTranscriptMd(rec.turns ?? [])),
    "meta.json": strToU8(JSON.stringify(meta, null, 2)),
  };
  // The structured report (new meetings) also ships as a self-contained page; the full object stays out of meta.json.
  if (rec.report) {
    files["report.html"] = strToU8(reportToHtml(rec.report, rec, rec.turns ?? [], { standalone: true, timestamps: false }));
  }
  // Flat "screens/<atMs>.jpg" keys (no separate folder entry). JPEGs are already compressed: stored as they are.
  for (const s of screens) files[`screens/${s.atMs}.jpg`] = [new Uint8Array(await s.blob.arrayBuffer()), { level: 0 }];
  const out = zipSync(files, { level: 6 });
  return new Blob([out], { type: "application/zip" });
}
