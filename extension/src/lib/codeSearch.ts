// Bounded local search of the services folder for meeting keywords.
// Returns ranked, masked evidence of where in the code the meeting's topics live.

import type { CodeFile, CodeService } from "../types";
import { isConfigFile, isReadable, maskSecrets } from "./redact";
import { isSingleRepo, listEntries, serviceDirs } from "./servicesContext";

export interface CodeLimits {
  maxFiles: number;
  maxBytes: number;
  maxMs: number;
  maxFileBytes: number;
  topServices: number;
  filesPerService: number;
  linesPerFile: number;
  lineChars: number;
}
export const CODE_LIMITS: CodeLimits = {
  maxFiles: 20000,
  maxBytes: 200 * 1024 * 1024,
  maxMs: 20000,
  maxFileBytes: 512 * 1024,
  topServices: 3,
  filesPerService: 5,
  linesPerFile: 2,
  lineChars: 200,
};

const SKIP_DIRS = new Set([
  ".git", "node_modules", "vendor", "dist", "build", "bin", "obj", "target", "coverage", "__pycache__", ".idea", ".vscode",
]);
export function isSkippedDir(name: string): boolean {
  return name.startsWith(".") || SKIP_DIRS.has(name);
}

interface Keyword { word: string; lower: string }
interface FileHit { path: string; pathKw: Set<string>; kw: Set<string>; hits: number; snippets: string[] }
interface ServiceHits { service: string; files: FileHit[] }

const byName = (a: FileSystemHandle, b: FileSystemHandle) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0);

/** Trimmed, case-insensitively de-duplicated keywords; the first spelling wins. */
function normalize(keywords: string[]): Keyword[] {
  const out: Keyword[] = [];
  for (const k of keywords) {
    const word = k.trim();
    const lower = word.toLowerCase();
    if (word && !out.some((o) => o.lower === lower)) out.push({ word, lower });
  }
  return out;
}

export async function searchCode(
  dir: FileSystemDirectoryHandle,
  keywords: string[],
  limits: CodeLimits = CODE_LIMITS,
  now: () => number = Date.now,
): Promise<{ services: CodeService[]; limitHit: boolean }> {
  const kws = normalize(keywords);
  if (kws.length === 0) return { services: [], limitHit: false };

  const start = now();
  let visited = 0;
  let bytes = 0;
  let limitHit = false;

  const overLimit = (): boolean => {
    if (!limitHit && (visited >= limits.maxFiles || bytes >= limits.maxBytes || now() - start >= limits.maxMs)) limitHit = true;
    return limitHit;
  };

  // rel is the path inside the service ("" at the service root).
  async function scanFile(h: FileSystemFileHandle, rel: string, acc: ServiceHits): Promise<void> {
    visited++;
    if (!isReadable(h.name)) return; // never opens forbidden, lock or unknown files
    let text: string;
    try {
      const file = await h.getFile();
      if (file.size > limits.maxFileBytes) return;
      text = await file.text();
      bytes += file.size;
    } catch {
      return;
    }
    const relLower = rel.toLowerCase();
    const pathKw = new Set(kws.filter((k) => relLower.includes(k.lower)).map((k) => k.lower));
    const kw = new Set(pathKw);
    const config = isConfigFile(h.name);
    const snippets: string[] = [];
    let hits = pathKw.size;
    for (const line of text.split(/\r?\n/)) {
      const lower = line.toLowerCase();
      const found = kws.filter((k) => lower.includes(k.lower));
      if (found.length === 0) continue;
      hits++;
      for (const k of found) kw.add(k.lower);
      // Mask the whole line before cutting it, so a cut can never expose part of a secret.
      if (!config && snippets.length < limits.linesPerFile) snippets.push(maskSecrets(line.trim()).slice(0, limits.lineChars));
    }
    if (hits > 0) acc.files.push({ path: `${acc.service}/${rel}`, pathKw, kw, hits, snippets });
  }

  async function walk(entries: FileSystemHandle[], rel: string, acc: ServiceHits): Promise<void> {
    for (const e of [...entries].sort(byName)) {
      if (overLimit()) return;
      const p = rel ? `${rel}/${e.name}` : e.name;
      if (e.kind === "directory") {
        if (isSkippedDir(e.name)) continue;
        let sub: FileSystemHandle[];
        try {
          sub = await listEntries(e as FileSystemDirectoryHandle);
        } catch {
          continue; // one unreadable folder must not lose the rest of the search
        }
        await walk(sub, p, acc);
      } else {
        await scanFile(e as FileSystemFileHandle, p, acc);
      }
    }
  }

  const rootEntries = await listEntries(dir);
  const found: ServiceHits[] = [];
  if (isSingleRepo(rootEntries)) {
    const acc: ServiceHits = { service: dir.name, files: [] };
    await walk(rootEntries, "", acc);
    found.push(acc);
  } else {
    for (const s of serviceDirs(rootEntries).filter((d) => !isSkippedDir(d.name))) {
      if (overLimit()) break;
      const acc: ServiceHits = { service: s.name, files: [] };
      found.push(acc);
      try {
        await walk(await listEntries(s), "", acc);
      } catch {
        /* unreadable service folder: no evidence from it */
      }
    }
  }

  const ranked = found
    .filter((s) => s.files.length > 0)
    .map((s) => {
      const pathKw = new Set(s.files.flatMap((f) => [...f.pathKw]));
      const kw = new Set(s.files.flatMap((f) => [...f.kw]));
      // Distinct keywords matched, a path match counting double; then total hits.
      const score = [...kw].reduce((n, k) => n + (pathKw.has(k) ? 2 : 1), 0);
      const hits = s.files.reduce((n, f) => n + f.hits, 0);
      return { s, kw, score, hits };
    })
    .sort((a, b) => b.score - a.score || b.hits - a.hits || (a.s.service < b.s.service ? -1 : a.s.service > b.s.service ? 1 : 0))
    .slice(0, limits.topServices);

  const services: CodeService[] = ranked.map(({ s, kw }) => ({
    service: s.service,
    keywords: kws.filter((k) => kw.has(k.lower)).map((k) => k.word),
    files: [...s.files]
      .sort((a, b) =>
        Number(b.pathKw.size > 0) - Number(a.pathKw.size > 0) || b.hits - a.hits || (a.path < b.path ? -1 : a.path > b.path ? 1 : 0))
      .slice(0, limits.filesPerService)
      .map((f): CodeFile => ({ path: f.path, snippets: f.snippets })),
  }));
  return { services, limitHit };
}
