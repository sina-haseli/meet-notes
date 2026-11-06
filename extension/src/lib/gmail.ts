// Gmail compose links. Nothing is sent: the user reviews and sends the draft in Gmail.
import type { MeetingRecord } from "../types";
import { typeLabel } from "./popupView";

export function gmailComposeUrl(subject: string): string {
  return `https://mail.google.com/mail/?view=cm&fs=1&su=${encodeURIComponent(subject)}`;
}

/** `<title or type label> — <YYYY-MM-DD>`; startedAt is a local ISO, so its date is the local date. */
export function meetingSubject(rec: Pick<MeetingRecord, "title" | "type" | "startedAt">): string {
  const name = (rec.title ?? "").trim() || typeLabel(rec.type);
  return `${name} — ${rec.startedAt.slice(0, 10)}`;
}
