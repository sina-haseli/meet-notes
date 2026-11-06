import { describe, it, expect } from "vitest";
import { parseKeywords, extractKeywords, KEYWORDS_PROMPT } from "../src/lib/codeKeywords";

describe("codeKeywords", () => {
  it("parseKeywordsDefensive", () => {
    expect(parseKeywords('Sure:\n```json\n["Kavenegar", "sms"]\n```\nbye')).toEqual(["kavenegar", "sms"]);
    expect(parseKeywords("not json")).toEqual([]);
    expect(parseKeywords('["کاوه‌نگار","kavenegar"]')).toEqual(["kavenegar"]);
    expect(parseKeywords('["service","api","figma","webhook"]')).toEqual(["webhook"]);
    const many = Array.from({ length: 20 }, (_, i) => `term${i}`);
    expect(parseKeywords(JSON.stringify(many))).toHaveLength(12);
    expect(parseKeywords('["Redis","redis","REDIS","kafka"]')).toEqual(["redis", "kafka"]);
  });
  it("keywordsNeedThreeCharacters", () => {
    expect(parseKeywords('["a","ab","db","abc","s3x","go"]')).toEqual(["abc", "s3x"]);
  });
  it("extractKeywordsSendsTranscriptAndPrompt", async () => {
    const calls: { model: string; text: string }[] = [];
    const fake = (async (_k: string, model: string, content: unknown[]) => {
      calls.push({ model, text: JSON.stringify(content) });
      return { text: '["kavenegar"]', cost: 0.01 };
    }) as unknown as typeof import("../src/lib/openrouter").complete;
    const r = await extractKeywords("k", "m1", "TRANSCRIPT_BODY", [{ atMs: 0, description: "SCREEN_DESC" }], fake);
    expect(r).toEqual({ keywords: ["kavenegar"], cost: 0.01 });
    expect(calls[0].model).toBe("m1");
    expect(calls[0].text).toContain("TRANSCRIPT_BODY");
    expect(calls[0].text).toContain("SCREEN_DESC");
    expect(calls[0].text).toContain(KEYWORDS_PROMPT.slice(0, 30));
  });
});
