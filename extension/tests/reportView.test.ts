// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, type Mock } from "vitest";
import { renderReport, setReportEditable } from "../src/reportView";
import type { Report } from "../src/lib/report";
import type { MeetingRecord, Turn } from "../src/types";

const turn = (speaker: string, startMs: number, endMs: number, uncertain = false): Turn =>
  ({ startMs, endMs, speaker, text: "یک دو سه", uncertain, chunk: 0, label: speaker });

const turns: Turn[] = [
  turn("دانیال", 0, 600_000),
  turn("دالرام", 600_000, 900_000),
  turn("گوینده ۱", 900_000, 1_000_000, true),
  turn("سینا", 1_000_000, 1_200_000),
  turn("ایلیا", 1_200_000, 1_250_000),
  turn("گوینده ۲", 1_250_000, 1_260_000, true),
];

const rec = {
  id: "m1", mode: "builtin", title: "Grooming", type: "grooming",
  startedAt: "2026-11-11T10:00:00+03:30", durationMs: 2_989_000, status: "ready",
} as MeetingRecord;

const XSS = "<img src=x onerror=alert(1)>";

const report = (): Report => ({
  title: "بررسی تسک‌های داشبورد",
  summary: ["پاراگراف اول", "پاراگراف دوم"],
  decisions: [{ text: "حذف نقش کنار گذاشته شود.", at: "21:03" }, { text: XSS }],
  actions: [
    { text: "بررسی بیمه", owner: "", due: "امروز" },
    { text: "مستندات", owner: "دانیال", due: "" },
    { text: "message ID", owner: "سینا", due: "" },
  ],
  topics: [{ heading: "لاگ نقش‌ها", body: "لاگ‌ها ایجاد را پوشش می‌دهند" }],
  people: [],
  followUps: [{ text: "session چه می‌شود؟", at: "30:00" }],
  codeServices: [],
});

let root: HTMLElement;
let onEdit: Mock<(next: Report) => void>;
const mount = (r: Report = report(), m: MeetingRecord = rec) => renderReport(root, r, { rec: m, turns }, onEdit);
const path = (p: string) => root.querySelector<HTMLElement>(`[data-path="${p}"]`)!;
const type = (p: string, text: string) => {
  const cell = path(p);
  cell.textContent = text;
  cell.dispatchEvent(new Event("input", { bubbles: true }));
};
const section = (title: string) =>
  [...root.querySelectorAll("section")].find((s) => s.querySelector("h2")?.textContent === title);

beforeEach(() => {
  root = document.createElement("div");
  document.body.replaceChildren(root);
  onEdit = vi.fn();
});

