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
  it("codeSuggestionsDefaultsFalse", async () => {
    expect((await getSettings(fake())).codeSuggestions).toBe(false);
    expect((await getSettings(fake({ token: "t", selfName: "S" }))).codeSuggestions).toBe(false);
  });
  it("defaultsToOpenRouterWithNoKey", async () => {
    const s = await getSettings(fake());
    expect(s.provider).toBe("openrouter");
    expect(s.baseUrl).toBe("");
    expect(s.apiKey).toBe("");
  });
  it("migratesTheOldOpenRouterKey", async () => {
    const st = fake({ settings: { openrouterKey: "sk-or-v1-old", setupDone: true } });
    const s = await getSettings(st);
    expect(s.apiKey).toBe("sk-or-v1-old");
    expect(s.provider).toBe("openrouter");
    expect(s).not.toHaveProperty("openrouterKey");
    await saveSettings({ selfName: "S" }, st);
    const stored = st.data.settings as Record<string, unknown>;
    expect(stored.apiKey).toBe("sk-or-v1-old");
    expect(stored).not.toHaveProperty("openrouterKey");
  });
  it("aSavedApiKeyWinsOverTheOldField", async () => {
    const s = await getSettings(fake({ settings: { openrouterKey: "old", apiKey: "new", provider: "avalai" } }));
    expect(s.apiKey).toBe("new");
    expect(s.provider).toBe("avalai");
  });
  it("anUnknownProviderFallsBackToOpenRouter", async () => {
    expect((await getSettings(fake({ settings: { provider: "nope" } }))).provider).toBe("openrouter");
  });
  it("savedV2WithoutCodeSuggestionsIsFalse", async () => {
    const st = fake({ settings: { setupDone: true, role: "technical", selfName: "S" } });
    expect((await getSettings(st)).codeSuggestions).toBe(false);
  });
});
