import { describe, expect, it } from "vitest";
import { listPackageFiles } from "../scripts/packageFiles.mjs";

const manifest = {
  icons: { "16": "icons/16.png", "128": "icons/128.png" },
  background: { service_worker: "dist/background.js" },
  action: { default_popup: "dist/popup.html", default_icon: { "16": "icons/16.png" } },
  content_scripts: [{ matches: ["https://meet.google.com/*"], js: ["dist/speakerLog.js"] }],
};

describe("listPackageFiles", () => {
  it("returns every manifest-referenced path, once, plus manifest and notices", () => {
    const files = listPackageFiles(manifest, () => true);
    expect(files).toEqual(
      expect.arrayContaining([
        "manifest.json",
        "THIRD_PARTY_NOTICES.md",
        "icons/16.png",
        "icons/128.png",
        "dist/background.js",
        "dist/popup.html",
        "dist/speakerLog.js",
      ]),
    );
    expect(new Set(files).size).toBe(files.length);
  });

  it("throws naming a missing file", () => {
    expect(() => listPackageFiles(manifest, (p: string) => p !== "icons/128.png")).toThrow(/icons\/128\.png/);
  });
});
