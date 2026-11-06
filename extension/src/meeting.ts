// The meeting page (dist/meeting.html?id=<id>): banners, speakers, and the Summary / AI notes /
// Transcript / Screens tabs with copy, Gmail draft and downloads.
import type { MeetingRecord } from "./types";
import type { Ack, PopupMsg } from "./messages";
import { getHandle, getMeeting, getWebm, listScreens, updateMeeting } from "./lib/db";
import { getSettings, type Settings } from "./lib/settings";
import { dateLine, displayTitle, progressFor, stepText, typeLabel } from "./lib/popupView";
import { applyRename, helperMeetingUrl, mmss, rerunFailedPatch, speakersOf } from "./lib/meetingView";
import { renderTranscriptMd } from "./lib/transcript";
import { clipboardHtml, renderMarkdownSafe } from "./lib/markdown";
import { gmailComposeUrl, meetingSubject } from "./lib/gmail";
import { buildMeetingZip, zipFileName } from "./lib/exportZip";
import { audioFileName } from "./lib/download";
import { readServicesContext } from "./lib/servicesContext";
import type { PermissionQueryable } from "./lib/servicesSnapshot";
import { el, saveBlob, twoClick } from "./lib/dom";

const SAVE_DEBOUNCE_MS = 800;
const POLL_MS = 1000;
const SETTINGS_PATH = "dist/settings.html";

type Tab = "summary" | "notes" | "transcript" | "screens";
type Doc = "summaryMd" | "notesMd";

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;

const id = new URLSearchParams(location.search).get("id") ?? "";
let rec: MeetingRecord | undefined;
let settings: Settings | undefined;
let tab: Tab = "summary";
let preview = false;
let renaming: string | null = null;
let busy = false;

const summaryTa = $<HTMLTextAreaElement>("summary");
const notesTa = $<HTMLTextAreaElement>("notes");
const areas: Record<Doc, HTMLTextAreaElement> = { summaryMd: summaryTa, notesMd: notesTa };
const dirty: Record<Doc, boolean> = { summaryMd: false, notesMd: false };

function send(msg: PopupMsg): Promise<Ack | undefined> {
  return chrome.runtime.sendMessage(msg) as Promise<Ack | undefined>;
}

function setMsg(elId: string, text: string, isError = false): void {
  const m = $(elId);
  m.textContent = text;
  m.classList.toggle("err", isError);
}

const isWorking = (r: MeetingRecord) => r.status === "queued" || r.status === "processing";
const isEditable = (r: MeetingRecord) => r.status === "ready" || r.status === "error";

// ================= saving edits =================

let saveTimer: number | undefined;

function setSaved(text: string, cls: "" | "ok" | "err" = ""): void {
  const s = $("saved");
  s.textContent = text;
  s.className = cls;
}

/** Writes pending edits now. Resolves false if they could not be saved. */
async function flush(): Promise<boolean> {
  if (saveTimer !== undefined) clearTimeout(saveTimer);
  saveTimer = undefined;
  const patch: Partial<MeetingRecord> = {};
  for (const d of ["summaryMd", "notesMd"] as const) {
    if (dirty[d]) {
      patch[d] = areas[d].value;
      dirty[d] = false;
    }
  }
  if (Object.keys(patch).length === 0) return true;
  setSaved("Saving…");
  try {
    rec = await updateMeeting(id, patch);
    // Typing during the write leaves the field dirty; it is saved by the next timer.
    setSaved(dirty.summaryMd || dirty.notesMd ? "Saving…" : "Saved", dirty.summaryMd || dirty.notesMd ? "" : "ok");
    return true;
  } catch {
    for (const d of Object.keys(patch) as Doc[]) dirty[d] = true;
    setSaved("Your edits could not be saved. Keep this tab open and type again to retry.", "err");
    return false;
  }
}

for (const d of ["summaryMd", "notesMd"] as const) {
  areas[d].addEventListener("input", () => {
    dirty[d] = true;
    setSaved("Saving…");
    if (saveTimer !== undefined) clearTimeout(saveTimer);
    saveTimer = window.setTimeout(() => void flush(), SAVE_DEBOUNCE_MS);
    if (d === "summaryMd" && preview) renderPreview();
  });
}
window.addEventListener("pagehide", () => void flush());
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "hidden") void flush();
});

// ================= header + banners =================

function renderHeader(r: MeetingRecord): void {
  const title = displayTitle(r);
  $("title").textContent = title;
  document.title = `${title} - Meet Notes`;
  $("headMeta").hidden = false;
  $("when").textContent = dateLine(r);
  $("typeChip").textContent = typeLabel(r.type);
  $("cost").textContent = `$${(r.costUsd ?? 0).toFixed(2)}`;
  $("cost").hidden = r.mode === "helper";
}

