import { describe, it, expect } from "vitest";
import { formatBytes } from "../src/lib/storageUsage";
import { codeSwitchState } from "../src/lib/codeSwitch";
import { getSettings, type Settings } from "../src/lib/settings";

const fake = { get: async () => ({}), set: async () => undefined };
const base = await getSettings(fake);

describe("formatBytes", () => {
  it("formats bytes, MB and GB", () => {
    expect(formatBytes(0)).toBe("0 B");
    expect(formatBytes(1536)).toBe("1.5 KB");
    expect(formatBytes(1610612736)).toBe("1.5 GB");
    expect(formatBytes(2147483648)).toBe("2.0 GB");
    expect(formatBytes(1572864)).toBe("1.5 MB");
  });
});

describe("codeSwitchStates", () => {
  const tech = (o: Partial<Settings> = {}): Settings => ({ ...base, role: "technical", ...o });

  it("is disabled with a hint when no folder is chosen", () => {
    expect(codeSwitchState(tech({ codeSuggestions: true }), false)).toEqual({
      checked: true,
      disabled: true,
      hint: "Choose a services folder first.",
    });
  });
  it("is disabled for the pm role", () => {
    expect(codeSwitchState({ ...base, role: "pm" }, true)).toEqual({
      checked: false,
      disabled: true,
      hint: "Only for the Technical role.",
    });
  });
  it("is enabled and checked for technical with the setting on", () => {
    expect(codeSwitchState(tech({ codeSuggestions: true }), true)).toEqual({ checked: true, disabled: false, hint: null });
  });
  it("is enabled and unchecked for technical with the setting off", () => {
    expect(codeSwitchState(tech(), true)).toEqual({ checked: false, disabled: false, hint: null });
  });
});
