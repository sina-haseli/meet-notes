// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, type Mock } from "vitest";
import { createClipPlayer, renderVoiceCards } from "../src/voiceCards";
import type { Clip, Voice } from "../src/lib/voices";

const voices: Voice[] = [
  {
    key: "v1", name: "دانیال", fromMeet: true, talkMs: 700_000, share: 0.7,
    clips: [
      { startMs: 760_000, endMs: 772_000, text: "اولی" },
      { startMs: 1_263_000, endMs: 1_275_000, text: "دومی" },
      { startMs: 2_650_000, endMs: 2_662_000, text: "سومی" },
    ],
  },
  { key: "v2", name: "", fromMeet: false, talkMs: 80_000, share: 0.08, clips: [{ startMs: 5_000, endMs: 15_000, text: "<b>x</b>" }] },
];

let root: HTMLElement;
let play: Mock<(clip: Clip) => Promise<void>>;
let stop: Mock<() => void>;
const mount = (audio = true) => renderVoiceCards(root, voices, { audio, play, stop });
const card = (i: number) => root.querySelectorAll<HTMLElement>(".vcard")[i];
const q = (i: number, sel: string) => card(i).querySelector(sel) as HTMLElement;

beforeEach(() => {
  root = document.createElement("div");
  play = vi.fn(async (_c: Clip) => undefined);
  stop = vi.fn();
});

describe("renderVoiceCards", () => {
  it("renders a card per voice with the Persian meta line and quoted clip text", () => {
    mount();
    expect(root.querySelectorAll(".vcard").length).toBe(2);
    expect(q(0, ".vmeta").textContent).toBe("صدای ۱ · ٪۷۰ از جلسه · کلیپ ۱ از ۳ · ۱۲:۴۰ تا ۱۲:۵۲");
    expect(q(0, ".vq").textContent).toBe("«اولی»");
  });

  it("pre-fills a Meet name and flags unknown voices", () => {
    mount();
    expect((q(0, "input") as HTMLInputElement).value).toBe("دانیال");
    expect(q(0, ".vhint").textContent).toBe("پیشنهاد از Google Meet");
    expect(card(0).classList.contains("unk")).toBe(false);
    expect((q(1, "input") as HTMLInputElement).value).toBe("");
    expect(q(1, ".vhint").textContent).toBe("نامشخص — لطفاً نام بدهید");
    expect(card(1).classList.contains("unk")).toBe(true);
  });

  it("↻ advances, stops, replays when it was playing, and wraps", () => {
    mount();
    q(0, ".next").click();
    expect(q(0, ".vq").textContent).toBe("«دومی»");
    expect(stop).toHaveBeenCalledTimes(1);
    expect(play).not.toHaveBeenCalled();
    q(0, ".play").click();
    expect(play).toHaveBeenLastCalledWith(voices[0].clips[1]);
    q(0, ".next").click();
    expect(play).toHaveBeenLastCalledWith(voices[0].clips[2]);
    q(0, ".next").click();
    expect(q(0, ".vmeta").textContent).toContain("کلیپ ۱ از ۳");
  });

  it("▶ on another card stops the one playing", () => {
    mount();
    q(0, ".play").click();
    expect(q(0, ".play").classList.contains("on")).toBe(true);
    stop.mockClear();
    q(1, ".play").click();
    expect(stop).toHaveBeenCalled();
    expect(q(0, ".play").classList.contains("on")).toBe(false);
    expect(q(1, ".play").classList.contains("on")).toBe(true);
    expect(play).toHaveBeenLastCalledWith(voices[1].clips[0]);
  });

  it("disables ▶ without audio but ↻ still cycles text", () => {
    mount(false);
    expect((q(0, ".play") as HTMLButtonElement).disabled).toBe(true);
    q(0, ".next").click();
    expect(q(0, ".vq").textContent).toBe("«دومی»");
  });

  it("names() maps each key to the input value", () => {
    const api = mount();
    (q(1, "input") as HTMLInputElement).value = "مهران";
    expect(api.names()).toEqual({ v1: "دانیال", v2: "مهران" });
  });

  it("shows clip text literally", () => {
    mount();
    expect(q(1, ".vq").textContent).toBe("«<b>x</b>»");
    expect(q(1, ".vq").querySelector("b")).toBeNull();
  });
});

describe("createClipPlayer", () => {
  const clipA = { startMs: 0, endMs: 1000, text: "a" };
  const clipB = { startMs: 0, endMs: 1000, text: "b" };
  const setup = () => {
    URL.createObjectURL = vi.fn((b: Blob) => `blob:${(b as unknown as { tag: string }).tag}`);
    URL.revokeObjectURL = vi.fn();
    const audio = { src: "", pause: vi.fn(), play: vi.fn(async () => undefined), onended: null, onerror: null } as never as HTMLAudioElement;
    const pending = new Map<string, (b: Blob) => void>();
    const load = (c: Clip) => new Promise<Blob>((r) => pending.set(c.text, (b) => r(b)));
    const blob = (tag: string) => Object.assign(new Blob(), { tag });
    return { audio, pending, blob, player: createClipPlayer(load, audio) };
  };

  it("does not play a clip stopped while it was being built", async () => {
    const { audio, pending, blob, player } = setup();
    const done = player.play(clipA);
    player.stop();
    pending.get("a")!(blob("a"));
    await done;
    expect(audio.play).not.toHaveBeenCalled();
  });

  it("plays only the latest clip when another is pressed during the build", async () => {
    const { audio, pending, blob, player } = setup();
    const a = player.play(clipA);
    player.stop();
    const b = player.play(clipB);
    pending.get("b")!(blob("b"));
    await Promise.resolve();
    await Promise.resolve();
    pending.get("a")!(blob("a"));
    await a;
    expect(audio.play).toHaveBeenCalledTimes(1);
    expect(audio.src).toBe("blob:b");
    player.stop();
    await b;
  });
});
