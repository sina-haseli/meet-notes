import { buildUploadForm, uploadWithRetry, UploadError } from "../src/lib/upload";
import type { UploadMeta } from "../src/types";

const meta: UploadMeta = {
  title: "Sprint grooming", type: "grooming", started_at: "2026-11-06T10:00:00Z",
  duration_ms: 1000, self_name: "Sina", participants: ["Sina", "Reza"],
};

test("uploadWithRetry retries then succeeds", async () => {
  let n = 0; const fetchFn = async () => (++n < 3 ? Promise.reject(new Error("ECONNREFUSED")) : new Response('{"id":"m1"}'));
  await expect(uploadWithRetry(new FormData(), "u", "t", { fetchFn, delayMs: 0 })).resolves.toEqual({ id: "m1" });
});

test("uploadWithRetry throws UploadError after last try and sends token", async () => {
  const seen: Headers[] = []; const fetchFn = async (_: any, i: any) => { seen.push(new Headers(i.headers)); throw new Error("down"); };
  await expect(uploadWithRetry(new FormData(), "u", "tok", { fetchFn, delayMs: 0 })).rejects.toBeInstanceOf(UploadError);
  expect(seen).toHaveLength(3); expect(seen[0].get("X-MeetNotes-Token")).toBe("tok");
});

test("uploadWithRetry treats non-2xx as failure and reports status", async () => {
  let n = 0;
  const fetchFn = async () => { n++; return new Response("nope", { status: 401 }); };
  await expect(uploadWithRetry(new FormData(), "u", "t", { fetchFn, delayMs: 0 })).rejects.toThrow(/401/);
  expect(n).toBe(3);
});

test("buildUploadForm names screens by atMs", () => {
  const f = buildUploadForm(meta, [], new Blob(["a"]), [{ atMs: 500, blob: new Blob(["j"]) }]);
  expect((f.getAll("screens")[0] as File).name).toBe("500.jpg"); expect(JSON.parse(f.get("meta") as string).type).toBe(meta.type);
  expect(f.get("speaker_log")).toBe("[]");
  expect((f.get("audio") as File).name).toBe("audio.webm");
});
