import { describe, it, expect } from "vitest";
import { maskSecrets, isConfigFile, isForbiddenFile, isReadable } from "../src/lib/redact";

describe("redact", () => {
  it("masksAssignmentsAndLongTokens", () => {
    expect(maskSecrets('KAVENEGAR_API_KEY = "4F3A9C2B1D0E8F7A6B5C"')).not.toContain("4F3A");
    expect(maskSecrets('"apiKey": "abc"')).toBe('"apiKey": ***');
    expect(maskSecrets("Authorization: Bearer eyJhbGciOi12345678901234")).not.toContain("eyJ");
    expect(maskSecrets("client := kavenegar.New(cfg.Token)")).toBe("client := kavenegar.New(cfg.Token)");
    expect(maskSecrets("func SendDeliveryStatus()")).toBe("func SendDeliveryStatus()");
  });
  it("fileRules", () => {
    expect(isConfigFile("conf.toml")).toBe(true);
    expect(isForbiddenFile(".env.local")).toBe(true);
    expect(isForbiddenFile("go.sum")).toBe(true);
    expect(isForbiddenFile("aws-credentials.json")).toBe(true);
    expect(isReadable("informing.go")).toBe(true);
    expect(isReadable("Dockerfile")).toBe(true);
    expect(isReadable("logo.png")).toBe(false);
  });
});
