// The report tab on the meeting page: the same structure and class names as reportToHtml (styled
// by REPORT_CSS), with every written text editable in place. The meta line and the stats are
// computed from the meeting and are not editable. Text is only ever set as text, never as HTML.
import type { MeetingRecord, Turn } from "./types";
import { el } from "./lib/dom";
import {
  DASH, FOOTER, GROUPS, T, actionColumns, faDigits, faNum, isDaily, metaLines, statRows, statTotals,
  type Report,
} from "./lib/report";

const EDITABLE = "plaintext-only";

/** Each editable element carries its place in the report as a dotted path, e.g. "actions.1.owner". */
type Container = Record<string, unknown>;

function parentOf(r: Report, path: string): [Container, string] {
  const keys = path.split(".");
  let o = r as unknown as Container;
  for (const k of keys.slice(0, -1)) o = o[k] as Container;
  return [o, keys[keys.length - 1]];
}

function setAt(r: Report, path: string, value: string): Report {
  const next = structuredClone(r);
  const [o, k] = parentOf(next, path);
  o[k] = value;
  return next;
}

function removeAt(r: Report, path: string): Report {
  const next = structuredClone(r);
  const [o, k] = parentOf(next, path);
  (o as unknown as unknown[]).splice(Number(k), 1);
  return next;
}

/** Text nodes as they are and <br> as a line break; the browser's trailing <br> placeholder is dropped. */
function readText(e: Element): string {
  const walk = (n: Node): string =>
    [...n.childNodes].map((c) => (c.nodeType === Node.TEXT_NODE ? c.nodeValue ?? "" : c.nodeName === "BR" ? "\n" : walk(c))).join("");
  const text = walk(e);
  return e.lastChild?.nodeName === "BR" ? text.slice(0, -1) : text;
}

/** Sets text with its line breaks as <br>, as reportToHtml writes it. */
function setLines(e: HTMLElement, text: string): void {
  text.split("\n").forEach((line, i) => {
    if (i) e.append(document.createElement("br"));
    if (line) e.append(line);
  });
}

function field<K extends keyof HTMLElementTagNameMap>(tag: K, path: string, value: string, dash = false): HTMLElementTagNameMap[K] {
  const e = el(tag);
  setLines(e, value);
  e.setAttribute("contenteditable", EDITABLE);
  e.dataset.path = path;
  if (dash) e.dataset.empty = DASH; // shown by the page CSS while the field is empty
  return e;
}

function delButton(path: string): HTMLButtonElement {
  const b = el("button", "del", "×");
  b.type = "button";
  b.title = "حذف";
  b.setAttribute("aria-label", "حذف");
  b.dataset.del = path;
  return b;
}

const ts = (at?: string): (string | Node)[] => (at ? [" ", el("span", "ts", `[${faDigits(at)}]`)] : []);

function td(cls: string, ...nodes: (string | Node)[]): HTMLTableCellElement {
  const c = el("td", cls);
  c.append(...nodes);
  return c;
}

/** A numbered table; each row's number cell holds its delete button. */
function table(head: string[], rows: { path: string; cells: HTMLTableCellElement[] }[]): HTMLTableElement {
  const t = el("table");
  const hr = el("tr");
  hr.append(el("th", "", "#"), ...head.map((h) => el("th", "", h)));
  t.append(hr);
  rows.forEach((row, i) => {
    const tr = el("tr");
    tr.append(td("n", faNum(i + 1), delButton(row.path)), ...row.cells);
    t.append(tr);
  });
  return t;
}

/** A list item that can be deleted: the editable text plus its × button. */
function deletable<K extends keyof HTMLElementTagNameMap>(tag: K, path: string, ...nodes: Node[]): HTMLElementTagNameMap[K] {
  const e = el(tag);
  e.append(...nodes, delButton(path));
  return e;
}

