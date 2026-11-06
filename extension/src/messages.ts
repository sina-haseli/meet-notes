import type { MeetingType, SpeakerInterval, UploadMeta } from "./types";
import type { Settings } from "./lib/settings";

export type RecState = "idle" | "recording" | "uploading" | "upload-failed" | "done";

export const UPLOAD_URL = "http://127.0.0.1:47821/api/meetings";
/** Paths relative to the extension root (where manifest.json lives); build.mjs writes them to dist/. */
export const OFFSCREEN_PATH = "dist/offscreen.html";
export const PERMISSION_PATH = "dist/permission.html";
/** The meeting page; opened as `${MEETING_PATH}?id=<meeting id>`. */
export const MEETING_PATH = "dist/meeting.html";

// ---- popup -> background (no `target` field) ----
export interface StartMsg {
  type: "start";
  tabId: number;
  streamId: string;
  meetingType: MeetingType;
  title: string;
}
export type PopupMsg =
  | StartMsg
  | { type: "stop" }
  | { type: "status" }
  | { type: "retry-upload" }
  | { type: "save-discard" }
  /** Built-in: process an `interrupted` meeting from the audio saved so far. */
  | { type: "process-saved"; meetingId: string }
  /** Built-in: process an `error` meeting again (resumes where it failed). */
  | { type: "retry-meeting"; meetingId: string }
  /** Deletes a meeting and its audio; refused while it is recording or processing. */
  | { type: "delete-meeting"; meetingId: string };

export interface StatusResponse {
  state: RecState;
  elapsedMs: number;
  error?: string;
  /** Non-error information for the idle state (e.g. where the audio was saved). */
  notice?: string;
  meetingId?: string;
}
export interface Ack {
  ok: boolean;
  error?: string;
  /** Offscreen stop/retry failures only: whether the recording is still held in memory. */
  kept?: boolean;
}

// ---- background -> offscreen ----
export type ToOffscreen =
  /**
   * Built-in mode (persist true): the audio goes to IndexedDB under `meetingId`, a record the
   * background created first. Helper mode (persist false): v1 behaviour, kept in memory for upload.
   */
  | ({ target: "offscreen"; type: "start"; streamId: string; selfName: string } & (
      | { persist: true; meetingId: string }
      | { persist: false }
    ))
  /** Helper mode. `url` is the helper's upload endpoint, `token` its pairing token. */
  | { target: "offscreen"; type: "stop"; meta: UploadMeta; log: SpeakerInterval[]; token: string; url: string }
  | { target: "offscreen"; type: "retry-upload"; token: string; url: string }
  | { target: "offscreen"; type: "export-audio" }
  | { target: "offscreen"; type: "stop-builtin"; meetingId: string; log: SpeakerInterval[]; participants: string[] }
  | { target: "offscreen"; type: "process"; meetingId: string };
export interface OffscreenStartAck extends Ack {
  t0?: number;
}
/** Reply to export-audio: a blob: URL of the kept audio, valid while the offscreen doc lives. */
export interface ExportAudioAck extends Ack {
  url?: string;
}

// ---- offscreen -> background ----
export type FromOffscreen =
  | { target: "background"; type: "upload-result"; ok: boolean; id?: string; error?: string }
  | { target: "background"; type: "tab-ended" }
  | { target: "background"; type: "processed"; meetingId: string; ok: boolean }
  /** Not recording and nothing queued or being processed: the document may be closed. */
  | { target: "background"; type: "offscreen-idle" }
  /** R5: the offscreen doc has no chrome.storage; the background replies with GetSettingsReply. */
  | { target: "background"; type: "get-settings" };
/** Reply to get-settings: the current Settings, read fresh by the background. */
export type GetSettingsReply = Settings;

// ---- background -> content script (Task 13) ----
export interface CollectResponse {
  log: SpeakerInterval[];
  participants: string[];
}
