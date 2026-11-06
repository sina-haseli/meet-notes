import { describe, it, expect } from "vitest";
import { retryOnce, SliceBuffer } from "../src/lib/sliceBuffer";
import { SERVICES_NOTICE, savedMeetingServices, snapshotServices } from "../src/lib/servicesSnapshot";
import { isOffscreenIdle, type OffscreenActivity } from "../src/lib/offscreenIdle";
import type { Settings } from "../src/lib/settings";

function settings(role: Settings["role"]): Pick<Settings, "role"> {
  return { role };
}

function fakeHandle(permission: PermissionState): FileSystemDirectoryHandle {
  return {
    kind: "directory",
    name: "services",
    queryPermission: async (d: { mode: string }) => {
      expect(d).toEqual({ mode: "read" });
      return permission;
    },
  } as unknown as FileSystemDirectoryHandle;
}

describe("SliceBuffer", () => {
  it("emitsFixedSlicesInOrderAndPartialOnFlush", async () => {
    const got: { seq: number; len: number; first: number }[] = [];
    const buf = new SliceBuffer(async (seq, pcm) => {
      got.push({ seq, len: pcm.length, first: pcm[0] });
    }, 160000);
    const fill = (n: number, v: number) => new Int16Array(n).fill(v);
    buf.push(fill(70000, 1));
    buf.push(fill(100000, 2));
    buf.push(fill(5000, 3));
    expect(buf.totalSamples).toBe(175000);
    await new Promise((r) => setTimeout(r, 0));
    expect(got.map((g) => g.len)).toEqual([160000]); // the partial tail waits for flush
    await buf.flush();
    expect(got).toEqual([
      { seq: 0, len: 160000, first: 1 },
      { seq: 1, len: 15000, first: 2 },
    ]);
    expect(buf.totalSamples).toBe(175000);
  });

  it("failedWriteDoesNotBlockLaterSlicesAndFlushRejectsWithFirstError", async () => {
    const written: number[] = [];
    const first = new Error("quota 0");
    const buf = new SliceBuffer(async (seq) => {
      if (seq === 0) throw first;
      if (seq === 2) throw new Error("quota 2");
      written.push(seq);
    }, 10);
    buf.push(new Int16Array(35)); // slices 0, 1, 2 + a tail of 5
    await expect(buf.flush()).rejects.toBe(first);
    expect(written).toEqual([1, 3]);
    // The error is reported once; a later flush with nothing new succeeds.
    await expect(buf.flush()).resolves.toBeUndefined();
  });
});

describe("isOffscreenIdle", () => {
  const quiet: OffscreenActivity = { recording: false, stopping: false, processing: false, queued: 0, helperPending: false };
  it("idleOnlyWhenNothingIsGoingOn", () => {
    expect(isOffscreenIdle(quiet)).toBe(true);
    expect(isOffscreenIdle({ ...quiet, recording: true })).toBe(false);
    expect(isOffscreenIdle({ ...quiet, stopping: true })).toBe(false);
    expect(isOffscreenIdle({ ...quiet, processing: true })).toBe(false);
    expect(isOffscreenIdle({ ...quiet, queued: 1 })).toBe(false);
    expect(isOffscreenIdle({ ...quiet, helperPending: true })).toBe(false);
  });
});

describe("snapshotServices", () => {
  it("snapshotGrantedReadsContext", async () => {
    const h = fakeHandle("granted");
    const keys: string[] = [];
    const out = await snapshotServices(
      settings("technical"),
      async (k) => {
        keys.push(k);
        return h;
      },
      async (dir) => {
        expect(dir).toBe(h);
        return "### svc\nmanifest: -\nREADME:\n-\n";
      },
    );
    expect(keys).toEqual(["services"]);
    expect(out).toEqual({ servicesContext: "### svc\nmanifest: -\nREADME:\n-\n" });
  });

  it("snapshotPromptGivesNotice", async () => {
    let read = false;
    const out = await snapshotServices(settings("technical"), async () => fakeHandle("prompt"), async () => {
      read = true;
      return "x";
    });
    expect(read).toBe(false);
    expect(out).toEqual({
      servicesContext: null,
      servicesNotice: "Made without your services folder — Allow & Retry",
    });
    expect(SERVICES_NOTICE).toBe("Made without your services folder — Allow & Retry");
  });

  it("snapshotQueryPermissionThrowsGivesNotice", async () => {
    const h = {
      kind: "directory",
      name: "services",
      queryPermission: async () => {
        throw new DOMException("gone", "NotFoundError");
      },
    } as unknown as FileSystemDirectoryHandle;
    const out = await snapshotServices(settings("technical"), async () => h, async () => "x");
    expect(out).toEqual({ servicesContext: null, servicesNotice: SERVICES_NOTICE });
  });

  it("snapshotReadThrowsGivesNotice", async () => {
    const out = await snapshotServices(settings("technical"), async () => fakeHandle("granted"), async () => {
      throw new DOMException("moved", "NotFoundError");
    });
    expect(out).toEqual({ servicesContext: null, servicesNotice: SERVICES_NOTICE });
  });

  it("snapshotPmNoNotice", async () => {
    let asked = false;
    const out = await snapshotServices(settings("pm"), async () => {
      asked = true;
      return fakeHandle("granted");
    }, async () => "x");
    expect(asked).toBe(false);
    expect(out).toEqual({ servicesContext: null });
  });

  it("snapshotNoFolderNoNotice", async () => {
    const out = await snapshotServices(settings("technical"), async () => undefined, async () => "x");
    expect(out).toEqual({ servicesContext: null });
  });
});

describe("savedMeetingServices", () => {
  it("technicalWithAFolderGetsTheNotice", async () => {
    const out = await savedMeetingServices(settings("technical"), async () => fakeHandle("granted"));
    expect(out).toEqual({ servicesContext: null, servicesNotice: SERVICES_NOTICE });
  });

  it("noFolderOrPmGetsNoNotice", async () => {
    expect(await savedMeetingServices(settings("technical"), async () => undefined)).toEqual({ servicesContext: null });
    let asked = false;
    const out = await savedMeetingServices(settings("pm"), async () => {
      asked = true;
      return fakeHandle("granted");
    });
    expect(asked).toBe(false);
    expect(out).toEqual({ servicesContext: null });
  });

  it("anUnreadableHandleStoreStillGivesTheNotice", async () => {
    // The folder may be set; without being able to tell, the honest outcome is the notice.
    const out = await savedMeetingServices(settings("technical"), async () => {
      throw new Error("db closed");
    });
    expect(out).toEqual({ servicesContext: null, servicesNotice: SERVICES_NOTICE });
  });
});

describe("retryOnce", () => {
  it("aFailedSliceWriteIsTriedOnceMore", async () => {
    let calls = 0;
    await retryOnce(async () => {
      calls++;
      if (calls === 1) throw new Error("transient");
    });
    expect(calls).toBe(2);
  });

  it("aSecondFailureIsReported", async () => {
    let calls = 0;
    const second = new Error("still failing");
    await expect(
      retryOnce(async () => {
        calls++;
        throw calls === 1 ? new Error("first") : second;
      }),
    ).rejects.toBe(second);
    expect(calls).toBe(2);
  });

  it("aSuccessfulWriteRunsOnce", async () => {
    let calls = 0;
    await retryOnce(async () => {
      calls++;
    });
    expect(calls).toBe(1);
  });
});
