// Offscreen document: captures the Meet tab (audio + low-rate video) and the mic, mixes the audio,
// records it, samples screen changes and detects self-speaking.
// - Helper mode (persist false): the recording is kept in memory until an upload succeeds, so a
//   failed upload can be retried.
// - Built-in mode (persist true): 16 kHz PCM slices, WebM chunks and screens are written to
//   IndexedDB as they arrive (crash-safe), and finished meetings are processed here one at a time.
import type { Screen, SpeakerInterval, UploadMeta } from "./types";
import type {
  Ack,
  ExportAudioAck,
  FromOffscreen,
  GetSettingsReply,
  OffscreenStartAck,
  ToOffscreen,
} from "./messages";
import { UPLOAD_URL } from "./messages";
import { CHANGE_THRESHOLD, frameDiff } from "./lib/frameDiff";
import { SpeakingDetector } from "./lib/speakingDetector";
import { buildUploadForm, uploadWithRetry } from "./lib/upload";
import { getHandle, putPcm, putScreen, putWebm, updateMeeting } from "./lib/db";
import { PCM_RATE } from "./lib/audioChunks";
import { SliceBuffer } from "./lib/sliceBuffer";
import { SERVICES_NOTICE, snapshotServices, type ServicesSnapshot } from "./lib/servicesSnapshot";
import { readServicesContext } from "./lib/servicesContext";
import type { Settings } from "./lib/settings";
import { defaultPipelineDeps, processMeeting } from "./lib/pipeline";
import { isOffscreenIdle } from "./lib/offscreenIdle";

const THUMB_W = 64;
const THUMB_H = 36;
const RMS_EVERY_MS = 50;
const FRAME_EVERY_MS = 2000;
const TIMESLICE_MS = 10_000;
/** Keep at most this many screen changes (bounds memory and upload size). */
const MAX_SCREENS = 300;
const WORKLET_PATH = "dist/pcmWorklet.js";
/** How long Stop waits for the worklet to hand over its last partial batch. */
const WORKLET_FLUSH_MS = 1000;

/** Built-in mode only: where the recording is persisted while it runs. */
interface Persist {
  meetingId: string;
  worklet: AudioWorkletNode;
  slices: SliceBuffer;
  /** 16 kHz samples written to IndexedDB so far. */
  pcmSamples: number;
  webmSeq: number;
  /** Serial chain of WebM/screen writes. */
  writes: Promise<void>;
}

interface Recording {
  t0: number;
  streams: MediaStream[];
  ctx: AudioContext;
  recorder: MediaRecorder;
  chunks: Blob[];
  detector: SpeakingDetector;
  screens: Screen[];
  video: HTMLVideoElement;
  timers: number[];
  frameJob: Promise<void> | null;
  lastThumb: Uint8Array | null;
  screensCapped: boolean;
  /** Screens kept so far (counted in both modes; in built-in mode they are not held in memory). */
  screenCount: number;
  stopping: boolean;
  persist: Persist | null;
}

interface Pending {
  meta: UploadMeta;
  log: SpeakerInterval[];
  audio: Blob;
  screens: Screen[];
}

let rec: Recording | null = null;
let pending: Pending | null = null;
let uploading = false;
let exportUrl: string | null = null;
/** Built-in processing queue: FIFO, one meeting at a time. */
const queue: string[] = [];
let processingId: string | null = null;
/** Stop handlers (built-in or helper) still flushing/persisting; the doc must not be closed meanwhile. */
let stopsInFlight = 0;

