import type { Screen, SpeakerInterval, UploadMeta } from "../types";

export class UploadError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UploadError";
  }
}

function jsonPart(value: unknown): Blob {
  return new Blob([JSON.stringify(value)], { type: "application/json" });
}

export function buildUploadForm(
  meta: UploadMeta,
  log: SpeakerInterval[],
  audio: Blob,
  screens: Screen[],
): FormData {
  const form = new FormData();
  // File parts, not string fields: no multipart field-size limit applies to them on the helper.
  form.append("meta", jsonPart(meta), "meta.json");
  form.append("speaker_log", jsonPart(log), "speaker_log.json");
  form.append("audio", audio, "audio.webm");
  for (const s of screens) form.append("screens", s.blob, `${s.atMs}.jpg`);
  return form;
}

/** `HTTP <status>: <detail>` from a FastAPI error response (JSON `detail` or plain text). */
async function describe(res: Response): Promise<string> {
  let body = "";
  try {
    body = await res.text();
  } catch {
    // no body
  }
  let detail: unknown = body;
  try {
    const parsed = JSON.parse(body) as { detail?: unknown };
    if (parsed && typeof parsed === "object" && "detail" in parsed) detail = parsed.detail;
  } catch {
    // plain text
  }
  const text = (typeof detail === "string" ? detail : JSON.stringify(detail)).trim().slice(0, 300);
  return text ? `HTTP ${res.status}: ${text}` : `HTTP ${res.status}`;
}

/** 4xx means the request itself is wrong; sending it again can't help (except 408/429). */
function retryable(status: number): boolean {
  return status >= 500 || status === 408 || status === 429;
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
      lastError = await describe(res);
      if (!retryable(res.status)) throw new UploadError(`upload rejected: ${lastError}`);
    } catch (e) {
      if (e instanceof UploadError) throw e;
      lastError = e instanceof Error ? e.message : String(e);
    }
    if (i < tries) await new Promise((r) => setTimeout(r, delayMs * i));
  }
  throw new UploadError(`upload failed after ${tries} tries: ${lastError}`);
}
