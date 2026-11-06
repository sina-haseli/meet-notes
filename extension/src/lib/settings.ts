import type { MeetingType } from "../types";

export interface Settings {
  openrouterKey: string;
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

export const DEFAULT_MODELS: Settings["models"] = {
  transcribe: "google/gemini-2.5-flash",
  vision: "google/gemini-2.5-flash",
  notes: "anthropic/claude-sonnet-5.5",
};
export const HELPER_URL = "http://127.0.0.1:47821";

export interface StorageArea {
  get(keys: string | string[]): Promise<Record<string, unknown>>;
  set(items: Record<string, unknown>): Promise<void>;
}

const KEY = "settings";

function defaults(): Settings {
  return {
    openrouterKey: "",
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
  const saved = got[KEY] as Partial<Settings> | undefined;
  if (!saved) {
    if (typeof got.token === "string") base.helper.token = got.token;
    if (typeof got.selfName === "string") base.selfName = got.selfName;
    return base;
  }
  return {
    ...base,
    ...saved,
    models: { ...base.models, ...(saved.models ?? {}) },
    helper: { ...base.helper, ...(saved.helper ?? {}) },
  };
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
