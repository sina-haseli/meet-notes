// The Settings page: AI provider & key, name/role, services folder, Advanced (models, local helper), storage.
import { getSettings, saveSettings, type Settings } from "./lib/settings";
import { baseUrlFor, defaultModels, isProviderId, makeApi, normalizeBaseUrl, PROVIDERS, type ProviderId } from "./lib/provider";
import { hasHostAccess, requestHostAccess } from "./lib/hostAccess";
import { checkKey } from "./lib/openrouter";
import { checkKeyThenSave, keyCheckText, setupState } from "./lib/setupFlow";
import { putHandle, getHandle, deleteHandle, listMeetings, deleteMeeting } from "./lib/db";
import type { PermissionQueryable } from "./lib/servicesSnapshot";
import { formatBytes } from "./lib/storageUsage";
import { twoClick } from "./lib/dom";
import { codeSwitchState } from "./lib/codeSwitch";

const KEY_DEBOUNCE_MS = 600;
const HELPER_ORIGIN = "http://127.0.0.1:47821/*";

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;

let settings: Settings;

// Settings writes are read-modify-write: run them one at a time so quick edits don't drop each other.
let saveChain: Promise<unknown> = Promise.resolve();
function save(patch: Partial<Settings>): Promise<void> {
  settings = {
    ...settings,
    ...patch,
    models: { ...settings.models, ...(patch.models ?? {}) },
    helper: { ...settings.helper, ...(patch.helper ?? {}) },
  };
  const p = saveChain.then(() => saveSettings(patch));
  saveChain = p.catch(() => undefined);
  return p.then(
    () => undefined,
    (e) => console.warn("could not save settings", e),
  );
}

/** Keeps setupDone in step with the other fields (the popup gates Start on it). */
function syncSetupDone(): Promise<void> {
  const done = setupState(settings).done;
  return done === settings.setupDone ? Promise.resolve() : save({ setupDone: done });
}

// ---------- AI provider & key ----------

let keySeq = 0;
let keyTimer: number | undefined;
/** The provider being picked. It is saved, with its key, only once that key checks out. */
let draft: { provider: ProviderId; baseUrl: string };

const providerSel = $<HTMLSelectElement>("provider");
const baseUrlIn = $<HTMLInputElement>("baseUrl");
const keyIn = $<HTMLInputElement>("key");

function draftIsSaved(): boolean {
  return (
    draft.provider === settings.provider &&
    (draft.provider !== "custom" || normalizeBaseUrl(draft.baseUrl) === normalizeBaseUrl(settings.baseUrl))
  );
}

function renderKey(): void {
  const k = settings.apiKey;
  $("keyMasked").textContent = k ? `••••${k.slice(-4)}` : "No key yet";
  $("keyChange").textContent = k ? "Change" : "Add key";
}

function renderProvider(): void {
  providerSel.value = draft.provider;
  $("baseUrlField").hidden = draft.provider !== "custom";
  if (baseUrlIn.value.trim() !== draft.baseUrl) baseUrlIn.value = draft.baseUrl;
  const p = PROVIDERS[draft.provider];
  keyIn.placeholder = p.keyPlaceholder;
  const hint = $("keyHint");
  if (p.keysUrl) {
    const a = document.createElement("a");
    a.href = p.keysUrl;
    a.target = "_blank";
    a.rel = "noopener";
    a.textContent = p.keysText;
    hint.replaceChildren("Create a key at ", a, ".");
  } else {
    hint.replaceChildren("Use the API key your provider gave you.");
  }
}

function setKeyStatus(text: string, kind: "hint" | "ok" | "err", action?: { label: string; run: () => void }): void {
  const el = $("keyStatus");
  el.className = `msg ${kind === "ok" ? "mn-ok-text" : kind === "err" ? "mn-err-text" : "mn-hint"}`;
  el.replaceChildren(text);
  if (action) {
    const a = document.createElement("a");
    a.href = "#";
    a.className = "mn-link";
    a.textContent = action.label;
    a.addEventListener("click", (e) => {
      e.preventDefault();
      action.run();
    });
    el.append(" ", a);
  }
}

