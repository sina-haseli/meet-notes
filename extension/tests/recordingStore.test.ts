import "fake-indexeddb/auto";
import { describe, it, expect } from "vitest";
import { SliceBuffer } from "../src/lib/sliceBuffer";
import { SERVICES_NOTICE, snapshotServices } from "../src/lib/servicesSnapshot";
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
