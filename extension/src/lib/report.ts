import type { MeetingRecord, Turn } from "../types";
import { NotesError } from "./notes";
import { replaceWholeName } from "./meetingView";

export interface Item { text: string; at?: string }
export interface Action { text: string; owner: string; due: string; person?: string; at?: string }
export interface Topic { heading: string; body: string }
export interface DailyPerson { person: string; yesterday: string[]; today: string[]; blockers: string[] }
export interface CodeService { service: string; reason: string }
export interface Report {
  title: string; summary: string[]; decisions: Item[]; actions: Action[];
  topics: Topic[]; people: DailyPerson[]; followUps: Item[]; codeServices: CodeService[];
}
export interface SpeakerStat { name: string; talkMs: number; share: number; words: number }
export type Meta = Pick<MeetingRecord, "startedAt" | "durationMs" | "type">;

export const FOOTER = "ساخته‌شده با Meet Notes";
export const DASH = "—";
/** Section titles, in report order. */
export const T = {
  summary: "خلاصه", decisions: "تصمیم‌ها", actions: "اقدام‌ها", topics: "یادداشت موضوعی",
  followUps: "پیگیری‌ها", code: "سرویس‌های احتمالی برای تغییر (پیشنهاد AI)", stats: "آمار جلسه",
};

// ---------- parsing ----------

const str = (v: unknown): string => (v === null || v === undefined || typeof v === "object" ? "" : String(v));
const obj = (v: unknown): Record<string, unknown> => (v && typeof v === "object" ? (v as Record<string, unknown>) : {});
const list = (v: unknown): unknown[] => (Array.isArray(v) ? v : v === undefined || v === null || v === "" ? [] : [v]);
const strings = (v: unknown): string[] => list(v).map(str).filter((s) => s !== "");
const opt = (v: unknown): string | undefined => { const s = str(v); return s === "" ? undefined : s; };

function item(v: unknown): Item {
  const o = typeof v === "object" ? obj(v) : { text: v };
  const at = opt(o.at);
  return at === undefined ? { text: str(o.text) } : { text: str(o.text), at };
}

function action(v: unknown): Action {
  const o = obj(v);
  const a: Action = { text: str(o.text), owner: str(o.owner), due: str(o.due) };
  const person = opt(o.person); if (person !== undefined) a.person = person;
  const at = opt(o.at); if (at !== undefined) a.at = at;
  return a;
}

export function parseReport(raw: string): Report {
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  if (start < 0 || end < start) throw new NotesError("The report came back in an unexpected format (no JSON object).");
  let data: unknown;
  try { data = JSON.parse(raw.slice(start, end + 1)); }
  catch { throw new NotesError("The report came back in an unexpected format (invalid JSON)."); }
  const o = obj(data);
  return {
    title: str(o.title),
    summary: strings(o.summary),
    decisions: list(o.decisions).map(item),
    actions: list(o.actions).map(action),
    topics: list(o.topics).map((t) => ({ heading: str(obj(t).heading), body: str(obj(t).body) })),
    people: list(o.people).map((p) => {
      const q = obj(p);
      return { person: str(q.person), yesterday: strings(q.yesterday), today: strings(q.today), blockers: strings(q.blockers) };
    }),
    followUps: list(o.followUps).map(item),
    codeServices: list(o.codeServices).map((c) => ({ service: str(obj(c).service), reason: str(obj(c).reason) })),
  };
}

// ---------- formatting ----------

export function faNum(n: number, fractionDigits = 0): string {
  return n.toLocaleString("fa-IR", { minimumFractionDigits: fractionDigits, maximumFractionDigits: fractionDigits });
}

export function faDuration(ms: number): string {
  const total = Math.max(0, Math.round(ms / 1000));
  const h = Math.floor(total / 3600), m = Math.floor((total % 3600) / 60), s = total % 60;
  const parts: string[] = [];
  if (h) parts.push(`${faNum(h)} ساعت`);
  if (m) parts.push(`${faNum(m)} دقیقه`);
  if (s || parts.length === 0) parts.push(`${faNum(s)} ثانیه`);
  return parts.join(" ");
}