function build(r: Report, m: MeetingRecord, turns: Turn[]): Node[] {
  const out: Node[] = [field("h1", "title", r.title)];
  for (const line of metaLines(m, turns)) out.push(el("div", "meta", line));
  out.push(el("div", "rule"));
  const section = (title: string, ...body: Node[]) => {
    const s = el("section");
    s.append(el("h2", "", title), ...body);
    out.push(s);
  };

  if (r.summary.length) section(T.summary, ...r.summary.map((p, i) => field("p", `summary.${i}`, p)));
  if (r.decisions.length) {
    section(T.decisions, table(["تصمیم"], r.decisions.map((d, i) => ({
      path: `decisions.${i}`,
      cells: [td("", field("span", `decisions.${i}.text`, d.text), ...ts(d.at))],
    }))));
  }
  if (r.actions.length) {
    const keys = isDaily(m) ? (["person", "owner"] as const) : (["owner", "due"] as const);
    section(T.actions, table(actionColumns(m), r.actions.map((a, i) => ({
      path: `actions.${i}`,
      cells: [
        td("", field("span", `actions.${i}.text`, a.text), ...ts(a.at)),
        td("who", field("span", `actions.${i}.${keys[0]}`, a[keys[0]] ?? "", true)),
        td("due", field("span", `actions.${i}.${keys[1]}`, a[keys[1]] ?? "", true)),
      ],
    }))));
  }
  if (isDaily(m) ? r.people.length : r.topics.length) {
    section(T.topics, ...(isDaily(m)
      ? r.people.flatMap((p, i) => [
        field("h3", `people.${i}.person`, p.person),
        ...GROUPS(p).filter(([, l]) => l.length).flatMap(([label, list, key]) => {
          const head = el("p");
          head.append(el("b", "", label));
          const ul = el("ul");
          ul.append(...list.map((x, j) => deletable("li", `people.${i}.${key}.${j}`, field("span", `people.${i}.${key}.${j}`, x))));
          return [head, ul];
        }),
      ])
      : r.topics.flatMap((t, i) => [
        deletable("h3", `topics.${i}`, field("span", `topics.${i}.heading`, t.heading)),
        field("p", `topics.${i}.body`, t.body),
      ])));
  }
  if (r.followUps.length) {
    section(T.followUps, table(["موضوع"], r.followUps.map((f, i) => ({
      path: `followUps.${i}`,
      cells: [td("", field("span", `followUps.${i}.text`, f.text), ...ts(f.at))],
    }))));
  }
  if (r.codeServices.length) {
    const ul = el("ul");
    ul.append(...r.codeServices.map((c, i) =>
      deletable("li", `codeServices.${i}`, field("b", `codeServices.${i}.service`, c.service), document.createTextNode(": "),
        field("span", `codeServices.${i}.reason`, c.reason))));
    section(T.code, ul);
  }

  const stats: Node[] = [el("p", "", statTotals(m, turns))];
  const rows = statRows(turns);
  if (rows.length) {
    const t = el("table");
    for (const [name, value] of rows) {
      const tr = el("tr");
      tr.append(el("td", "who", name), el("td", "", value));
      t.append(tr);
    }
    stats.push(t);
  }
  section(T.stats, ...stats);
  out.push(el("div", "footer", FOOTER));
  return out;
}

/** Plain text only, whatever the clipboard holds. */
function pastePlain(target: HTMLElement, text: string, changed: () => void): void {
  // insertText keeps the browser's undo stack and fires `input` itself.
  if (typeof document.execCommand === "function" && document.execCommand("insertText", false, text)) return;
  const sel = document.getSelection();
  const range = sel && sel.rangeCount ? sel.getRangeAt(0) : null;
  if (range && target.contains(range.commonAncestorContainer)) {
    range.deleteContents();
    const node = document.createTextNode(text);
    range.insertNode(node);
    range.setStartAfter(node);
    range.collapse(true);
  } else {
    target.append(text);
  }
  changed();
}

/**
 * Renders `r` into `root`. Every edit calls `onEdit` with the whole updated report; deleting a row
 * redraws the report (numbers change), typing does not (the caret stays where it is).
 */
export function renderReport(
  root: HTMLElement, r: Report, ctx: { rec: MeetingRecord; turns: Turn[] }, onEdit: (next: Report) => void,
): void {
  let cur = r;
  const doc = el("div", "report");
  doc.dir = "rtl";
  doc.lang = "fa";
  const draw = () => doc.replaceChildren(...build(cur, ctx.rec, ctx.turns));
  const changed = (e: HTMLElement) => {
    cur = setAt(cur, e.dataset.path!, readText(e));
    onEdit(cur);
  };
  const editableOf = (t: EventTarget | null) => (t instanceof Element ? t.closest<HTMLElement>("[data-path]") : null);

  doc.addEventListener("input", (ev) => {
    const e = editableOf(ev.target);
    if (e) changed(e);
  });
  doc.addEventListener("paste", (ev) => {
    const e = editableOf(ev.target);
    if (!e || e.getAttribute("contenteditable") !== EDITABLE) return;
    ev.preventDefault();
    pastePlain(e, (ev as ClipboardEvent).clipboardData?.getData("text/plain") ?? "", () => changed(e));
  });
  doc.addEventListener("click", (ev) => {
    const b = ev.target instanceof Element ? ev.target.closest<HTMLButtonElement>("button[data-del]") : null;
    if (!b || b.disabled) return;
    cur = removeAt(cur, b.dataset.del!);
    onEdit(cur);
    draw();
  });

  draw();
  root.replaceChildren(doc);
}

/** Turns editing and row deletion off (while the meeting is being processed) or back on. */
export function setReportEditable(root: HTMLElement, on: boolean): void {
  root.querySelectorAll("[data-path]").forEach((e) => e.setAttribute("contenteditable", on ? EDITABLE : "false"));
  root.querySelectorAll<HTMLButtonElement>("button[data-del]").forEach((b) => (b.disabled = !on));
}
