// The meeting page (dist/meeting.html?id=<id>): banners, voice naming, and the tabs. Meetings with
// a report get گزارش / متن جلسه / تصاویر / یادداشت فنی (English); older meetings (a summaryMd and
// no report) keep Summary / AI notes / Transcript / Screens with the speaker chips.
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
import { voicesOf } from "./lib/voices";
import { clipBlob, createClipPlayer, renderVoiceCards } from "./voiceCards";
import { REPORT_CSS, faNum, reportToHtml, reportToMarkdown, speakerStats, type Report } from "./lib/report";
import { renamePatch, renameVoices } from "./lib/renameLater";
import { renderReport, setReportEditable } from "./reportView";

const SAVE_DEBOUNCE_MS = 800;
const POLL_MS = 1000;
const SETTINGS_PATH = "dist/settings.html";

type Tab = "report" | "summary" | "notes" | "transcript" | "screens";
type Doc = "summaryMd" | "notesMd";

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;

const id = new URLSearchParams(location.search).get("id") ?? "";
let rec: MeetingRecord | undefined;
let settings: Settings | undefined;
let tab: Tab = "summary";
/** Which tab set is shown: the report one, or the legacy one (undefined until the first render). */
let reportMode: boolean | undefined;
let preview = false;
let renaming: string | null = null;
let busy = false;

const summaryTa = $<HTMLTextAreaElement>("summary");
const notesTa = $<HTMLTextAreaElement>("notes");
const areas: Record<Doc, HTMLTextAreaElement> = { summaryMd: summaryTa, notesMd: notesTa };
const dirty: Record<Doc, boolean> = { summaryMd: false, notesMd: false };
/** The report on screen, with the user's edits; saved like the text areas. */
let reportDraft: Report | undefined;
let reportDirty = false;
const anyDirty = () => dirty.summaryMd || dirty.notesMd || reportDirty;

const reportStyle = document.createElement("style");
reportStyle.textContent = REPORT_CSS;
document.head.append(reportStyle);

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
  if (reportDirty && reportDraft) {
    patch.report = reportDraft;
    reportDirty = false;
  }
  if (Object.keys(patch).length === 0) return true;
  setSaved("Saving…");
  try {
    rec = await updateMeeting(id, patch);
    // Typing during the write leaves the field dirty; it is saved by the next timer.
    setSaved(anyDirty() ? "Saving…" : "Saved", anyDirty() ? "" : "ok");
    return true;
  } catch {
    for (const d of ["summaryMd", "notesMd"] as const) if (d in patch) dirty[d] = true;
    if ("report" in patch) reportDirty = true;
    setSaved("Your edits could not be saved. Keep this tab open and type again to retry.", "err");
    return false;
  }
}

function scheduleSave(): void {
  setSaved("Saving…");
  if (saveTimer !== undefined) clearTimeout(saveTimer);
  saveTimer = window.setTimeout(() => void flush(), SAVE_DEBOUNCE_MS);
}

