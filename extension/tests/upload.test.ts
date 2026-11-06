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

test("uploadWithRetry does not retry a 4xx and reports the server's detail", async () => {
  let n = 0;
  const fetchFn = async () => {
    n++;
    return new Response('{"detail":"meta.type must be grooming, planning or technical"}', {
      status: 400, headers: { "content-type": "application/json" },
    });
  };
  const err = await uploadWithRetry(new FormData(), "u", "t", { fetchFn, delayMs: 0 }).catch((e) => e);
  expect(err).toBeInstanceOf(UploadError);
  expect(err.message).toMatch(/HTTP 400/);
  expect(err.message).toMatch(/meta\.type must be grooming/);
  expect(n).toBe(1);
});

test("uploadWithRetry 401 fails at once with the plain-text body when there is no JSON detail", async () => {
  let n = 0;
  const fetchFn = async () => { n++; return new Response("nope", { status: 401 }); };
  await expect(uploadWithRetry(new FormData(), "u", "t", { fetchFn, delayMs: 0 })).rejects.toThrow(/401.*nope/);
  expect(n).toBe(1);
});

test("uploadWithRetry retries a 5xx and 429, and reports the last detail", async () => {
  let n = 0;
  const fetchFn = async () => {
    n++;
    return n === 1 ? new Response("slow down", { status: 429 }) : new Response('{"detail":"disk full"}', { status: 500 });
  };
  await expect(uploadWithRetry(new FormData(), "u", "t", { fetchFn, delayMs: 0 })).rejects.toThrow(/500.*disk full/);
  expect(n).toBe(3);
});

test("uploadWithRetry shows a structured (422) detail as JSON, not [object Object]", async () => {
  const fetchFn = async () => new Response('{"detail":[{"loc":["body","audio"],"msg":"Field required"}]}', { status: 422 });
  const err = await uploadWithRetry(new FormData(), "u", "t", { fetchFn, delayMs: 0 }).catch((e) => e);
  expect(err.message).toMatch(/Field required/);
  expect(err.message).not.toMatch(/object Object/);
});

test("buildUploadForm names screens by atMs and sends JSON fields as application/json blobs", async () => {
  const log = [{ name: "Reza", start_ms: 0, end_ms: 5 }];
  const f = buildUploadForm(meta, log, new Blob(["a"]), [{ atMs: 500, blob: new Blob(["j"]) }]);
  expect((f.getAll("screens")[0] as File).name).toBe("500.jpg");
  const m = f.get("meta") as File;
  const l = f.get("speaker_log") as File;
  expect(m).toBeInstanceOf(Blob); expect(m.type).toBe("application/json");
  expect(l).toBeInstanceOf(Blob); expect(l.type).toBe("application/json");
  expect(JSON.parse(await m.text()).type).toBe(meta.type);
  expect(JSON.parse(await l.text())).toEqual(log);
  expect((f.get("audio") as File).name).toBe("audio.webm");
});