describe("renderReport", () => {
  it("renders the title, the computed meta lines and the sections in order", () => {
    mount();
    expect(root.querySelector(".report h1")?.textContent).toBe("بررسی تسک‌های داشبورد");
    const meta = [...root.querySelectorAll(".meta")].map((m) => m.textContent);
    expect(meta).toEqual(["۲۰ آبان ۱۴۰۵ · ۴۹ دقیقه ۴۹ ثانیه · ۶ گوینده", "حاضران: دانیال، دالرام، سینا، ایلیا"]);
    expect([...root.querySelectorAll("h2")].map((h) => h.textContent)).toEqual(
      ["خلاصه", "تصمیم‌ها", "اقدام‌ها", "یادداشت موضوعی", "پیگیری‌ها", "آمار جلسه"],
    );
    expect(root.querySelector(".footer")?.textContent).toBe("ساخته‌شده با Meet Notes");
  });

  it("leaves out empty sections", () => {
    mount({ ...report(), decisions: [], followUps: [] });
    const titles = [...root.querySelectorAll("h2")].map((h) => h.textContent);
    expect(titles).not.toContain("تصمیم‌ها");
    expect(titles).not.toContain("پیگیری‌ها");
    expect(titles).not.toContain("سرویس‌های احتمالی برای تغییر (پیشنهاد AI)");
  });

  it("shows the action table with — for a missing owner or deadline", () => {
    mount();
    const head = [...section("اقدام‌ها")!.querySelectorAll("th")].map((t) => t.textContent);
    expect(head).toEqual(["#", "کار", "مسئول", "موعد"]);
    expect(path("actions.0.owner").dataset.empty).toBe("—");
    expect(path("actions.0.owner").closest("td")?.className).toBe("who");
    expect(path("actions.0.due").closest("td")?.className).toBe("due");
  });

  it("uses the daily columns and per-person groups for a daily meeting", () => {
    const daily: Report = {
      ...report(), topics: [],
      actions: [{ text: "دسترسی سرور", person: "سینا", owner: "ایلیا", due: "" }],
      people: [{ person: "سینا", yesterday: ["کار الف"], today: [], blockers: ["مانع ب"] }],
    };
    mount(daily, { ...rec, type: "daily" });
    const head = [...section("اقدام‌ها")!.querySelectorAll("th")].map((t) => t.textContent);
    expect(head).toEqual(["#", "مانع", "فرد", "رفع‌کننده"]);
    expect(path("actions.0.person").textContent).toBe("سینا");
    expect(section("یادداشت موضوعی")!.querySelector("h3")?.textContent).toBe("سینا");
    expect([...section("یادداشت موضوعی")!.querySelectorAll("b")].map((b) => b.textContent)).toEqual(["دیروز", "موانع"]);
    type("people.0.blockers.0", "مانع ج");
    expect(onEdit.mock.lastCall![0].people[0].blockers).toEqual(["مانع ج"]);
  });

  it("editing the owner of action 2 reports only that change", () => {
    mount();
    type("actions.1.owner", "مهران");
    const expected = report();
    expected.actions[1].owner = "مهران";
    expect(onEdit).toHaveBeenCalledTimes(1);
    expect(onEdit).toHaveBeenLastCalledWith(expected);
  });

  it("keeps earlier edits when a second field is edited", () => {
    mount();
    type("title", "عنوان تازه");
    type("summary.1", "خط یک\nخط دو");
    const last = onEdit.mock.lastCall![0];
    expect(last.title).toBe("عنوان تازه");
    expect(last.summary).toEqual(["پاراگراف اول", "خط یک\nخط دو"]);
  });

  it("reads line breaks the browser inserts as <br>", () => {
    mount();
    const cell = path("topics.0.body");
    cell.replaceChildren("الف", document.createElement("br"), "ب", document.createElement("br"));
    cell.dispatchEvent(new Event("input", { bubbles: true }));
    expect(onEdit.mock.lastCall![0].topics[0].body).toBe("الف\nب");
  });

  it("deleting decision 1 removes it and renumbers", () => {
    mount();
    path("decisions.0.text").closest("tr")!.querySelector<HTMLButtonElement>("button.del")!.click();
    const expected = report();
    expected.decisions.splice(0, 1);
    expect(onEdit).toHaveBeenLastCalledWith(expected);
    const rows = section("تصمیم‌ها")!.querySelectorAll("tr");
    expect(rows.length).toBe(2); // header + one row
    expect(path("decisions.0.text").textContent).toBe(XSS);
  });

  it("deleting the last row of a table removes the section", () => {
    mount({ ...report(), followUps: [{ text: "تنها" }] });
    path("followUps.0.text").closest("tr")!.querySelector<HTMLButtonElement>("button.del")!.click();
    expect(onEdit.mock.lastCall![0].followUps).toEqual([]);
    expect(section("پیگیری‌ها")).toBeUndefined();
  });

  it("renders report text as text, never as HTML", () => {
    mount();
    expect(path("decisions.1.text").textContent).toBe(XSS);
    expect(root.querySelector("img")).toBeNull();
  });

  it("marks [MM:SS] timestamps with class ts, outside the editable text", () => {
    mount();
    const ts = path("decisions.0.text").closest("td")!.querySelector(".ts")!;
    expect(ts.textContent).toBe("[۲۱:۰۳]");
    expect(ts.closest("[contenteditable]")).toBeNull();
    expect(path("decisions.0.text").textContent).toBe("حذف نقش کنار گذاشته شود.");
  });

  it("makes every text editable as plain text, but not the meta line or the stats", () => {
    mount();
    const editables = root.querySelectorAll("[contenteditable]");
    expect(editables.length).toBeGreaterThan(10);
    for (const e of editables) expect(e.getAttribute("contenteditable")).toBe("plaintext-only");
    const stats = section("آمار جلسه")!;
    expect(stats.querySelectorAll("tr").length).toBe(6);
    expect(stats.querySelector("[contenteditable]")).toBeNull();
    expect(stats.querySelector("td.who")?.textContent).toBe("دانیال");
    for (const m of root.querySelectorAll(".meta")) expect(m.closest("[contenteditable]")).toBeNull();
    expect(root.querySelector(".meta [contenteditable]")).toBeNull();
  });

  it("pastes plain text only", () => {
    mount();
    const cell = path("title");
    const ev = new Event("paste", { bubbles: true, cancelable: true });
    Object.defineProperty(ev, "clipboardData", {
      value: { getData: (t: string) => (t === "text/plain" ? "<b>چسبانده</b>" : "<b>html</b>") },
    });
    cell.dispatchEvent(ev);
    expect(ev.defaultPrevented).toBe(true);
    expect(cell.querySelector("b")).toBeNull();
    expect(onEdit.mock.lastCall![0].title).toContain("<b>چسبانده</b>");
  });

  it("setReportEditable turns editing and row deletion off and on", () => {
    mount();
    setReportEditable(root, false);
    for (const e of root.querySelectorAll("[contenteditable]")) expect(e.getAttribute("contenteditable")).toBe("false");
    for (const b of root.querySelectorAll<HTMLButtonElement>("button.del")) expect(b.disabled).toBe(true);
    setReportEditable(root, true);
    expect(path("title").getAttribute("contenteditable")).toBe("plaintext-only");
  });
});
