import { describe, it, expect } from "vitest";
import { pickEvenly, MAX_DESCRIBED, DESCRIBE_PROMPT } from "../src/lib/screens";

describe("pickEvenly", () => {
  it("caps to k keeping first and last", () => {
    const items = Array.from({ length: 100 }, (_, i) => (i + 1) * 100);
    const out = pickEvenly(items, 10);
    expect(out).toHaveLength(10);
    expect(out[0]).toBe(100);
    expect(out[out.length - 1]).toBe(10000);
  });
  it("returns all when k >= n, and first for k = 1", () => {
    expect(pickEvenly([1, 2, 3], 5)).toEqual([1, 2, 3]);
    expect(pickEvenly([1, 2, 3], 1)).toEqual([1]);
  });
  it("exports constants", () => {
    expect(MAX_DESCRIBED).toBe(60);
    expect(DESCRIBE_PROMPT.startsWith("Describe this screenshot")).toBe(true);
  });
});
