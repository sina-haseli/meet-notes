# Lobbe-style Report and Voice Naming Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Pause processing so the user can name each voice from short clips, then write a structured Persian report in the Lobbe layout (decisions, actions, topic notes, follow-ups, stats) that is editable in place and saved as a PDF.

**Architecture:** The notes AI call returns the Persian report as JSON (`<<<REPORT>>>`) next to the unchanged English notes (`<<<NOTES>>>`). Pure logic lives in two new modules: `src/lib/voices.ts` (voice cards, clips, applying names) and `src/lib/report.ts` (report types, parsing, Persian formatting, stats, rename, markdown/HTML export). The pipeline gets a new `naming` status before the `notes` step; the meeting page gets voice cards and a report tab with a print stylesheet.

**Tech Stack:** TypeScript, Chrome MV3, esbuild (`build.mjs`), vitest + jsdom, IndexedDB (`src/lib/db.ts`), `encodeMp3` for clips, Vazirmatn font (npm `vazirmatn`).

**Spec:** `docs/superpowers/specs/2026-11-12-lobbe-style-report-design.md`. Read it first. Approved mockups: `.superpowers/brainstorm/1340-1794433480/content/speaker-naming-v2.html` and `report-page.html`.

All commands run from `extension/`.

## Global Constraints

- Built-in mode only; local helper mode is untouched.
- Manifest V3, `minimum_chrome_version` 116, **no new permissions** in `manifest.json`.
- Nothing new leaves the machine: clips play from IndexedDB PCM.
- Unknown voices are labelled `گوینده N` (replaces `Speaker N` for new meetings); names are never guessed by the AI and are copied character for character.
- Persian digits everywhere in the report (`toLocaleString("fa-IR")`), percent as `٪۷۰٫۹`, Jalali dates via `Intl.DateTimeFormat("fa-IR-u-ca-persian")`.
- Report colours: indigo `#4f46e5` headings and rule, light indigo `#efeefe` table header rows. Footer copy: `ساخته‌شده با Meet Notes`.
- Exact Persian copy from the spec: `چه کسی صحبت می‌کند؟`, `تأیید و ساخت گزارش`, `پیشنهاد از Google Meet`, `نامشخص — لطفاً نام بدهید`, `اگر کسی را نمی‌شناسید، خالی بگذارید: در گزارش «گوینده N» نوشته می‌شود.`, notification `نام گوینده‌ها را تأیید کنید`, list/popup state `منتظر نام گوینده‌ها`, toolbar `نام گوینده‌ها`, `Gmail`, `کپی`, `دانلود PDF`, tabs `گزارش`, `متن جلسه`, `تصاویر`, `یادداشت فنی (English)`.
- Section titles exactly: `خلاصه`, `تصمیم‌ها`, `اقدام‌ها`, `یادداشت موضوعی`, `پیگیری‌ها`, `سرویس‌های احتمالی برای تغییر (پیشنهاد AI)`, `آمار جلسه`; columns `تصمیم`, `کار | مسئول | موعد`, daily `مانع | فرد | رفع‌کننده`, `موضوع`; daily groups `دیروز`, `امروز`, `موانع`.
- Missing owner/deadline shows `—`. Empty tables are omitted, not shown as "None".
- Stats and the header meta line are computed in code, never by the AI, and are not editable.
- Old meetings (have `summaryMd`, no `report`) keep today's Summary tab unchanged.

## Review Focus

1. **Model text rendered as HTML.** Report strings from the AI (or a hostile transcript) containing `<img onerror>` or `<script>` must show as literal text on the page, in Copy, in `report.html` and in the PDF. Test in Task 2 (`reportToHtml` escapes) and Task 7 (rendered cell `textContent` equals the raw string, no element created).
2. **Malformed report JSON.** Missing arrays, `null` owner, a number where a string is expected, extra fields, or JSON wrapped in prose / code fences must parse into a valid `Report` with defaults, or raise `NotesError` only when no object exists at all. Test in Task 2.
3. **Rename where one name is inside another.** Renaming `علی` must not touch `علیرضا` in turns, report fields or notes. Test in Task 2 (`renameInReport`) and Task 1 (`applyNames`).
4. **Browser restart while waiting for names.** A `naming` meeting must not be resumed, marked interrupted, treated as stuck or have its audio pruned. Test in Task 5 (`lifecycle`) and Task 4 (`pruneExpiredAudio` ignores `naming`).
5. **Names with stray spaces or left empty.** `"  دانیال "` saves as `دانیال`; an empty box keeps `گوینده N`; two boxes with the same name merge. Test in Task 1.