const JALALI = new Intl.DateTimeFormat("fa-IR-u-ca-persian", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });

/** Formats the calendar day as written in the ISO string, whatever the machine's timezone. */
export function jalaliDate(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  const d = m ? new Date(Date.UTC(+m[1], +m[2] - 1, +m[3])) : new Date(iso);
  const parts = JALALI.formatToParts(d);
  const part = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
  return `${part("day")} ${part("month")} ${part("year")}`;
}

export const faDigits = (s: string) => s.replace(/\d/g, (c) => "۰۱۲۳۴۵۶۷۸۹"[+c]);
const pct = (share: number) => `٪${faNum(share * 100, 1)}`;

export function speakerStats(turns: Turn[]): { totalMs: number; words: number; speakers: SpeakerStat[] } {
  const by = new Map<string, SpeakerStat>();
  let totalMs = 0, words = 0;
  for (const t of turns) {
    const s = by.get(t.speaker) ?? { name: t.speaker, talkMs: 0, share: 0, words: 0 };
    const w = t.text.split(/\s+/).filter(Boolean).length;
    const ms = Math.max(0, t.endMs - t.startMs);
    s.talkMs += ms; s.words += w; totalMs += ms; words += w;
    by.set(t.speaker, s);
  }
  const speakers = [...by.values()].sort((a, b) => b.talkMs - a.talkMs);
  for (const s of speakers) s.share = totalMs ? s.talkMs / totalMs : 0;
  return { totalMs, words, speakers };
}

// ---------- editing ----------

export function mapReportText(r: Report, f: (s: string) => string): Report {
  const it = (i: Item): Item => ({ ...i, text: f(i.text) });
  return {
    title: f(r.title),
    summary: r.summary.map(f),
    decisions: r.decisions.map(it),
    actions: r.actions.map((a) => {
      const out: Action = { ...a, text: f(a.text), owner: f(a.owner), due: f(a.due) };
      if (a.person !== undefined) out.person = f(a.person);
      return out;
    }),
    topics: r.topics.map((t) => ({ heading: f(t.heading), body: f(t.body) })),
    people: r.people.map((p) => ({ person: f(p.person), yesterday: p.yesterday.map(f), today: p.today.map(f), blockers: p.blockers.map(f) })),
    followUps: r.followUps.map(it),
    codeServices: r.codeServices.map((c) => ({ service: f(c.service), reason: f(c.reason) })),
  };
}

export function renameInReport(r: Report, old: string, next: string): Report {
  return mapReportText(r, (s) => replaceWholeName(s, old, next));
}

// ---------- shared view model ----------

export const isDaily = (m: Meta) => m.type === "daily";
const orDash = (s: string) => (s === "" ? DASH : s);
/** The daily groups of one person, in order: [label, items, field]. */
export const GROUPS = (p: DailyPerson): [string, string[], "yesterday" | "today" | "blockers"][] =>
  [["دیروز", p.yesterday, "yesterday"], ["امروز", p.today, "today"], ["موانع", p.blockers, "blockers"]];

export function metaLines(m: Meta, turns: Turn[]): string[] {
  const speakers = speakerStats(turns).speakers;
  const line = [jalaliDate(m.startedAt), faDuration(m.durationMs), `${faNum(speakers.length)} گوینده`].join(" · ");
  const named = speakers.map((s) => s.name).filter((n) => turns.some((t) => t.speaker === n && !t.uncertain));
  return named.length ? [line, `حاضران: ${named.join("، ")}`] : [line];
}

