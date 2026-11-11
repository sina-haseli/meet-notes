// The toolbar popup: first-time setup (3 steps), then idle / recording, interrupted recordings,
// helper-mode upload states and the Recent list.
import type { MeetingRecord, MeetingType } from "./types";
import type { Ack, PopupMsg, StatusResponse } from "./messages";
import { MEETING_PATH, PERMISSION_PATH } from "./messages";
import { getSettings, saveSettings, type Settings } from "./lib/settings";
import { checkKey } from "./lib/openrouter";
import { baseUrlFor, defaultModels, isProviderId, makeApi, PROVIDERS } from "./lib/provider";
import { hasHostAccess, requestHostAccess } from "./lib/hostAccess";
import { listMeetings } from "./lib/db";
import { keyCheckText, nextStep, setupState, type SetupStep } from "./lib/setupFlow";
import {
  badgeFor,
  dateLine,
  displayTitle,
  fmtDuration,
  fmtTimer,
  progressFor,
  stepText,
  stripMeetSuffix,
} from "./lib/popupView";
import { helperMeetingUrl } from "./lib/meetingView";

const MEET_PREFIX = "https://meet.google.com/";
const SETTINGS_PATH = "dist/settings.html";
const MEETINGS_PATH = "dist/meetings.html";
const KEY_DEBOUNCE_MS = 600;
const ARM_MS = 4000;
const RECENT_COUNT = 5;

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;

// ---------- state ----------

let settings: Settings;
let activeTabId: number | undefined;
let onMeet = false;
let last: StatusResponse = { state: "idle", elapsedMs: 0 };
let meetings: MeetingRecord[] = [];
let busy = false;
let message = ""; // transient line in the main card (overrides the status line until the next action)
let messageIsError = false;
/** Two-click actions: "save" (save audio & discard) or "del:<meeting id>". */
let armed: string | null = null;
let armTimer: number | undefined;
let view: "setup" | "main" | null = null;

// Settings writes are read-modify-write: run them one at a time so quick edits don't drop each other.
let saveChain: Promise<unknown> = Promise.resolve();
function save(patch: Partial<Settings>): Promise<void> {
  settings = { ...settings, ...patch };
  const p = saveChain.then(() => saveSettings(patch));
  saveChain = p.catch(() => undefined);
  return p.then(
    () => undefined,
    (e) => console.warn("could not save settings", e),
  );
}

function openTab(url: string): void {
  void chrome.tabs.create({ url });
}
const extUrl = (path: string) => chrome.runtime.getURL(path);

function send<T = Ack>(msg: PopupMsg): Promise<T | undefined> {
  return chrome.runtime.sendMessage(msg) as Promise<T | undefined>;
}

// ================= setup =================

let setupStepShown: SetupStep = 1;
let keySeq = 0;
let keyTimer: number | undefined;
let keyOk = false;
/** "provider|address|key" of the last check, so a reopened popup does not check the same key again. */
let checkedKey = "";

const providerSel = $<HTMLSelectElement>("provider");
const baseUrlIn = $<HTMLInputElement>("baseUrl");
const keyIn = $<HTMLInputElement>("key");
const keyStatus = $("keyStatus");
const next1 = $<HTMLButtonElement>("next1");
const nameIn = $<HTMLInputElement>("name");
const next2 = $<HTMLButtonElement>("next2");

function showSetup(step: SetupStep): void {
  view = "setup";
  setupStepShown = step;
  $("setup").hidden = false;
  $("main").hidden = true;
  $("stepLabel").textContent = `Step ${step} of 3`;
  $("stepBar")
    .querySelectorAll("span")
    .forEach((el, i) => el.classList.toggle("on", i < step));
  for (const n of [1, 2, 3] as const) $(`step${n}`).hidden = n !== step;
  if (step === 1) {
    providerSel.value = settings.provider;
    baseUrlIn.value = settings.baseUrl;
    renderProvider();
    keyIn.value = settings.apiKey;
    const key = settings.apiKey;
    if (!key) setKeyStatus("", "hint");
    else if (!(keyOk && checkedKey === connectionId(key))) void runKeyCheck(key);
    keyIn.focus();
  } else if (step === 2) {
    nameIn.value = settings.selfName;
    renderStep2();
    if (!nameIn.value) nameIn.focus();
  }
}

