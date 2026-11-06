import { TRANSCRIBE_PROMPT } from "./transcript";

const BASE = "https://openrouter.ai/api/v1";
const RETRY_DELAYS = [2000, 8000];

const MSG_KEY = "OpenRouter rejected your API key. Check it in Settings, then press Retry.";
const MSG_CREDIT = "Your OpenRouter credit ran out. Add credit at openrouter.ai, then press Retry.";
const MSG_BUSY = "OpenRouter is busy or unavailable right now. Press Retry in a few minutes.";
const MSG_NETWORK = "Couldn't reach OpenRouter. Check your internet connection, then press Retry.";
const MSG_UNEXPECTED = "OpenRouter returned something unexpected. Press Retry.";

export class OpenRouterError extends Error {
  constructor(public userMessage: string, public detail: string, public status?: number) {
    super(userMessage);
    this.name = "OpenRouterError";
  }
}

export interface OpenRouterDeps {
  fetch: typeof fetch;
  sleep: (ms: number) => Promise<void>;
}

function defaultDeps(): OpenRouterDeps {
  return {
    fetch: (input, init) => globalThis.fetch(input, init),
    sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
  };
}

function messageForStatus(status: number): string {
  if (status === 401 || status === 403) return MSG_KEY;
  if (status === 402) return MSG_CREDIT;
  if (status === 429 || status >= 500) return MSG_BUSY;
  return MSG_UNEXPECTED;
}

function isRetryable(status: number): boolean {
  return status === 429 || status >= 500;
}

/** Sends one request with the retry policy; resolves with a 2xx Response. */
async function send(url: string, init: RequestInit, deps: OpenRouterDeps): Promise<Response> {
  for (let attempt = 0; ; attempt++) {
    let failure: OpenRouterError;
    try {
      const resp = await deps.fetch(url, init);
      if (resp.status >= 200 && resp.status < 300) return resp;
      let body = "";
      try { body = (await resp.text()).slice(0, 500); } catch { /* ignore */ }
      failure = new OpenRouterError(messageForStatus(resp.status), `HTTP ${resp.status}: ${body}`, resp.status);
      if (!isRetryable(resp.status)) throw failure;
    } catch (e) {
      if (e instanceof OpenRouterError) {
        if (!isRetryable(e.status ?? 0)) throw e;
        failure = e;
      } else {
        const name = e instanceof Error ? e.name : "Error";
        failure = new OpenRouterError(MSG_NETWORK, `Network error (${name})`);
      }
    }
    if (attempt >= RETRY_DELAYS.length) throw failure;
    await deps.sleep(RETRY_DELAYS[attempt]);
  }
}

export async function complete(
  key: string,
  model: string,
  content: unknown[],
  opts: { maxTokens?: number } = {},
  deps: OpenRouterDeps = defaultDeps(),
): Promise<{ text: string; cost: number }> {
  const payload: Record<string, unknown> = {
    model,
    messages: [{ role: "user", content }],
    usage: { include: true },
  };
  if (opts.maxTokens !== undefined) payload.max_tokens = opts.maxTokens;
  const resp = await send(
    `${BASE}/chat/completions`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json",
        "X-Title": "Meet Notes",
      },
      body: JSON.stringify(payload),
    },
    deps,
  );
  let data: any;
  let raw = "";
  try {
    raw = await resp.text();
    data = JSON.parse(raw);
  } catch {
    throw new OpenRouterError(MSG_UNEXPECTED, `HTTP ${resp.status}: ${raw.slice(0, 500)}`, resp.status);
  }
  const text = data?.choices?.[0]?.message?.content;
  if (typeof text !== "string") {
    throw new OpenRouterError(MSG_UNEXPECTED, `HTTP ${resp.status}: ${raw.slice(0, 500)}`, resp.status);
  }
  const cost = Number(data?.usage?.cost);
  return { text, cost: Number.isFinite(cost) ? cost : 0 };
}

async function blobToBase64(blob: Blob): Promise<string> {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  const PIECE = 32766; // ~32 KB and a multiple of 3, so pieces concatenate without mid-string padding
  let out = "";
  for (let i = 0; i < bytes.length; i += PIECE) {
    out += btoa(String.fromCharCode.apply(null, bytes.subarray(i, i + PIECE) as unknown as number[]));
  }
  return out;
}

export async function transcribeChunk(
  key: string, model: string, mp3: Blob, deps?: OpenRouterDeps,
): Promise<{ text: string; cost: number }> {
  const data = await blobToBase64(mp3);
  return complete(key, model, [
    { type: "text", text: TRANSCRIBE_PROMPT },
    { type: "input_audio", input_audio: { data, format: "mp3" } },
  ], {}, deps);
}

export async function describeImage(
  key: string, model: string, jpeg: Blob, prompt: string, deps?: OpenRouterDeps,
): Promise<{ text: string; cost: number }> {
  const b64 = await blobToBase64(jpeg);
  return complete(key, model, [
    { type: "text", text: prompt },
    { type: "image_url", image_url: { url: `data:image/jpeg;base64,${b64}` } },
  ], {}, deps);
}

export async function checkKey(
  key: string, deps: OpenRouterDeps = defaultDeps(),
): Promise<{ ok: true; remainingUsd: number | null } | { ok: false; userMessage: string }> {
  try {
    const resp = await send(`${BASE}/key`, { method: "GET", headers: { Authorization: `Bearer ${key}`, "X-Title": "Meet Notes" } }, deps);
    const data: any = await resp.json();
    const rem = data?.data?.limit_remaining;
    return { ok: true, remainingUsd: typeof rem === "number" ? rem : null };
  } catch (e) {
    if (e instanceof OpenRouterError) return { ok: false, userMessage: e.userMessage };
    return { ok: false, userMessage: MSG_UNEXPECTED };
  }
}