export function actionColumns(m: Meta): string[] {
  return isDaily(m) ? ["مانع", "فرد", "رفع‌کننده"] : ["کار", "مسئول", "موعد"];
}
function actionCells(a: Action, m: Meta): string[] {
  return isDaily(m) ? [a.text, orDash(a.person ?? ""), orDash(a.owner)] : [a.text, orDash(a.owner), orDash(a.due)];
}
export function statRows(turns: Turn[]): [string, string][] {
  return speakerStats(turns).speakers.map((s) => [s.name, `${faDuration(s.talkMs)} · ${pct(s.share)}`]);
}
export function statTotals(m: Meta, turns: Turn[]): string {
  const s = speakerStats(turns);
  return [`مدت: ${faDuration(m.durationMs)}`, `گوینده‌ها: ${faNum(s.speakers.length)}`, `کلمه‌ها: ${faNum(s.words)}`].join(" · ");
}

// ---------- markdown ----------

const mdCell = (s: string) => s.replace(/\|/g, "\\|").replace(/\n/g, " ");
const mdTable = (head: string[], rows: string[][]) =>
  [`| # | ${head.join(" | ")} |`, `|${" --- |".repeat(head.length + 1)}`,
    ...rows.map((r, i) => `| ${faNum(i + 1)} | ${r.map(mdCell).join(" | ")} |`)].join("\n");
const mdAt = (at?: string) => (at ? ` [${at}]` : "");

export function reportToMarkdown(r: Report, m: Meta, turns: Turn[]): string {
  const out: string[] = [`# ${r.title}`, "", ...metaLines(m, turns).map((l) => `${l}  `), ""];
  const section = (title: string, body: string) => out.push(`## ${title}`, "", body, "");
  if (r.summary.length) section(T.summary, r.summary.join("\n\n"));
  if (r.decisions.length) section(T.decisions, mdTable(["تصمیم"], r.decisions.map((d) => [d.text + mdAt(d.at)])));
  if (r.actions.length) {
    section(T.actions, mdTable(actionColumns(m), r.actions.map((a) => actionCells(a, m).map((c, i) => (i === 0 ? c + mdAt(a.at) : c)))));
  }
  if (isDaily(m) ? r.people.length : r.topics.length) {
    section(T.topics, isDaily(m)
      ? r.people.map((p) => [`### ${p.person}`, ...GROUPS(p).filter(([, l]) => l.length)
        .flatMap(([n, l]) => ["", `**${n}**`, ...l.map((x) => `- ${x}`)])].join("\n")).join("\n\n")
      : r.topics.map((t) => `### ${t.heading}\n\n${t.body}`).join("\n\n"));
  }
  if (r.followUps.length) section(T.followUps, mdTable(["موضوع"], r.followUps.map((f) => [f.text + mdAt(f.at)])));
  if (r.codeServices.length) section(T.code, r.codeServices.map((c) => `- **${c.service}**: ${c.reason}`).join("\n"));
  const rows = statRows(turns);
  section(T.stats, [statTotals(m, turns), ...(rows.length ? ["", ...rows.map(([n, v]) => `- ${n}: ${v}`)] : [])].join("\n"));
  out.push(`*${FOOTER}*`, "");
  return out.join("\n");
}

// ---------- html ----------

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
const multi = (s: string) => esc(s).replace(/\n/g, "<br>");

/** The report stylesheet, shared by the meeting page, the PDF and report.html. */
export const REPORT_CSS = `.report{font-family:Vazirmatn,Tahoma,sans-serif;background:#fff;color:#222;padding:18px 22px;line-height:1.9}
.report h1{color:#4f46e5;font-size:22px;margin:0 0 4px}
.report .meta{color:#777;font-size:12.5px}
.report .rule{height:3px;background:#4f46e5;margin:12px 0 16px;border-radius:2px}
.report h2{color:#4f46e5;font-size:16px;margin:18px 0 8px}
.report h3{font-size:14px;margin:12px 0 2px}
.report p{margin:0 0 8px;font-size:14px}
.report table{width:100%;border-collapse:collapse;font-size:13.5px}
.report tr{break-inside:avoid}
.report th{background:#efeefe;color:#4f46e5;font-weight:600;text-align:right;padding:7px 10px}
.report td{border-bottom:1px solid #e5e5ea;padding:7px 10px;vertical-align:top}
.report td.n{color:#999;width:24px}
.report td.who{font-weight:700;width:90px}
.report td.due{color:#555;width:80px}
.report .ts{color:#aaa;font-size:11px;font-variant-numeric:tabular-nums}
.report .footer{text-align:center;color:#999;font-size:11.5px;margin-top:18px}`;