function connectionId(key: string): string {
  return `${settings.provider}|${baseUrlFor(settings.provider, settings.baseUrl) ?? ""}|${key}`;
}

/** The address field (Other only), the key placeholder and the "create a key at" hint. */
function renderProvider(): void {
  const p = PROVIDERS[settings.provider];
  $("baseUrlField").hidden = settings.provider !== "custom";
  keyIn.placeholder = p.keyPlaceholder;
  const hint = $("keyHint");
  if (p.keysUrl) {
    const a = document.createElement("a");
    a.href = p.keysUrl;
    a.textContent = p.keysText;
    a.addEventListener("click", (e) => {
      e.preventDefault();
      openTab(p.keysUrl);
    });
    hint.replaceChildren(`Meet Notes uses ${p.label} to write your notes. Create a key at `, a, " and paste it here.");
  } else {
    hint.replaceChildren("Any service with an OpenAI-compatible chat API that accepts audio and images. Paste its key here.");
  }
}

function setKeyStatus(text: string, kind: "hint" | "ok" | "err", action?: { label: string; run: () => void }): void {
  keyStatus.className = kind === "ok" ? "mn-ok-text" : kind === "err" ? "mn-err-text" : "mn-hint";
  keyStatus.replaceChildren(text);
  if (action) {
    const a = document.createElement("a");
    a.href = "#";
    a.className = "mn-link";
    a.textContent = action.label;
    a.addEventListener("click", (e) => {
      e.preventDefault();
      action.run();
    });
    keyStatus.append(" ", a);
  }
  next1.disabled = kind !== "ok";
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

async function runKeyCheck(key: string): Promise<void> {
  const seq = ++keySeq;
  keyOk = false;
  const { provider } = settings;
  const url = baseUrlFor(provider, settings.baseUrl);
  if (!url) {
    setKeyStatus("Enter the API address, starting with https://.", "err");
    return;
  }
  if (!(await hasHostAccess(url))) {
    if (seq === keySeq) askAccess(url, key, `Chrome needs your permission for Meet Notes to reach ${new URL(url).hostname}.`);
    return;
  }
  setKeyStatus("Checking your key…", "hint");
  const res = await checkKey(makeApi(provider, url, key));
  if (seq !== keySeq) return; // a field changed meanwhile
  keyOk = res.ok;
  checkedKey = connectionId(key);
  if (res.ok) setKeyStatus(keyCheckText(res), "ok");
  else setKeyStatus(keyCheckText(res), "err", { label: "Retry", run: () => void runKeyCheck(key) });
}

/** Any field of step 1 changed: drop the running check and check again after a pause. */
function recheckKey(): void {
  keySeq++; // drops any check still in flight
  keyOk = false;
  if (keyTimer !== undefined) clearTimeout(keyTimer);
  setKeyStatus("", "hint");
  const key = keyIn.value.trim();
  if (key) keyTimer = window.setTimeout(() => void runKeyCheck(key), KEY_DEBOUNCE_MS);
}

providerSel.addEventListener("change", () => {
  const v = providerSel.value;
  if (!isProviderId(v)) return;
  // Model names differ between providers, so a new provider starts from its own defaults.
  void save({ provider: v, models: defaultModels(v) });
  renderProvider();
  recheckKey();
});

baseUrlIn.addEventListener("input", () => {
  void save({ baseUrl: baseUrlIn.value.trim() });
  recheckKey();
});

keyIn.addEventListener("input", () => {
  // a pasted key with a trailing space is stored without it
  void save({ apiKey: keyIn.value.trim() });
  recheckKey();
});

next1.addEventListener("click", () => {
  if (!keyOk) return;
  void save({ setupStep: 2 });
  showSetup(2);
});

function renderStep2(): void {
  $("roleSeg")
    .querySelectorAll<HTMLButtonElement>("button")
    .forEach((b) => b.classList.toggle("on", b.dataset.role === settings.role));
  next2.disabled = nameIn.value.trim() === "" || settings.role === "";
  next2.textContent = settings.role === "pm" ? "Finish" : "Next →";
}

nameIn.addEventListener("input", () => {
  void save({ selfName: nameIn.value.trim() });
  renderStep2();
});

$("roleSeg").addEventListener("click", (e) => {
  const b = (e.target as HTMLElement).closest<HTMLButtonElement>("button[data-role]");
  if (!b) return;
  void save({ role: b.dataset.role as Settings["role"] });
  renderStep2();
});

$("back2").addEventListener("click", () => {
  void save({ setupStep: 1 });
  showSetup(1);
});

next2.addEventListener("click", async () => {
  if (next2.disabled) return;
  const n = nextStep(settings, 2);
  if (n === "done") await finishSetup({});
  else if (n === 3) {
    void save({ setupStep: 3 });
    showSetup(3);
  }
});

$("chooseFolder").addEventListener("click", () => {
  // A folder picker closes the popup, so the folder is chosen on the settings page.
  openTab(extUrl(`${SETTINGS_PATH}?pick=folder`));
});

$("back3").addEventListener("click", () => {
  void save({ setupStep: 2 });
  showSetup(2);
});

$("skip3").addEventListener("click", () => void finishSetup({ servicesSkipped: true }));

async function finishSetup(patch: Partial<Settings>): Promise<void> {
  await save(patch);
  if (setupState(settings).done) {
    await save({ setupDone: true });
    showMain();
  } else {
    showSetup(setupState(settings).step);
  }
}

/**
 * The step to show on open. A key saved while it was still being checked (the popup closed) counts
 * as step 1 until Next was pressed, so a wrong key is never carried past step 1 unnoticed; the saved
 * key is checked again straight away.
 */
function openingStep(s: Settings): SetupStep {
  const st = setupState(s);
  return st.step > 1 && s.setupStep === 1 ? 1 : st.step;
}

// ================= main: idle / recording =================

const titleIn = $<HTMLInputElement>("title");
const startBtn = $<HTMLButtonElement>("start");
const stopBtn = $<HTMLButtonElement>("stop");
const retryBtn = $<HTMLButtonElement>("retry");
const saveDiscardBtn = $<HTMLButtonElement>("saveDiscard");
const statusEl = $("status");

function showMain(): void {
  view = "main";
  $("setup").hidden = true;
  $("main").hidden = false;
  $("helperBadge").hidden = !settings.helper.enabled;
  renderChips();
  render();
  renderMeetings(true);
}

function disarm(): void {
  armed = null;
  if (armTimer !== undefined) clearTimeout(armTimer);
  armTimer = undefined;
}

function arm(key: string): void {
  disarm();
  armed = key;
  armTimer = window.setTimeout(() => {
    disarm();
    render();
    renderMeetings(true);
  }, ARM_MS);
}

function say(text: string, isError = false): void {
  message = text;
  messageIsError = isError;
  render();
}

function renderChips(): void {
  $("chips")
    .querySelectorAll<HTMLButtonElement>(".mn-chip")
    .forEach((b) => b.classList.toggle("on", b.dataset.type === settings.lastType));
}

function render(): void {
  if (view !== "main") return;
  const st = last.state;
  const recording = st === "recording";
  $("tabLine").textContent = recording ? "Recording" : onMeet ? "Meet tab detected" : "Open a Google Meet tab";

  $("idleView").hidden = recording || st === "uploading" || st === "upload-failed";
  $("recView").hidden = !recording;
  $("uploadView").hidden = st !== "uploading";
  $("failView").hidden = st !== "upload-failed";

  startBtn.disabled = busy || !onMeet || (st !== "idle" && st !== "done");
  stopBtn.disabled = busy;
  titleIn.disabled = busy;
  $("chips")
    .querySelectorAll<HTMLButtonElement>(".mn-chip")
    .forEach((b) => (b.disabled = busy));

  $("timer").textContent = fmtTimer(last.elapsedMs);
  const live = recording && last.meetingId ? meetings.find((m) => m.id === last.meetingId) : undefined;
  $("recTitle").textContent = live?.title ?? "";

  if (st !== "upload-failed" && armed === "save") disarm();
  $("failDetail").textContent = last.error ?? "";
  retryBtn.disabled = busy;
  saveDiscardBtn.disabled = busy;
  saveDiscardBtn.classList.toggle("armed", armed === "save");
  saveDiscardBtn.textContent = armed === "save" ? "Click again to save audio & discard" : "Save audio & discard";

  let text = "";
  let isError = false;
  if (st === "done") text = `Uploaded. The local helper is processing ${last.meetingId ?? "the meeting"}.`;
  else if (st === "idle" && last.error) {
    text = last.error;
    isError = true;
  } else if (st === "idle" && last.notice) text = last.notice;
  if (message) {
    text = message;
    isError = messageIsError;
  }
  statusEl.textContent = text;
  statusEl.classList.toggle("error", isError);
}

async function refreshStatus(): Promise<void> {
  try {
    const s = await send<StatusResponse>({ type: "status" });
    if (s) last = s;
  } catch {
    // background starting up; try again on the next tick
  }
  render();
}

async function act(fn: () => Promise<void>): Promise<void> {
  if (busy) return;
  busy = true;
  message = "";
  render();
  renderMeetings(true);
  try {
    await fn();
  } catch (e) {
    say(e instanceof Error ? e.message : String(e), true);
  } finally {
    busy = false;
    await refreshStatus();
    await refreshMeetings(true);
  }
}

async function onStart(): Promise<void> {
  // R7: no recording without finished setup.
  if (!setupState(settings).done) {
    showSetup(setupState(settings).step);
    return;
  }
  const perm = await navigator.permissions.query({ name: "microphone" as PermissionName }).catch(() => null);
  if (perm?.state !== "granted") {
    say("Allow microphone access in the new tab, then press Start recording again.");
    openTab(extUrl(PERMISSION_PATH));
    return;
  }
  if (activeTabId === undefined) return;
  const streamId = await chrome.tabCapture.getMediaStreamId({ targetTabId: activeTabId });
  const res = await send({
    type: "start",
    tabId: activeTabId,
    streamId,
    meetingType: settings.lastType,
    title: titleIn.value.trim(),
  });
  if (!res?.ok) say(res?.error ?? "Could not start recording. Press Start recording again.", true);
}

$("chips").addEventListener("click", (e) => {
  const b = (e.target as HTMLElement).closest<HTMLButtonElement>(".mn-chip");
  if (!b || b.disabled) return;
  void save({ lastType: b.dataset.type as MeetingType });
  renderChips();
});

startBtn.addEventListener("click", () => void act(onStart));

stopBtn.addEventListener("click", () =>
  act(async () => {
    const res = await send({ type: "stop" });
    if (!res?.ok) say(res?.error ?? "Could not stop. Press Stop recording again.", true);
  }),
);

retryBtn.addEventListener("click", () =>
  act(async () => {
    const res = await send({ type: "retry-upload" });
    if (!res?.ok) say(res?.error ?? "Retry failed.", true);
  }),
);

saveDiscardBtn.addEventListener("click", () => {
  if (armed !== "save") {
    arm("save");
    render();
    return;
  }
  disarm();
  void act(async () => {
    say("Saving the audio to your Downloads folder…");
    const res = await send({ type: "save-discard" });
    if (res?.ok) message = ""; // the status line now shows where the file was saved
    else say(res?.error ?? "Could not save the audio.", true);
  });
});

$("gear").addEventListener("click", () => openTab(extUrl(SETTINGS_PATH)));
$("seeAll").addEventListener("click", (e) => {
  e.preventDefault();
  openTab(extUrl(MEETINGS_PATH));
});

// ================= interrupted + Recent =================

let lastSignature = "";

function meetingUrl(r: MeetingRecord): string {
  // A stub without a helper URL opens the meeting page, which explains where the meeting lives.
  const helper = r.mode === "helper" && r.helperId ? helperMeetingUrl(settings.helper.url, r.helperId) : null;
  if (helper) return helper;
  return extUrl(`${MEETING_PATH}?id=${encodeURIComponent(r.id)}`);
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, text?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
}

function interruptedCard(r: MeetingRecord): HTMLElement {
  const card = el("section", "mn-card int-card");
  const head = el("div", "mn-t1", `Recording interrupted — ${displayTitle(r)}`);
  head.dir = "auto";
  const saved = fmtDuration(r.pcmSamples / 16); // 16 kHz: 16 samples per millisecond
  const info = el("div", "mn-hint", `The recording stopped unexpectedly. ${saved} of audio was saved.`);

  const actions = el("div", "mn-row actions");
  const process = el("button", "mn-btn", "Process what was saved");
  process.disabled = busy;
  process.addEventListener("click", () =>
    act(async () => {
      const res = await send({ type: "process-saved", meetingId: r.id });
      if (!res?.ok) say(res?.error ?? "Could not start processing. Try again.", true);
    }),
  );
  const del = deleteButton(r);
  actions.append(process, el("div", "mn-sp"), del);
  card.append(head, info, actions);
  return card;
}

function deleteButton(r: MeetingRecord): HTMLButtonElement {
  const key = `del:${r.id}`;
  const isArmed = armed === key;
  const b = el("button", `mn-btn-ghost${isArmed ? " armed" : ""}`, isArmed ? "Click again to delete" : "Delete");
  b.disabled = busy;
  b.addEventListener("click", () => {
    if (armed !== key) {
      arm(key);
      renderMeetings(true);
      return;
    }
    disarm();
    void act(async () => {
      const res = await send({ type: "delete-meeting", meetingId: r.id });
      if (!res?.ok) say(res?.error ?? "Could not delete the meeting.", true);
    });
  });
  return b;
}

function recentItem(r: MeetingRecord): HTMLElement {
  const item = el("button", "mn-item");
  item.type = "button";
  item.title = "Open this meeting";
  item.addEventListener("click", () => openTab(meetingUrl(r)));

  const main = el("div", "mn-main");
  const t1 = el("div", "mn-t1", displayTitle(r));
  t1.dir = "auto";
  main.append(t1);
  const step = stepText(r);
  if (step) {
    main.append(el("div", "mn-t2", step));
    if (r.status !== "naming") {
      const bar = el("div", "mn-progress");
      const fill = el("span");
      fill.style.width = `${Math.round(progressFor(r) * 100)}%`;
      bar.append(fill);
      main.append(bar);
    }
  } else if (r.status === "error") {
    const err = el("div", "mn-t2 err", r.error || "Processing failed. Open it to retry.");
    err.title = r.error ?? "";
    main.append(err);
  } else {
    main.append(el("div", "mn-t2", dateLine(r)));
  }
  const badge = badgeFor(r);
  item.append(el("div", "mn-ic", "☰"), main, el("span", `mn-badge ${badge.cls}`, badge.text));
  return item;
}

function signature(): string {
  return JSON.stringify([
    armed,
    busy,
    new Date().toDateString(), // "Today" / "Yesterday" roll over at midnight
    meetings.slice(0, RECENT_COUNT + 20).map((m) => [
      m.id,
      m.title,
      m.status,
      m.step,
      m.error,
      m.durationMs,
      m.pcmSamples,
      m.chunks?.length,
      m.chunkTurns?.filter((t) => t !== null).length,
    ]),
  ]);
}

function renderMeetings(force = false): void {
  if (view !== "main") return;
  const sig = signature();
  if (!force && sig === lastSignature) return;
  lastSignature = sig;

  const interrupted = meetings.filter((m) => m.status === "interrupted" && m.mode === "builtin");
  $("interrupted").replaceChildren(...interrupted.map(interruptedCard));

  const recent = meetings.slice(0, RECENT_COUNT);
  $("recentHead").hidden = recent.length === 0;
  $("recent").replaceChildren(...recent.map(recentItem));
}

async function refreshMeetings(force = false): Promise<void> {
  try {
    meetings = await listMeetings();
  } catch (e) {
    console.warn("could not read meetings", e);
  }
  renderMeetings(force);
}

// ================= start-up =================

async function init(): Promise<void> {
  settings = await getSettings();

  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  activeTabId = tab?.id;
  onMeet = typeof tab?.url === "string" && tab.url.startsWith(MEET_PREFIX);
  if (onMeet && tab?.title) titleIn.value = stripMeetSuffix(tab.title);

  await refreshStatus();
  await refreshMeetings();
  const st = setupState(settings);
  // A recording or upload in progress always shows its controls, whatever the setup says.
  const active = last.state !== "idle" && last.state !== "done";
  if (st.done || active) {
    if (st.done && !settings.setupDone) void save({ setupDone: true });
    showMain();
  } else {
    showSetup(openingStep(settings));
  }

  setInterval(() => void refreshStatus(), 500);
  setInterval(() => void refreshMeetings(), 1000);
}

void init();
