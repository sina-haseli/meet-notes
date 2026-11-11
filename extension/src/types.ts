import type { Report } from "./lib/report";

export type MeetingType ="grooming" | "planning" | "technical" | "daily";
export type MeetingStatus = "recording" | "interrupted" | "queued" | "processing" | "naming" | "ready" | "error";
export type Step = "chunking" | "transcribing" | "speakers" | "screens" | "code" | "notes" | "done";
export interface ChunkPlan { index: number; offsetMs: number; durationMs: number }
export interface Turn { startMs: number; endMs: number; speaker: string; text: string; uncertain: boolean; chunk: number; label: string }
export interface ScreenDesc { atMs: number; description: string }
export interface CodeFile { path: string; snippets: string[] }      // path relative to the services folder, "/"-separated, starts with the service dir
export interface CodeService { service: string; keywords: string[]; files: CodeFile[] }
export type CodeSkipReason = "off" | "not-technical" | "no-folder" | "daily" | "no-permission" | "error";
export type CodeSearch =
  | { status: "skipped"; reason: CodeSkipReason }
  | { status: "done"; keywords: string[]; services: CodeService[]; limitHit: boolean };

export interface SpeakerInterval {
  name: string;
  start_ms: number;
  end_ms: number;
}

/** The `meta` field of POST /api/meetings. */
export interface UploadMeta {
  title: string;
  type: MeetingType;
  started_at: string; // ISO-8601
  duration_ms: number;
  self_name: string;
  participants: string[];
}

export interface Screen {
  atMs: number;
  blob: Blob;
}

export interface MeetingRecord {
  id: string;                       // meetingId(), see lib/slug
  mode: "builtin" | "helper";
  title: string; type: MeetingType;
  startedAt: string;                // local ISO via lib/localIso
  durationMs: number;
  selfName: string; participants: string[];
  status: MeetingStatus; step?: Step;
  error?: string; errorDetail?: string;
  costUsd: number;
  speakerLog: SpeakerInterval[];
  servicesContext: string | null;   // snapshot taken at Stop
  servicesNotice?: string;
  chunks?: ChunkPlan[];
  chunkTurns?: (Turn[] | null)[];   // per chunk, null = not yet transcribed
  turns?: Turn[];                   // merged + speaker-mapped
  screens?: ScreenDesc[];
  codeSearch?: CodeSearch;
  summaryMd?: string; notesMd?: string;
  report?: Report;
  namesConfirmedAt?: number;        // set when the user confirms speaker names
  pcmSamples: number;               // timeline end of the persisted 16 kHz samples
  readyAt?: number; audioDeleted?: boolean;
  helperId?: string;                // helper-mode stub only
  createdAt: number;
}
