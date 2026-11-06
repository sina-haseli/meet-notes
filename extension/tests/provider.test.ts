import { describe, it, expect } from "vitest";
import {
  apiFor, baseUrlFor, defaultModels, isProviderId, makeApi, normalizeBaseUrl, originPattern, PROVIDERS,
} from "../src/lib/provider";

describe("normalizeBaseUrl", () => {
  it("keeps an https base and drops trailing slashes", () => {
    expect(normalizeBaseUrl(" https://api.avalai.ir/v1/ ")).toBe("https://api.avalai.ir/v1");
    expect(normalizeBaseUrl("https://llm.example.com:8443/openai/v1")).toBe("https://llm.example.com:8443/openai/v1");
    expect(normalizeBaseUrl("https://llm.example.com")).toBe("https://llm.example.com");
  });
  it("cuts a pasted chat-completions endpoint back to its base", () => {
    expect(normalizeBaseUrl("https://api.example.com/v1/chat/completions")).toBe("https://api.example.com/v1");
  });
  it("drops a query and fragment", () => {
    expect(normalizeBaseUrl("https://api.example.com/v1?x=1#y")).toBe("https://api.example.com/v1");
  });
  it("rejects anything that is not a plain https URL", () => {
    expect(normalizeBaseUrl("")).toBeNull();
    expect(normalizeBaseUrl("api.example.com/v1")).toBeNull();
    expect(normalizeBaseUrl("http://api.example.com/v1")).toBeNull();
    expect(normalizeBaseUrl("https://user:pw@api.example.com/v1")).toBeNull();
    expect(normalizeBaseUrl("javascript:alert(1)")).toBeNull();
  });
});

describe("providers", () => {
  it("presets use their own address and custom uses the typed one", () => {
    expect(baseUrlFor("openrouter", "https://ignored.example")).toBe("https://openrouter.ai/api/v1");
    expect(baseUrlFor("avalai", "")).toBe("https://api.avalai.ir/v1");
    expect(baseUrlFor("custom", "https://x.example/v1/")).toBe("https://x.example/v1");
    expect(baseUrlFor("custom", "")).toBeNull();
  });
  it("originPattern covers the host on any path", () => {
    expect(originPattern("https://api.avalai.ir/v1")).toBe("https://api.avalai.ir/*");
    expect(originPattern("https://x.example:8443/v1")).toBe("https://x.example/*");
  });
  it("defaultModels is a copy per provider", () => {
    const m = defaultModels("avalai");
    m.notes = "changed";
    expect(PROVIDERS.avalai.models.notes).not.toBe("changed");
    expect(defaultModels("openrouter").transcribe).toBe("google/gemini-2.5-flash");
  });
  it("isProviderId", () => {
    expect(isProviderId("avalai")).toBe(true);
    expect(isProviderId("openai")).toBe(false);
    expect(isProviderId(undefined)).toBe(false);
  });
});

describe("makeApi / apiFor", () => {
  it("names presets by label and custom by host", () => {
    expect(makeApi("openrouter", PROVIDERS.openrouter.baseUrl, "k")).toEqual({
      baseUrl: "https://openrouter.ai/api/v1", key: "k", name: "OpenRouter", creditSite: "openrouter.ai", openrouter: true,
    });
    expect(makeApi("avalai", PROVIDERS.avalai.baseUrl, "k")).toMatchObject({
      name: "AvalAI", creditSite: "avalai.ir", openrouter: false,
    });
    expect(makeApi("custom", "https://llm.example.com/v1", "k")).toMatchObject({
      name: "llm.example.com", creditSite: "", openrouter: false,
    });
  });
  it("apiFor is null for a custom provider without a usable address", () => {
    expect(apiFor({ provider: "custom", baseUrl: "nope", apiKey: "k" })).toBeNull();
    expect(apiFor({ provider: "avalai", baseUrl: "nope", apiKey: "k" })?.baseUrl).toBe("https://api.avalai.ir/v1");
  });
});