for (const d of ["summaryMd", "notesMd"] as const) {
  areas[d].addEventListener("input", () => {
    dirty[d] = true;
    scheduleSave();
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
  // Only OpenRouter reports cost; other providers leave it 0, which would read as "free".
$("cost").hidden = r.mode === "helper" || !r.costUsd;
}

function renderBanners(r: MeetingRecord): void {
  // progress: queued / processing / still recording
  const step = stepText(r);
  const recording = r.status === "recording";
  $("progressCard").hidden = (!step && !recording) || r.status === "naming";
  renderNaming(r);
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

// ================= voice naming =================

const player = createClipPlayer((clip) => clipBlob(id, clip));
const stopPlayer = player.stop;
const playClip = player.play;
let namingFor = "";
let names: (() => Record<string, string>) | undefined;

function renderNaming(r: MeetingRecord): void {
  const on = r.status === "naming";
  $("namingCard").hidden = !on;
  if (!on) {
    if (namingFor) stopPlayer(); // the player is shared with the rename panel
    namingFor = "";
    return;
  }
  if (namingFor === r.id) return; // keep typed names across polls
  namingFor = r.id;
  const voices = voicesOf(r.turns ?? []);
  $("namingSub").textContent = `${faNum(voices.length)} صدا شناسایی شد. هر صدا را گوش کنید و نامش را تأیید یا وارد کنید.`;
  setMsg("namingMsg", "");
  names = renderVoiceCards($("voices"), voices, { audio: !r.audioDeleted, play: playClip, stop: stopPlayer }).names;
}

$("confirmNames").addEventListener("click", async () => {
  if (!names) return;
  const btn = $<HTMLButtonElement>("confirmNames");
  btn.disabled = true;
  setMsg("namingMsg", "");
  try {
    const ack = await send({ type: "confirm-names", meetingId: id, names: names() });
    if (!ack?.ok) throw new Error(ack?.error || "Could not confirm the names.");
    stopPlayer();
    const next = await getMeeting(id);
    if (next) {
      rec = next;
      render(next);
    }
  } catch (e) {
    setMsg("namingMsg", e instanceof Error ? e.message : String(e), true);
  } finally {
    btn.disabled = false;
  }
});

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

// ================= report =================

let reportKey = "";

/** Everything the report view shows: the report, the computed meta line and the stats. */
function reportViewKey(report: Report, r: MeetingRecord): string {
  const turns = r.turns ?? [];
  return JSON.stringify([report, r.startedAt, r.durationMs, r.type, speakerStats(turns), speakersOf(turns)]);
}

function onReportEdit(next: Report): void {
  reportDraft = next;
  if (rec) reportKey = reportViewKey(next, rec); // the DOM already shows it: no redraw on save
  reportDirty = true;
  scheduleSave();
}

/** `overwrite` replaces the report even when it holds unsaved edits (after a rename). */
function renderReportPane(r: MeetingRecord, overwrite: boolean): void {
  const box = $("report");
  if (overwrite) reportDirty = false;
  if (!r.report) {
    reportDraft = undefined;
    reportKey = "";
    box.replaceChildren(el("div", "empty", isWorking(r) || r.status === "naming" ? "گزارش در حال نوشتن است…" : "گزارشی نوشته نشده است."));
    return;
  }
  const key = reportViewKey(r.report, r);
  if (!reportDirty && key !== reportKey) {
    reportDraft = r.report;
    reportKey = key;
    renderReport(box, r.report, { rec: r, turns: r.turns ?? [] }, onReportEdit);
  }
  setReportEditable(box, isEditable(r) && !busy);
}

// ---- renaming later: the voice cards again, grouped by current name; no AI call ----

let renameNames: (() => Record<string, string>) | undefined;

const canRenameLater = (r: MeetingRecord) => isEditable(r) && !busy && Boolean(r.report) && Boolean(r.turns?.length);

function openRenamePanel(r: MeetingRecord): void {
  setMsg("renameMsg", "");
  renameNames = renderVoiceCards($("renameVoices"), renameVoices(r), {
    audio: !r.audioDeleted, play: playClip, stop: stopPlayer,
  }).names;
  $("renamePanel").hidden = false;
}

function closeRenamePanel(): void {
  if ($("renamePanel").hidden) return;
  stopPlayer();
  $("renamePanel").hidden = true;
  $("renameVoices").replaceChildren();
  renameNames = undefined;
}

$("renameSpeakers").addEventListener("click", () => {
  if (!$("renamePanel").hidden) closeRenamePanel();
  else if (rec && canRenameLater(rec)) openRenamePanel(rec);
});
$("cancelNames").addEventListener("click", closeRenamePanel);

$("saveNames").addEventListener("click", async () => {
  if (!renameNames) return;
  const names = renameNames();
  const save = $<HTMLButtonElement>("saveNames");
  save.disabled = true;
  setMsg("renameMsg", "");
  try {
    // Edits are saved first, so the names are replaced in the report as the user left it.
    if (!(await flush())) throw new Error("edits not saved");
    const cur = await getMeeting(id);
    if (!cur) throw new Error("meeting not found");
    const patch = renamePatch(cur, names);
    rec = patch ? await updateMeeting(id, patch) : cur;
    closeRenamePanel();
    if (patch) setSaved("Saved", "ok");
    render(rec, true);
  } catch (e) {
    console.warn(e);
    setMsg("renameMsg", "نام‌ها ذخیره نشد. دوباره تلاش کنید.", true);
  } finally {
    save.disabled = false;
  }
});

// ================= tabs =================

const TAB_SETS: Record<"report" | "legacy", Tab[]> = {
  report: ["report", "transcript", "screens", "notes"],
  legacy: ["summary", "notes", "transcript", "screens"],
};
const TAB_LABELS: Record<Exclude<Tab, "screens">, [legacy: string, report: string]> = {
  report: ["", "گزارش"],
  summary: ["Summary", ""],
  notes: ["AI notes", "یادداشت فنی (English)"],
  transcript: ["Transcript", "متن جلسه"],
};
let screensCount = 0;

const tabButton = (t: Tab) => $("tabs").querySelector<HTMLButtonElement>(`button[data-tab="${t}"]`)!;

function screensLabel(): string {
  if (reportMode) return screensCount ? `تصاویر (${faNum(screensCount)})` : "تصاویر";
  return screensCount ? `Screens (${screensCount})` : "Screens";
}

/** A meeting with a report, or one with no legacy summary (new, or still being written), gets the report tabs. */
const wantsReport = (r: MeetingRecord) => Boolean(r.report) || r.summaryMd === undefined;

function setTabSet(report: boolean): void {
  if (reportMode === report) return;
  const first = reportMode === undefined;
  reportMode = report;
  const order = TAB_SETS[report ? "report" : "legacy"];
  const bar = $("tabs");
  if (report) bar.dir = "rtl";
  else bar.removeAttribute("dir");
  for (const t of ["report", "summary", "notes", "transcript", "screens"] as const) {
    const b = tabButton(t);
    b.hidden = !order.includes(t);
    b.textContent = t === "screens" ? screensLabel() : TAB_LABELS[t][report ? 1 : 0];
  }
  bar.append(...order.map(tabButton));
  // The report is the default tab; legacy meetings open on Summary as before.
  if (first || report || !order.includes(tab)) showTab(order[0]);
}

function showTab(t: Tab): void {
  tab = t;
  $("tabs")
    .querySelectorAll<HTMLButtonElement>("button")
    .forEach((b) => {
      const on = b.dataset.tab === t;
      b.classList.toggle("on", on);
      b.setAttribute("aria-selected", String(on));
    });
  for (const name of ["report", "summary", "notes", "transcript", "screens"] as const) $(`pane-${name}`).hidden = name !== t;
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
  screensCount = shots.length;
  $("screensTab").textContent = screensLabel();
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
  return r.status === "ready" || Boolean(r.turns?.length || r.report || r.summaryMd || r.notesMd);
}

/** `overwrite` replaces the text areas and the report even when they hold unsaved edits (after a rename). */
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

  setTabSet(wantsReport(r));
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
  renderReportPane(r, overwrite);
  if (!canRenameLater(r)) closeRenamePanel();
  // Speaker chips are the legacy rename; report meetings rename through the voice cards.
  if (reportMode) $("speakersRow").hidden = true;
  else if (renaming === null) renderSpeakers(r);
  renderTranscript(r);
  if (tab === "screens") void loadScreens();
  else if (!screensKey) void loadScreens(); // fills the tab's count
  for (const b of ["copySummary", "openGmail", "copyReport", "gmailReport", "pdfReport", "copyNotes", "downloadZip", "copyTranscript", "downloadTranscript"]) {
    $<HTMLButtonElement>(b).disabled = isWorking(r) && b !== "copyTranscript" && b !== "downloadTranscript";
  }
  $<HTMLButtonElement>("renameSpeakers").disabled = !canRenameLater(r);
  if (!reportDraft) {
    $<HTMLButtonElement>("pdfReport").disabled = true;
    $<HTMLButtonElement>("copyReport").disabled = true;
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

/** Rich copy: HTML for email clients plus a plain-text (Markdown) version. */
async function copyRich(html: string, text: string): Promise<void> {
  try {
    await navigator.clipboard.write([
      new ClipboardItem({
        "text/html": new Blob([html], { type: "text/html" }),
        "text/plain": new Blob([text], { type: "text/plain" }),
      }),
    ]);
  } catch {
    await navigator.clipboard.writeText(text);
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
  guarded(btn("copySummary"), "Copied", () => copyRich(clipboardHtml(summaryTa.value), summaryTa.value)),
);
btn("copyReport").addEventListener("click", () =>
  guarded(btn("copyReport"), "کپی شد", async () => {
    if (!rec || !reportDraft) return;
    const turns = rec.turns ?? [];
    await copyRich(reportToHtml(reportDraft, rec, turns, { timestamps: false, inline: true }), reportToMarkdown(reportDraft, rec, turns));
  }),
);
btn("pdfReport").addEventListener("click", async () => {
  await flush();
  if (!rec || !reportDraft) return;
  const previous = document.title;
  document.title = reportDraft.title || displayTitle(rec);
  window.addEventListener("afterprint", () => (document.title = previous), { once: true });
  window.print();
});
btn("gmailReport").addEventListener("click", () => {
  if (rec) void chrome.tabs.create({ url: gmailComposeUrl(meetingSubject({ ...rec, title: reportDraft?.title ?? rec.title })) });
});
btn("openGmail").addEventListener("click", () => {
  if (rec) void chrome.tabs.create({ url: gmailComposeUrl(meetingSubject(rec)) });
});
btn("copyNotes").addEventListener("click", () => guarded(btn("copyNotes"), "Copied", () => copyText(notesTa.value)));
btn("downloadZip").addEventListener("click", () =>
  guarded(btn("downloadZip"), "Downloading…", async () => {
    await flush();
    if (!rec) return;
    const doc = { ...rec, summaryMd: summaryTa.value, notesMd: notesTa.value, ...(reportDraft ? { report: reportDraft } : {}) };
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
      report: undefined, // the confirmed names (namesConfirmedAt) stay
    });
    for (const d of ["summaryMd", "notesMd"] as const) dirty[d] = false;
    reportDirty = false;
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
  await reload(); // the first render picks the tab set and its first tab
  window.setInterval(() => {
    if (rec && (isWorking(rec) || rec.status === "recording") && !busy) void reload();
  }, POLL_MS);
}

void init();
