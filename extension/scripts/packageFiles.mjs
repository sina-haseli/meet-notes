// Pure helper for package.mjs: every file the zip must contain for the manifest to work.
export const ALWAYS_INCLUDED = ["manifest.json", "THIRD_PARTY_NOTICES.md"];

function collect(value, out) {
  if (typeof value === "string") {
    if (/^(dist|icons)\//.test(value)) out.add(value);
  } else if (Array.isArray(value)) {
    for (const v of value) collect(v, out);
  } else if (value && typeof value === "object") {
    for (const v of Object.values(value)) collect(v, out);
  }
}

/** Returns manifest.json, the notices file and every dist/ or icons/ path the manifest references.
 *  Throws if any of them does not exist according to `fsExists`. */
export function listPackageFiles(manifest, fsExists) {
  const refs = new Set();
  collect(manifest, refs);
  const files = [...ALWAYS_INCLUDED, ...[...refs].sort()];
  const missing = files.filter((f) => !fsExists(f));
  if (missing.length) throw new Error(`Missing file(s) needed for the package: ${missing.join(", ")}`);
  return files;
}
