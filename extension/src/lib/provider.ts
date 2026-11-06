// Which AI service the extension talks to. Every provider here speaks the OpenAI-compatible
// chat-completions API; OpenRouter also has a credit endpoint and per-request cost.
// Pure (no chrome.* APIs), so the offscreen document and tests can use it.

export type ProviderId = "openrouter" | "avalai" | "custom";

export interface Models {
  transcribe: string;
  vision: string;
  notes: string;
}

export interface Provider {
  id: ProviderId;
  label: string;
  /** Fixed API address; "" for custom, whose address the user enters. */
  baseUrl: string;
  /** Where to create a key; "" when unknown. */
  keysUrl: string;
  keysText: string;
  keyPlaceholder: string;
  models: Models;
}

export const PROVIDERS: Record<ProviderId, Provider> = {
  openrouter: {
    id: "openrouter",
    label: "OpenRouter",
    baseUrl: "https://openrouter.ai/api/v1",
    keysUrl: "https://openrouter.ai/keys",
    keysText: "openrouter.ai/keys",
    keyPlaceholder: "sk-or-v1-…",
    models: {
      transcribe: "google/gemini-2.5-flash",
      vision: "google/gemini-2.5-flash",
      notes: "anthropic/claude-sonnet-5.5",
    },
  },
  avalai: {
    id: "avalai",
    label: "AvalAI",
    baseUrl: "https://api.avalai.ir/v1",
    keysUrl: "https://avalai.ir",
    keysText: "avalai.ir",
    keyPlaceholder: "API key",
    models: { transcribe: "gemini-2.5-flash", vision: "gemini-2.5-flash", notes: "gemini-2.5-pro" },
  },
  custom: {
    id: "custom",
    label: "Other (OpenAI-compatible)",
    baseUrl: "",
    keysUrl: "",
    keysText: "",
    keyPlaceholder: "API key",
    models: { transcribe: "gemini-2.5-flash", vision: "gemini-2.5-flash", notes: "gemini-2.5-pro" },
  },
};

export function isProviderId(v: unknown): v is ProviderId {
  return v === "openrouter" || v === "avalai" || v === "custom";
}

export function defaultModels(id: ProviderId): Models {
  return { ...PROVIDERS[id].models };
}

/**
 * A user-typed API address as "https://host[:port]/path" without a trailing slash, or null when it
 * is not a usable https URL. A pasted ".../chat/completions" endpoint is cut back to its base.
 */
export function normalizeBaseUrl(raw: string): string | null {
  let u: URL;
  try {
    u = new URL(raw.trim());
  } catch {
    return null;
  }
  if (u.protocol !== "https:" || !u.hostname || u.username || u.password) return null;
  const path = u.pathname.replace(/\/+$/, "").replace(/\/chat\/completions$/, "");
  return `${u.origin}${path}`;
}

/** The address requests go to, or null when a custom address is missing or invalid. */
export function baseUrlFor(id: ProviderId, customBaseUrl: string): string | null {
  return id === "custom" ? normalizeBaseUrl(customBaseUrl) : PROVIDERS[id].baseUrl;
}

/** The host permission pattern Chrome needs to reach `baseUrl` ("https://host/*"). */
export function originPattern(baseUrl: string): string {
  const u = new URL(baseUrl);
  return `${u.protocol}//${u.hostname}/*`;
}

/** Everything one request needs. */
export interface Api {
  baseUrl: string;
  key: string;
  /** For messages: "OpenRouter", "AvalAI", or the custom host. */
  name: string;
  /** Where credit is topped up, for the "credit ran out" message; "" when unknown. */
  creditSite: string;
  /** OpenRouter extras: per-request cost, the credit endpoint and the X-Title header. */
  openrouter: boolean;
}

export function makeApi(id: ProviderId, baseUrl: string, key: string): Api {
  const p = PROVIDERS[id];
  let host = "";
  try {
    host = new URL(baseUrl).hostname;
  } catch {
    // leave empty: the request will fail with the network message
  }
  return {
    baseUrl,
    key,
    name: id === "custom" ? host || "your AI provider" : p.label,
    creditSite: id === "custom" ? "" : p.keysText.split("/")[0],
    openrouter: id === "openrouter",
  };
}

/** The saved connection as an Api, or null when the custom address is missing or invalid. */
export function apiFor(s: { provider: ProviderId; baseUrl: string; apiKey: string }): Api | null {
  const url = baseUrlFor(s.provider, s.baseUrl);
  return url ? makeApi(s.provider, url, s.apiKey) : null;
}
