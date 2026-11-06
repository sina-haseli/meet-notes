// Pure text/format helpers for the popup's Recent list, timer and title prefill.
import type { MeetingRecord, MeetingType } from "../types";

const TYPE_LABEL: Record<MeetingType, string> = {
  grooming: "Grooming",
  planning: "Planning",
  technical: "Technical",
  daily: "Daily",
};
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export function typeLabel(t: MeetingType): string {
  return TYPE_LABEL[t] ?? t;
}

export function displayTitle(r: MeetingRecord): string {
  return r.title.trim() || `${typeLabel(r.type)} meeting`;
}

/** "Sprint 42 grooming - Google Meet" -> "Sprint 42 grooming". Other titles are kept as they are. */
export function stripMeetSuffix(tabTitle: string): string {
  const t = tabTitle.trim();
  if (t === "Google Meet") return "";
  return t.replace(/\s+[-–—]\s+Google Meet$/, "").trim();
}

export function fmtTimer(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  const hh = Math.floor(s / 3600);
  const mm = String(Math.floor((s % 3600) / 60)).padStart(2, "0");
  const ss = String(s % 60).padStart(2, "0");
  return hh > 0 ? `${hh}:${mm}:${ss}` : `${mm}:${ss}`;
}

export function fmtDuration(ms: number): string {
  const min = Math.round(ms / 60_000);
  if (min < 1) return "<1 min";
  if (min < 60) return `${min} min`;
  const h = Math.floor(min / 60);
  const m = min % 60;
  return m === 0 ? `${h} h` : `${h} h ${m} min`;
}

function sameDay(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

/** "Today 10:00 · 14 min", "Yesterday 09:05 · 52 min", "Oct 28 14:00 · 1 h 15 min". */
export function dateLine(r: MeetingRecord, now: Date = new Date()): string {
  const d = new Date(r.startedAt);
  let when = "";
  if (!Number.isNaN(d.getTime())) {
    const hm = `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
    const yesterday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1);
    const day = sameDay(d, now)
      ? "Today"
      : sameDay(d, yesterday)
        ? "Yesterday"
        : d.getFullYear() === now.getFullYear()
          ? `${MONTHS[d.getMonth()]} ${d.getDate()}`
          : `${MONTHS[d.getMonth()]} ${d.getDate()}, ${d.getFullYear()}`;
    when = `${day} ${hm}`;
  }
  const length = r.status === "recording" ? "recording now" : fmtDuration(r.durationMs);
  return when ? `${when} · ${length}` : length;
}

function chunkProgress(r: MeetingRecord): { done: number; n: number } | null {
  const n = r.chunks?.length ?? 0;
  if (n === 0) return null;
  const done = (r.chunkTurns ?? []).filter((t) => t !== null && t !== undefined).length;
  return { done: Math.min(done, n), n };
}

/** The step line of a queued/processing meeting, or null for any other status. */
export function stepText(r: MeetingRecord): string | null {
  if (r.status === "queued") return "Queued…";
  if (r.status !== "processing") return null;
  switch (r.step) {
    case "transcribing": {
      const p = chunkProgress(r);
      if (!p) return "Transcribing…";
      return `Transcribing part ${Math.min(p.done + 1, p.n)} of ${p.n}…`;
    }
    case "speakers":
      return "Matching speakers…";
    case "screens":
      return "Describing screens…";
    case "notes":
      return "Writing notes…";
    case "done":
      return "Finishing…";
    default:
      return "Preparing audio…";
  }
}

/** 0..1 for the thin progress bar: transcription is most of the work. */
export function progressFor(r: MeetingRecord): number {
  if (r.status === "queued") return 0.02;
  switch (r.step) {
    case "transcribing": {
      const p = chunkProgress(r);
      return 0.05 + 0.7 * (p ? p.done / p.n : 0);
    }
    case "speakers":
      return 0.78;
    case "screens":
      return 0.82;
    case "notes":
      return 0.9;
    case "done":
      return 0.98;
    default:
      return 0.03;
  }
}

export type BadgeClass = "ready" | "processing" | "error" | "interrupted" | "recording";

export function badgeFor(r: MeetingRecord): { cls: BadgeClass; text: string } {
  switch (r.status) {
    case "ready":
      return { cls: "ready", text: "Ready" };
    case "queued":
      return { cls: "processing", text: "Queued" };
    case "processing":
      return { cls: "processing", text: "Processing" };
    case "error":
      return { cls: "error", text: "Failed" };
    case "interrupted":
      return { cls: "interrupted", text: "Interrupted" };
    default:
      return { cls: "recording", text: "Recording" };
  }
}
