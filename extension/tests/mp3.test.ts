import { describe, it, expect } from "vitest";
import { encodeMp3 } from "../src/lib/mp3";

describe("encodeMp3", () => {
  it("encodesSilence", () => {
    const blob = encodeMp3(new Int16Array(16000));
    expect(blob.type).toBe("audio/mpeg");
    expect(blob.size).toBeGreaterThan(0);
    expect(blob.size).toBeLessThan(10000);
  });
});
