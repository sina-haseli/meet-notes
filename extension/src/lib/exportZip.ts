// The meeting's .zip export: notes, summary, transcript, metadata and screenshots.
import { strToU8, zipSync, type Zippable } from "fflate";
import type { MeetingRecord } from "../types";
import { renderTranscriptMd } from "./transcript";

export function zipFileName(rec: Pick<MeetingRecord, "id">): string {
  return `${rec.id}.zip`;
}

export async function buildMeetingZip(rec: MeetingRecord, screens: { atMs: number; blob: Blob }[]): Promise<Blob> {
  // The services folder context and the raw transcription data stay out of the export.
  const { servicesContext: _s, chunkTurns: _ct, turns: _t, chunks: _c, ...meta } = rec;
  const files: Zippable = {
    "notes.md": strToU8(rec.notesMd ?? ""),
    "summary.md": strToU8(rec.summaryMd ?? ""),
    "transcript.md": strToU8(renderTranscriptMd(rec.turns ?? [])),
    "meta.json": strToU8(JSON.stringify(meta, null, 2)),
  };
  // Flat "screens/<atMs>.jpg" keys (no separate folder entry). JPEGs are already compressed: stored as they are.
  for (const s of screens) files[`screens/${s.atMs}.jpg`] = [new Uint8Array(await s.blob.arrayBuffer()), { level: 0 }];
  const out = zipSync(files, { level: 6 });
  return new Blob([out], { type: "application/zip" });
}
