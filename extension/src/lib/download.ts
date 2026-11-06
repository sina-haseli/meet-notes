/** `meet-notes-<started_at>.webm`, with characters Windows forbids in file names replaced. */
export function audioFileName(startedAtIso: string): string {
  const stamp = startedAtIso.replace(/[^0-9A-Za-z+_-]/g, "-").replace(/^-+|-+$/g, "");
  return `meet-notes-${stamp || "recording"}.webm`;
}

interface DownloadDelta {
  id: number;
  state?: { current?: string };
  error?: { current?: string };
}

/** The slice of chrome.downloads used here (injectable for tests). */
export interface DownloadsApi {
  download(options: { url: string; filename: string; saveAs?: boolean; conflictAction?: "uniquify" }): Promise<number>;
  search(query: { id: number }): Promise<Array<{ filename?: string }>>;
  onChanged: {
    addListener(cb: (delta: DownloadDelta) => void): void;
    removeListener(cb: (delta: DownloadDelta) => void): void;
  };
}

/**
 * Download `url` into the Downloads folder as `filename` and wait until it is fully written
 * (a blob URL dies with the document that made it, so the caller must not close it earlier).
 * Resolves with the full path of the saved file.
 */
export async function downloadAndWait(
  api: DownloadsApi,
  url: string,
  filename: string,
  timeoutMs = 120_000,
): Promise<string> {
  // Listen before starting, so a very fast "complete" can't be missed.
  const seen = new Map<number, DownloadDelta>();
  let id: number | undefined;
  let settle: ((d: DownloadDelta) => void) | undefined;
  const listener = (d: DownloadDelta) => {
    const state = d.state?.current;
    if (state !== "complete" && state !== "interrupted") return;
    if (id === undefined) seen.set(d.id, d);
    else if (d.id === id) settle?.(d);
  };
  api.onChanged.addListener(listener);
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    id = await api.download({ url, filename, saveAs: false, conflictAction: "uniquify" });
    const final =
      seen.get(id) ??
      (await new Promise<DownloadDelta>((resolve, reject) => {
        settle = resolve;
        timer = setTimeout(() => reject(new Error("saving the audio timed out")), timeoutMs);
      }));
    if (final.state?.current !== "complete") {
      throw new Error(`saving the audio failed: ${final.error?.current ?? "interrupted"}`);
    }
    const [item] = await api.search({ id });
    return item?.filename || filename;
  } finally {
    if (timer !== undefined) clearTimeout(timer);
    api.onChanged.removeListener(listener);
  }
}
