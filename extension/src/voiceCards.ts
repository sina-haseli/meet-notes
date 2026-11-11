// "Who is speaking?" cards: one per voice, with a playable clip, a clip shuffler and a name field.
// Used on the meeting page before the report is written (and later for renaming).
import { assembleChunk } from "./lib/audioChunks";
import { getPcmRange } from "./lib/db";
import { encodeMp3 } from "./lib/mp3";
import { el } from "./lib/dom";
import { faNum } from "./lib/report";
import { mmss } from "./lib/transcript";
import type { Clip, Voice } from "./lib/voices";

export interface VoiceCardOpts {
  audio: boolean;
  /** Plays the clip; resolves when it ends. */
  play: (clip: Clip) => Promise<void>;
  stop: () => void;
}

const fa = (s: string) => s.replace(/\d/g, (d) => faNum(Number(d)));

/** The clip as a small mp3, cut from the stored PCM. */
export async function clipBlob(meetingId: string, clip: Clip): Promise<Blob> {
  const pcm = await assembleChunk(
    { index: 0, offsetMs: clip.startMs, durationMs: clip.endMs - clip.startMs },
    (a, b) => getPcmRange(meetingId, a, b),
  );
  return encodeMp3(pcm);
}

type AudioLike = Pick<HTMLAudioElement, "pause" | "play" | "src" | "onended" | "onerror">;

/**
 * One shared audio element. `stop` cancels anything still being built, so a clip that finishes
 * encoding after it was cancelled (paused, or another card pressed) never plays.
 */
export function createClipPlayer(
  load: (clip: Clip) => Promise<Blob>,
  audio: AudioLike = new Audio(),
): { play: (clip: Clip) => Promise<void>; stop: () => void } {
  let token = 0;
  let url: string | undefined;
  let finish: (() => void) | undefined;
  const stop = () => {
    token++;
    audio.pause();
    if (url) URL.revokeObjectURL(url);
    url = undefined;
    finish?.();
    finish = undefined;
  };
  const play = async (clip: Clip): Promise<void> => {
    const mine = ++token;
    const blob = await load(clip);
    if (token !== mine) return;
    url = URL.createObjectURL(blob);
    audio.src = url;
    await new Promise<void>((resolve, reject) => {
      finish = resolve;
      audio.onended = () => resolve();
      audio.onerror = () => reject(new Error("playback failed"));
      audio.play().catch(reject);
    });
  };
  return { play, stop };
}

export function renderVoiceCards(root: HTMLElement, voices: Voice[], opts: VoiceCardOpts): { names(): Record<string, string> } {
  root.replaceChildren();
  const inputs: [string, HTMLInputElement][] = [];
  let stopCurrent: (() => void) | null = null;

  const stopAll = () => {
    opts.stop();
    stopCurrent?.();
  };

  voices.forEach((v, n) => {
    let i = 0;
    let playing = false;
    let run = 0;
    const card = el("div", `vcard${v.name ? "" : " unk"}`);
    const playBtn = el("button", "vbtn play", "▶");
    playBtn.type = "button";
    playBtn.title = "پخش";
    playBtn.disabled = !opts.audio;
    const meta = el("div", "vmeta");
    const quote = el("div", "vq");
    quote.dir = "rtl";
    const bar = el("div", "vbar");
    const fill = el("span");
    bar.append(fill);
    const mid = el("div", "vmid");
    mid.append(meta, quote, bar);
    const next = el("button", "vbtn next", "↻");
    next.type = "button";
    next.title = "کلیپ دیگر";
    const input = el("input");
    input.placeholder = "نام این فرد";
    input.value = v.name;
    input.setAttribute("aria-label", `نام صدای ${fa(String(n + 1))}`);
    const hint = el("div", `vhint${v.name ? "" : " warn"}`, v.name ? "پیشنهاد از Google Meet" : "نامشخص — لطفاً نام بدهید");
    const nameBox = el("div", "vname");
    nameBox.append(input, hint);
    card.append(playBtn, mid, next, nameBox);
    root.append(card);
    inputs.push([v.key, input]);

    const reset = () => {
      playing = false;
      run++;
      playBtn.textContent = "▶";
      playBtn.classList.remove("on");
      fill.style.transition = "none";
      fill.style.width = "0";
    };
    const show = () => {
      const c = v.clips[i];
      meta.textContent = `صدای ${faNum(n + 1)} · ٪${faNum(Math.round(v.share * 100))} از جلسه · کلیپ ${faNum(i + 1)} از ${faNum(v.clips.length)} · ${fa(mmss(c.startMs))} تا ${fa(mmss(c.endMs))}`;
      quote.textContent = `«${c.text}»`;
    };
    const start = () => {
      const clip = v.clips[i];
      stopAll();
      playing = true;
      playBtn.textContent = "⏸";
      playBtn.classList.add("on");
      stopCurrent = reset;
      fill.style.transition = "none";
      fill.style.width = "0";
      void fill.offsetWidth;
      fill.style.transition = `width ${Math.max(0, clip.endMs - clip.startMs)}ms linear`;
      fill.style.width = "100%";
      const mine = run;
      const done = () => {
        if (run === mine) reset();
      };
      opts.play(clip).then(done, done);
    };

    playBtn.addEventListener("click", () => {
      if (playing) {
        stopAll();
        return;
      }
      start();
    });
    next.addEventListener("click", () => {
      const was = playing;
      stopAll();
      i = (i + 1) % v.clips.length;
      show();
      if (was) start();
    });
    show();
  });

  return { names: () => Object.fromEntries(inputs.map(([k, inp]) => [k, inp.value])) };
}
