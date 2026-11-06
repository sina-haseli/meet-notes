import type { CodeSearch, MeetingRecord, ScreenDesc } from "../types";
import { TEMPLATES } from "./templates";

export const SUMMARY_MARK = "<<<SUMMARY>>>";
export const NOTES_MARK = "<<<NOTES>>>";
export const NOTES_MAX_TOKENS = 16000;

export class NotesError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "NotesError";
  }
}

function mmss(ms: number): string {
  const s = Math.floor(ms / 1000);
  return `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
}

export const CODE_EVIDENCE_START = "<<<CODE_EVIDENCE_START>>>";
export const CODE_EVIDENCE_END = "<<<CODE_EVIDENCE_END>>>";

/**
 * Repo text (service names, keywords, paths, snippets) must not close the evidence fence or forge
 * the output markers. Every marker needs a run of three brackets, so any run of 3+ `<` or `>`
 * collapses to two; the result never contains `<<<` or `>>>`, however many brackets were stacked.
 */
function neutralise(s: string): string {
  return s.replace(/<{3,}/g, "<<").replace(/>{3,}/g, ">>");
}

/** The `## Code evidence` body: what the code search found, or why it did not run. */
export function renderCodeEvidence(cs: CodeSearch | undefined): string {
  if (!cs) return "(code search not run)";
  if (cs.status === "skipped") {
    // The user did not turn the feature on (or can't use it): the notes say nothing about code.
    if (cs.reason === "off" || cs.reason === "not-technical") return "(code search not used)";
    return `(code search skipped: ${cs.reason})`;
  }
  const blocks = cs.services.map((svc) => {
    const lines = [`### ${neutralise(svc.service)} (matched: ${neutralise(svc.keywords.join(", "))})`];
    for (const f of svc.files) {
      lines.push(`- ${neutralise(f.path)}`);
      for (const snip of f.snippets) lines.push(`    > ${neutralise(snip)}`);
    }
    return lines.join("\n");
  });
  const body = blocks.length ? blocks.join("\n\n") : "(no matching code found)";
  const fenced = `${CODE_EVIDENCE_START}\n${body}\n${CODE_EVIDENCE_END}`;
  return cs.limitHit ? `${fenced}\n\n(search stopped at a limit; results may be partial)` : fenced;
}

export function buildNotesPrompt(
  rec: Pick<MeetingRecord, "title" | "type" | "startedAt" | "durationMs" | "participants">,
  transcriptMd: string,
  screens: ScreenDesc[],
  servicesContext: string | null,
  codeSearch?: CodeSearch,
): string {
  const template = TEMPLATES[rec.type];
  if (!template) throw new NotesError(`No notes template for meeting type '${rec.type}'`);
  const date = (rec.startedAt || "").slice(0, 10) || "?";
  const dur = rec.durationMs != null ? mmss(rec.durationMs) : "?";
  const parts = rec.participants?.length ? rec.participants.join(", ") : "?";
  const info =
    "## Meeting info\n" +
    `- Title: ${rec.title || "?"}\n` +
    `- Type: ${rec.type}\n` +
    `- Date: ${date}\n` +
    `- Duration: ${dur}\n` +
    `- Participants: ${parts}\n`;
  const shots = screens.length
    ? "## Screenshots\n" + screens.map((s) => `- screens/${s.atMs}.jpg [${mmss(s.atMs)}]: ${s.description}`).join("\n") + "\n"
    : "## Screenshots\n(none)\n";
  const ctx = `## Services context\n${servicesContext ? servicesContext : "(none)"}\n`;
  const code = `## Code evidence\n${renderCodeEvidence(codeSearch)}\n`;
  return `${template}\n${info}\n${shots}\n${ctx}\n${code}\n## Transcript\n${transcriptMd}\n`;
}

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const TRAILING_PUNCT = new Set([".", ",", ":", ";", "!", "?", "،"]);

/** Tidies a summary line a path was cut out of: empty quotes/brackets, doubled or stray spaces. */
function tidy(line: string): string {
  return line
    .replace(/``/g, "")
    .replace(/\(\s*\)|\[\s*\]/g, "")
    .replace(/ {2,}/g, " ")
    .replace(/ ([.,:;!?،])/g, "$1")
    .trimEnd();
}

/**
 * The email summary names services only, never file paths (spec §4). The notes model is told so;
 * this enforces it: every evidence path, and any `<suggested service>/….<ext>` token, is removed.
 */
export function stripCodePaths(summaryMd: string, cs: CodeSearch | undefined): string {
  if (!cs || cs.status !== "done" || cs.services.length === 0) return summaryMd;
  const paths = cs.services.flatMap((s) => s.files.map((f) => f.path)).filter((p) => p.length > 0);
  // `<service>/` followed by non-space, non-bracket characters; whether it ends in `.ext` is checked below.
  const tokens = cs.services.map(
    (s) => new RegExp(`(?<![\\w./-])${escapeRe(s.service)}/[^\\s()\\[\\]<>"'\`,;،]+`, "g"));
  const out: string[] = [];
  for (const line of summaryMd.split("\n")) {
    let l = line;
    for (const p of paths) l = l.split(p).join("");
    for (const re of tokens) {
      l = l.replace(re, (tok) => {
        let end = tok.length;
        while (end > 0 && TRAILING_PUNCT.has(tok[end - 1])) end--;
        return /\.[A-Za-z0-9]{1,10}$/.test(tok.slice(0, end)) ? tok.slice(end) : tok;
      });
    }
    if (l === line) { out.push(line); continue; }
    const t = tidy(l);
    if (/^\s*(?:[-*•]|\d+[.)])?\s*$/.test(t)) continue; // nothing but a bullet was left
    out.push(t);
  }
  return out.join("\n");
}

export function splitNotesOutput(text: string): { summaryMd: string; notesMd: string } {
  const s = text.indexOf(SUMMARY_MARK);
  const n = s !== -1 ? text.indexOf(NOTES_MARK, s + SUMMARY_MARK.length) : -1;
  if (s === -1 || n === -1) throw new NotesError("The notes answer is missing the summary / notes markers");
  const summaryMd = text.slice(s + SUMMARY_MARK.length, n).trim();
  const notesMd = text.slice(n + NOTES_MARK.length).trim();
  if (!summaryMd || !notesMd) throw new NotesError("The notes answer has an empty summary or notes section");
  return { summaryMd, notesMd };
}
