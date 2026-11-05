import type { Screen, SpeakerInterval, UploadMeta } from "../types";

export class UploadError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UploadError";
  }
}

export function buildUploadForm(
  meta: UploadMeta,
  log: SpeakerInterval[],
  audio: Blob,
  screens: Screen[],
): FormData {
  const form = new FormData();
  form.append("meta", JSON.stringify(meta));
  form.append("speaker_log", JSON.stringify(log));
  form.append("audio", audio, "audio.webm");
  for (const s of screens) form.append("screens", s.blob, `${s.atMs}.jpg`);
  return form;
}

export async function uploadWithRetry(
  form: FormData,
  url: string,
  token: string,
  opts: { tries?: number; delayMs?: number; fetchFn?: typeof fetch } = {},
): Promise<{ id: string }> {
  const tries = opts.tries ?? 3;
  const delayMs = opts.delayMs ?? 2000;
  const fetchFn = opts.fetchFn ?? fetch;
  let lastError = "unknown error";
  for (let i = 1; i <= tries; i++) {
    try {
      const res = await fetchFn(url, {
        method: "POST",
        headers: { "X-MeetNotes-Token": token },
        body: form,
      });
      if (res.ok) return (await res.json()) as { id: string };
      lastError = `HTTP ${res.status}`;
    } catch (e) {
      lastError = e instanceof Error ? e.message : String(e);
    }
    if (i < tries) await new Promise((r) => setTimeout(r, delayMs * i));
  }
  throw new UploadError(`upload failed after ${tries} tries: ${lastError}`);
}