function renderBanners(r: MeetingRecord): void {
  // progress: queued / processing / still recording
  const step = stepText(r);
  const recording = r.status === "recording";
  $("progressCard").hidden = !step && !recording;
  if (step) {
    $("stepLine").textContent = step;
    $("progressBar").hidden = false;
    $("progressFill").style.width = `${Math.round(progressFor(r) * 100)}%`;
    $("progressHint").textContent =
      "You can close this tab. Meet Notes keeps working and notifies you when the notes are ready.";
  } else if (recording) {
    $("stepLine").textContent = "Recording…";
    $("progressBar").hidden = true;
    $("progressHint").textContent = "Stop the recording from the Meet Notes button in the toolbar.";
  }

  // error
  $("errorCard").hidden = r.status !== "error";
  if (r.status === "error") {
    $("errorText").textContent = r.error || "Processing failed. Press Retry.";
    $("errorDetail").textContent = r.errorDetail ?? "";
    $("errorDetails").hidden = !r.errorDetail;
    $<HTMLButtonElement>("retry").disabled = busy;
    $<HTMLButtonElement>("downloadAudio").disabled = busy || r.audioDeleted === true;
  }

  // interrupted
  $("interruptedCard").hidden = r.status !== "interrupted";
  $<HTMLButtonElement>("processSaved").disabled = busy;

  // services notice: only once processing is over (a running pipeline can't take a new context)
  $("noticeCard").hidden = !(r.servicesNotice && isEditable(r));
  $<HTMLButtonElement>("allowRetry").disabled = busy;
}

// ================= speakers =================

function renderSpeakers(r: MeetingRecord): void {
  const chips = speakersOf(r.turns ?? []);
  $("speakersRow").hidden = chips.length === 0;
  const box = $("speakers");
  box.replaceChildren();
  const canRename = isEditable(r) && !busy;
  for (const c of chips) {
    if (renaming === c.name) {
      box.append(renameInput(c.name));
      continue;
    }
    const chip = el("button", `mn-chip${c.uncertain ? " warn" : ""}`, c.uncertain ? `${c.name} → rename?` : c.name);
    chip.type = "button";
    chip.dir = "auto";
    chip.title = "Click to rename";
    chip.disabled = !canRename;
    chip.addEventListener("click", () => {
      renaming = c.name;
      renderSpeakers(r);
    });
    box.append(chip);
  }
  const input = box.querySelector<HTMLInputElement>("input");
  if (input) {
    input.focus();
    input.select();
  }
}

function renameInput(old: string): HTMLInputElement {
  const input = el("input", "mn-input rename-in");
  input.value = old;
  input.dir = "auto";
  input.setAttribute("aria-label", `New name for ${old}`);
  let done = false;
  const finish = (commit: boolean) => {
    if (done) return;
    done = true;
    renaming = null;
    const next = input.value.trim();
    if (commit && next && next !== old) void commitRename(old, next);
    else if (rec) renderSpeakers(rec);
  };
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter") finish(true);
    else if (e.key === "Escape") finish(false);
  });
  input.addEventListener("blur", () => finish(true));
  return input;
}

async function commitRename(old: string, next: string): Promise<void> {
  // Edits are saved first, so the rename applies to the text as the user left it.
  if (!(await flush())) {
    if (rec) renderSpeakers(rec);
    return;
  }
  try {
    const cur = await getMeeting(id);
    if (!cur) throw new Error("meeting not found");
    rec = await updateMeeting(id, applyRename(cur, old, next));
    setSaved("Saved", "ok");
  } catch {
    setSaved("The new name could not be saved. Try again.", "err");
  }
  if (rec) render(rec, true);
}

// ================= tabs =================

function showTab(t: Tab): void {
  tab = t;
  $("tabs")
    .querySelectorAll<HTMLButtonElement>("button")
    .forEach((b) => {
      const on = b.dataset.tab === t;
      b.classList.toggle("on", on);
      b.setAttribute("aria-selected", String(on));
    });
  for (const name of ["summary", "notes", "transcript", "screens"] as const) $(`pane-${name}`).hidden = name !== t;
  if (t === "screens") void loadScreens();
}

$("tabs").addEventListener("click", (e) => {
  const b = (e.target as HTMLElement).closest<HTMLButtonElement>("button[data-tab]");
  if (b) showTab(b.dataset.tab as Tab);
});

