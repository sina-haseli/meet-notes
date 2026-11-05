import { build } from "esbuild";
import { existsSync, mkdirSync, readdirSync, copyFileSync } from "node:fs";

const entries = [
  ["src/background.ts", "esm"],
  ["src/offscreen.ts", "esm"],
  ["src/popup.ts", "esm"],
  ["src/permission.ts", "esm"],
  ["src/content/speakerLog.ts", "iife"],
];

mkdirSync("dist", { recursive: true });

for (const [file, format] of entries) {
  if (!existsSync(file)) {
    console.log(`skip ${file} (not present)`);
    continue;
  }
  const name = file.split("/").pop().replace(/\.ts$/, ".js");
  await build({
    entryPoints: [file],
    outfile: `dist/${name}`,
    bundle: true,
    format,
    target: "es2022",
    sourcemap: false,
  });
  console.log(`built dist/${name}`);
}

for (const f of readdirSync("src")) {
  if (f.endsWith(".html")) copyFileSync(`src/${f}`, `dist/${f}`);
}
