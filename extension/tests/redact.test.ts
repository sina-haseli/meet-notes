import { describe, it, expect } from "vitest";
import { maskSecrets, isConfigFile, isForbiddenFile, isReadable } from "../src/lib/redact";

describe("redact", () => {
  it("masksAssignmentsAndLongTokens", () => {
    // R3: string literals on a secret line keep their quotes; only the content becomes ***.
    expect(maskSecrets('KAVENEGAR_API_KEY = "4F3A9C2B1D0E8F7A6B5C"')).toBe('KAVENEGAR_API_KEY = "***"');
    // Every non-empty literal on a secret line is masked, quoted keys included.
    expect(maskSecrets('"apiKey": "abc"')).toBe('"***": "***"');
    expect(maskSecrets("Authorization: Bearer eyJhbGciOi12345678901234")).toBe("Authorization: Bearer ***");
    // R3: `Token` makes this a secret line, so the unquoted value after := is masked.
    expect(maskSecrets("client := kavenegar.New(cfg.Token)")).toBe("client := ***)");
    expect(maskSecrets("func SendDeliveryStatus()")).toBe("func SendDeliveryStatus()");
  });
  it("masksSchemesQuotedKeysUrlsAndTypedDecls", () => {
    expect(maskSecrets("Authorization: Bearer abc123short")).toBe("Authorization: Bearer ***");
    expect(maskSecrets("Authorization: Bearer abcdefgh")).toBe("Authorization: Bearer ***");
    expect(maskSecrets('curl -H "Authorization: Bearer abcdefgh" https://x')).not.toContain("abcdefgh");
    expect(maskSecrets("'password' => 'hunter2',")).toBe("'***' => '***',");
    expect(maskSecrets("headers = {'Authorization': 'Bearer abcdef'}")).toBe("headers = {'***': 'Bearer ***'}");
    expect(maskSecrets("postgres://app:S3cretPass@db:5432/app")).toBe("postgres://app:***@db:5432/app");
    expect(maskSecrets("redis://:hunter2@redis:6379/0")).toBe("redis://:***@redis:6379/0");
    expect(maskSecrets('var apiKey string = "s3cr3t"')).not.toContain("s3cr3t");
  });
  it("keepsReadableCode", () => {
    const imp = 'import "github.com/kavenegar/kavenegar-go/v2/pkg"';
    expect(maskSecrets(imp)).toBe(imp);
    expect(maskSecrets("sha=" + "a1b2c3d4e5".repeat(4))).not.toContain("a1b2c3d4e5");
    expect(maskSecrets("eyJhbGciOiJIUzI1.eyJzdWIiOiIxMjM0.SflKxwRJSMeKKF2QT4")).toBe("***");
    for (const l of [
      "const monkey = 5", 'author: "Sina"', 'if token == ""', "if token != nil", "tokenizer.next()",
      "const keyboard = getKeyboard()", "let passenger = load()", "compass: north",
      'import { send } from "./kavenegar"', "import kavenegar from 'kavenegar-go'",
    ]) {
      expect(maskSecrets(l)).toBe(l);
    }
  });
  it("masksSecretIdentifiers", () => {
    for (const n of ["apiKey", "api_key", "API_KEY", "kavenegarKey", "AUTH_TOKEN", "authToken", "password", "passwd", "pwd", "secret", "clientSecret", "credentials", "Authorization"]) {
      expect(maskSecrets(`${n} = "zzz"`)).toBe(`${n} = "***"`);
    }
  });

  // C1 / R3: the declarations the final review found unmasked. Short, letters-only values, so the
  // long-run rule cannot hide a regression in the secret-line rule.
  it.each([
    ['const apiKey = "abc"', "abc"],
    ['let kavenegarPassword = "Tehran@1402"', "Tehran@1402"],
    ['var password = "hunter2"', "hunter2"],
    ['export const smsToken = "abcdefg"', "abcdefg"],
    ['String password = "hunter2";', "hunter2"],
    ['private static final String API_KEY = "abc";', "abc"],
    ['private const string ApiKey = "abc";', "abc"],
    ['val apiKey: String = "abc"', "abc"],
    ['private apiKey: string = "abc"', "abc"],
    ['const KAVENEGAR_API_KEY: string = "abc"', "abc"],
    ['kavenegar_api_key: str = "abc"', "abc"],
    ["apikey: abcdef", "abcdef"],
    ["APIKEY = abcdef", "abcdef"],
    ["DB_PASS=abcdef", "abcdef"],
    ["passphrase: abcdef", "abcdef"],
    ["x-api-key: abcdef", "abcdef"],
    ["Client(api_key=abcdef)", "abcdef"],
    ["https://h/send?token=abcdef&to=1", "abcdef"],
    ["Authorization=Basic dXNlcjpwYXNz", "dXNlcjpwYXNz"],
    ["`Bearer ${tok}` // authToken", "${tok}"],
  ])("masks %s", (line, secret) => {
    const out = maskSecrets(line);
    expect(out).not.toContain(secret);
    expect(out).toContain("***");
  });
  it("keepsNamesAndTypesInDeclarations", () => {
    expect(maskSecrets('const apiKey = "abc"')).toBe('const apiKey = "***"');
    expect(maskSecrets('val apiKey: String = "abc"')).toBe('val apiKey: String = "***"');
    expect(maskSecrets('kavenegar_api_key: str = "abc"')).toBe('kavenegar_api_key: str = "***"');
    expect(maskSecrets("DB_PASS=abcdef")).toBe("DB_PASS=***");
    expect(maskSecrets("Authorization=Basic dXNlcjpwYXNz")).toBe("Authorization=Basic ***");
  });

  it("masksLongRunsButKeepsPaths", () => {
    const url = "https://api.kavenegar.com/v1/4F6B4A6C6D7A2B3C4D5E6F/sms/send.json";
    expect(maskSecrets(url)).toBe("https://api.kavenegar.com/v1/***/sms/send.json");
    expect(maskSecrets("aws = wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY")).toBe("aws = ***");
    const imp = "github.com/kavenegar/kavenegar-go/v2/pkg";
    expect(maskSecrets(imp)).toBe(imp);
    expect(maskSecrets("id: 1234567890123456789")).toBe("id: 1234567890123456789");
  });

  it("isLinearOnHugeLines", () => {
    const n = 512 * 1024;
    const lines = [
      "a-".repeat(n / 2),
      "sms-gateway-".repeat(Math.ceil(n / 12)).slice(0, n),
      "a.".repeat(n / 2),
      "data:image/png;base64," + "Ab9_-xY".repeat(Math.ceil(n / 7)).slice(0, n),
      "token = " + "a-".repeat(n / 2),
      "x://" + "a:".repeat(n / 2),
    ];
    for (const l of lines) {
      const t0 = performance.now();
      maskSecrets(l);
      expect(performance.now() - t0).toBeLessThan(200);
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
