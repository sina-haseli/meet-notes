// Client for the configured AI provider (OpenRouter, AvalAI or any OpenAI-compatible API).
// The file keeps its old name; nothing here is OpenRouter-only except the parts marked so.
import { TRANSCRIBE_PROMPT } from "./transcript";
import type { Api } from "./provider";

const RETRY_DELAYS = [2000, 8000];

const msgKey = (a: Api) => `${a.name} rejected your API key. Check it in Settings, then press Retry.`;
const msgCredit = (a: Api) =>
  `Your ${a.name} credit ran out. Add credit ${a.creditSite ? `at ${a.creditSite}` : "with your provider"}, then press Retry.`;
const msgBusy = (a: Api) => `${a.name} is busy or unavailable right now. Press Retry in a few minutes.`;
const msgNetwork = (a: Api) => `Couldn't reach ${a.name}. Check your internet connection, then press Retry.`;
const msgUnexpected = (a: Api) => `${a.name} returned something unexpected. Press Retry.`;

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

function messageForStatus(api: Api, status: number): string {
  if (status === 401 || status === 403) return msgKey(api);
  if (status === 402) return msgCredit(api);
  if (status === 429 || status >= 500) return msgBusy(api);
  return msgUnexpected(api);
}

function isRetryable(status: number): boolean {
  return status === 429 || status >= 500;
}

function headers(api: Api, json: boolean): Record<string, string> {
  const h: Record<string, string> = { Authorization: `Bearer ${api.key}` };
  if (json) h["Content-Type"] = "application/json";
  if (api.openrouter) h["X-Title"] = "Meet Notes";
  return h;
}

/** Sends one request with the retry policy; resolves with a 2xx Response. */
async function send(api: Api, path: string, init: RequestInit, deps: OpenRouterDeps): Promise<Response> {
  for (let attempt = 0; ; attempt++) {
    let failure: OpenRouterError;
    try {
      const resp = await deps.fetch(`${api.baseUrl}${path}`, init);
      if (resp.status >= 200 && resp.status < 300) return resp;
      let body = "";
      try { body = (await resp.text()).slice(0, 500); } catch { /* ignore */ }
      failure = new OpenRouterError(messageForStatus(api, resp.status), `HTTP ${resp.status}: ${body}`, resp.status);
      if (!isRetryable(resp.status)) throw failure;
    } catch (e) {
      if (e instanceof OpenRouterError) {
        if (!isRetryable(e.status ?? 0)) throw e;
        failure = e;
      } else {
        const name = e instanceof Error ? e.name : "Error";
        failure = new OpenRouterError(msgNetwork(api), `Network error (${name})`);
      }
    }
    if (attempt >= RETRY_DELAYS.length) throw failure;
    await deps.sleep(RETRY_DELAYS[attempt]);
  }
}

export async function complete(
  api: Api,
  model: string,
  content: unknown[],
  opts: { maxTokens?: number } = {},
  deps: OpenRouterDeps = defaultDeps(),
): Promise<{ text: string; cost: number }> {
  const payload: Record<string, unknown> = {
    model,
    messages: [{ role: "user", content }],
  };
  // OpenRouter only: report the cost of each request. Other APIs may reject unknown fields.
  if (api.openrouter) payload.usage = { include: true };
  if (opts.maxTokens !== undefined) payload.max_tokens = opts.maxTokens;
  const resp = await send(
    api,
    "/chat/completions",
    { method: "POST", headers: headers(api, true), body: JSON.stringify(payload) },
    deps,
  );
  let data: any;
  let raw = "";
  try {
    raw = await resp.text();
    data = JSON.parse(raw);
  } catch {
    throw new OpenRouterError(msgUnexpected(api), `HTTP ${resp.status}: ${raw.slice(0, 500)}`, resp.status);
  }
  const text = data?.choices?.[0]?.message?.content;
  if (typeof text !== "string") {
    throw new OpenRouterError(msgUnexpected(api), `HTTP ${resp.status}: ${raw.slice(0, 500)}`, resp.status);
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
  api: Api, model: string, mp3: Blob, deps?: OpenRouterDeps,
): Promise<{ text: string; cost: number }> {
  const data = await blobToBase64(mp3);
  return complete(api, model, [
    { type: "text", text: TRANSCRIBE_PROMPT },
    { type: "input_audio", input_audio: { data, format: "mp3" } },
  ], {}, deps);
}

export async function describeImage(
  api: Api, model: string, jpeg: Blob, prompt: string, deps?: OpenRouterDeps,
): Promise<{ text: string; cost: number }> {
  const b64 = await blobToBase64(jpeg);
  return complete(api, model, [
    { type: "text", text: prompt },
    { type: "image_url", image_url: { url: `data:image/jpeg;base64,${b64}` } },
  ], {}, deps);
}

/**
 * Checks the key: OpenRouter's key endpoint (with remaining credit), otherwise the
 * OpenAI-compatible model list, which needs a valid key on most providers.
 */
export async function checkKey(
  api: Api, deps: OpenRouterDeps = defaultDeps(),
): Promise<{ ok: true; remainingUsd: number | null } | { ok: false; userMessage: string }> {
  try {
    const resp = await send(api, api.openrouter ? "/key" : "/models", { method: "GET", headers: headers(api, false) }, deps);
    if (!api.openrouter) return { ok: true, remainingUsd: null };
    const data: any = await resp.json();
    const rem = data?.data?.limit_remaining;
    return { ok: true, remainingUsd: typeof rem === "number" ? rem : null };
  } catch (e) {
    if (e instanceof OpenRouterError) return { ok: false, userMessage: e.userMessage };
    return { ok: false, userMessage: msgUnexpected(api) };
  }
}
