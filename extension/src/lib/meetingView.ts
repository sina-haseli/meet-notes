// Pure helpers for the meeting page and the meetings list.
import type { MeetingRecord, Turn } from "../types";
import { renameSpeaker } from "./speakers";

export { mmss } from "./transcript";

// Python's `\w` (Unicode-aware), as used by the v1 helper's whole-name rename.
const WORD = "[\\p{L}\\p{N}\\p{M}_]";

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function replaceWholeName(text: string, old: string, next: string): string {
  if (!old) return text;
  const re = new RegExp(`(?<!${WORD})${escapeRegExp(old)}(?!${WORD})`, "gu");
  return text.replace(re, () => next); // a function replacer: `$` in the new name stays literal
}

/**
 * Port of the v1 rename: turns spoken by `old` get `next` (and are no longer uncertain), and
 * whole-name occurrences of `old` in the summary and notes are replaced literally.
 */
export function applyRename(
  rec: MeetingRecord,
  old: string,
  next: string,
): Pick<MeetingRecord, "turns" | "summaryMd" | "notesMd"> {
  return {
    turns: rec.turns ? renameSpeaker(rec.turns, old, next) : rec.turns,
    summaryMd: rec.summaryMd === undefined ? undefined : replaceWholeName(rec.summaryMd, old, next),
    notesMd: rec.notesMd === undefined ? undefined : replaceWholeName(rec.notesMd, old, next),
  };
}

export interface SpeakerChip {
  name: string;
  /** Every turn of this speaker is uncertain: shown as "Speaker N → rename?". */
  uncertain: boolean;
}

/** Distinct speakers in order of first appearance. */
export function speakersOf(turns: Turn[]): SpeakerChip[] {
  const out = new Map<string, SpeakerChip>();
  for (const t of turns) {
    const cur = out.get(t.speaker);
    if (!cur) out.set(t.speaker, { name: t.speaker, uncertain: t.uncertain });
    else if (!t.uncertain) cur.uncertain = false;
  }
  return [...out.values()];
}

/** The helper's review page for a helper-mode stub, or null when no helper URL is set. */
export function helperMeetingUrl(helperBase: string, helperId: string): string | null {
  const base = helperBase.trim().replace(/\/+$/, "");
  if (!base) return null; // a bare "/meetings/<id>" would resolve inside the extension
  return `${base}/meetings/${encodeURIComponent(helperId)}`;
}

/**
 * Allow & Retry cleared the notes but the re-run could not be started: make the meeting a normal
 * failed one, so the page shows the error banner with Retry instead of a ready meeting without notes.
 */
export function rerunFailedPatch(detail: string | undefined): Pick<MeetingRecord, "status" | "error" | "errorDetail"> {
  return { status: "error", error: "The notes could not be written again. Press Retry.", errorDetail: detail };
}
