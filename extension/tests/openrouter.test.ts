import { describe, it, expect } from "vitest";
import {
  OpenRouterError, complete, transcribeChunk, describeImage, checkKey,
} from "../src/lib/openrouter";

type Call = { url: string; init: RequestInit };

function harness(responses: Array<Response | Error>) {
  const calls: Call[] = [];
  const sleeps: number[] = [];
  let i = 0;
  const fetchFn = (async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    const r = responses[Math.min(i++, responses.length - 1)];
    if (r instanceof Error) throw r;
    return r.clone();
  }) as unknown as typeof fetch;
  const deps = { fetch: fetchFn, sleep: async (ms: number) => { sleeps.push(ms); } };
  return { calls, sleeps, deps };
}

const ok = (text = "hi", cost?: number) =>
  new Response(JSON.stringify({
    choices: [{ message: { content: text } }],
    ...(cost === undefined ? {} : { usage: { cost } }),
  }), { status: 200 });

const status = (s: number, body = "boom") => new Response(body, { status: s });

const BUSY = "OpenRouter is busy or unavailable right now. Press Retry in a few minutes.";

function decode(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

async function failure(p: Promise<unknown>): Promise<OpenRouterError> {
  try { await p; } catch (e) { return e as OpenRouterError; }
  throw new Error("expected rejection");
}

describe("complete", () => {
  it("sendsModelContentAndUsage", async () => {
    const h = harness([ok()]);
    await complete("sk-key", "m/x", [{ type: "text", text: "yo" }], { maxTokens: 50 }, h.deps);
    expect(h.calls).toHaveLength(1);
    expect(h.calls[0].url).toBe("https://openrouter.ai/api/v1/chat/completions");
    const headers = h.calls[0].init.headers as Record<string, string>;
    expect(headers["Authorization"]).toBe("Bearer sk-key");
    expect(headers["X-Title"]).toBe("Meet Notes");
    const body = JSON.parse(h.calls[0].init.body as string);
    expect(body.model).toBe("m/x");
    expect(body.messages).toEqual([{ role: "user", content: [{ type: "text", text: "yo" }] }]);
    expect(body.usage.include).toBe(true);
    expect(body.max_tokens).toBe(50);
  });

  it("omits max_tokens when not given", async () => {
    const h = harness([ok()]);
    await complete("k", "m", [], undefined, h.deps);
    expect(JSON.parse(h.calls[0].init.body as string)).not.toHaveProperty("max_tokens");
  });

  it("parsesTextAndCost", async () => {
    const h = harness([ok("hello", 0.0123)]);
    expect(await complete("k", "m", [], {}, h.deps)).toEqual({ text: "hello", cost: 0.0123 });
  });

  it("cost is 0 when usage is missing", async () => {
    const h = harness([ok("hello")]);
    expect((await complete("k", "m", [], {}, h.deps)).cost).toBe(0);
  });

  it("retries429Then200", async () => {
    const h = harness([status(429), ok("late")]);
    const r = await complete("k", "m", [], {}, h.deps);
    expect(r.text).toBe("late");
    expect(h.sleeps).toEqual([2000]);
    expect(h.calls).toHaveLength(2);
  });

  it("gives503FriendlyAfterThreeTries", async () => {
    const h = harness([status(503, "down")]);
    const e = await failure(complete("k", "m", [], {}, h.deps));
    expect(e).toBeInstanceOf(OpenRouterError);
    expect(e.userMessage).toBe(BUSY);
    expect(e.detail).toBe("HTTP 503: down");
    expect(e.status).toBe(503);
    expect(h.sleeps).toEqual([2000, 8000]);
    expect(h.calls).toHaveLength(3);
  });

  it("fails402Immediately", async () => {
    const h = harness([status(402)]);
    const e = await failure(complete("k", "m", [], {}, h.deps));
    expect(e.userMessage).toBe("Your OpenRouter credit ran out. Add credit at openrouter.ai, then press Retry.");
    expect(h.calls).toHaveLength(1);
    expect(h.sleeps).toEqual([]);
  });

  it("fails401Immediately", async () => {
    const h = harness([status(401)]);
    const e = await failure(complete("k", "m", [], {}, h.deps));
    expect(e.userMessage).toBe("OpenRouter rejected your API key. Check it in Settings, then press Retry.");
    expect(h.calls).toHaveLength(1);
  });

  it("403 is the key message and 400 is unexpected, both immediate", async () => {
    const a = harness([status(403)]);
    expect((await failure(complete("k", "m", [], {}, a.deps))).userMessage).toMatch(/rejected your API key/);
    const b = harness([status(400)]);
    const e = await failure(complete("k", "m", [], {}, b.deps));
    expect(e.userMessage).toBe("OpenRouter returned something unexpected. Press Retry.");
    expect(b.calls).toHaveLength(1);
  });

  it("truncates detail to 500 chars of body", async () => {
    const h = harness([status(400, "x".repeat(900))]);
    const e = await failure(complete("k", "m", [], {}, h.deps));
    expect(e.detail).toBe("HTTP 400: " + "x".repeat(500));
  });

  it("networkErrorFriendly", async () => {
    const h = harness([new TypeError("Failed to fetch")]);
    const e = await failure(complete("sk-secret", "m", [], {}, h.deps));
    expect(e.userMessage).toBe("Couldn't reach OpenRouter. Check your internet connection, then press Retry.");
    expect(h.calls).toHaveLength(3);
    expect(h.sleeps).toEqual([2000, 8000]);
    expect(e.detail).not.toContain("sk-secret");
  });

  it("a bad 200 body is unexpected, not retried", async () => {
    const h = harness([new Response(JSON.stringify({ nope: 1 }), { status: 200 })]);
    const e = await failure(complete("k", "m", [], {}, h.deps));
    expect(e.userMessage).toBe("OpenRouter returned something unexpected. Press Retry.");
    expect(h.calls).toHaveLength(1);
  });
});

describe("checkKey", () => {
  it("checkKeyOkAndRemaining", async () => {
    const h = harness([new Response(JSON.stringify({ data: { limit_remaining: 1.98 } }), { status: 200 })]);
    expect(await checkKey("k", h.deps)).toEqual({ ok: true, remainingUsd: 1.98 });
    expect(h.calls[0].url).toBe("https://openrouter.ai/api/v1/key");
    expect((h.calls[0].init.headers as Record<string, string>)["Authorization"]).toBe("Bearer k");
  });

  it("null when there is no limit", async () => {
    const h = harness([new Response(JSON.stringify({ data: { limit_remaining: null } }), { status: 200 })]);
    expect(await checkKey("k", h.deps)).toEqual({ ok: true, remainingUsd: null });
  });

  it("checkKey401", async () => {
    const h = harness([status(401)]);
    expect(await checkKey("k", h.deps)).toEqual({
      ok: false,
      userMessage: "OpenRouter rejected your API key. Check it in Settings, then press Retry.",
    });
  });
});

describe("media helpers", () => {
  it("transcribeChunkSendsMp3Base64", async () => {
    const bytes = new Uint8Array([0, 1, 2, 250, 251, 252, 255]);
    const h = harness([ok("t")]);
    await transcribeChunk("k", "m", new Blob([bytes]), h.deps);
    const body = JSON.parse(h.calls[0].init.body as string);
    const parts = body.messages[0].content;
    const audio = parts.find((p: { type: string }) => p.type === "input_audio");
    expect(audio.input_audio.format).toBe("mp3");
    expect(Array.from(decode(audio.input_audio.data))).toEqual(Array.from(bytes));
    expect(parts.some((p: { type: string }) => p.type === "text")).toBe(true);
  });

  it("describeImage sends a jpeg data URL after the prompt", async () => {
    const h = harness([ok("d")]);
    await describeImage("k", "m", new Blob([new Uint8Array([1, 2, 3])]), "what?", h.deps);
    const parts = JSON.parse(h.calls[0].init.body as string).messages[0].content;
    expect(parts[0]).toEqual({ type: "text", text: "what?" });
    expect(parts[1]).toEqual({ type: "image_url", image_url: { url: "data:image/jpeg;base64,AQID" } });
  });

  it("base64LargeBlob", async () => {
    const big = new Uint8Array(3 * 1024 * 1024).map((_, i) => i % 251);
    const h = harness([ok()]);
    await transcribeChunk("k", "m", new Blob([big]), h.deps);
    const body = JSON.parse(h.calls[0].init.body as string);
    const data = body.messages[0].content.find((p: { type: string }) => p.type === "input_audio").input_audio.data;
    expect(decode(data)).toEqual(big);
  });
});
