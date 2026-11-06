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
 * Repo text (service names, paths, snippets) must not close the evidence fence or forge the
 * output markers: any `<<<NAME>>>` loses one `<` and one `>`.
 */
function neutralise(s: string): string {
  return s.replace(/<<<([A-Za-z_]+)>>>/g, "<<$1>>");
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

export function splitNotesOutput(text: string): { summaryMd: string; notesMd: string } {
  const s = text.indexOf(SUMMARY_MARK);
  const n = s !== -1 ? text.indexOf(NOTES_MARK, s + SUMMARY_MARK.length) : -1;
  if (s === -1 || n === -1) throw new NotesError("The notes answer is missing the summary / notes markers");
  const summaryMd = text.slice(s + SUMMARY_MARK.length, n).trim();
  const notesMd = text.slice(n + NOTES_MARK.length).trim();
  if (!summaryMd || !notesMd) throw new NotesError("The notes answer has an empty summary or notes section");
  return { summaryMd, notesMd };
}
