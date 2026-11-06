import { audioFileName, downloadAndWait } from "../src/lib/download";

test("audioFileName uses started_at with Windows-safe characters", () => {
  expect(audioFileName("2026-11-06T10:00:00+03:30")).toBe("meet-notes-2026-11-06T10-00-00+03-30.webm");
  expect(audioFileName("")).toMatch(/^meet-notes-recording\.webm$/);
});

type Listener = (d: { id: number; state?: { current?: string }; error?: { current?: string } }) => void;

function fakeDownloads(outcome: "complete" | "interrupted" | "never") {
  const listeners = new Set<Listener>();
  const calls: unknown[] = [];
  return {
    calls,
    listeners,
    api: {
      download: async (opts: unknown) => {
        calls.push(opts);
        if (outcome !== "never") {
          setTimeout(() => {
            for (const l of [...listeners]) {
              l({ id: 7, state: { current: outcome }, ...(outcome === "interrupted" ? { error: { current: "FILE_NO_SPACE" } } : {}) });
            }
          }, 0);
        }
        return 7;
      },
      search: async (q: { id: number }) => (q.id === 7 ? [{ id: 7, filename: "C:\Users\sina\Downloads\meet-notes-x.webm" }] : []),
      onChanged: {
        addListener: (l: Listener) => listeners.add(l),
        removeListener: (l: Listener) => listeners.delete(l),
      },
    },
  };
}

test("downloadAndWait resolves with the saved path once the download completes", async () => {
  const f = fakeDownloads("complete");
  await expect(downloadAndWait(f.api, "blob:x", "meet-notes-x.webm")).resolves.toBe("C:\Users\sina\Downloads\meet-notes-x.webm");
  expect(f.calls[0]).toMatchObject({ url: "blob:x", filename: "meet-notes-x.webm", saveAs: false, conflictAction: "uniquify" });
  expect(f.listeners.size).toBe(0);
});

test("downloadAndWait rejects on an interrupted download", async () => {
  const f = fakeDownloads("interrupted");
  await expect(downloadAndWait(f.api, "blob:x", "a.webm")).rejects.toThrow(/FILE_NO_SPACE/);
  expect(f.listeners.size).toBe(0);
});

test("downloadAndWait times out", async () => {
  const f = fakeDownloads("never");
  await expect(downloadAndWait(f.api, "blob:x", "a.webm", 10)).rejects.toThrow(/timed out/);
  expect(f.listeners.size).toBe(0);
});
