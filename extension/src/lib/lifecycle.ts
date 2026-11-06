// Pure decisions for the background service worker: when the offscreen document may close, which
// meetings to resume or mark interrupted at startup, and where the helper upload goes.
import type { MeetingRecord } from "../types";
import { UPLOAD_URL } from "../messages";

/** The background's view of what still needs the offscreen document. */
export interface BackgroundActivity {
  recording: boolean;
  processing: boolean;
  queued: number;
  helperUploadPending: boolean;
}

export function shouldCloseOffscreen(s: BackgroundActivity): boolean {
  return !s.recording && !s.processing && s.queued === 0 && !s.helperUploadPending;
}

/** Built-in meetings whose processing was queued or under way, oldest first. */
export function recordsToResume(all: MeetingRecord[]): string[] {
  return all
    .filter((r) => r.mode === "builtin" && (r.status === "queued" || r.status === "processing"))
    .sort((a, b) => a.createdAt - b.createdAt)
    .map((r) => r.id);
}

/** Shown when a run ended without saving its own error (e.g. the offscreen document died). */
export const STUCK_ERROR = "Something went wrong while processing. Press Retry.";

/**
 * A built-in meeting marked queued/processing while no offscreen document exists: nothing is
 * working on it, so it may be retried or deleted like a failed one.
 */
export function isStuck(rec: Pick<MeetingRecord, "mode" | "status">, offscreenAlive: boolean): boolean {
  return rec.mode === "builtin" && !offscreenAlive && (rec.status === "queued" || rec.status === "processing");
}

/**
 * The offscreen doc reported a failed run but the record still says `processing` (the pipeline
 * could not save its error): make it a normal failed meeting with Retry. Null = nothing to change.
 */
export function failedRunPatch(
  rec: Pick<MeetingRecord, "status"> | undefined,
  ok: boolean,
): Pick<MeetingRecord, "status" | "error"> | null {
  if (ok || rec?.status !== "processing") return null;
  return { status: "error", error: STUCK_ERROR };
}

/** A popup poll found work waiting with no offscreen document to do it: resume the queue. */
export function shouldResumeOnPoll(all: MeetingRecord[], offscreenAlive: boolean): boolean {
  return all.some((r) => isStuck(r, offscreenAlive));
}

/** Built-in meetings still marked `recording` that are not the live recording. */
export function recordsInterrupted(all: MeetingRecord[], recordingId: string | undefined): string[] {
  return all
    .filter((r) => r.mode === "builtin" && r.status === "recording" && r.id !== recordingId)
    .map((r) => r.id);
}

/** True when one of `urls` is the meeting page (`pageUrl`, without query) showing meeting `id`. */
export function meetingPageOpen(urls: string[], pageUrl: string, id: string): boolean {
  // Plain string parsing: `new URL` gives a "null" origin for chrome-extension: URLs off-browser.
  return urls.some((u) => {
    const hash = u.indexOf("#");
    const noHash = hash >= 0 ? u.slice(0, hash) : u;
    const q = noHash.indexOf("?");
    if (q < 0 || noHash.slice(0, q) !== pageUrl) return false;
    try {
      return new URLSearchParams(noHash.slice(q + 1)).get("id") === id;
    } catch {
      return false;
    }
  });
}

/** The helper's upload endpoint for the configured helper URL (the default gives UPLOAD_URL). */
export function helperUploadUrl(helperUrl: string): string {
  const base = helperUrl.trim().replace(/\/+$/, "");
  return base ? `${base}/api/meetings` : UPLOAD_URL;
}