/** Offers the Allow link that asks Chrome for access to `url`, then checks `key` again. */
function askAccess(url: string, key: string, text: string): void {
  setKeyStatus(text, "err", {
    label: "Allow",
    run: () =>
      void requestHostAccess(url).then((ok) => {
        if (ok) void runKeyCheck(key);
        else askAccess(url, key, "Permission was not given. Press Allow to try again.");
      }),
  });
}

/** Checks `key` against the picked provider; only a key that checks out replaces the saved one. */
async function runKeyCheck(key: string): Promise<void> {
  const seq = ++keySeq;
  const { provider } = draft;
  const url = baseUrlFor(provider, draft.baseUrl);
  if (!url) {
    setKeyStatus("Enter the API address, starting with https://.", "err");
    return;
  }
  if (!(await hasHostAccess(url))) {
    if (seq === keySeq) askAccess(url, key, `Chrome needs your permission for Meet Notes to reach ${new URL(url).hostname}.`);
    return;
  }
  setKeyStatus("Checking your key…", "hint");
  const res = await checkKeyThenSave(key, (k) => checkKey(makeApi(provider, url, k)), () => seq === keySeq, async (k) => {
    const changed = provider !== settings.provider;
    await save({
      provider,
      apiKey: k,
      ...(provider === "custom" ? { baseUrl: url } : {}),
      ...(changed ? { models: defaultModels(provider) } : {}),
    });
    draft = { provider: settings.provider, baseUrl: settings.baseUrl };
    renderKey();
    renderProvider();
    renderModels();
    await syncSetupDone();
  });
  if (!res) return; // superseded by a newer key or provider
  if (res.ok) setKeyStatus(keyCheckText(res), "ok");
  else {
    const kept = settings.apiKey ? " Your saved provider and key were not changed." : "";
    setKeyStatus(`${keyCheckText(res)}${kept}`, "err", { label: "Retry", run: () => void runKeyCheck(key) });
  }
}

function scheduleKeyCheck(key: string): void {
  if (keyTimer !== undefined) clearTimeout(keyTimer);
  keyTimer = window.setTimeout(() => void runKeyCheck(key), KEY_DEBOUNCE_MS);
}

/** After the provider or address changed: ask for a key, or go back to the saved connection. */
function onDraftChanged(): void {
  keySeq++; // drops any check still in flight
  if (keyTimer !== undefined) clearTimeout(keyTimer);
  if (draftIsSaved() && settings.apiKey) {
    $("keyEdit").hidden = true;
    keyIn.value = "";
    setKeyStatus("", "hint");
    return;
  }
  $("keyEdit").hidden = false;
  // A new address for the same custom provider is tried with the saved key until another is typed.
  const key = keyIn.value.trim() || (draft.provider === settings.provider ? settings.apiKey : "");
  if (key) {
    setKeyStatus("", "hint");
    scheduleKeyCheck(key);
  } else {
    const kept = settings.apiKey ? " Your current provider and key are kept until the new key is checked." : "";
    setKeyStatus(`Paste your ${PROVIDERS[draft.provider].label} key.${kept}`, "hint");
    keyIn.focus();
  }
}

providerSel.addEventListener("change", () => {
  const v = providerSel.value;
  if (!isProviderId(v)) return;
  draft = { provider: v, baseUrl: draft.baseUrl || settings.baseUrl };
  renderProvider();
  onDraftChanged();
});

baseUrlIn.addEventListener("input", () => {
  draft = { ...draft, baseUrl: baseUrlIn.value.trim() };
  onDraftChanged();
});

$("keyChange").addEventListener("click", () => {
  $("keyEdit").hidden = false;
  keyIn.value = "";
  keyIn.focus();
  setKeyStatus("Paste the new key. The old one is kept until the new one is checked.", "hint");
});

keyIn.addEventListener("input", () => {
  const key = keyIn.value.trim();
  keySeq++;
  if (keyTimer !== undefined) clearTimeout(keyTimer);
  setKeyStatus("", "hint");
  if (!key) return;
  // Saved only once the check passes (runKeyCheck): the old key stays until then.
  scheduleKeyCheck(key);
});

// ---------- name & role ----------

