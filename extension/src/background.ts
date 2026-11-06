// Service worker: session state (in chrome.storage.session, so a worker restart mid-meeting is
// harmless), offscreen document lifecycle, the speaker-log content script handshake, and the
// built-in processing queue (meeting records, resume at startup, notifications, audio pruning).
// - Built-in mode (settings.helper.enabled false): the audio goes to IndexedDB and the meeting is
//   processed in the offscreen document.
// - Helper mode: v1 flow, the recording is uploaded to the local helper.
import type { MeetingRecord, MeetingType, SpeakerInterval, UploadMeta } from "./types";
import type {
  Ack,
  CollectResponse,
  ExportAudioAck,
  FromOffscreen,
  OffscreenStartAck,
  PopupMsg,
  RecState,
  StartMsg,
  StatusResponse,
  ToOffscreen,
} from "./messages";
import { MEETING_PATH, OFFSCREEN_PATH } from "./messages";
import { localIso } from "./lib/localIso";
import { stateAfterFailure } from "./lib/failureState";
import { audioFileName, downloadAndWait } from "./lib/download";
import { getSettings, type Settings } from "./lib/settings";
import { meetingId } from "./lib/slug";
import {
  deleteMeeting,
  getMeeting,
  listMeetings,
  pruneExpiredAudio,
  putMeeting,
  updateMeeting,
} from "./lib/db";
import {
  helperUploadUrl,
  meetingPageOpen,
  recordsInterrupted,
  recordsToResume,
  shouldCloseOffscreen,
} from "./lib/lifecycle";

const COLLECT_TIMEOUT_MS = 3000;
const NOTIFY_PREFIX = "meeting:";
const NOTIFY_ICON = "icons/128.png";

interface Session {
  state: RecState;
  /** Mode of the current/last recording; missing = helper (v1 sessions). */
  mode?: "builtin" | "helper";
  startedAt?: number;
  stoppedAt?: number;
  tabId?: number;
  meetingType?: MeetingType;
  title?: string;
  selfName?: string;
  /** Helper mode: participants collected at Stop, for the Recent stub record. */
  participants?: string[];
  error?: string;
  notice?: string;
  /** Built-in: the meeting record being recorded. Helper: the helper's id after upload. */
  meetingId?: string;
}

async function getSession(): Promise<Session> {
  const { session } = await chrome.storage.session.get("session");
  return (session as Session | undefined) ?? { state: "idle" };
}

async function setSession(s: Session): Promise<void> {
  await chrome.storage.session.set({ session: s });
}

