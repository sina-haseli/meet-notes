// Offscreen document: captures the Meet tab (audio + low-rate video) and the mic, mixes the audio,
// records it, samples screen changes, detects self-speaking, and uploads. The recording is kept in
// memory until an upload succeeds, so a failed upload can be retried.
import type { Screen, SpeakerInterval, UploadMeta } from "./types";
import type { Ack, ExportAudioAck, FromOffscreen, OffscreenStartAck, ToOffscreen } from "./messages";
import { UPLOAD_URL } from "./messages";
import { CHANGE_THRESHOLD, frameDiff } from "./lib/frameDiff";
import { SpeakingDetector } from "./lib/speakingDetector";
import { buildUploadForm, uploadWithRetry } from "./lib/upload";

const THUMB_W = 64;
const THUMB_H = 36;
const RMS_EVERY_MS = 50;
const FRAME_EVERY_MS = 2000;
const TIMESLICE_MS = 10_000;
/** Keep at most this many screen changes (bounds memory and upload size). */
const MAX_SCREENS = 300;

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
  stopping: boolean;
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

function errText(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

function report(msg: FromOffscreen): void {
  chrome.runtime.sendMessage(msg).catch(() => undefined);
}

// ---------- start ----------

async function startRecording(streamId: string, selfName: string): Promise<number> {
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

    const recorder = new MediaRecorder(mixed.stream, {
      mimeType: "audio/webm;codecs=opus",
      audioBitsPerSecond: 32000,
    });
    const chunks: Blob[] = [];
    recorder.addEventListener("dataavailable", (e) => {
      if (e.data.size > 0) chunks.push(e.data);
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
      stopping: false,
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
    if (r.screens.length >= MAX_SCREENS) {
      if (!r.screensCapped) console.warn(`screen limit (${MAX_SCREENS}) reached; no more screens are kept`);
      r.screensCapped = true;
      return;
    }

    const full = new OffscreenCanvas(v.videoWidth, v.videoHeight);
    const fctx = full.getContext("2d") as OffscreenCanvasRenderingContext2D;
    fctx.drawImage(v, 0, 0);
    const blob = await full.convertToBlob({ type: "image/jpeg", quality: 0.8 });
    r.lastThumb = gray;
    r.screens.push({ atMs, blob });
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

// ---------- routing ----------

async function handle(msg: ToOffscreen): Promise<Ack | OffscreenStartAck | ExportAudioAck> {
  switch (msg.type) {
    case "start": {
      if (rec) return { ok: false, error: "Already recording." };
      if (pending) return { ok: false, error: "A previous recording has not been uploaded yet." };
      try {
        const t0 = await startRecording(msg.streamId, msg.selfName);
        return { ok: true, t0 };
      } catch (e) {
        return { ok: false, error: `Could not start capture: ${errText(e)}` };
      }
    }
    case "stop": {
      const r = rec;
      if (!r) return { ok: false, kept: pending !== null, error: "Not recording." };
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
  }
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
