// Service worker: session state (in chrome.storage.session, so a worker restart mid-meeting is
// harmless), offscreen document lifecycle, and the speaker-log content script handshake.
import type { MeetingType, SpeakerInterval, UploadMeta } from "./types";
import type {
  Ack,
  CollectResponse,
  FromOffscreen,
  OffscreenStartAck,
  PopupMsg,
  RecState,
  StartMsg,
  StatusResponse,
  ToOffscreen,
} from "./messages";
import { OFFSCREEN_PATH } from "./messages";
import { localIso } from "./lib/localIso";
import { stateAfterFailure } from "./lib/failureState";

const COLLECT_TIMEOUT_MS = 3000;

interface Session {
  state: RecState;
  startedAt?: number;
  stoppedAt?: number;
  tabId?: number;
  meetingType?: MeetingType;
  title?: string;
  selfName?: string;
  error?: string;
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
    reasons: ["USER_MEDIA"],
    justification: "Record the Meet tab audio mixed with the microphone, and sample the shared screen.",
  });
}

async function closeOffscreen(): Promise<void> {
  try {
    if (await hasOffscreen()) await chrome.offscreen.closeDocument();
  } catch {
    // already gone
  }
}

function sendToOffscreen<R>(msg: ToOffscreen): Promise<R | undefined> {
  return chrome.runtime.sendMessage(msg) as Promise<R | undefined>;
}

// ---------- content script (Task 13; may be absent — ruling R5) ----------

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

// ---------- handlers ----------

/**
 * A stop/upload/retry failed. If the offscreen doc still holds the recording, stay `upload-failed`
 * (Retry). If the recording is gone, go `idle` with the error kept, and close any leftover doc,
 * so the next meeting can be recorded.
 */
async function applyFailure(base: Session, res: Ack | undefined, fallback: string): Promise<string> {
  const next = stateAfterFailure({
    offscreenAlive: await hasOffscreen(),
    dataKept: res?.kept,
    error: res?.error ?? fallback,
  });
  await setSession({ ...base, state: next.state, error: next.error });
  if (next.state === "idle") await closeOffscreen();
  return next.error;
}

async function start(msg: StartMsg): Promise<Ack> {
  const s = await getSession();
  if (s.state === "recording" || s.state === "uploading" || s.state === "upload-failed") {
    return { ok: false, error: `Can't start while ${s.state}.` };
  }
  const { selfName = "" } = await chrome.storage.local.get("selfName");
  try {
    await ensureOffscreen();
    const res = await sendToOffscreen<OffscreenStartAck>({
      target: "offscreen",
      type: "start",
      streamId: msg.streamId,
      selfName: String(selfName),
    });
    if (!res?.ok || typeof res.t0 !== "number") {
      await closeOffscreen();
      return { ok: false, error: res?.error ?? "The recorder did not respond." };
    }
    await setSession({
      state: "recording",
      startedAt: res.t0,
      tabId: msg.tabId,
      meetingType: msg.meetingType,
      title: msg.title,
      selfName: String(selfName),
    });
    // Speaker log is best-effort: never block recording on the content script.
    chrome.tabs.sendMessage(msg.tabId, { type: "speaker-log:start", t0: res.t0 }).catch(() => undefined);
    return { ok: true };
  } catch (e) {
    await closeOffscreen();
    return { ok: false, error: errText(e) };
  }
}

async function stop(): Promise<Ack> {
  const s = await getSession();
  if (s.state !== "recording" || s.startedAt === undefined) return { ok: false, error: "Not recording." };
  const stoppedAt = Date.now();
  const uploading: Session = { ...s, state: "uploading", stoppedAt, error: undefined };
  await setSession(uploading);

  const collected = await collectSpeakerLog(s.tabId);
  const { token = "" } = await chrome.storage.local.get("token");
  const meta: UploadMeta = {
    title: s.title ?? "",
    type: s.meetingType ?? "technical",
    started_at: localIso(s.startedAt),
    duration_ms: stoppedAt - s.startedAt,
    self_name: s.selfName ?? "",
    participants: collected.participants,
  };
  let res: Ack | undefined;
  try {
    res = await sendToOffscreen<Ack>({ target: "offscreen", type: "stop", meta, log: collected.log, token: String(token) });
  } catch (e) {
    res = { ok: false, error: errText(e) };
  }
  if (!res?.ok) await applyFailure(uploading, res, "The recorder did not respond.");
  // Otherwise the offscreen document reports `upload-result` when the upload finishes.
  return { ok: true };
}

async function retryUpload(): Promise<Ack> {
  const s = await getSession();
  if (s.state !== "upload-failed") return { ok: false, error: "Nothing to retry." };
  if (!(await hasOffscreen())) {
    const error = await applyFailure(s, undefined, "the recorder page was closed.");
    return { ok: false, error };
  }
  await setSession({ ...s, state: "uploading", error: undefined });
  const { token = "" } = await chrome.storage.local.get("token");
  let res: Ack | undefined;
  try {
    res = await sendToOffscreen<Ack>({ target: "offscreen", type: "retry-upload", token: String(token) });
  } catch (e) {
    res = { ok: false, error: errText(e) };
  }
  if (!res?.ok) {
    const error = await applyFailure(s, res, "The recorder did not respond.");
    return { ok: false, error };
  }
  return { ok: true };
}

async function uploadResult(msg: Extract<FromOffscreen, { type: "upload-result" }>): Promise<void> {
  const s = await getSession();
  if (msg.ok) {
    await setSession({ ...s, state: "done", meetingId: msg.id, error: undefined });
    await closeOffscreen(); // only after a successful upload
  } else {
    // The offscreen doc keeps the recording after a failed upload (kept: true).
    await applyFailure(s, { ok: false, kept: true, error: msg.error }, "Upload failed.");
  }
}

async function status(): Promise<StatusResponse> {
  const s = await getSession();
  let elapsedMs = 0;
  if (s.startedAt !== undefined) {
    elapsedMs = s.state === "recording" ? Date.now() - s.startedAt : (s.stoppedAt ?? s.startedAt) - s.startedAt;
  }
  const out: StatusResponse = { state: s.state, elapsedMs };
  if (s.error) out.error = s.error;
  if (s.meetingId) out.meetingId = s.meetingId;
  return out;
}

// ---------- routing ----------

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (!msg || typeof msg !== "object") return false;
  if (msg.target === "background") {
    const m = msg as FromOffscreen;
    if (m.type === "upload-result") serial(() => uploadResult(m)).catch(() => undefined);
    else if (m.type === "tab-ended") serial(stop).catch(() => undefined);
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
    default:
      return false;
  }
  work.then(sendResponse, (e) => sendResponse({ ok: false, error: errText(e) }));
  return true;
});