function renderPreview(): void {
  // Sanitized: raw HTML escaped, unsafe links and images dropped (lib/markdown).
  $("preview").innerHTML = renderMarkdownSafe(summaryTa.value);
}

function setPreview(on: boolean): void {
  preview = on;
  $("summaryMode")
    .querySelectorAll<HTMLButtonElement>("button")
    .forEach((b) => b.classList.toggle("on", (b.dataset.mode === "preview") === on));
  summaryTa.hidden = on;
  $("preview").hidden = !on;
  if (on) renderPreview();
}

$("summaryMode").addEventListener("click", (e) => {
  const b = (e.target as HTMLElement).closest<HTMLButtonElement>("button[data-mode]");
  if (b) setPreview(b.dataset.mode === "preview");
});

// ================= content =================

let transcriptKey = "";

function renderTranscript(r: MeetingRecord): void {
  const turns = r.turns ?? [];
  const key = `${turns.length}\u0000${speakersOf(turns).map((s) => `${s.name}:${s.uncertain}`).join("\u0000")}`;
  if (key === transcriptKey) return;
  transcriptKey = key;
  const box = $("transcript");
  if (!turns.length) {
    box.replaceChildren(el("div", "empty", isWorking(r) ? "The transcript is on its way…" : "No transcript."));
    return;
  }
  box.replaceChildren(
    ...turns.map((t) => {
      const row = el("div", `tline${t.uncertain ? " u" : ""}`);
      const who = el("span", "who", `${t.speaker}:`);
      who.dir = "auto";
      who.title = t.speaker;
      const txt = el("span", "txt", t.text);
      txt.dir = "auto";
      if (t.uncertain) txt.append(el("span", "unc", "(uncertain)"));
      row.append(el("span", "t", `[${mmss(t.startMs)}]`), who, txt);
      return row;
    }),
  );
}

let screenUrls: string[] = [];
let screensKey = "";

async function loadScreens(force = false): Promise<void> {
  if (!rec) return;
  const key = `${rec.screens?.length ?? -1}`;
  if (!force && key === screensKey) return;
  screensKey = key;
  let shots: { atMs: number; blob: Blob }[] = [];
  try {
    shots = await listScreens(id);
  } catch (e) {
    console.warn("could not read screenshots", e);
  }
  for (const u of screenUrls) URL.revokeObjectURL(u);
  screenUrls = [];
  const desc = new Map((rec.screens ?? []).map((s) => [s.atMs, s.description]));
  $("screensEmpty").hidden = shots.length > 0;
  $("screensTab").textContent = shots.length ? `Screens (${shots.length})` : "Screens";
  $("screens").replaceChildren(
    ...shots.map((s) => {
      const url = URL.createObjectURL(s.blob);
      screenUrls.push(url);
      const fig = el("figure", "shot");
      const open = el("button");
      open.type = "button";
      open.title = "Open full size";
      const img = el("img");
      img.src = url;
      img.alt = `Screen at ${mmss(s.atMs)}`;
      img.loading = "lazy";
      open.append(img);
      open.addEventListener("click", () => openLightbox(url, img.alt));
      const cap = el("figcaption");
      cap.append(el("span", "at", mmss(s.atMs)));
      const d = desc.get(s.atMs);
      if (d) {
        const span = el("span", "", d);
        span.dir = "auto";
        cap.append(span);
      }
      fig.append(open, cap);
      return fig;
    }),
  );
}

function openLightbox(url: string, alt: string): void {
  const img = $<HTMLImageElement>("lightboxImg");
  img.src = url;
  img.alt = alt;
  $("lightbox").hidden = false;
}
$("lightbox").addEventListener("click", () => ($("lightbox").hidden = true));
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") $("lightbox").hidden = true;
});

function hasContent(r: MeetingRecord): boolean {
  return r.status === "ready" || Boolean(r.turns?.length || r.summaryMd || r.notesMd);
}

