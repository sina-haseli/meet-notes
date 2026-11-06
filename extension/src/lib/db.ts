import type { MeetingRecord } from "../types";

const DB_NAME = "meetnotes";
const STORES = ["meetings", "pcm", "webm", "screens", "handles"] as const;
type StoreName = (typeof STORES)[number];

let dbPromise: Promise<IDBDatabase> | null = null;

function openDb(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      db.createObjectStore("meetings", { keyPath: "id" });
      db.createObjectStore("pcm");
      db.createObjectStore("webm");
      db.createObjectStore("screens");
      db.createObjectStore("handles");
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => {
      dbPromise = null;
      reject(req.error);
    };
  });
  return dbPromise;
}

function req<T>(r: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
}

function done(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error ?? new Error("transaction aborted"));
  });
}

async function tx(stores: StoreName[], mode: IDBTransactionMode): Promise<IDBTransaction> {
  return (await openDb()).transaction(stores, mode);
}

const rangeFor = (id: string) => IDBKeyRange.bound([id, -Infinity], [id, Infinity]);

export async function putMeeting(r: MeetingRecord): Promise<void> {
  const t = await tx(["meetings"], "readwrite");
  t.objectStore("meetings").put(r);
  await done(t);
}

export async function getMeeting(id: string): Promise<MeetingRecord | undefined> {
  const t = await tx(["meetings"], "readonly");
  return req<MeetingRecord | undefined>(t.objectStore("meetings").get(id));
}

export async function updateMeeting(id: string, patch: Partial<MeetingRecord>): Promise<MeetingRecord> {
  const t = await tx(["meetings"], "readwrite");
  const store = t.objectStore("meetings");
  const cur = (await req(store.get(id))) as MeetingRecord | undefined;
  if (!cur) {
    t.abort();
    throw new Error(`meeting not found: ${id}`);
  }
  const next = { ...cur, ...patch, id } as MeetingRecord;
  store.put(next);
  await done(t);
  return next;
}

export async function listMeetings(): Promise<MeetingRecord[]> {
  const t = await tx(["meetings"], "readonly");
  const all = (await req(t.objectStore("meetings").getAll())) as MeetingRecord[];
  return all.sort((a, b) => b.createdAt - a.createdAt);
}

export async function deleteMeeting(id: string): Promise<void> {
  const t = await tx([...STORES], "readwrite");
  t.objectStore("meetings").delete(id);
  for (const s of ["pcm", "webm", "screens"] as const) t.objectStore(s).delete(rangeFor(id));
  await done(t);
}

export async function putPcm(id: string, seq: number, pcm: Int16Array): Promise<void> {
  const t = await tx(["pcm"], "readwrite");
  t.objectStore("pcm").put(pcm, [id, seq]);
  await done(t);
}

export async function getPcmRange(id: string, fromSeq: number, toSeq: number): Promise<Int16Array[]> {
  const t = await tx(["pcm"], "readonly");
  return req(t.objectStore("pcm").getAll(IDBKeyRange.bound([id, fromSeq], [id, toSeq]))) as Promise<Int16Array[]>;
}

export async function putWebm(id: string, seq: number, blob: Blob): Promise<void> {
  const t = await tx(["webm"], "readwrite");
  t.objectStore("webm").put(blob, [id, seq]);
  await done(t);
}

export async function getWebm(id: string): Promise<Blob> {
  const t = await tx(["webm"], "readonly");
  const parts = (await req(t.objectStore("webm").getAll(rangeFor(id)))) as Blob[];
  return new Blob(parts, { type: "audio/webm" });
}

export async function putScreen(id: string, atMs: number, blob: Blob): Promise<void> {
  const t = await tx(["screens"], "readwrite");
  t.objectStore("screens").put(blob, [id, atMs]);
  await done(t);
}

export async function listScreens(id: string): Promise<{ atMs: number; blob: Blob }[]> {
  const t = await tx(["screens"], "readonly");
  const store = t.objectStore("screens");
  const range = rangeFor(id);
  const [keys, blobs] = await Promise.all([req(store.getAllKeys(range)), req(store.getAll(range))]);
  return (keys as unknown as [string, number][])
    .map((k, i) => ({ atMs: k[1], blob: (blobs as Blob[])[i] }))
    .sort((a, b) => a.atMs - b.atMs);
}

export async function deleteAudio(id: string): Promise<void> {
  const t = await tx(["meetings", "pcm", "webm"], "readwrite");
  t.objectStore("pcm").delete(rangeFor(id));
  t.objectStore("webm").delete(rangeFor(id));
  const ms = t.objectStore("meetings");
  const cur = (await req(ms.get(id))) as MeetingRecord | undefined;
  if (cur) ms.put({ ...cur, audioDeleted: true });
  await done(t);
}

export async function pruneExpiredAudio(nowMs: number, days = 30): Promise<string[]> {
  const cutoff = nowMs - days * 86_400_000;
  const ids = (await listMeetings())
    .filter((m) => m.status === "ready" && !m.audioDeleted && m.readyAt !== undefined && m.readyAt <= cutoff)
    .map((m) => m.id);
  for (const id of ids) await deleteAudio(id);
  return ids;
}

export async function putHandle(key: string, h: FileSystemDirectoryHandle): Promise<void> {
  const t = await tx(["handles"], "readwrite");
  t.objectStore("handles").put(h, key);
  await done(t);
}

export async function getHandle(key: string): Promise<FileSystemDirectoryHandle | undefined> {
  const t = await tx(["handles"], "readonly");
  return req<FileSystemDirectoryHandle | undefined>(t.objectStore("handles").get(key));
}

export async function deleteHandle(key: string): Promise<void> {
  const t = await tx(["handles"], "readwrite");
  t.objectStore("handles").delete(key);
  await done(t);
}
