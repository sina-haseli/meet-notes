import type { MeetingType } from "../types";
import { isProviderId, PROVIDERS, type ProviderId } from "./provider";

export interface Settings {
  /** The AI service; requests go to its address, or to `baseUrl` for "custom". */
  provider: ProviderId;
  /** The API address for the "custom" provider (kept when another provider is chosen). */
  baseUrl: string;
  apiKey: string;
  selfName: string;
  role: "" | "pm" | "technical";
  servicesFolderName: string;
  servicesSkipped: boolean;
  setupStep: 1 | 2 | 3;
  setupDone: boolean;
  models: { transcribe: string; vision: string; notes: string };
  helper: { enabled: boolean; url: string; token: string };
  lastType: MeetingType;
  codeSuggestions: boolean;
}

/** OpenRouter's default models (the default provider). */
export const DEFAULT_MODELS: Settings["models"] = { ...PROVIDERS.openrouter.models };
export const HELPER_URL = "http://127.0.0.1:47821";

export interface StorageArea {
  get(keys: string | string[]): Promise<Record<string, unknown>>;
  set(items: Record<string, unknown>): Promise<void>;
}

const KEY = "settings";

function defaults(): Settings {
  return {
    provider: "openrouter",
    baseUrl: "",
    apiKey: "",
    selfName: "",
    role: "",
    servicesFolderName: "",
    servicesSkipped: false,
    setupStep: 1,
    setupDone: false,
    models: { ...DEFAULT_MODELS },
    helper: { enabled: false, url: HELPER_URL, token: "" },
    lastType: "technical",
    codeSuggestions: false,
  };
}

function area(store?: StorageArea): StorageArea {
  return store ?? (chrome.storage.local as unknown as StorageArea);
}

export async function getSettings(store?: StorageArea): Promise<Settings> {
  const st = area(store);
  const got = await st.get([KEY, "token", "selfName"]);
  const base = defaults();
  const saved = got[KEY] as (Partial<Settings> & { openrouterKey?: unknown }) | undefined;
  if (!saved) {
    if (typeof got.token === "string") base.helper.token = got.token;
    if (typeof got.selfName === "string") base.selfName = got.selfName;
    return base;
  }
  // Before providers could be chosen, the key was saved as `openrouterKey`.
  const { openrouterKey, ...rest } = saved;
  const out: Settings = {
    ...base,
    ...rest,
    models: { ...base.models, ...(saved.models ?? {}) },
    helper: { ...base.helper, ...(saved.helper ?? {}) },
  };
  if (saved.apiKey === undefined && typeof openrouterKey === "string") out.apiKey = openrouterKey;
  if (!isProviderId(out.provider)) out.provider = "openrouter";
  return out;
}

export async function saveSettings(patch: Partial<Settings>, store?: StorageArea): Promise<Settings> {
  const st = area(store);
  const cur = await getSettings(st);
  const next: Settings = {
    ...cur,
    ...patch,
    models: { ...cur.models, ...(patch.models ?? {}) },
    helper: { ...cur.helper, ...(patch.helper ?? {}) },
  };
  await st.set({ [KEY]: next });
  return next;
}
