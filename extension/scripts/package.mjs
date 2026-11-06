// Builds the extension and zips it for the Chrome Web Store: npm run package
import { execSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { zipSync } from "fflate";
import { listPackageFiles } from "./packageFiles.mjs";

process.chdir(join(dirname(fileURLToPath(import.meta.url)), ".."));

execSync("npm run build", { stdio: "inherit" });

const manifest = JSON.parse(readFileSync("manifest.json", "utf8"));
const files = new Set(listPackageFiles(manifest, (p) => existsSync(p)));

function walk(dir) {
  for (const name of readdirSync(dir)) {
    const rel = `${dir}/${name}`;
    if (statSync(rel).isDirectory()) walk(rel);
    else files.add(rel);
  }
}
walk("dist");
walk("icons");

const entries = {};
for (const f of [...files].sort()) entries[f] = new Uint8Array(readFileSync(f));
const out = `meet-notes-${manifest.version}.zip`;
writeFileSync(out, zipSync(entries, { level: 9 }));
console.log(`wrote ${out} (${Object.keys(entries).length} files)`);
