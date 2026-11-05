export type MeetingType = "grooming" | "planning" | "technical";

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
