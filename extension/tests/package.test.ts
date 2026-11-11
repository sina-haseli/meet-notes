import { describe, expect, it } from "vitest";
import { listPackageFiles } from "../scripts/packageFiles.mjs";
import manifestRaw from "../manifest.json?raw";
import packageRaw from "../package.json?raw";
import notices from "../THIRD_PARTY_NOTICES.md?raw";
import buildSrc from "../build.mjs?raw";

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

describe("store package metadata", () => {
  const m = JSON.parse(manifestRaw) as { version: string; minimum_chrome_version?: string };
  const pkg = JSON.parse(packageRaw) as { version: string };

  it("needs Chrome 116 and matches the package version", () => {
    expect(m.minimum_chrome_version).toBe("116");
    expect(pkg.version).toBe(m.version);
    expect(m.version).toBe("0.2.0");
  });

  it("carries the full licence texts", () => {
    // MIT with the copyright lines from node_modules/*/LICENSE
    expect(notices).toContain("Copyright (c) 2011-2018, Christopher Jeffrey (https://github.com/chjj/)");
    expect(notices).toContain("Copyright (c) 2026 Arjun Barrett");
    expect(notices).toContain("THE SOFTWARE IS PROVIDED \"AS IS\", WITHOUT WARRANTY OF ANY KIND");
    // LGPL-3.0 and the GPL-3.0 it incorporates, in full
    expect(notices).toContain("GNU LESSER GENERAL PUBLIC LICENSE");
    expect(notices).toContain("4. Combined Works.");
    expect(notices).toContain("GNU GENERAL PUBLIC LICENSE");
    expect(notices).toContain("17. Interpretation of Sections 15 and 16.");
  });

  it("bundles the Vazirmatn font and its licence", () => {
    expect(notices).toContain("Vazirmatn");
    expect(notices).toContain("SIL OPEN FONT LICENSE");
    expect(buildSrc).toContain("Vazirmatn");
    expect(buildSrc).toContain("dist/fonts");
  });
});
