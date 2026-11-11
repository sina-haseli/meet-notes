// The meetings list (dist/meetings.html): every meeting, newest first.
import type { MeetingRecord } from "./types";
import { listMeetings } from "./lib/db";
import { getSettings, type Settings } from "./lib/settings";
import { badgeFor, dateLine, displayTitle, progressFor, stepText, typeLabel } from "./lib/popupView";
import { helperMeetingUrl } from "./lib/meetingView";
import { el } from "./lib/dom";

const POLL_MS = 2000;
const EMPTY_TEXT = "No meetings yet. Open a Google Meet and press Start recording.";

const $ = (id: string) => document.getElementById(id) as HTMLElement;

let settings: Settings | undefined;
let meetings: MeetingRecord[] = [];
let lastSignature = "";

function item(r: MeetingRecord): HTMLElement {
  const a = el("a", "mn-item");
  if (r.mode === "helper") {
    const url = r.helperId && settings ? helperMeetingUrl(settings.helper.url, r.helperId) : null;
    if (url) a.href = url; // no helper URL: an inert card rather than a broken relative link
    a.target = "_blank";
    a.rel = "noopener";
    a.title = "Open this meeting in the local helper";
  } else {
    a.href = `meeting.html?id=${encodeURIComponent(r.id)}`;
    a.title = "Open this meeting";
  }

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
    main.append(el("div", "mn-t2", r.mode === "helper" ? `Local helper · ${dateLine(r)}` : dateLine(r)));
  }
  const badge = badgeFor(r);
  a.append(
    el("div", "mn-ic", "☰"),
    main,
    el("span", "mn-badge type", typeLabel(r.type)),
    el("span", `mn-badge ${badge.cls}`, badge.text),
  );
  return a;
}

function signature(): string {
  return JSON.stringify([
    new Date().toDateString(), // "Today" / "Yesterday" roll over at midnight
    meetings.map((m) => [m.id, m.title, m.status, m.step, m.error, m.durationMs, m.chunks?.length,
      m.chunkTurns?.filter((t) => t !== null).length]),
  ]);
}

function render(): void {
  const sig = signature();
  if (sig === lastSignature) return;
  lastSignature = sig;
  $("count").textContent = meetings.length === 1 ? "1 meeting" : `${meetings.length} meetings`;
  if (meetings.length === 0) {
    const card = el("section", "mn-card");
    card.append(el("div", "empty", EMPTY_TEXT));
    $("list").replaceChildren(card);
    return;
  }
  $("list").replaceChildren(...meetings.map(item));
}

async function refresh(): Promise<void> {
  try {
    meetings = await listMeetings(); // newest first
  } catch (e) {
    console.warn("could not read meetings", e);
    return;
  }
  render();
}

const active = (m: MeetingRecord) => m.status === "queued" || m.status === "processing" || m.status === "recording";

$("gear").addEventListener("click", () => void chrome.tabs.create({ url: chrome.runtime.getURL("dist/settings.html") }));
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible") void refresh();
});

async function init(): Promise<void> {
  try {
    settings = await getSettings();
  } catch (e) {
    console.warn("could not read settings", e);
  }
  await refresh();
  window.setInterval(() => {
    if (meetings.some(active)) void refresh();
  }, POLL_MS);
}

void init();
