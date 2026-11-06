import { describe, it, expect } from "vitest";
import { getSettings, saveSettings, DEFAULT_MODELS, HELPER_URL } from "../src/lib/settings";

function fake(init: Record<string, unknown> = {}) {
  const data: Record<string, unknown> = { ...init };
  return {
    data,
    async get(keys: string | string[]) {
      const ks = Array.isArray(keys) ? keys : [keys];
      const out: Record<string, unknown> = {};
      for (const k of ks) if (k in data) out[k] = data[k];
      return out;
    },
    async set(items: Record<string, unknown>) {
      Object.assign(data, items);
    },
  };
}

describe("settings", () => {
  it("defaultsWhenEmpty", async () => {
    const s = await getSettings(fake());
    expect(s.models).toEqual(DEFAULT_MODELS);
    expect(s.setupDone).toBe(false);
    expect(s.helper.url).toBe(HELPER_URL);
    expect(s.setupStep).toBe(1);
  });
  it("saveMergesNested", async () => {
    const st = fake();
    await saveSettings({ selfName: "Sina" }, st);
    const s = await saveSettings({ models: { ...DEFAULT_MODELS, notes: "x" } }, st);
    expect(s.models.notes).toBe("x");
    expect(s.models.transcribe).toBe(DEFAULT_MODELS.transcribe);
    expect(s.selfName).toBe("Sina");
    expect((await getSettings(st)).models.notes).toBe("x");
  });
  it("prefillsFromV1Keys", async () => {
    const s = await getSettings(fake({ token: "t", selfName: "Sina" }));
    expect(s.helper.token).toBe("t");
    expect(s.selfName).toBe("Sina");
  });
});