---

### Task 1: Voice cards, clips and applying names

**Files:**
- Create: `src/lib/voices.ts`
- Modify: `src/lib/speakers.ts` (unknown label `گوینده N` instead of `Speaker N`)
- Test: `tests/voices.test.ts`, update `tests/speakers.test.ts`

**Interfaces:**
- Produces:
  - `export const UNKNOWN_PREFIX = "گوینده"`; `assignSpeakers` emits `` `${UNKNOWN_PREFIX} ${n}` `` (Persian digit n via `toLocaleString("fa-IR")`, e.g. `گوینده ۳`).
  - `export interface Clip { startMs: number; endMs: number; text: string }`
  - `export interface Voice { key: string; name: string; fromMeet: boolean; talkMs: number; share: number; clips: Clip[] }` — `key` is the current speaker string in the turns; `name` is `""` for unknown voices; `share` is 0..1 of total talk.
  - `export function voicesOf(turns: Turn[], minTalkMs = 5000, maxClips = 5): Voice[]` — one voice per distinct `turn.speaker`; unknown (all turns `uncertain`) voices under `minTalkMs` are dropped; sorted by `talkMs` descending.
  - `export function pickClips(turns: Turn[], maxClips = 5, minMs = 4000, maxMs = 12000): Clip[]` — from one voice's turns: prefer longest turns, spread across the meeting (no two clips from the same chunk until every chunk is used), each clip is the turn's start clipped to `maxMs`; turns shorter than `minMs` used only if nothing else.
  - `export function applyNames(turns: Turn[], names: Record<string, string>): Turn[]` — `names` maps voice `key` → typed name; trims; empty keeps the key; a non-empty name sets `speaker` and `uncertain: false`; same name in two keys merges.

- [ ] **Step 1: Write the failing tests** in `tests/voices.test.ts`:
  - `voicesOf` merges all turns with `speaker: "دانیال"` into one voice with `fromMeet: true`, `name: "دانیال"`.
  - unknown `گوینده ۳` with 3 s of talk is dropped; with 6 s kept with `name: ""`, `fromMeet: false`.
  - order is by `talkMs` desc; `share` = the voice's talk / total talk of all turns (dropped voices included in the total).
  - `pickClips` on turns in chunks 0,0,1,2 with `maxClips = 3` returns one clip per chunk; a 30 s turn yields a clip of exactly 12 000 ms.
  - `applyNames(turns, { "گوینده ۱": "  علی ", "گوینده ۲": "" })` → `گوینده ۱` turns become `علی` with `uncertain: false`; `گوینده ۲` unchanged; a turn by `علیرضا` unchanged.
  - `applyNames` with `{ "گوینده ۱": "سینا", "گوینده ۴": "سینا" }` → `voicesOf` on the result has one `سینا` voice.
  Update `tests/speakers.test.ts` expectations from `Speaker 1` to `گوینده ۱` etc.

- [ ] **Step 2: Run** `npx vitest run tests/voices.test.ts tests/speakers.test.ts` — Expected: FAIL (module missing / old labels).

- [ ] **Step 3: Implement** `src/lib/voices.ts` and the label change in `assignSpeakers`.

- [ ] **Step 4: Run** `npx vitest run` — Expected: all PASS (fix any other test that asserted `Speaker N`).

- [ ] **Step 5: Commit** `feat(extension): voice cards, clip picking and naming for speakers`

---

### Task 2: Report model, Persian formatting and export