export function reportToHtml(
  r: Report, m: Meta, turns: Turn[], opts: { standalone?: boolean; timestamps?: boolean } = {},
): string {
  const showAt = opts.timestamps !== false;
  const ts = (at?: string) => (showAt && at ? ` <span class="ts">[${faDigits(esc(at))}]</span>` : "");
  const table = (head: string[], rows: string[][], classes: string[] = []) =>
    `<table><tr><th>#</th>${head.map((h) => `<th>${esc(h)}</th>`).join("")}</tr>` +
    rows.map((row, i) => `<tr><td class="n">${faNum(i + 1)}</td>${row.map((c, j) => `<td${classes[j] ? ` class="${classes[j]}"` : ""}>${c}</td>`).join("")}</tr>`).join("") +
    "</table>";
  const parts: string[] = [];
  const section = (title: string, body: string) => parts.push(`<section><h2>${esc(title)}</h2>${body}</section>`);

  parts.push(`<h1>${esc(r.title)}</h1>`, ...metaLines(m, turns).map((l) => `<div class="meta">${esc(l)}</div>`), `<div class="rule"></div>`);
  if (r.summary.length) section(T.summary, r.summary.map((p) => `<p>${multi(p)}</p>`).join(""));
  if (r.decisions.length) section(T.decisions, table(["تصمیم"], r.decisions.map((d) => [multi(d.text) + ts(d.at)])));
  if (r.actions.length) {
    section(T.actions, table(actionColumns(m),
      r.actions.map((a) => actionCells(a, m).map((c, i) => (i === 0 ? multi(c) + ts(a.at) : esc(c)))), ["", "who", "due"]));
  }
  if (isDaily(m) ? r.people.length : r.topics.length) {
    const groups = (p: DailyPerson) => GROUPS(p).filter(([, l]) => l.length)
      .map(([n, l]) => `<p><b>${n}</b></p><ul>${l.map((x) => `<li>${multi(x)}</li>`).join("")}</ul>`).join("");
    section(T.topics, isDaily(m)
      ? r.people.map((p) => `<h3>${esc(p.person)}</h3>${groups(p)}`).join("")
      : r.topics.map((t) => `<h3>${esc(t.heading)}</h3><p>${multi(t.body)}</p>`).join(""));
  }
  if (r.followUps.length) section(T.followUps, table(["موضوع"], r.followUps.map((f) => [multi(f.text) + ts(f.at)])));
  if (r.codeServices.length) {
    section(T.code, `<ul>${r.codeServices.map((c) => `<li><b>${esc(c.service)}</b>: ${esc(c.reason)}</li>`).join("")}</ul>`);
  }
  const rows = statRows(turns);
  section(T.stats, `<p>${esc(statTotals(m, turns))}</p>` +
    (rows.length ? `<table>${rows.map(([n, v]) => `<tr><td class="who">${esc(n)}</td><td>${esc(v)}</td></tr>`).join("")}</table>` : ""));
  parts.push(`<div class="footer">${FOOTER}</div>`);

  const body = `<div class="report" dir="rtl" lang="fa">${parts.join("")}</div>`;
  if (!opts.standalone) return body;
  return `<!doctype html>\n<html lang="fa" dir="rtl"><head><meta charset="utf-8"><title>${esc(r.title)}</title>` +
    `<style>body{margin:0}${REPORT_CSS}</style></head><body>${body}</body></html>`;
}
