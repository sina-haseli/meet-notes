// Offscreen documents only expose chrome.runtime: nothing bundled into them may touch chrome.storage.
import { describe, it, expect, vi, afterEach } from "vitest";
import { build } from "esbuild";
import { defaultPipelineDeps } from "../src/lib/pipeline";
import type { Settings } from "../src/lib/settings";

/** Bundles like build.mjs does; entry paths are relative to extension/ (vitest's working directory). */
async function bundle(entry: string): Promise<string> {
  const out = await build({
    entryPoints: [entry],
    bundle: true,
    format: "esm",
    target: "es2022",
    write: false,
    logLevel: "silent",
  });
  return out.outputFiles[0].text;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("offscreen path", () => {
  it("defaultPipelineDepsUsesTheGivenSettingsProvider", async () => {
    const storageGet = vi.fn(async () => {
      throw new Error("chrome.storage is not available in an offscreen document");
    });
    vi.stubGlobal("chrome", { storage: { local: { get: storageGet, set: storageGet } } });
    const s = { role: "technical", apiKey: "k" } as Settings;
    const provider = vi.fn(async () => s);
    const deps = defaultPipelineDeps(provider);
    expect(await deps.settings()).toBe(s);
    expect(await deps.settings()).toBe(s);
    expect(provider).toHaveBeenCalledTimes(2); // fresh on every use, never cached
    expect(storageGet).not.toHaveBeenCalled();
  });

  it("offscreenBundleNeverTouchesChromeStorage", async () => {
    const js = await bundle("src/offscreen.ts");
    expect(js).toContain("get-settings");
    expect(js).not.toMatch(/chrome\s*\.\s*storage/);
  });

  it("workletBundleTouchesNoDomOrChrome", async () => {
    const js = await bundle("src/pcmWorklet.ts");
    expect(js).toContain('registerProcessor("pcm-capture"');
    expect(js).not.toMatch(/\bchrome\s*\./);
    expect(js).not.toMatch(/\b(document|window)\s*\./);
  });
});