**Files:**
- Create: `src/lib/report.ts`
- Test: `tests/report.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export interface Item { text: string; at?: string }                 // at = "MM:SS"
  export interface Action { text: string; owner: string; due: string; person?: string; at?: string } // "" = —
  // daily: text = the blocker, person = who is blocked, owner = who can unblock (columns مانع | فرد | رفع‌کننده)
  export interface Topic { heading: string; body: string }
  export interface DailyPerson { person: string; yesterday: string[]; today: string[]; blockers: string[] }
  export interface CodeService { service: string; reason: string }
  export interface Report {
    title: string; summary: string[]; decisions: Item[]; actions: Action[];
    topics: Topic[]; people: DailyPerson[]; followUps: Item[]; codeServices: CodeService[];
  }
  export interface SpeakerStat { name: string; talkMs: number; share: number; words: number }
  export function parseReport(raw: string): Report
  export function faNum(n: number, fractionDigits?: number): string      // ۶٬۱۶۴ ; ۷۰٫۹
  export function faDuration(ms: number): string                          // "۴۹ دقیقه ۴۹ ثانیه", "۴۶ ثانیه", "۱ ساعت ۲ دقیقه"
  export function jalaliDate(iso: string): string                         // "۲۰ آبان ۱۴۰۵"
  export function speakerStats(turns: Turn[]): { totalMs: number; words: number; speakers: SpeakerStat[] }
  export function mapReportText(r: Report, f: (s: string) => string): Report  // every string field
  export function renameInReport(r: Report, old: string, next: string): Report // whole-word, uses replaceWholeName
  export function reportToMarkdown(r: Report, rec: Pick<MeetingRecord,"startedAt"|"durationMs"|"type">, turns: Turn[]): string
  export function reportToHtml(r: Report, rec: Pick<MeetingRecord,"startedAt"|"durationMs"|"type">, turns: Turn[], opts?: { standalone?: boolean; timestamps?: boolean }): string
  ```
  `people` is filled only for daily; `topics` for the other types. `MeetingRecord` gains `report?: Report` (add to `src/types.ts` in this task).
- Consumes: `replaceWholeName` from `src/lib/meetingView.ts` — export it (currently module-private).

