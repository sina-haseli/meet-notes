// Content script on meet.google.com: samples "who is speaking" while a recording runs.
import { IntervalTracker } from "../lib/intervalTracker";
import type { CollectResponse } from "../messages";
import { getParticipantNames, getSpeakingNames } from "./meetSelectors";

const POLL_MS = 250;

let tracker: IntervalTracker | null = null;
let t0 = 0;
let timer: ReturnType<typeof setInterval> | null = null;
const seen: string[] = [];

function stopPolling(): void {
  if (timer !== null) clearInterval(timer);
  timer = null;
}

function sample(): void {
  if (!tracker) return;
  const names = getSpeakingNames(document);
  tracker.update(names, Date.now() - t0);
  for (const n of getParticipantNames(document)) if (!seen.includes(n)) seen.push(n);
}

chrome.runtime.onMessage.addListener((msg: { type?: string; t0?: number }, _sender, sendResponse) => {
  if (msg?.type === "speaker-log:start") {
    stopPolling();
    tracker = new IntervalTracker();
    seen.length = 0;
    t0 = typeof msg.t0 === "number" ? msg.t0 : Date.now();
    sample();
    timer = setInterval(sample, POLL_MS);
    sendResponse({ ok: true });
  } else if (msg?.type === "speaker-log:collect") {
    stopPolling();
    sample();
    const res: CollectResponse = {
      log: tracker ? tracker.finish(Date.now() - t0) : [],
      participants: [...seen],
    };
    tracker = null;
    sendResponse(res);
  }
  return false;
});
