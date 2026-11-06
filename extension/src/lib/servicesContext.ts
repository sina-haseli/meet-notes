export interface ServicesCaps { maxServices: number; readmeChars: number; totalChars: number }
export const SERVICES_CAPS: ServicesCaps = { maxServices: 80, readmeChars: 3000, totalChars: 40000 };

const TRUNC = "…(truncated)";
const ROOT_MARKERS = ["package.json", "pyproject.toml", "go.mod", ".git"];

// values() is missing from some TS DOM lib versions.
interface DirWithValues {
  values(): AsyncIterable<FileSystemHandle>;
}

async function listEntries(dir: FileSystemDirectoryHandle): Promise<FileSystemHandle[]> {
  const out: FileSystemHandle[] = [];
  for await (const e of (dir as unknown as DirWithValues).values()) out.push(e);
  return out;
}

async function readText(h: FileSystemHandle): Promise<string | null> {
  try {
    return await (await (h as FileSystemFileHandle).getFile()).text();
  } catch {
    return null;
  }
}

function manifestSummary(file: string, text: string): string {
  try {
    if (file === "package.json") {
      const j = JSON.parse(text) as { name?: unknown; description?: unknown };
      const name = typeof j.name === "string" ? j.name : "";
      const desc = typeof j.description === "string" ? j.description : "";
      return [name, desc].filter(Boolean).join(" — ") || "-";
    }
    if (file === "pyproject.toml") {
      const lines = text.split(/\r?\n/).filter((l) => /^\s*(name|description)\s*=/.test(l)).map((l) => l.trim());
      return lines.join("\n") || "-";
    }
    if (file === "go.mod") {
      return text.split(/\r?\n/).find((l) => /^module\s/.test(l))?.trim() || "-";
    }
  } catch { /* fall through */ }
  return "-";
}

async function describeService(name: string, entries: FileSystemHandle[], caps: ServicesCaps): Promise<string> {
  const files = entries.filter((e) => e.kind === "file");
  let manifest = "-";
  for (const f of ["package.json", "pyproject.toml", "go.mod"]) {
    const h = files.find((e) => e.name === f);
    if (!h) continue;
    const t = await readText(h);
    if (t != null) { manifest = manifestSummary(f, t); break; }
  }
  const readmeH = files.find((e) => e.name.toLowerCase().startsWith("readme"));
  let readme = "-";
  if (readmeH) {
    const t = await readText(readmeH);
    if (t && t.trim()) readme = t.slice(0, caps.readmeChars);
  }
  return `### ${name}\nmanifest: ${manifest}\nREADME:\n${readme}\n`;
}

export async function readServicesContext(dir: FileSystemDirectoryHandle, caps: ServicesCaps = SERVICES_CAPS): Promise<string> {
  const entries = await listEntries(dir);
  const blocks: string[] = [];
  if (entries.some((e) => ROOT_MARKERS.includes(e.name))) {
    blocks.push(await describeService(dir.name, entries, caps));
  } else {
    const subs = entries
      .filter((e) => e.kind === "directory" && !e.name.startsWith(".") && e.name !== "node_modules")
      .sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))
      .slice(0, caps.maxServices);
    for (const s of subs) {
      blocks.push(await describeService(s.name, await listEntries(s as FileSystemDirectoryHandle), caps));
    }
  }
  const text = blocks.join("\n");
  return text.length > caps.totalChars ? text.slice(0, caps.totalChars) + "\n" + TRUNC : text;
}
