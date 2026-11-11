import "fake-indexeddb/auto";
import { describe, it, expect } from "vitest";
import {
  putMeeting, getMeeting, updateMeeting, listMeetings, deleteMeeting,
  putPcm, getPcmRange, putWebm, getWebm, putScreen, listScreens,
  deleteAudio, pruneExpiredAudio, putHandle, getHandle, deleteHandle,
} from "../src/lib/db";
import type { MeetingRecord } from "../src/types";

const DAY = 86_400_000;
function rec(id: string, over: Partial<MeetingRecord> = {}): MeetingRecord {
  return {
    id, mode: "builtin", title: id, type: "daily", startedAt: "2026-11-06T10:00:00+03:30",
    durationMs: 1000, selfName: "S", participants: [], status: "recording", costUsd: 0,
    speakerLog: [], servicesContext: null, pcmSamples: 0, createdAt: 1, ...over,
  };
}

describe("db", () => {
  it("putGetUpdateList", async () => {
    await putMeeting(rec("a", { createdAt: 1 }));
    await putMeeting(rec("b", { createdAt: 2 }));
    expect((await listMeetings()).map((m) => m.id)).toEqual(["b", "a"]);
    const u = await updateMeeting("a", { title: "New", status: "queued" });
    expect(u.title).toBe("New");
    expect((await getMeeting("a"))!.status).toBe("queued");
    expect((await getMeeting("a"))!.id).toBe("a");
    await expect(updateMeeting("zzz", {})).rejects.toThrow();
  });
  it("pcmRangeAndWebmConcat", async () => {
    for (let i = 1; i <= 4; i++) await putPcm("p", i, new Int16Array([i, i]));
    const r = await getPcmRange("p", 2, 3);
    expect(r.map((a) => a.pcm[0])).toEqual([2, 3]);
    expect(r.map((a) => a.seq)).toEqual([2, 3]);
    await putWebm("p", 2, new Blob([new Uint8Array(5)]));
    await putWebm("p", 1, new Blob([new Uint8Array(3)]));
    await putWebm("q", 1, new Blob([new Uint8Array(9)]));
    const w = await getWebm("p");
    expect(w.size).toBe(8);
    expect(w.type).toBe("audio/webm");
    await putScreen("p", 500, new Blob(["b"]));
    await putScreen("p", 100, new Blob(["a"]));
    expect((await listScreens("p")).map((s) => s.atMs)).toEqual([100, 500]);
  });
  it("pcmRangeKeepsSeqsAcrossGaps", async () => {
    await putPcm("g", 0, new Int16Array([10]));
    await putPcm("g", 2, new Int16Array([30]));
    const r = await getPcmRange("g", 0, 5);
    expect(r.map((a) => [a.seq, a.pcm[0]])).toEqual([[0, 10], [2, 30]]);
    expect(r[1].pcm).toBeInstanceOf(Int16Array);
  });
  it("deleteMeetingRemovesAllRows", async () => {
    await putMeeting(rec("d"));
    await putPcm("d", 1, new Int16Array(2));
    await putWebm("d", 1, new Blob(["x"]));
    await putScreen("d", 1, new Blob(["x"]));
    await putPcm("e", 1, new Int16Array(2));
    await deleteMeeting("d");
    expect(await getMeeting("d")).toBeUndefined();
    expect(await getPcmRange("d", 0, 99)).toEqual([]);
    expect((await getWebm("d")).size).toBe(0);
    expect(await listScreens("d")).toEqual([]);
    expect((await getPcmRange("e", 0, 99)).length).toBe(1);
  });
  it("pruneExpiredAudio", async () => {
    const now = 100 * DAY;
    await putMeeting(rec("old", { status: "ready", readyAt: now - 31 * DAY }));
    await putMeeting(rec("new", { status: "ready", readyAt: now - 29 * DAY }));
    await putMeeting(rec("err", { status: "error", readyAt: now - 40 * DAY }));
    for (const id of ["old", "new", "err"]) {
      await putPcm(id, 1, new Int16Array(2));
      await putWebm(id, 1, new Blob(["x"]));
    }
    const ids = await pruneExpiredAudio(now);
    expect(ids).toEqual(["old"]);
    expect((await getMeeting("old"))!.audioDeleted).toBe(true);
    expect(await getPcmRange("old", 0, 9)).toEqual([]);
    expect((await getMeeting("new"))!.audioDeleted).toBeFalsy();
    expect((await getPcmRange("err", 0, 9)).length).toBe(1);
    expect(await deleteAudio("new")).toBeUndefined();
  });
  it("pruneExpiredAudioKeepsNamingMeetings", async () => {
    const now = 100 * DAY;
    await putMeeting(rec("nm", { status: "naming", createdAt: now - 40 * DAY, readyAt: now - 40 * DAY }));
    await putPcm("nm", 1, new Int16Array(2));
    expect(await pruneExpiredAudio(now)).toEqual([]);
    expect((await getPcmRange("nm", 0, 9)).length).toBe(1);
  });
  it("handles", async () => {
    const h = { kind: "directory", name: "x" } as unknown as FileSystemDirectoryHandle;
    await putHandle("k", h);
    expect(((await getHandle("k")) as any).name).toBe("x");
    await deleteHandle("k");
    expect(await getHandle("k")).toBeUndefined();
  });
});