/** `overwrite` replaces the text areas even when they hold unsaved edits (after a rename). */
function render(r: MeetingRecord, overwrite = false): void {
  for (const c of ["notFound", "helperCard"]) $(c).hidden = true;
  renderHeader(r);
  $("pageFoot").hidden = false;

  if (r.mode === "helper") {
    for (const c of ["progressCard", "errorCard", "interruptedCard", "noticeCard", "mainCard"]) $(c).hidden = true;
    $("helperCard").hidden = false;
    const link = $<HTMLAnchorElement>("helperLink");
    const url = r.helperId ? helperMeetingUrl(settings?.helper.url ?? "", r.helperId) : null;
    if (url) link.href = url;
    else link.removeAttribute("href");
    $("pageFoot").hidden = true;
    return;
  }

  renderBanners(r);
  $("mainCard").hidden = !hasContent(r);
  if ($("mainCard").hidden) return;

  const editable = isEditable(r);
  for (const d of ["summaryMd", "notesMd"] as const) {
    const ta = areas[d];
    if (overwrite || !dirty[d]) {
      if (overwrite) dirty[d] = false;
      if (ta.value !== (r[d] ?? "")) ta.value = r[d] ?? "";
    }
    ta.readOnly = !editable || busy; // no typing while a Retry is starting (nothing to overwrite mid-run)
    ta.placeholder = isWorking(r) ? "Being written…" : "";
  }
  if (preview) renderPreview();
  if (renaming === null) renderSpeakers(r);
  renderTranscript(r);
  if (tab === "screens") void loadScreens();
  else if (!screensKey) void loadScreens(); // fills the tab's count
  for (const b of ["copySummary", "openGmail", "copyNotes", "downloadZip", "copyTranscript", "downloadTranscript"]) {
    $<HTMLButtonElement>(b).disabled = isWorking(r) && b !== "copyTranscript" && b !== "downloadTranscript";
  }
}

// ================= actions =================

function flash(btn: HTMLButtonElement, text: string): void {
  const prev = btn.dataset.label ?? btn.textContent ?? "";
  btn.dataset.label = prev;
  btn.textContent = text;
  window.setTimeout(() => {
    btn.textContent = prev;
    delete btn.dataset.label;
  }, 1500);
}

async function copyText(text: string): Promise<void> {
  await navigator.clipboard.writeText(text);
}

/** Rich copy: sanitized HTML for email clients plus the Markdown as plain text. */
async function copyRich(md: string): Promise<void> {
  try {
    await navigator.clipboard.write([
      new ClipboardItem({
        "text/html": new Blob([clipboardHtml(md)], { type: "text/html" }),
        "text/plain": new Blob([md], { type: "text/plain" }),
      }),
    ]);
  } catch {
    await navigator.clipboard.writeText(md);
  }
}

async function guarded(btn: HTMLButtonElement, done: string, fn: () => Promise<void>): Promise<void> {
  setMsg("actionMsg", "");
  try {
    await fn();
    flash(btn, done);
  } catch (e) {
    console.warn(e);
    setMsg("actionMsg", "That didn't work. Click the page, then try again.", true);
  }
}

const btn = (bid: string) => $<HTMLButtonElement>(bid);

btn("copySummary").addEventListener("click", () =>
  guarded(btn("copySummary"), "Copied", () => copyRich(summaryTa.value)),
);
btn("openGmail").addEventListener("click", () => {
  if (rec) void chrome.tabs.create({ url: gmailComposeUrl(meetingSubject(rec)) });
});
btn("copyNotes").addEventListener("click", () => guarded(btn("copyNotes"), "Copied", () => copyText(notesTa.value)));
btn("downloadZip").addEventListener("click", () =>
  guarded(btn("downloadZip"), "Downloading…", async () => {
    await flush();
    if (!rec) return;
    const doc = { ...rec, summaryMd: summaryTa.value, notesMd: notesTa.value };
    await saveBlob(await buildMeetingZip(doc, await listScreens(id)), zipFileName(rec));
  }),
);
btn("copyTranscript").addEventListener("click", () =>
  guarded(btn("copyTranscript"), "Copied", () => copyText(renderTranscriptMd(rec?.turns ?? []))),
);
btn("downloadTranscript").addEventListener("click", () =>
  guarded(btn("downloadTranscript"), "Downloading…", async () => {
    if (!rec) return;
    const md = renderTranscriptMd(rec.turns ?? []);
    await saveBlob(new Blob([md], { type: "text/markdown" }), `${rec.id}-transcript.md`);
  }),
);

/** Runs a banner action with the buttons disabled; polling picks up the new status. */
async function act(msgId: string, fn: () => Promise<void>): Promise<void> {
  if (busy) return;
  busy = true;
  setMsg(msgId, "");
  if (rec) render(rec);
  try {
    await fn();
  } catch (e) {
    console.warn(e);
    setMsg(msgId, "Something went wrong. Try again.", true);
  } finally {
    busy = false;
    await reload();
  }
}

btn("retry").addEventListener("click", () =>
  act("errorMsg", async () => {
    // Pending edits are written now, so no debounce timer can write into the meeting mid-run.
    if (!(await flush())) {
      setMsg("errorMsg", "Your edits could not be saved, so the meeting was not started again. Try again.", true);
      return;
    }
    const res = await send({ type: "retry-meeting", meetingId: id });
    if (!res?.ok) setMsg("errorMsg", res?.error ?? "Could not start again. Press Retry.", true);
  }),
);

