import type { MeetingType, SpeakerInterval, UploadMeta } from "./types";

export type RecState = "idle" | "recording" | "uploading" | "upload-failed" | "done";

export const UPLOAD_URL = "http://127.0.0.1:47821/api/meetings";
/** Paths relative to the extension root (where manifest.json lives); build.mjs writes them to dist/. */
export const OFFSCREEN_PATH = "dist/offscreen.html";
export const PERMISSION_PATH = "dist/permission.html";

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
  | { type: "save-discard" };

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
  | { target: "offscreen"; type: "start"; streamId: string; selfName: string }
  | { target: "offscreen"; type: "stop"; meta: UploadMeta; log: SpeakerInterval[]; token: string }
  | { target: "offscreen"; type: "retry-upload"; token: string }
  | { target: "offscreen"; type: "export-audio" };
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
  | { target: "background"; type: "tab-ended" };

// ---- background -> content script (Task 13) ----
export interface CollectResponse {
  log: SpeakerInterval[];
  participants: string[];
}