function errText(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

// Start/stop/retry/result handlers run one at a time so a popup Stop and a tab-ended can't race.
let queue: Promise<unknown> = Promise.resolve();
function serial<T>(fn: () => Promise<T>): Promise<T> {
  const p = queue.then(fn);
  queue = p.catch(() => undefined);
  return p;
}

// ---------- offscreen document ----------

async function hasOffscreen(): Promise<boolean> {
  const contexts = await chrome.runtime.getContexts({
    contextTypes: ["OFFSCREEN_DOCUMENT"],
    documentUrls: [chrome.runtime.getURL(OFFSCREEN_PATH)],
  });
  return contexts.length > 0;
}

async function ensureOffscreen(): Promise<void> {
  if (await hasOffscreen()) return;
  await chrome.offscreen.createDocument({
    url: OFFSCREEN_PATH,
    reasons: ["USER_MEDIA", "BLOBS"],
    justification:
      "Record the Meet tab audio mixed with the microphone, sample the shared screen, " +
      "and turn the saved recording into notes.",
  });
}

async function closeOffscreen(): Promise<void> {
  try {
    if (await hasOffscreen()) await chrome.offscreen.closeDocument();
  } catch {
    // already gone
  }
}

/**
 * Closes the document only when nothing needs it: not recording, no helper upload pending, and no
 * built-in meeting queued or processing (read from IndexedDB, so a `process` sent just before the
 * offscreen's idle report still keeps it open). Returns the ids still waiting, when any.
 */
async function closeIfIdle(): Promise<string[]> {
  const s = await getSession();
  let waiting: MeetingRecord[];
  try {
    const all = await listMeetings();
    const ids = new Set(recordsToResume(all));
    waiting = all.filter((r) => ids.has(r.id));
  } catch {
    return []; // can't tell: keep the document
  }
  const close = shouldCloseOffscreen({
    recording: s.state === "recording",
    processing: waiting.some((r) => r.status === "processing"),
    queued: waiting.filter((r) => r.status === "queued").length,
    helperUploadPending: s.state === "uploading" || s.state === "upload-failed",
  });
  if (close) await closeOffscreen();
  return waiting.map((r) => r.id);
}

/**
 * Closes the document unconditionally (helper recording discarded or lost), then re-sends any
 * built-in meetings it was processing so they continue in a fresh document.
 */
async function resetOffscreen(): Promise<void> {
  await closeOffscreen();
  await resumeQueue();
}

function sendToOffscreen<R>(msg: ToOffscreen): Promise<R | undefined> {
  return chrome.runtime.sendMessage(msg) as Promise<R | undefined>;
}

/** Ensures the document and queues `id` for processing there. */
async function sendProcess(id: string): Promise<Ack> {
  try {
    await ensureOffscreen();
    const res = await sendToOffscreen<Ack>({ target: "offscreen", type: "process", meetingId: id });
    return res?.ok ? { ok: true } : { ok: false, error: res?.error ?? "Processing could not start. Try again." };
  } catch (e) {
    console.warn("could not start processing", e);
    return { ok: false, error: "Processing could not start. Try again." };
  }
}

/** Sends `process` for every built-in meeting left queued or processing, oldest first. */
async function resumeQueue(): Promise<void> {
  let ids: string[];
  try {
    ids = recordsToResume(await listMeetings());
  } catch (e) {
    console.warn("could not read meetings", e);
    return;
  }
  for (const id of ids) await sendProcess(id);
}

// ---------- meeting records ----------

/** A meetingId() not taken yet, checked against IndexedDB. */
async function freshMeetingId(startedAtIso: string, type: MeetingType, title: string): Promise<string> {
  const taken = new Set<string>();
  for (;;) {
    const id = meetingId(startedAtIso, type, title, (x) => taken.has(x));
    if (!(await getMeeting(id))) return id;
    taken.add(id);
  }
}

function meetingPageUrl(id: string): string {
  return chrome.runtime.getURL(`${MEETING_PATH}?id=${encodeURIComponent(id)}`);
}

async function meetingTabOpen(id: string): Promise<boolean> {
  try {
    const contexts = await chrome.runtime.getContexts({ contextTypes: ["TAB"] });
    const urls = contexts.map((c) => c.documentUrl ?? "");
    return meetingPageOpen(urls, chrome.runtime.getURL(MEETING_PATH), id);
  } catch {
    return false;
  }
}

// ---------- content script (may be absent) ----------

function isInterval(x: unknown): x is SpeakerInterval {
  const i = x as SpeakerInterval;
  return (
    typeof i === "object" && i !== null &&
    typeof i.name === "string" && typeof i.start_ms === "number" && typeof i.end_ms === "number"
  );
}

async function collectSpeakerLog(tabId: number | undefined): Promise<CollectResponse> {
  const empty: CollectResponse = { log: [], participants: [] };
  if (tabId === undefined) return empty;
  try {
    const timeout = new Promise<undefined>((r) => setTimeout(() => r(undefined), COLLECT_TIMEOUT_MS));
    const res = (await Promise.race([
      chrome.tabs.sendMessage(tabId, { type: "speaker-log:collect" }),
      timeout,
    ])) as Partial<CollectResponse> | undefined;
    return {
      log: Array.isArray(res?.log) ? res.log.filter(isInterval) : [],
      participants: Array.isArray(res?.participants)
        ? res.participants.filter((p): p is string => typeof p === "string")
        : [],
    };
  } catch {
    return empty;
  }
}

// ---------- start / stop ----------

/**
 * A helper stop/upload/retry failed. If the offscreen doc still holds the recording, stay
 * `upload-failed` (Retry). If the recording is gone, go `idle` with the error kept, and reset the
 * document, so the next meeting can be recorded.
 */
async function applyFailure(base: Session, res: Ack | undefined, fallback: string): Promise<string> {
  const next = stateAfterFailure({
    offscreenAlive: await hasOffscreen(),
    dataKept: res?.kept,
    error: res?.error ?? fallback,
  });
  await setSession({ ...base, state: next.state, error: next.error });
  if (next.state === "idle") await resetOffscreen();
  return next.error;
}

async function start(msg: StartMsg): Promise<Ack> {
  const s = await getSession();
  if (s.state === "recording" || s.state === "uploading" || s.state === "upload-failed") {
    return { ok: false, error: `Can't start while ${s.state}.` };
  }
  let settings: Settings;
  try {
    settings = await getSettings();
  } catch (e) {
    return { ok: false, error: `Could not read your settings: ${errText(e)}` };
  }
  return settings.helper.enabled ? startHelper(msg, settings.selfName) : startBuiltin(msg, settings.selfName);
}

function speakerLogStart(tabId: number, t0: number): void {
  // Speaker log is best-effort: never block recording on the content script.
  chrome.tabs.sendMessage(tabId, { type: "speaker-log:start", t0 }).catch(() => undefined);
}

async function startBuiltin(msg: StartMsg, selfName: string): Promise<Ack> {
  // The record must exist before capture starts: the offscreen doc updates pcmSamples per slice.
  const createdAt = Date.now();
  const startedAt = localIso(createdAt);
  let id: string;
  try {
    id = await freshMeetingId(startedAt, msg.meetingType, msg.title);
    await putMeeting({
      id,
      mode: "builtin",
      title: msg.title,
      type: msg.meetingType,
      startedAt,
      durationMs: 0,
      selfName,
      participants: [],
      status: "recording",
      costUsd: 0,
      speakerLog: [],
      servicesContext: null,
      pcmSamples: 0,
      createdAt,
    });
  } catch (e) {
    return { ok: false, error: `Could not save the meeting: ${errText(e)}` };
  }
  let res: OffscreenStartAck | undefined;
  try {
    await ensureOffscreen();
    res = await sendToOffscreen<OffscreenStartAck>({
      target: "offscreen",
      type: "start",
      streamId: msg.streamId,
      selfName,
      persist: true,
      meetingId: id,
    });
  } catch (e) {
    res = { ok: false, error: errText(e) };
  }
  if (!res?.ok || typeof res.t0 !== "number") {
    await deleteMeeting(id).catch(() => undefined);
    await closeIfIdle();
    return { ok: false, error: res?.error ?? "The recorder did not respond." };
  }
  await setSession({
    state: "recording",
    mode: "builtin",
    meetingId: id,
    startedAt: res.t0,
    tabId: msg.tabId,
    meetingType: msg.meetingType,
    title: msg.title,
    selfName,
  });
  speakerLogStart(msg.tabId, res.t0);
  return { ok: true };
}

async function startHelper(msg: StartMsg, selfName: string): Promise<Ack> {
  try {
    await ensureOffscreen();
    const res = await sendToOffscreen<OffscreenStartAck>({
      target: "offscreen",
      type: "start",
      streamId: msg.streamId,
      selfName,
      persist: false,
    });
    if (!res?.ok || typeof res.t0 !== "number") {
      await closeIfIdle();
      return { ok: false, error: res?.error ?? "The recorder did not respond." };
    }
    await setSession({
      state: "recording",
      mode: "helper",
      startedAt: res.t0,
      tabId: msg.tabId,
      meetingType: msg.meetingType,
      title: msg.title,
      selfName,
    });
    speakerLogStart(msg.tabId, res.t0);
    return { ok: true };
  } catch (e) {
    await closeIfIdle();
    return { ok: false, error: errText(e) };
  }
}

async function stop(): Promise<Ack> {
  const s = await getSession();
  if (s.state !== "recording" || s.startedAt === undefined) return { ok: false, error: "Not recording." };
  return s.mode === "builtin" && s.meetingId ? stopBuiltin(s, s.meetingId) : stopHelper(s, s.startedAt);
}

async function stopBuiltin(s: Session, id: string): Promise<Ack> {
  // Back to idle right away: the meeting shows as processing in Recent.
  await setSession({ state: "idle" });
  const collected = await collectSpeakerLog(s.tabId);
  let res: Ack | undefined;
  try {
    res = await sendToOffscreen<Ack>({
      target: "offscreen",
      type: "stop-builtin",
      meetingId: id,
      log: collected.log,
      participants: collected.participants,
    });
  } catch (e) {
    res = { ok: false, error: errText(e) };
  }
  if (!res?.ok) {
    // Whatever was recorded is already in IndexedDB: offer it as an interrupted meeting.
    console.warn("stop-builtin failed", res?.error);
    await updateMeeting(id, { status: "interrupted", participants: collected.participants }).catch(() => undefined);
    await setSession({
      state: "idle",
      error: "The recording stopped but its last part could not be saved. Open it in Recent to make notes from what was saved.",
    });
    await closeIfIdle();
  }
  // Otherwise the offscreen doc queued it and reports `processed` when the notes are ready.
  return { ok: true };
}

async function stopHelper(s: Session, startedAt: number): Promise<Ack> {
  const stoppedAt = Date.now();
  let uploading: Session = { ...s, state: "uploading", stoppedAt, error: undefined };
  await setSession(uploading);

  const collected = await collectSpeakerLog(s.tabId);
  uploading = { ...uploading, participants: collected.participants };
  await setSession(uploading);
  let helper: Settings["helper"];
  try {
    helper = (await getSettings()).helper;
  } catch (e) {
    // Still recording in the offscreen doc: go back so Stop can be pressed again.
    await setSession({ ...s, error: `Could not read your settings: ${errText(e)}` });
    return { ok: false, error: "Could not read your settings. Press Stop again." };
  }
  let res: Ack | undefined;
  try {
    const meta: UploadMeta = {
      title: s.title ?? "",
      type: s.meetingType ?? "technical",
      started_at: localIso(startedAt),
      duration_ms: stoppedAt - startedAt,
      self_name: s.selfName ?? "",
      participants: collected.participants,
    };
    res = await sendToOffscreen<Ack>({
      target: "offscreen",
      type: "stop",
      meta,
      log: collected.log,
      token: helper.token,
      url: helperUploadUrl(helper.url),
    });
  } catch (e) {
    res = { ok: false, error: errText(e) };
  }
  if (!res?.ok) await applyFailure(uploading, res, "The recorder did not respond.");
  // Otherwise the offscreen document reports `upload-result` when the upload finishes.
  return { ok: true };
}

// ---------- helper mode: retry / save & discard / result ----------

async function retryUpload(): Promise<Ack> {
  const s = await getSession();
  if (s.state !== "upload-failed") return { ok: false, error: "Nothing to retry." };
  if (!(await hasOffscreen())) {
    const error = await applyFailure(s, undefined, "the recorder page was closed.");
    return { ok: false, error };
  }
  const { helper } = await getSettings();
  await setSession({ ...s, state: "uploading", error: undefined });
  let res: Ack | undefined;
  try {
    res = await sendToOffscreen<Ack>({
      target: "offscreen",
      type: "retry-upload",
      token: helper.token,
      url: helperUploadUrl(helper.url),
    });
  } catch (e) {
    res = { ok: false, error: errText(e) };
  }
  if (!res?.ok) {
    const error = await applyFailure(s, res, "The recorder did not respond.");
    return { ok: false, error };
  }
  return { ok: true };
}

/**
 * Escape hatch for an upload that keeps failing: save the kept audio to the Downloads folder, then
 * drop the recording and go idle so the next meeting can be recorded.
 */
async function saveAndDiscard(): Promise<Ack> {
  const s = await getSession();
  if (s.state !== "upload-failed") return { ok: false, error: "Nothing to save." };
  if (!(await hasOffscreen())) {
    const error = await applyFailure(s, undefined, "the recorder page was closed.");
    return { ok: false, error };
  }
  let res: ExportAudioAck | undefined;
  try {
    res = await sendToOffscreen<ExportAudioAck>({ target: "offscreen", type: "export-audio" });
  } catch (e) {
    res = { ok: false, error: errText(e) };
  }
  if (!res?.ok || !res.url) {
    if (res?.kept === false) {
      const error = await applyFailure(s, res, "The recorder did not respond.");
      return { ok: false, error };
    }
    return { ok: false, error: res?.error ?? "The recorder did not respond." };
  }
  const startedIso = s.startedAt !== undefined ? localIso(s.startedAt) : "";
  let savedPath: string;
  try {
    // The blob: URL lives in the offscreen doc, so it stays open until the file is written.
    savedPath = await downloadAndWait(chrome.downloads, res.url, audioFileName(startedIso));
  } catch (e) {
    // Recording still in memory: stay upload-failed so Retry / Save stay possible.
    return { ok: false, error: errText(e) };
  }
  await setSession({ state: "idle", notice: `Audio saved to ${savedPath}. The recording was discarded.` });
  await resetOffscreen(); // drops the in-memory recording
  return { ok: true };
}

/** A helper-mode meeting in Recent: the notes live in the helper, under `helperId`. */
async function writeHelperStub(s: Session, helperId: string): Promise<void> {
  const startedAtMs = s.startedAt ?? Date.now();
  const startedAt = localIso(startedAtMs);
  const type = s.meetingType ?? "technical";
  const title = s.title ?? "";
  const now = Date.now();
  await putMeeting({
    id: await freshMeetingId(startedAt, type, title),
    mode: "helper",
    helperId,
    title,
    type,
    startedAt,
    durationMs: (s.stoppedAt ?? startedAtMs) - startedAtMs,
    selfName: s.selfName ?? "",
    participants: s.participants ?? [],
    status: "ready",
    costUsd: 0,
    speakerLog: [],
    servicesContext: null,
    pcmSamples: 0,
    readyAt: now,
    audioDeleted: true, // no audio is kept in the browser for helper meetings
    createdAt: now,
  });
}

async function uploadResult(msg: Extract<FromOffscreen, { type: "upload-result" }>): Promise<void> {
  const s = await getSession();
  if (msg.ok) {
    await setSession({ ...s, state: "done", meetingId: msg.id, error: undefined });
    if (msg.id) await writeHelperStub(s, msg.id).catch((e) => console.warn("could not add to Recent", e));
    await closeIfIdle(); // only after a successful upload
  } else {
    // The offscreen doc keeps the recording after a failed upload (kept: true).
    await applyFailure(s, { ok: false, kept: true, error: msg.error }, "Upload failed.");
  }
}

// ---------- built-in: processed / idle / popup actions ----------

async function processed(msg: Extract<FromOffscreen, { type: "processed" }>): Promise<void> {
  let rec: MeetingRecord | undefined;
  try {
    rec = await getMeeting(msg.meetingId);
  } catch {
    rec = undefined;
  }
  if (rec && !(await meetingTabOpen(rec.id))) {
    const options: chrome.notifications.NotificationCreateOptions = msg.ok
      ? { type: "basic", iconUrl: NOTIFY_ICON, title: "Notes ready", message: rec.title || "Your meeting" }
      : {
          type: "basic",
          iconUrl: NOTIFY_ICON,
          title: "Processing failed",
          message: rec.error || "Something went wrong while processing. Press Retry.",
        };
    try {
      await chrome.notifications.create(`${NOTIFY_PREFIX}${rec.id}`, options);
    } catch (e) {
      console.warn("could not show a notification", e);
    }
  }
  await closeIfIdle();
}

// Meetings already re-sent after an idle report in this worker's life (so a meeting whose status
// can't be updated is not re-sent in a loop).
const nudged = new Set<string>();

async function offscreenIdle(): Promise<void> {
  const waiting = await closeIfIdle();
  // The offscreen doc is idle yet these are still queued/processing (e.g. a `process` was lost):
  // send them once more. The doc ignores ids it already has.
  for (const id of waiting) {
    if (nudged.has(id)) continue;
    nudged.add(id);
    await sendProcess(id);
  }
}

async function processSaved(id: string): Promise<Ack> {
  const rec = await getMeeting(id);
  if (!rec || rec.mode !== "builtin") return { ok: false, error: "This meeting was not found." };
  if (rec.status !== "interrupted") return { ok: false, error: "This meeting is not waiting to be processed." };
  // 16 kHz PCM: 16 samples per millisecond.
  await updateMeeting(id, { durationMs: Math.round(rec.pcmSamples / 16), status: "queued" });
  const res = await sendProcess(id);
  if (!res.ok) await updateMeeting(id, { status: "interrupted" }).catch(() => undefined);
  return res;
}

async function retryMeeting(id: string): Promise<Ack> {
  const rec = await getMeeting(id);
  if (!rec || rec.mode !== "builtin") return { ok: false, error: "This meeting was not found." };
  if (rec.status !== "error") return { ok: false, error: "This meeting has not failed." };
  await updateMeeting(id, { status: "queued" });
  nudged.delete(id);
  const res = await sendProcess(id);
  if (!res.ok) await updateMeeting(id, { status: "error" }).catch(() => undefined);
  return res;
}

async function removeMeeting(id: string): Promise<Ack> {
  const rec = await getMeeting(id);
  if (rec?.status === "recording") return { ok: false, error: "Stop the recording before deleting it." };
  if (rec?.status === "processing") {
    return { ok: false, error: "This meeting is being processed. Delete it when it's done." };
  }
  await deleteMeeting(id);
  return { ok: true };
}

async function status(): Promise<StatusResponse> {
  const s = await getSession();
  let elapsedMs = 0;
  if (s.startedAt !== undefined) {
    elapsedMs = s.state === "recording" ? Date.now() - s.startedAt : (s.stoppedAt ?? s.startedAt) - s.startedAt;
  }
  const out: StatusResponse = { state: s.state, elapsedMs };
  if (s.error) out.error = s.error;
  if (s.notice) out.notice = s.notice;
  if (s.meetingId) out.meetingId = s.meetingId;
  return out;
}

// ---------- startup ----------

/** Browser start / install / update: mark lost recordings, prune old audio, resume the queue. */
async function startupTasks(): Promise<void> {
  const s = await getSession();
  const live = s.state === "recording" && s.mode === "builtin" ? s.meetingId : undefined;
  try {
    for (const id of recordsInterrupted(await listMeetings(), live)) {
      await updateMeeting(id, { status: "interrupted" });
    }
  } catch (e) {
    console.warn("could not mark interrupted recordings", e);
  }
  try {
    await pruneExpiredAudio(Date.now());
  } catch (e) {
    console.warn("could not delete expired audio", e);
  }
  await resumeQueue();
}

chrome.runtime.onStartup.addListener(() => {
  serial(startupTasks).catch(() => undefined);
});

chrome.runtime.onInstalled.addListener(() => {
  // On a fresh install this opens nothing: setup happens in the popup.
  serial(startupTasks).catch(() => undefined);
});

chrome.notifications.onClicked.addListener((notificationId) => {
  if (!notificationId.startsWith(NOTIFY_PREFIX)) return;
  const id = notificationId.slice(NOTIFY_PREFIX.length);
  chrome.tabs.create({ url: meetingPageUrl(id) }).catch(() => undefined);
  chrome.notifications.clear(notificationId).catch(() => undefined);
});

// ---------- routing ----------

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (!msg || typeof msg !== "object") return false;
  if (msg.target === "background") {
    const m = msg as FromOffscreen;
    if (m.type === "get-settings") {
      // R5: the offscreen doc has no chrome.storage. On failure the reply fails its validation there.
      getSettings().then(sendResponse, () => sendResponse(undefined));
      return true;
    }
    if (m.type === "upload-result") serial(() => uploadResult(m)).catch(() => undefined);
    else if (m.type === "tab-ended") serial(stop).catch(() => undefined);
    else if (m.type === "processed") serial(() => processed(m)).catch(() => undefined);
    else if (m.type === "offscreen-idle") serial(offscreenIdle).catch(() => undefined);
    return false;
  }
  if (msg.target !== undefined) return false; // addressed to another context (e.g. the offscreen doc)

  const m = msg as PopupMsg;
  let work: Promise<unknown>;
  switch (m.type) {
    case "status":
      work = status();
      break;
    case "start":
      work = serial(() => start(m));
      break;
    case "stop":
      work = serial(stop);
      break;
    case "retry-upload":
      work = serial(retryUpload);
      break;
    case "save-discard":
      work = serial(saveAndDiscard);
      break;
    case "process-saved":
      work = serial(() => processSaved(m.meetingId));
      break;
    case "retry-meeting":
      work = serial(() => retryMeeting(m.meetingId));
      break;
    case "delete-meeting":
      work = serial(() => removeMeeting(m.meetingId));
      break;
    default:
      return false;
  }
  work.then(sendResponse, (e) => sendResponse({ ok: false, error: errText(e) }));
  return true;
});