- [ ] **Step 1: Write the failing tests** in `tests/report.test.ts`:
  - `parseReport` accepts the object inside prose or a ```json fence; missing arrays become `[]`; `owner: null` → `""`; numbers coerced to strings; unknown fields dropped; a string `summary` becomes a one-item array; no `{` at all → throws `NotesError`.
  - `faDuration(2989000)` → `"۴۹ دقیقه ۴۹ ثانیه"`; `faDuration(46000)` → `"۴۶ ثانیه"`; `faNum(6164)` → `"۶٬۱۶۴"`; `faNum(70.9, 1)` → `"۷۰٫۹"`.
  - `jalaliDate("2026-11-11T10:00:00+03:30")` → `"۲۰ آبان ۱۴۰۵"`.
  - `speakerStats` sums turn durations per speaker, counts words by whitespace, shares sum to 1, sorted by talk desc.
  - `renameInReport(r, "علی", "Ali")` changes `علی` in actions.owner and summary, leaves `علیرضا` alone.
  - `reportToHtml` with `decisions: [{ text: '<img src=x onerror=alert(1)>' }]` contains `&lt;img` and no `<img`; omits the `تصمیم‌ها` section when `decisions` is empty; with `timestamps: false` contains no `[` timestamps; contains footer `ساخته‌شده با Meet Notes`; `standalone: true` yields a full `<!doctype html>` page with `dir="rtl"` and inline CSS.
  - `reportToMarkdown` for a daily report renders `### <person>` with `دیروز`, `امروز`, `موانع` lists and the blockers table header `| مانع | فرد | رفع‌کننده |`.

- [ ] **Step 2: Run** `npx vitest run tests/report.test.ts` — Expected: FAIL (module missing).

- [ ] **Step 3: Implement** `src/lib/report.ts`. Section order and titles per Global Constraints. HTML escapes every interpolated string.

- [ ] **Step 4: Run** `npx vitest run tests/report.test.ts` — Expected: PASS.

- [ ] **Step 5: Commit** `feat(extension): structured meeting report with Persian formatting`

---

### Task 3: Prompt and output contract

**Files:**
- Modify: `src/lib/templates.ts`, `src/lib/notes.ts`
- Test: `tests/notes.test.ts`

**Interfaces:**
- Consumes: `parseReport`, `mapReportText`, `Report` (Task 2).
- Produces: `export const REPORT_MARK = "<<<REPORT>>>"`; `export function splitReportOutput(text: string): { report: Report; notesMd: string }` (throws `NotesError` like `splitNotesOutput`); `export function stripReportCodePaths(r: Report, cs: CodeSearch | undefined): Report` (applies `stripCodePaths` to every string via `mapReportText`). `SUMMARY_MARK` / `splitNotesOutput` stay exported for old tests but are no longer used by the pipeline.

- [ ] **Step 1: Write the failing tests** in `tests/notes.test.ts`:
  - `splitReportOutput("<<<REPORT>>>\n{\"title\":\"ت\",\"decisions\":[{\"text\":\"d\",\"at\":\"01:02\"}]}\n<<<NOTES>>>\n# N")` → `report.title === "ت"`, `notesMd === "# N"`.
  - missing `<<<NOTES>>>` → `NotesError`.
  - `buildNotesPrompt` for `grooming` contains `<<<REPORT>>>`, every section key of the JSON schema, the rule that names are copied exactly, and still contains the English notes sections (`## Tasks`); for `daily` the schema mentions `people`, `yesterday`, `today`, `blockers`.
  - `stripReportCodePaths` removes `svc/src/a.ts` from `codeServices[0].reason` and from `summary[0]`.
- [ ] **Step 2: Run** `npx vitest run tests/notes.test.ts` — Expected: FAIL.
- [ ] **Step 3: Implement.** In `templates.ts`, replace the `<<<SUMMARY>>>` part of `CONTRACT_HEAD`, `STANDARD` and `DAILY` with `<<<REPORT>>>` + a JSON schema matching `Report` (Persian text, English terms in Latin script, `at` = `MM:SS` where said, `owner`/`due` empty unless said, `codeServices` only from `## Code evidence` and service names only, `people` only for daily, never translate or transliterate speaker names, `گوینده N` stays as written). Keep each meeting type's emphasis line, reworded to point at the report fields (grooming story points go in action text). Keep the `<<<NOTES>>>` English section exactly.
- [ ] **Step 4: Run** `npx vitest run` — Expected: PASS.
- [ ] **Step 5: Commit** `feat(extension): notes prompt returns the Persian report as JSON`

---

### Task 4: Pipeline pause and report saving

**Files:**
- Modify: `src/types.ts`, `src/lib/pipeline.ts`, `src/lib/db.ts` (`pruneExpiredAudio` unchanged logic; add test only)
- Test: `tests/pipeline.test.ts`, `tests/db.test.ts`

**Interfaces:**
- Produces: `MeetingStatus` gains `"naming"`; `MeetingRecord` gains `namesConfirmedAt?: number`. `processMeeting` returns a record with `status: "naming"` when it stops for names.
- Consumes: `splitReportOutput`, `stripReportCodePaths` (Task 3).

- [ ] **Step 1: Write the failing tests** in `tests/pipeline.test.ts` (change `SUMMARY_OK` to a `<<<REPORT>>>` answer):
  - a fresh meeting with one turn stops with `status: "naming"`, `screens` and `codeSearch` set, `complete` (notes) not called, no `report`.
  - same meeting with `namesConfirmedAt: 1` ends `ready` with `report.title` set and `notesMd` set, and `summaryMd` undefined.
  - a meeting whose transcript has zero turns goes straight to `ready` without pausing.
  - a meeting in `error` at `notes` with `namesConfirmedAt` set, retried, does not stop at `naming`.
  - report strings have code paths stripped.
  In `tests/db.test.ts`: `pruneExpiredAudio` does not delete audio of a `naming` meeting with an old `readyAt`/`createdAt`.
- [ ] **Step 2: Run** `npx vitest run tests/pipeline.test.ts tests/db.test.ts` — Expected: FAIL.
- [ ] **Step 3: Implement.** In `processMeeting`, before the `notes` step: `if (!rec.namesConfirmedAt && (rec.turns?.length ?? 0) > 0) { await save({ status: "naming", step: undefined, costUsd: cost }); return rec; }`. The notes step saves `{ report: stripReportCodePaths(report, cs), notesMd }` and runs when `!rec.report || !rec.notesMd`.
- [ ] **Step 4: Run** `npx vitest run` — Expected: PASS.
- [ ] **Step 5: Commit** `feat(extension): pause for speaker names before writing the report`

---

### Task 5: Naming state in background, offscreen queue and lists

**Files:**
- Modify: `src/messages.ts`, `src/background.ts`, `src/offscreen.ts`, `src/lib/lifecycle.ts`, `src/lib/popupView.ts`, `src/meetings.ts`, `src/popup.ts` (only where status labels/links are rendered)
- Test: `tests/lifecycle.test.ts`, `tests/popupView.test.ts`

**Interfaces:**
- Produces:
  - `PopupMsg` gains `{ type: "confirm-names"; meetingId: string; names: Record<string, string> }` → `Ack`.
  - `ToOffscreen` `process` gains `front?: boolean`; offscreen `enqueue(id, front)` uses `unshift` when `front`.
  - `FromOffscreen` `processed` gains `status: MeetingStatus` (the run's final status); `ok` stays `status === "ready"`.
  - `popupView.badgeFor` returns `{ cls: "processing", text: "منتظر نام گوینده‌ها" }` for `naming`; `stepText` returns `"منتظر نام گوینده‌ها"` for `naming`.
- Consumes: `applyNames` (Task 1), `renameInReport` (Task 2) is NOT used here.

- [ ] **Step 1: Write the failing tests:**
  - `lifecycle`: `recordsToResume`, `recordsInterrupted`, `isStuck` and `shouldResumeOnPoll` all ignore a `naming` meeting; `failedRunPatch({ status: "naming" }, false)` → `null`.
  - `popupView`: `badgeFor` / `stepText` for `naming` as above.
- [ ] **Step 2: Run** `npx vitest run tests/lifecycle.test.ts tests/popupView.test.ts` — Expected: FAIL (badge/step text).
- [ ] **Step 3: Implement.**
  - `background.processed`: when `msg.status === "naming"`, always create notification `{ title: "نام گوینده‌ها را تأیید کنید", message: rec.title }` with the usual `NOTIFY_PREFIX` id (opens the meeting page), even if the meeting tab is open; never the "Processing failed" one.
  - `background.confirmNames(id, names)`: refuse unless `status === "naming"`; `updateMeeting(id, { turns: applyNames(rec.turns, names), namesConfirmedAt: Date.now(), status: "queued" })`; `sendProcess(id, true)`; on failure set `status: "naming"` back. Route `confirm-names` in the popup-message switch.
  - `sendProcess(id, front = false)` passes `front` through.
  - `offscreen.drain`: keep the record `processMeeting` returns and report `{ type: "processed", meetingId, ok: r.status === "ready", status: r.status }`.
  - `meetings.ts` / popup: a `naming` meeting links to its meeting page like a ready one.
- [ ] **Step 4: Run** `npx vitest run && npm run typecheck` — Expected: PASS, no type errors.
- [ ] **Step 5: Commit** `feat(extension): naming state, notification and confirm-names message`

---

### Task 6: Voice cards on the meeting page

**Files:**
- Create: `src/voiceCards.ts` (DOM for the cards; imported by `meeting.ts`)
- Modify: `src/meeting.html` (a `#namingCard` section, card CSS), `src/meeting.ts` (show the card when `status === "naming"` and from the report toolbar)
- Test: `tests/voiceCards.test.ts` (jsdom)

**Interfaces:**
- Consumes: `voicesOf`, `pickClips` (Task 1), `assembleChunk`, `PCM_RATE` (`src/lib/audioChunks.ts`), `encodeMp3`, `getPcmRange` (`src/lib/db.ts`).
- Produces:
  - `export function renderVoiceCards(root: HTMLElement, voices: Voice[], opts: { audio: boolean; play: (clip: Clip) => Promise<void>; stop: () => void }): { names(): Record<string, string> }`
  - `export async function clipBlob(meetingId: string, clip: Clip): Promise<Blob>` — `assembleChunk({ index: 0, offsetMs: clip.startMs, durationMs: clip.endMs - clip.startMs }, (a, b) => getPcmRange(meetingId, a, b))` → `encodeMp3` → `Blob` `audio/mpeg`.

- [ ] **Step 1: Write the failing tests** in `tests/voiceCards.test.ts`:
  - renders one card per voice with the meta line `صدای ۱ · ٪۷۰ از جلسه · کلیپ ۱ از ۳ · ۱۲:۴۰ تا ۱۲:۵۲` (digits Persian) and the clip text in `«…»`.
  - a Meet-named voice has the input pre-filled and hint `پیشنهاد از Google Meet`; unknown has empty input, hint `نامشخص — لطفاً نام بدهید` and class `unk`.
  - clicking ↻ advances to clip 2 and calls `stop`; when it was playing, `play` is called with clip 2; clips wrap around.
  - clicking ▶ on card 2 while card 1 plays stops card 1 first.
  - with `audio: false` the ▶ button is disabled and ↻ still cycles text.
  - `names()` returns `{ [voice.key]: input.value }` for every card.
  - clip text containing `<b>` appears as literal text.
- [ ] **Step 2: Run** `npx vitest run tests/voiceCards.test.ts` — Expected: FAIL.
- [ ] **Step 3: Implement** the cards per the approved mockup (RTL, layout and copy from Global Constraints) and wire them in `meeting.ts`: when `rec.status === "naming"`, show `#namingCard` with heading `چه کسی صحبت می‌کند؟`, the cards, the hint line and the `تأیید و ساخت گزارش` button, which sends `confirm-names` with `names()`. Playback uses one shared `<audio>` element and revokes the previous object URL. `audio` is `!rec.audioDeleted`.
- [ ] **Step 4: Run** `npx vitest run && npm run typecheck && npm run build` — Expected: PASS, build writes `dist/meeting.js`.
- [ ] **Step 5: Commit** `feat(extension): voice cards with clip playback on the meeting page`

---

### Task 7: Report tab, editing in place, copy, Gmail, rename later

**Files:**
- Create: `src/reportView.ts` (renders the editable report into a root element; imported by `meeting.ts`)
- Modify: `src/meeting.html` (tabs `گزارش` / `متن جلسه` / `تصاویر` / `یادداشت فنی (English)`, report pane and toolbar), `src/meeting.ts`
- Test: `tests/reportView.test.ts` (jsdom)

**Interfaces:**
- Consumes: `Report`, `speakerStats`, `faDuration`, `jalaliDate`, `faNum`, `reportToHtml`, `reportToMarkdown`, `renameInReport` (Task 2); `voicesOf`, `applyNames` (Task 1); `renderVoiceCards` (Task 6); `clipboardHtml` (`src/lib/markdown.ts`).
- Produces: `export function renderReport(root: HTMLElement, r: Report, ctx: { rec: MeetingRecord; turns: Turn[] }, onEdit: (next: Report) => void): void` — every text field is a `contenteditable="plaintext-only"` element bound to its path; on `input`, calls `onEdit` with the updated report; a row delete button (×, shown on hover) removes an item. Meta line and `آمار جلسه` are plain, not editable.

- [ ] **Step 1: Write the failing tests** in `tests/reportView.test.ts`:
  - renders the title, meta line `۲۰ آبان ۱۴۰۵ · ۴۹ دقیقه ۴۹ ثانیه · ۶ گوینده`, `حاضران: …` from named speakers only, and sections in spec order; empty sections absent.
  - editing the owner cell of action 2 calls `onEdit` with `actions[1].owner` updated and nothing else changed.
  - deleting decision 1 calls `onEdit` with that item removed.
  - a decision text `<img src=x onerror=alert(1)>` renders as text: the cell's `textContent` equals it and `root.querySelector("img")` is null.
  - `[MM:SS]` timestamps carry class `ts` (hidden in print).
  - stats rows are not `contenteditable`.
- [ ] **Step 2: Run** `npx vitest run tests/reportView.test.ts` — Expected: FAIL.
- [ ] **Step 3: Implement** and wire in `meeting.ts`:
  - When `rec.report` exists: default tab `گزارش`; the old Summary tab is hidden. When only `summaryMd` exists: today's tabs unchanged.
  - Edits save with the existing debounce/flush (`SAVE_DEBOUNCE_MS`) as `updateMeeting(id, { report })`, same "Saved" indicator; `flush()` covers the report.
  - `کپی`: `reportToHtml(r, rec, turns, { timestamps: false })` as `text/html` plus `reportToMarkdown` as `text/plain`.
  - `Gmail`: unchanged behaviour (`gmailComposeUrl`, `meetingSubject`), subject from `report.title`.
  - `نام گوینده‌ها`: opens the voice cards in a panel (grouped by current names); saving computes `names`, then for each changed key applies `applyNames` to turns, `renameInReport` to the report and `replaceWholeName` to `notesMd`, saves all three, re-renders. No AI call.
  - Allow & Retry also clears `report` (keeps `namesConfirmedAt`).
- [ ] **Step 4: Run** `npx vitest run && npm run typecheck && npm run build` — Expected: PASS.
- [ ] **Step 5: Commit** `feat(extension): editable Persian report tab with copy and rename`

---

### Task 8: PDF via print, bundled font

**Files:**
- Modify: `package.json` (dependency `vazirmatn`), `build.mjs` (copy `node_modules/vazirmatn/fonts/webfonts/Vazirmatn[wght].woff2` to `dist/fonts/Vazirmatn.woff2`), `src/meeting.html` (`@font-face`, `@media print` CSS, `دانلود PDF` button), `src/meeting.ts`, `scripts/packageFiles.mjs` (include `dist/fonts/`), licence text for Vazirmatn (OFL) next to the existing licence texts
- Test: `tests/package.test.ts`

**Interfaces:**
- Consumes: report tab DOM (Task 7).

- [ ] **Step 1: Write the failing test** in `tests/package.test.ts`: the packaged file list includes `dist/fonts/Vazirmatn.woff2` and the Vazirmatn licence file.
- [ ] **Step 2: Run** `npx vitest run tests/package.test.ts` — Expected: FAIL.
- [ ] **Step 3: Implement.** `npm install vazirmatn@33.0.3`. Print CSS: `@page { size: A4; margin: 18mm 16mm 20mm; }`; hide everything except the report root; hide `.ts`, row delete buttons and the toolbar; `tr { break-inside: avoid; }`; headings `break-after: avoid`; footer `ساخته‌شده با Meet Notes` at the bottom of the report. `دانلود PDF`: flush edits, set `document.title` to `report.title` (so the PDF gets that file name), `window.print()`, restore the title on `afterprint`.
- [ ] **Step 4: Run** `npx vitest run && npm run build`, then load `extension/` unpacked in Chrome, open a meeting with a report, press `دانلود PDF`, save as PDF. Expected: Persian letters joined, right-to-left, Persian digits, tables not split mid-row, no timestamps or buttons.
- [ ] **Step 5: Commit** `feat(extension): save the report as a PDF with the bundled Vazirmatn font`

---

### Task 9: Zip export and documentation

**Files:**
- Modify: `src/lib/exportZip.ts`, `../README.md`, `../docs/privacy-policy.md`, `../docs/store-listing.md`
- Test: `tests/exportZip.test.ts`

**Interfaces:**
- Consumes: `reportToHtml` (standalone), `reportToMarkdown` (Task 2).

- [ ] **Step 1: Write the failing test** in `tests/exportZip.test.ts`: for a record with `report`, the zip has `report.html` (starts with `<!doctype html>`, contains the title) and `summary.md` equal to `reportToMarkdown(...)`; for an old record with only `summaryMd`, `summary.md` is unchanged and there is no `report.html`.
- [ ] **Step 2: Run** `npx vitest run tests/exportZip.test.ts` — Expected: FAIL.
- [ ] **Step 3: Implement** the zip change. Docs: README first-run steps describe the voice-naming pause and the report/PDF; privacy policy adds that audio of a meeting waiting for names is kept until the names are confirmed and the 30 days start when the report is ready, and that clips are played locally; store listing describes the report sections and PDF.
- [ ] **Step 4: Run** `npx vitest run && npm run typecheck && npm run build` — Expected: all PASS.
- [ ] **Step 5: Commit** `feat(extension): report in the zip export; docs for voice naming and PDF`