btn("downloadAudio").addEventListener("click", () =>
  act("errorMsg", async () => {
    if (!rec) return;
    const audio = await getWebm(id);
    if (audio.size === 0) {
      setMsg("errorMsg", "No audio is saved for this meeting.", true);
      return;
    }
    await saveBlob(audio, audioFileName(rec.startedAt));
    setMsg("errorMsg", "The audio is being saved to your Downloads folder.");
  }),
);

btn("processSaved").addEventListener("click", () =>
  act("interruptedMsg", async () => {
    const res = await send({ type: "process-saved", meetingId: id });
    if (!res?.ok) setMsg("interruptedMsg", res?.error ?? "Could not start processing. Try again.", true);
  }),
);

function settingsLinkMsg(text: string): void {
  const m = $("noticeMsg");
  m.classList.add("err");
  const a = el("a", "mn-link", "Open Settings");
  a.href = "#";
  a.addEventListener("click", (e) => {
    e.preventDefault();
    void chrome.tabs.create({ url: chrome.runtime.getURL(`${SETTINGS_PATH}?pick=folder`) });
  });
  m.replaceChildren(`${text} `, a);
}

btn("allowRetry").addEventListener("click", () =>
  act("noticeMsg", async () => {
    const h = await getHandle("services").catch(() => undefined);
    if (!h) {
      settingsLinkMsg("Choose your services folder in Settings, then press Allow & Retry.");
      return;
    }
    let perm: PermissionState;
    try {
      perm = await (h as unknown as PermissionQueryable).requestPermission({ mode: "read" });
    } catch {
      perm = "denied";
    }
    if (perm !== "granted") {
      setMsg("noticeMsg", "Chrome did not give access to the folder. Press Allow & Retry to try again.", true);
      return;
    }
    let servicesContext: string;
    try {
      servicesContext = await readServicesContext(h);
    } catch {
      settingsLinkMsg("The services folder could not be read. Choose it again in Settings.");
      return;
    }
    await flush();
    await updateMeeting(id, {
      servicesContext, servicesNotice: undefined, codeSearch: undefined, notesMd: undefined, summaryMd: undefined,
    });
    for (const d of ["summaryMd", "notesMd"] as const) dirty[d] = false;
    let res: Ack | undefined;
    let detail: string | undefined;
    try {
      res = await send({ type: "retry-meeting", meetingId: id });
      detail = res?.error;
    } catch (e) {
      detail = e instanceof Error ? e.message : String(e);
    }
    if (!res?.ok) {
      // The notes were cleared: leave a failed meeting with Retry, not a ready one without notes.
      await updateMeeting(id, rerunFailedPatch(detail ?? "retry-meeting was not accepted"));
    }
  }),
);

twoClick(btn("deleteMeeting"), "Delete meeting", "Click again to delete", async () => {
  setMsg("deleteMsg", "");
  const res = await send({ type: "delete-meeting", meetingId: id }).catch(() => undefined);
  if (res?.ok) location.replace("meetings.html");
  else setMsg("deleteMsg", res?.error ?? "Could not delete the meeting. Try again.", true);
});

$("gear").addEventListener("click", () => void chrome.tabs.create({ url: chrome.runtime.getURL(SETTINGS_PATH) }));

// ================= loading + polling =================

function showNotFound(): void {
  $("title").textContent = "Meeting not found";
  $("headMeta").hidden = true;
  for (const c of ["progressCard", "errorCard", "interruptedCard", "noticeCard", "mainCard", "helperCard", "pageFoot"]) {
    $(c).hidden = true;
  }
  $("notFound").hidden = false;
}

async function reload(): Promise<void> {
  let next: MeetingRecord | undefined;
  try {
    next = id ? await getMeeting(id) : undefined;
  } catch (e) {
    console.warn("could not read the meeting", e);
    return;
  }
  if (!next) {
    rec = undefined;
    showNotFound();
    return;
  }
  const wasWorking = rec ? isWorking(rec) : false;
  rec = next;
  render(next, wasWorking && !isWorking(next)); // fresh notes replace the "being written" fields
}

async function init(): Promise<void> {
  try {
    settings = await getSettings();
  } catch (e) {
    console.warn("could not read settings", e);
  }
  showTab("summary");
  await reload();
  window.setInterval(() => {
    if (rec && (isWorking(rec) || rec.status === "recording") && !busy) void reload();
  }, POLL_MS);
}

void init();