function renderCodeSwitch(): void {
  const st = codeSwitchState(settings, settings.servicesFolderName !== "");
  const box = $<HTMLInputElement>("codeOn");
  box.checked = st.checked;
  box.disabled = st.disabled;
  $("codeHint").textContent = st.hint ?? "";
}

$<HTMLInputElement>("codeOn").addEventListener("change", (e) => {
  void save({ codeSuggestions: (e.target as HTMLInputElement).checked });
});

function renderRole(): void {
  renderCodeSwitch();
  $("roleSeg")
    .querySelectorAll<HTMLButtonElement>("button")
    .forEach((b) => b.classList.toggle("on", b.dataset.role === settings.role));
}

$<HTMLInputElement>("name").addEventListener("input", (e) => {
  void save({ selfName: (e.target as HTMLInputElement).value.trim() }).then(syncSetupDone);
});

$("roleSeg").addEventListener("click", (e) => {
  const b = (e.target as HTMLElement).closest<HTMLButtonElement>("button[data-role]");
  if (!b) return;
  void save({ role: b.dataset.role as Settings["role"] }).then(syncSetupDone);
  renderRole();
});

// ---------- services folder ----------

interface DirectoryPickerWindow {
  showDirectoryPicker?(opts?: { mode?: "read" | "readwrite" }): Promise<FileSystemDirectoryHandle>;
}

async function folderPermission(): Promise<PermissionState | "none"> {
  if (!settings.servicesFolderName) return "none";
  try {
    const h = await getHandle("services");
    if (!h) return "prompt"; // the name is saved but the handle is gone: choose again
    return await (h as unknown as PermissionQueryable).queryPermission({ mode: "read" });
  } catch {
    return "prompt";
  }
}

async function renderFolder(): Promise<void> {
  const has = settings.servicesFolderName !== "";
  $("folderNone").hidden = has;
  $("folderSet").hidden = !has;
  $("folderName").textContent = settings.servicesFolderName;
  const perm = await folderPermission();
  $("folderPerm").hidden = !(has && perm !== "granted");
  renderCodeSwitch();
}

async function chooseFolder(): Promise<void> {
  $("folderMsg").textContent = "";
  const picker = (window as unknown as DirectoryPickerWindow).showDirectoryPicker;
  if (!picker) {
    $("folderMsg").textContent = "This browser cannot choose a folder.";
    return;
  }
  let h: FileSystemDirectoryHandle;
  try {
    h = await picker.call(window, { mode: "read" });
  } catch (e) {
    if (e instanceof DOMException && e.name === "AbortError") return; // cancelled
    $("folderMsg").textContent = "Could not open that folder. Choose it again.";
    return;
  }
  try {
    await putHandle("services", h);
  } catch {
    $("folderMsg").textContent = "Could not remember that folder. Choose it again.";
    return;
  }
  await save({ servicesFolderName: h.name, servicesSkipped: false });
  await syncSetupDone();
  $("chooseFolder").classList.remove("highlight");
  $("changeFolder").classList.remove("highlight");
  await renderFolder();
}

$("chooseFolder").addEventListener("click", () => void chooseFolder());
$("changeFolder").addEventListener("click", () => void chooseFolder());

$("removeFolder").addEventListener("click", async () => {
  $("folderMsg").textContent = "";
  try {
    await deleteHandle("services");
  } catch {
    // the handle may already be gone
  }
  // "Remove" is a choice to go without a folder, so setup stays complete for technical users.
  await save({ servicesFolderName: "", servicesSkipped: true });
  await syncSetupDone();
  await renderFolder();
});

$("allowFolder").addEventListener("click", async () => {
  $("folderMsg").textContent = "";
  try {
    const h = await getHandle("services");
    if (!h) throw new Error("no handle");
    const res = await (h as unknown as PermissionQueryable).requestPermission({ mode: "read" });
    if (res !== "granted") $("folderMsg").textContent = "Permission was not given. Press Allow to try again.";
  } catch {
    $("folderMsg").textContent = "Could not get permission. Choose the folder again.";
  }
  await renderFolder();
});

// ---------- advanced: models ----------

const MODEL_FIELDS = { transcribe: "mTranscribe", vision: "mVision", notes: "mNotes" } as const;
type ModelKey = keyof typeof MODEL_FIELDS;

