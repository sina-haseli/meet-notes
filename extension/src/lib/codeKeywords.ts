import type { ScreenDesc } from "../types";

export const MAX_KEYWORDS = 12;

export const KEYWORDS_PROMPT =
  "You read a meeting transcript (and descriptions of shared screens) from a software team. " +
  `Reply with ONLY a JSON array of at most ${MAX_KEYWORDS} lowercase Latin search terms likely to appear in ` +
  "source code or config for the work discussed (provider, library, service or domain identifiers). " +
  "Write Persian-spoken English or brand terms in their Latin spelling (for example کاوه‌نگار -> kavenegar). " +
  "Exclude generic words such as service, page, button, data, api, app, frontend, backend, design, test. " +
  "No prose, no explanation, no code fences.";

const GENERIC = new Set([
  "service", "services", "page", "button", "data", "code", "file", "user", "users", "system",
  "api", "app", "application", "front", "frontend", "back", "backend", "design", "figma", "test",
]);
const SHAPE = /^[a-z0-9][a-z0-9_.\-]{2,39}$/; // 3 to 40 characters

export function parseKeywords(raw: string): string[] {
  const first = raw.indexOf("[");
  const last = raw.lastIndexOf("]");
  if (first === -1 || last <= first) return [];
  let data: unknown;
  try {
    data = JSON.parse(raw.slice(first, last + 1));
  } catch {
    return [];
  }
  if (!Array.isArray(data)) return [];
  const out: string[] = [];
  for (const item of data) {
    if (typeof item !== "string") continue;
    const k = item.trim().toLowerCase();
    if (!SHAPE.test(k) || GENERIC.has(k) || out.includes(k)) continue;
    out.push(k);
    if (out.length >= MAX_KEYWORDS) break;
  }
  return out;
}

export async function extractKeywords(
  key: string,
  model: string,
  transcriptMd: string,
  screens: ScreenDesc[],
  complete: typeof import("./openrouter").complete,
): Promise<{ keywords: string[]; cost: number }> {
  const screenText = screens.length ? "\n\nScreens:\n" + screens.map((s) => `- ${s.description}`).join("\n") : "";
  const res = await complete(key, model, [
    { type: "text", text: `${KEYWORDS_PROMPT}\n\nTranscript:\n${transcriptMd}${screenText}` },
  ]);
  return { keywords: parseKeywords(res.text), cost: res.cost };
}
