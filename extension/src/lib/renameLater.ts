// Renaming speakers after the report was written (the report tab's "نام گوینده‌ها"). Nothing is
// sent to the AI again, so the user's own edits to the report survive.
import type { MeetingRecord } from "../types";
import { replaceWholeName } from "./meetingView";
import { renameInReport } from "./report";
import { applyNames, voicesOf, type Voice } from "./voices";

/**
 * The voice cards, grouped by the names now in the turns. After the names were confirmed every
 * named voice looks "known", so only a name Google Meet itself logged counts as from Meet.
 */
export function renameVoices(rec: Pick<MeetingRecord, "turns" | "speakerLog">): Voice[] {
  const meet = new Set((rec.speakerLog ?? []).map((e) => e.name));
  return voicesOf(rec.turns ?? []).map((v) => ({ ...v, fromMeet: v.fromMeet && meet.has(v.name) }));
}

/** A private-use character: never a word character, so whole-word matching around it still works. */
const token = (i: number) => String.fromCharCode(0xe000 + i);

/**
 * The turns, report and English notes with the changed names applied. `names` maps each current
 * name to the typed one; an empty or unchanged box keeps the name. Null when nothing changed.
 */
export function renamePatch(
  rec: Pick<MeetingRecord, "turns" | "report" | "notesMd">,
  names: Record<string, string>,
): Pick<MeetingRecord, "turns" | "report" | "notesMd"> | null {
  const changed = Object.entries(names)
    .map(([old, typed]) => [old, typed.trim()] as const)
    .filter(([old, next]) => next !== "" && next !== old);
  if (!changed.length) return null;
  const to = new Map(changed);

  // Every current name goes to a placeholder first (longest first, so "علی رضایی" is taken before
  // "علی"), then each comes back as its new name or as itself. An unchanged name that contains a
  // changed one ("علی رضایی", "علی‌رضا") is therefore never rewritten, and swapping two names never
  // merges them.
  const current = [...new Set([...Object.keys(names), ...(rec.turns ?? []).map((t) => t.speaker)])]
    .filter((n) => n !== "")
    .sort((a, b) => b.length - a.length);
  const both = <T>(v: T, f: (v: T, old: string, next: string) => T): T => {
    let out = v;
    current.forEach((old, i) => (out = f(out, old, token(i))));
    current.forEach((old, i) => (out = f(out, token(i), to.get(old) ?? old)));
    return out;
  };
  const patch: Pick<MeetingRecord, "turns" | "report" | "notesMd"> = {
    turns: applyNames(rec.turns ?? [], Object.fromEntries(changed)),
  };
  if (rec.report !== undefined) patch.report = both(rec.report, renameInReport);
  if (rec.notesMd !== undefined) patch.notesMd = both(rec.notesMd, replaceWholeName);
  return patch;
}
