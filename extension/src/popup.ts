import type { MeetingType } from "./types";
import type { Ack, StatusResponse } from "./messages";
import { PERMISSION_PATH } from "./messages";

const MEET_PREFIX = "https://meet.google.com/";

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const typeSel = $<HTMLSelectElement>("type");
const titleIn = $<HTMLInputElement>("title");
const toggle = $<HTMLButtonElement>("toggle");
const timer = $<HTMLSpanElement>("timer");
const statusBox = $<HTMLDivElement>("status");
const statusText = $<HTMLSpanElement>("statusText");
const retryBtn = $<HTMLButtonElement>("retry");
const detail = $<HTMLDivElement>("detail");
const notMeet = $<HTMLDivElement>("notMeet");
const settings = $<HTMLDetailsElement>("settings");
const tokenIn = $<HTMLInputElement>("token");
const nameIn = $<HTMLInputElement>("selfName");
const saveBtn = $<HTMLButtonElement>("save");
const savedEl = $<HTMLSpanElement>("saved");

let activeTabId: number | undefined;
let onMeet = false;
let busy = false;
let last: StatusResponse = { state: "idle", elapsedMs: 0 };
let message = ""; // transient local message (overrides the status line until the next action)
let messageIsError = false;

function fmt(ms: number): string {
  const s = Math.floor(ms / 1000);
  const hh = Math.floor(s / 3600);
  const mm = String(Math.floor((s % 3600) / 60)).padStart(2, "0");
  const ss = String(s % 60).padStart(2, "0");
  return hh > 0 ? `${hh}:${mm}:${ss}` : `${mm}:${ss}`;
}

function say(text: string, isError = false): void {
  message = text;
  messageIsError = isError;
  render();
}

function render(): void {
  const st = last.state;
  notMeet.classList.toggle("hidden", onMeet || st === "recording");
  timer.textContent = fmt(last.elapsedMs);

  const recording = st === "recording";
  toggle.textContent = recording ? "Stop" : st === "uploading" ? "Uploading…" : "Start";
  toggle.disabled =
    busy || st === "uploading" || st === "upload-failed" || (!recording && !onMeet);
  typeSel.disabled = titleIn.disabled = recording || st === "uploading";

  retryBtn.classList.toggle("hidden", st !== "upload-failed");
  retryBtn.disabled = busy;

  let text = "";
  let isError = false;
  detail.textContent = "";
  if (st === "recording") text = "Recording…";
  else if (st === "uploading") text = "Uploading to the helper…";
  else if (st === "upload-failed") {
    text = "Upload failed —";
    isError = true;
    detail.textContent = last.error ?? "";
  } else if (st === "done") text = `Uploaded. The helper is processing ${last.meetingId ?? "the meeting"}.`;
  else if (st === "idle" && last.error) {
    text = last.error; // e.g. "Recording lost: …" after the kept recording disappeared
    isError = true;
  }
  if (message) {
    text = message;
    isError = messageIsError;
  }
  statusText.textContent = text;
  statusBox.classList.toggle("error", isError);
}

async function refresh(): Promise<void> {
  try {
    const s = (await chrome.runtime.sendMessage({ type: "status" })) as StatusResponse | undefined;
    if (s) last = s;
  } catch {
    // background starting up; try again on the next tick
  }
  render();
}

async function onStart(): Promise<void> {
  const { token = "", selfName = "" } = await chrome.storage.local.get(["token", "selfName"]);
  if (!token || !selfName) {
    settings.open = true;
    say("Set the helper token and your name in Settings first.", true);
    return;
  }
  const perm = await navigator.permissions
    .query({ name: "microphone" as PermissionName })
    .catch(() => null);
  if (perm?.state !== "granted") {
    say("Grant microphone access in the new tab, then press Start again.");
    await chrome.tabs.create({ url: chrome.runtime.getURL(PERMISSION_PATH) });
    return;
  }
  if (activeTabId === undefined) return;
  const streamId = await chrome.tabCapture.getMediaStreamId({ targetTabId: activeTabId });
  const res = (await chrome.runtime.sendMessage({
    type: "start",
    tabId: activeTabId,
    streamId,
    meetingType: typeSel.value as MeetingType,
    title: titleIn.value.trim(),
  })) as Ack | undefined;
  if (!res?.ok) say(res?.error ?? "Could not start recording.", true);
}

async function act(fn: () => Promise<void>): Promise<void> {
  if (busy) return;
  busy = true;
  message = "";
  render();
  try {
    await fn();
  } catch (e) {
    say(e instanceof Error ? e.message : String(e), true);
  } finally {
    busy = false;
    await refresh();
  }
}

toggle.addEventListener("click", () =>
  act(async () => {
    if (last.state === "recording") {
      const res = (await chrome.runtime.sendMessage({ type: "stop" })) as Ack | undefined;
      if (!res?.ok) say(res?.error ?? "Could not stop.", true);
    } else {
      await onStart();
    }
  }),
);

retryBtn.addEventListener("click", () =>
  act(async () => {
    const res = (await chrome.runtime.sendMessage({ type: "retry-upload" })) as Ack | undefined;
    if (!res?.ok) say(res?.error ?? "Retry failed.", true);
  }),
);

saveBtn.addEventListener("click", async () => {
  await chrome.storage.local.set({ token: tokenIn.value.trim(), selfName: nameIn.value.trim() });
  savedEl.textContent = "Saved";
  setTimeout(() => (savedEl.textContent = ""), 1500);
});

async function init(): Promise<void> {
  const { token = "", selfName = "", lastType = "technical" } = await chrome.storage.local.get([
    "token",
    "selfName",
    "lastType",
  ]);
  tokenIn.value = String(token);
  nameIn.value = String(selfName);
  typeSel.value = String(lastType);
  if (!token || !selfName) settings.open = true;
  typeSel.addEventListener("change", () => void chrome.storage.local.set({ lastType: typeSel.value }));

  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  activeTabId = tab?.id;
  onMeet = typeof tab?.url === "string" && tab.url.startsWith(MEET_PREFIX);

  await refresh();
  setInterval(() => void refresh(), 500);
}

void init();