function renderModels(): void {
  for (const k of Object.keys(MODEL_FIELDS) as ModelKey[]) $<HTMLInputElement>(MODEL_FIELDS[k]).value = settings.models[k];
}

for (const k of Object.keys(MODEL_FIELDS) as ModelKey[]) {
  const input = $<HTMLInputElement>(MODEL_FIELDS[k]);
  input.addEventListener("input", () => {
    const v = input.value.trim();
    if (v) void save({ models: { ...settings.models, [k]: v } });
  });
  input.addEventListener("blur", () => {
    // An empty field falls back to the default rather than saving nothing.
    if (!input.value.trim()) {
      const d = defaultModels(settings.provider)[k];
      input.value = d;
      void save({ models: { ...settings.models, [k]: d } });
    }
  });
}
document.querySelectorAll<HTMLButtonElement>("button[data-reset]").forEach((b) =>
  b.addEventListener("click", () => {
    const k = b.dataset.reset as ModelKey;
    const d = defaultModels(settings.provider)[k];
    $<HTMLInputElement>(MODEL_FIELDS[k]).value = d;
    void save({ models: { ...settings.models, [k]: d } });
  }),
);

// ---------- advanced: local helper ----------

const helperOn = $<HTMLInputElement>("helperOn");
const helperUrl = $<HTMLInputElement>("helperUrl");
const helperToken = $<HTMLInputElement>("helperToken");

helperOn.addEventListener("change", async () => {
  $("helperMsg").textContent = "";
  if (helperOn.checked) {
    let granted = false;
    try {
      granted = await chrome.permissions.request({ origins: [HELPER_ORIGIN] });
    } catch {
      granted = false;
    }
    if (!granted) {
      helperOn.checked = false;
      $("helperMsg").textContent = "Permission is needed to talk to the local helper.";
      return;
    }
  }
  void save({ helper: { ...settings.helper, enabled: helperOn.checked } });
});
helperUrl.addEventListener("input", () => void save({ helper: { ...settings.helper, url: helperUrl.value.trim() } }));
helperToken.addEventListener("input", () => void save({ helper: { ...settings.helper, token: helperToken.value.trim() } }));
$("helperConnect").addEventListener("click", () => {
  const base = helperUrl.value.trim().replace(/\/+$/, "");
  if (base) void chrome.tabs.create({ url: `${base}/pair` });
});

// ---------- storage ----------

async function renderUsage(): Promise<void> {
  let used = 0;
  try {
    used = (await navigator.storage.estimate()).usage ?? 0;
  } catch {
    // leave 0
  }
  $("usage").textContent = `Using ${formatBytes(used)}`;
}

twoClick($<HTMLButtonElement>("deleteAll"), "Delete all meetings", "Click again to delete all meetings", async () => {
  const all = await listMeetings();
  const busy = (s: string) => s === "recording" || s === "processing";
  const keep = all.filter((m) => busy(m.status));
  const del = all.filter((m) => !busy(m.status));
  for (const m of del) await deleteMeeting(m.id);
  $("storageMsg").textContent =
    `Deleted ${del.length} meeting${del.length === 1 ? "" : "s"}.` +
    (keep.length ? ` Kept ${keep.length} that ${keep.length === 1 ? "is" : "are"} still recording or processing.` : "");
  await renderUsage();
});

// ---------- start-up ----------

async function init(): Promise<void> {
  settings = await getSettings();
  draft = { provider: settings.provider, baseUrl: settings.baseUrl };
  renderProvider();
  renderKey();
  $("keyEdit").hidden = settings.apiKey !== "";
  $<HTMLInputElement>("name").value = settings.selfName;
  renderRole();
  renderModels();
  helperOn.checked = settings.helper.enabled;
  helperUrl.value = settings.helper.url;
  helperToken.value = settings.helper.token;
  await renderFolder();
  await renderUsage();

  if (new URLSearchParams(location.search).get("pick") === "folder") {
    const btn = settings.servicesFolderName ? $("changeFolder") : $("chooseFolder");
    $("secFolder").scrollIntoView({ block: "center" });
    btn.classList.add("highlight");
    btn.focus({ preventScroll: true });
  }
}

void init();