function errText(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

function report(msg: FromOffscreen): void {
  chrome.runtime.sendMessage(msg).catch(() => undefined);
}

// ---------- start ----------

async function startRecording(streamId: string, selfName: string, meetingId: string | null): Promise<number> {
  const streams: MediaStream[] = [];
  let ctx: AudioContext | null = null;
  try {
    const tab = await navigator.mediaDevices.getUserMedia({
      audio: { mandatory: { chromeMediaSource: "tab", chromeMediaSourceId: streamId } },
      video: { mandatory: { chromeMediaSource: "tab", chromeMediaSourceId: streamId, maxFrameRate: 2 } },
    } as unknown as MediaStreamConstraints);
    streams.push(tab);
    const mic = await navigator.mediaDevices.getUserMedia({ audio: true });
    streams.push(mic);

    ctx = new AudioContext();
    await ctx.resume().catch(() => undefined);
    const tabSrc = ctx.createMediaStreamSource(new MediaStream(tab.getAudioTracks()));
    const micSrc = ctx.createMediaStreamSource(mic);
    const mixed = ctx.createMediaStreamDestination();
    tabSrc.connect(ctx.destination); // capturing mutes the tab: play it back so the meeting stays audible
    tabSrc.connect(mixed);
    micSrc.connect(mixed);
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 2048;
    micSrc.connect(analyser);

    let persist: Persist | null = null;
    if (meetingId !== null) {
      // 16 kHz PCM tap. R6: routed to the destination through a muted gain, so the graph always
      // pulls it (no reliance on auto-pull of zero-output nodes) and it adds nothing audible.
      await ctx.audioWorklet.addModule(chrome.runtime.getURL(WORKLET_PATH));
      const worklet = new AudioWorkletNode(ctx, "pcm-capture", { numberOfInputs: 1, numberOfOutputs: 1 });
      const mute = ctx.createGain();
      mute.gain.value = 0;
      micSrc.connect(worklet);
      tabSrc.connect(worklet);
      worklet.connect(mute);
      mute.connect(ctx.destination);
      const p: Persist = {
        meetingId,
        worklet,
        pcmSamples: 0,
        webmSeq: 0,
        writes: Promise.resolve(),
        slices: new SliceBuffer(async (seq, pcm) => {
          await putPcm(meetingId, seq, pcm);
          p.pcmSamples += pcm.length;
          await updateMeeting(meetingId, { pcmSamples: p.pcmSamples });
        }),
      };
      worklet.port.onmessage = (e: MessageEvent) => {
        if (e.data instanceof Int16Array) p.slices.push(e.data);
      };
      persist = p;
    }

    const recorder = new MediaRecorder(mixed.stream, {
      mimeType: "audio/webm;codecs=opus",
      audioBitsPerSecond: 32000,
    });
    const chunks: Blob[] = [];
    recorder.addEventListener("dataavailable", (e) => {
      if (e.data.size === 0) return;
      if (persist) {
        const p = persist;
        const seq = p.webmSeq++;
        persistWrite(p, () => putWebm(p.meetingId, seq, e.data));
      } else {
        chunks.push(e.data);
      }
    });

    const video = document.createElement("video");
    video.muted = true;
    video.srcObject = new MediaStream(tab.getVideoTracks());
    await video.play().catch(() => undefined);

    recorder.start(TIMESLICE_MS);
    const t0 = Date.now();

    const r: Recording = {
      t0,
      streams,
      ctx,
      recorder,
      chunks,
      detector: new SpeakingDetector(selfName),
      screens: [],
      video,
      timers: [],
      frameJob: null,
      lastThumb: null,
      screensCapped: false,
      screenCount: 0,
      stopping: false,
      persist,
    };

    const buf = new Float32Array(analyser.fftSize);
    r.timers.push(
      window.setInterval(() => {
        analyser.getFloatTimeDomainData(buf);
        let sum = 0;
        for (let i = 0; i < buf.length; i++) sum += buf[i] * buf[i];
        r.detector.push(Math.sqrt(sum / buf.length), Date.now() - r.t0);
      }, RMS_EVERY_MS),
    );
    r.timers.push(
      window.setInterval(() => {
        if (r.frameJob || r.stopping) return;
        r.frameJob = sampleFrame(r).finally(() => {
          r.frameJob = null;
        });
      }, FRAME_EVERY_MS),
    );

    for (const track of tab.getTracks()) {
      track.addEventListener("ended", () => {
        // Tab closed or meeting left: the background runs the normal stop sequence.
        if (rec === r && !r.stopping) report({ target: "background", type: "tab-ended" });
      });
    }

    rec = r;
    return t0;
  } catch (e) {
    for (const s of streams) s.getTracks().forEach((t) => t.stop());
    if (ctx) await ctx.close().catch(() => undefined);
    throw e;
  }
}

const thumbCanvas = new OffscreenCanvas(THUMB_W, THUMB_H);
const thumbCtx = thumbCanvas.getContext("2d", { willReadFrequently: true }) as OffscreenCanvasRenderingContext2D;

async function sampleFrame(r: Recording): Promise<void> {
  // A stray frame failure must never kill the recording.
  try {
    const v = r.video;
    if (v.readyState < HTMLMediaElement.HAVE_CURRENT_DATA || v.videoWidth === 0 || v.videoHeight === 0) return;
    const atMs = Date.now() - r.t0;
    thumbCtx.drawImage(v, 0, 0, THUMB_W, THUMB_H);
    const rgba = thumbCtx.getImageData(0, 0, THUMB_W, THUMB_H).data;
    const gray = new Uint8Array(THUMB_W * THUMB_H);
    for (let i = 0, p = 0; i < gray.length; i++, p += 4) {
      gray[i] = Math.round(0.299 * rgba[p] + 0.587 * rgba[p + 1] + 0.114 * rgba[p + 2]);
    }
    // The first frame counts as a change, so the screen at recording start is kept too.
    if (r.lastThumb && frameDiff(r.lastThumb, gray) < CHANGE_THRESHOLD) return;
    if (r.screenCount >= MAX_SCREENS) {
      if (!r.screensCapped) console.warn(`screen limit (${MAX_SCREENS}) reached; no more screens are kept`);
      r.screensCapped = true;
      return;
    }

    const full = new OffscreenCanvas(v.videoWidth, v.videoHeight);
    const fctx = full.getContext("2d") as OffscreenCanvasRenderingContext2D;
    fctx.drawImage(v, 0, 0);
    const blob = await full.convertToBlob({ type: "image/jpeg", quality: 0.8 });
    r.lastThumb = gray;
    r.screenCount++;
    const p = r.persist;
    if (p) persistWrite(p, () => putScreen(p.meetingId, atMs, blob));
    else r.screens.push({ atMs, blob });
  } catch (e) {
    console.warn("frame sample failed", e);
  }
}

// ---------- stop ----------

async function stopRecording(r: Recording): Promise<{ audio: Blob; selfLog: SpeakerInterval[]; screens: Screen[] }> {
  r.stopping = true;
  r.timers.forEach((t) => clearInterval(t));
  r.timers = [];
  const tEnd = Date.now() - r.t0;
  try {
    if (r.recorder.state !== "inactive") {
      const stopped = new Promise<void>((res) => r.recorder.addEventListener("stop", () => res(), { once: true }));
      r.recorder.stop(); // flushes the final dataavailable before `stop`
      await stopped;
    }
    if (r.frameJob) await r.frameJob;
  } finally {
    release(r);
  }
  return {
    audio: new Blob(r.chunks, { type: "audio/webm" }),
    selfLog: r.detector.finish(tEnd),
    screens: r.screens,
  };
}

function persistWrite(p: Persist, write: () => Promise<void>): void {
  // A failed write must not kill the recording or block later writes.
  p.writes = p.writes.then(write).catch((e) => console.warn("could not save recording data", e));
}

/**
 * Asks the worklet for its partial batch; resolves once that is in the SliceBuffer (or on timeout).
 * The port is detached afterwards, so batches arriving late are not counted.
 */
function flushWorklet(p: Persist): Promise<void> {
  const port = p.worklet.port;
  return new Promise<void>((resolve) => {
    const timer = window.setTimeout(resolve, WORKLET_FLUSH_MS);
    port.onmessage = (e: MessageEvent) => {
      if (e.data instanceof Int16Array) p.slices.push(e.data);
      else if (e.data === "flushed") {
        clearTimeout(timer);
        resolve();
      }
    };
    port.postMessage("flush");
  }).finally(() => {
    port.onmessage = null;
  });
}

/** Built-in Stop: ends capture and waits until everything recorded is in IndexedDB. */
async function stopPersisted(r: Recording, p: Persist): Promise<SpeakerInterval[]> {
  r.stopping = true;
  r.timers.forEach((t) => clearInterval(t));
  r.timers = [];
  const tEnd = Date.now() - r.t0;
  try {
    await flushWorklet(p);
    if (r.recorder.state !== "inactive") {
      const stopped = new Promise<void>((res) => r.recorder.addEventListener("stop", () => res(), { once: true }));
      r.recorder.stop(); // flushes the final dataavailable before `stop`
      await stopped;
    }
    if (r.frameJob) await r.frameJob;
  } catch (e) {
    // Whatever was already written is kept; finish with that.
    console.warn("could not stop the recorder cleanly", e);
  } finally {
    release(r);
  }
  try {
    await p.slices.flush();
  } catch (e) {
    console.warn("could not save part of the audio", e);
  }
  await p.writes;
  try {
    return r.detector.finish(tEnd);
  } catch {
    return []; // keep the content-script log only
  }
}

/**
 * R5: offscreen documents have no chrome.storage, so Settings come from the background, fresh on
 * every call (never cached).
 */
async function fetchSettings(): Promise<Settings> {
  const ask: FromOffscreen = { target: "background", type: "get-settings" };
  const reply = (await chrome.runtime.sendMessage(ask)) as GetSettingsReply | undefined;
  if (
    !reply ||
    typeof reply !== "object" ||
    typeof reply.role !== "string" ||
    typeof reply.openrouterKey !== "string" ||
    !reply.models ||
    typeof reply.models !== "object"
  ) {
    throw new Error("Could not read your settings.");
  }
  return reply;
}

async function takeServicesSnapshot(): Promise<ServicesSnapshot> {
  try {
    return await snapshotServices(await fetchSettings(), getHandle, readServicesContext);
  } catch (e) {
    // Settings or folder unavailable: make the notes without it, and say so.
    console.warn("services snapshot failed", e);
    return { servicesContext: null, servicesNotice: SERVICES_NOTICE };
  }
}

function release(r: Recording): void {
  for (const s of r.streams) s.getTracks().forEach((t) => t.stop());
  r.video.pause();
  r.video.srcObject = null;
  r.ctx.close().catch(() => undefined);
}

// ---------- upload ----------

async function upload(token: string): Promise<void> {
  const p = pending;
  if (!p || uploading) return;
  uploading = true;
  try {
    const form = buildUploadForm(p.meta, p.log, p.audio, p.screens);
    const { id } = await uploadWithRetry(form, UPLOAD_URL, token);
    pending = null; // only now is the recording released
    report({ target: "background", type: "upload-result", ok: true, id });
  } catch (e) {
    report({ target: "background", type: "upload-result", ok: false, error: errText(e) });
  } finally {
    uploading = false;
  }
}

// ---------- built-in processing queue ----------

function enqueue(id: string): void {
  if (processingId !== id && !queue.includes(id)) queue.push(id);
  void drain();
}

async function drain(): Promise<void> {
  if (processingId !== null) return;
  while (queue.length > 0) {
    const id = queue.shift() as string;
    processingId = id;
    let ok = false;
    try {
      // Fresh deps (and settings) per run, so a Retry after fixing Settings uses the new values.
      ok = (await processMeeting(id, defaultPipelineDeps(fetchSettings))).status === "ready";
    } catch (e) {
      console.warn("processing failed", e); // processMeeting should never throw
    } finally {
      processingId = null;
    }
    report({ target: "background", type: "processed", meetingId: id, ok });
  }
  reportIfIdle();
}

function reportIfIdle(): void {
  const idle = isOffscreenIdle({
    recording: rec !== null,
    stopping: stopsInFlight > 0,
    processing: processingId !== null,
    queued: queue.length,
    helperPending: pending !== null || uploading,
  });
  if (idle) report({ target: "background", type: "offscreen-idle" });
}

// ---------- routing ----------

async function handle(msg: ToOffscreen): Promise<Ack | OffscreenStartAck | ExportAudioAck> {
  switch (msg.type) {
    case "start": {
      if (rec) return { ok: false, error: "Already recording." };
      if (pending) return { ok: false, error: "A previous recording has not been uploaded yet." };
      // A missing `persist` (the v1 start) means helper mode.
      const meetingId = msg.persist === true ? (msg.meetingId ?? "") : null;
      if (meetingId === "") return { ok: false, error: "Could not start capture: no meeting to record into." };
      try {
        const t0 = await startRecording(msg.streamId, msg.selfName, meetingId);
        return { ok: true, t0 };
      } catch (e) {
        return { ok: false, error: `Could not start capture: ${errText(e)}` };
      }
    }
    case "stop":
      return withStop(() => stopHelper(msg));
    case "retry-upload": {
      if (!pending) return { ok: false, kept: false, error: "The recording is no longer in memory." };
      if (uploading) return { ok: true };
      void upload(msg.token);
      return { ok: true };
    }
    case "export-audio": {
      // "Save audio & discard": the background downloads this URL, then closes this document.
      if (!pending) return { ok: false, kept: false, error: "The recording is no longer in memory." };
      if (uploading) return { ok: false, kept: true, error: "An upload is in progress." };
      exportUrl ??= URL.createObjectURL(pending.audio);
      return { ok: true, url: exportUrl };
    }
    case "stop-builtin":
      return withStop(() => stopBuiltin(msg));
    case "process": {
      enqueue(msg.meetingId);
      return { ok: true };
    }
  }
}

/**
 * Runs a stop handler while counting it as in flight, so `offscreen-idle` is never reported while
 * the final chunks are still being flushed or persisted (`rec` is already null by then).
 */
async function withStop(fn: () => Promise<Ack>): Promise<Ack> {
  stopsInFlight++;
  try {
    return await fn();
  } finally {
    stopsInFlight--;
    reportIfIdle();
  }
}

async function stopHelper(msg: Extract<ToOffscreen, { type: "stop" }>): Promise<Ack> {
  const r = rec;
  if (!r) return { ok: false, kept: pending !== null, error: "Not recording." };
  // A built-in recording is never handed to the upload path; it keeps running until stop-builtin.
  if (r.persist) return { ok: false, kept: true, error: "The recording didn't stop. Press Stop again." };
  rec = null;
  try {
    const { audio, selfLog, screens } = await stopRecording(r);
    pending = { meta: msg.meta, log: mergeLogs(msg.log, selfLog), audio, screens };
  } catch (e) {
    // Salvage whatever audio was recorded so it can still be uploaded.
    if (r.chunks.length === 0) {
      return { ok: false, kept: false, error: `Could not stop the recorder: ${errText(e)}` };
    }
    let selfLog: SpeakerInterval[] = [];
    try {
      selfLog = r.detector.finish(Date.now() - r.t0);
    } catch {
      // keep the content-script log only
    }
    pending = {
      meta: msg.meta,
      log: mergeLogs(msg.log, selfLog),
      audio: new Blob(r.chunks, { type: "audio/webm" }),
      screens: r.screens,
    };
  }
  void upload(msg.token);
  return { ok: true };
}

async function stopBuiltin(msg: Extract<ToOffscreen, { type: "stop-builtin" }>): Promise<Ack> {
  const r = rec;
  const p = r?.persist;
  if (!r || !p || p.meetingId !== msg.meetingId) return { ok: false, error: "Not recording." };
  rec = null;
  const selfLog = await stopPersisted(r, p);
  const snap = await takeServicesSnapshot();
  try {
    await updateMeeting(p.meetingId, {
      speakerLog: mergeLogs(msg.log, selfLog),
      participants: msg.participants,
      pcmSamples: p.pcmSamples,
      durationMs: Math.round(p.pcmSamples / (PCM_RATE / 1000)),
      servicesContext: snap.servicesContext,
      servicesNotice: snap.servicesNotice,
      status: "queued",
    });
  } catch (e) {
    // The audio is already in IndexedDB; only the final record update failed.
    return { ok: false, error: `Could not save the meeting: ${errText(e)}` };
  }
  enqueue(p.meetingId);
  return { ok: true };
}

function mergeLogs(a: SpeakerInterval[], b: SpeakerInterval[]): SpeakerInterval[] {
  return [...a, ...b].sort((x, y) => x.start_ms - y.start_ms || x.name.localeCompare(y.name));
}

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (!msg || typeof msg !== "object" || msg.target !== "offscreen") return false;
  handle(msg as ToOffscreen).then(sendResponse, (e) =>
    sendResponse({ ok: false, kept: pending !== null, error: errText(e) }),
  );
  return true;
});
