import { describe, it, expect } from "vitest";
import { formatBytes } from "../src/lib/storageUsage";

describe("formatBytes", () => {
  it("formats bytes, MB and GB", () => {
    expect(formatBytes(0)).toBe("0 B");
    expect(formatBytes(1536)).toBe("1.5 KB");
    expect(formatBytes(1610612736)).toBe("1.5 GB");
    expect(formatBytes(2147483648)).toBe("2.0 GB");
    expect(formatBytes(1572864)).toBe("1.5 MB");
  });
});
