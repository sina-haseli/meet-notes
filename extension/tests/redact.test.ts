import { describe, it, expect } from "vitest";
import { maskSecrets, isConfigFile, isForbiddenFile, isReadable } from "../src/lib/redact";

describe("redact", () => {
  it("masksAssignmentsAndLongTokens", () => {
    expect(maskSecrets('KAVENEGAR_API_KEY = "4F3A9C2B1D0E8F7A6B5C"')).toBe("KAVENEGAR_API_KEY = ***");
    expect(maskSecrets('"apiKey": "abc"')).toBe('"apiKey": ***');
    expect(maskSecrets("Authorization: Bearer eyJhbGciOi12345678901234")).not.toContain("eyJ");
    expect(maskSecrets("client := kavenegar.New(cfg.Token)")).toBe("client := kavenegar.New(cfg.Token)");
    expect(maskSecrets("func SendDeliveryStatus()")).toBe("func SendDeliveryStatus()");
  });
  it("masksSchemesQuotedKeysUrlsAndTypedDecls", () => {
    expect(maskSecrets("Authorization: Bearer abc123short")).not.toContain("abc123short");
    expect(maskSecrets("Authorization: Bearer abcdefgh")).not.toContain("abcdefgh");
    expect(maskSecrets('curl -H "Authorization: Bearer abcdefgh" https://x')).not.toContain("abcdefgh");
    expect(maskSecrets("'password' => 'hunter2',")).not.toContain("hunter2");
    expect(maskSecrets("headers = {'Authorization': 'Bearer abcdef'}")).not.toContain("abcdef");
    expect(maskSecrets("postgres://app:S3cretPass@db:5432/app")).toBe("postgres://app:***@db:5432/app");
    expect(maskSecrets("redis://:hunter2@redis:6379/0")).toBe("redis://:***@redis:6379/0");
    expect(maskSecrets('var apiKey string = "s3cr3t"')).not.toContain("s3cr3t");
  });
  it("keepsReadableCode", () => {
    const imp = 'import "github.com/kavenegar/kavenegar-go/v2/pkg"';
    expect(maskSecrets(imp)).toBe(imp);
    expect(maskSecrets("sha=" + "a1b2c3d4e5".repeat(4))).not.toContain("a1b2c3d4e5");
    expect(maskSecrets("eyJhbGciOiJIUzI1.eyJzdWIiOiIxMjM0.SflKxwRJSMeKKF2QT4")).toBe("***");
    for (const l of ["const monkey = 5", 'author: "Sina"', 'if token == ""', "if token != nil"]) {
      expect(maskSecrets(l)).toBe(l);
    }
  });
  it("masksSecretIdentifiers", () => {
    for (const n of ["apiKey", "api_key", "API_KEY", "kavenegarKey", "AUTH_TOKEN", "authToken", "password", "passwd", "pwd", "secret", "clientSecret", "credentials", "Authorization"]) {
      expect(maskSecrets(`${n} = "zzz"`)).toBe(`${n} = ***`);
    }
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
