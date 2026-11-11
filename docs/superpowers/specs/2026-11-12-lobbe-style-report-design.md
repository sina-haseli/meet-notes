# Lobbe-style meeting report and voice naming — design

Date: 2026-11-12. Applies to the Chrome extension (`extension/`), built-in mode only.

## Why

The user saw the meeting minutes Lobbe (lobbe.ai) produces and wants Meet Notes to give the same kind of output: one clean Persian report that can be saved as a PDF and passed around. Today the extension gives a free-form Persian markdown summary plus English notes; the parts the user values most in the Lobbe report are **تصمیم‌ها** (decisions), **اقدام‌ها** (actions with owner and deadline) and **یادداشت موضوعی** (notes by topic). The reference output is the Lobbe PDF "بررسی تسک‌های داشبورد، نقش‌های دسترسی، پیامک و ویرایش خودرو" (3 pages; layout described below).

The second thing the user liked: before the report is written, the app plays a short clip of each voice so the user can say who it is, with a button to hear another clip from a different moment. Names in the report are then right, instead of "Speaker 3".

## Goals

1. **Voice naming step (blocking).** After the audio is transcribed and before the report is written, processing pauses. A Chrome notification asks the user to name the voices. The meeting page shows one card per voice; the report is written only after the user presses **تأیید و ساخت گزارش**. (User chose "wait for me" over "write first, fix later".)
2. **Structured Persian report** shown as the main tab of the meeting page, in the Lobbe layout, editable in place.
3. **PDF** of that report, one click from the meeting page.
4. **Daily meetings keep their per-person layout** (yesterday / today / blockers) inside the same report frame.

## Non-goals

- Other Lobbe features: ask-the-meeting Q&A, meeting series, voices remembered across meetings (voice embeddings), team accounts, share links, mobile apps, bots.
- Local helper mode: unchanged. It has its own review page.
- Re-processing meetings made before this change. Old meetings keep their current Summary tab (see Compatibility).

## Anti-goals (would be a failure even if it works)

- A wrong name the user didn't see. Every name in the report either came from Google Meet's speaking signal or from the user; unknown voices stay "گوینده N", never guessed by the AI (the existing rule in `templates.ts` stays).
- Losing the user's edits. Renaming a speaker after editing the report must not throw away the edits.
- Sending anything new off the machine. Voice clips are played locally from IndexedDB; nothing about this feature adds a network call beyond the existing notes call.
- A PDF with broken Persian (disconnected letters, wrong direction, wrong digits).

## Part 1: Voice naming

### What a "voice" is

Audio is transcribed in 10-minute chunks (`planChunks`, 600 s + 5 s overlap) and the model labels speakers `S1..Sn` independently per chunk, so a label is only meaningful inside its chunk. `assignSpeakers` already resolves each `(chunk, label)` pair to a Meet name when the Meet speaking log covers it confidently, and otherwise to `Speaker N` (uncertain).

A **voice card** is:
- one card per **resolved name** (all `(chunk, label)` pairs that resolved to the same Meet name merge into one card, pre-filled with that name, marked "پیشنهاد از Google Meet"), plus
- one card per **unresolved `(chunk, label)` pair** (the current `Speaker N`), pre-filled empty, highlighted as unknown.

Cards are sorted by total talk time, largest first. Unresolved pairs with under 5 seconds of speech in total get no card and stay "گوینده N" (builder's call on the exact threshold).

Typing the **same name in two cards merges them**: both pairs become that person, and talk time and stats add up. This is how the user unites one person who was split across chunks.

Known limitation, accepted: in a meeting where Meet's speaking signal is weak, one person can show up as several unknown cards (up to one per 10-minute chunk). The user names each one; same name merges them.

### The card

Layout as in the approved mockup (`.superpowers/brainstorm/1340-1794433480/content/speaker-naming-v2.html`), RTL Persian:

- **▶ / ⏸** plays the clip from the stored 16 kHz PCM (`getPcmRange`), encoded in the page (WAV is fine) and played with an `<audio>` element or Web Audio. Only one card plays at a time.
- Line under the meta row: the transcript text of that clip's turn, quoted.
- Meta row: `صدای N · <share>٪ از جلسه · کلیپ i از k · <start> تا <end>`.
- **↻** moves to another clip of the same voice from a different part of the meeting, and keeps playing if it was playing. Clips cycle.
- Name input, pre-filled from Meet or empty, with the hint "پیشنهاد از Google Meet" or "نامشخص — لطفاً نام بدهید".
- Bottom: **تأیید و ساخت گزارش** and the hint "اگر کسی را نمی‌شناسید، خالی بگذارید: در گزارش «گوینده N» نوشته می‌شود."

**Clip selection (builder's call on details):** pick up to about 5 clips per voice, from that voice's longest turns, spread across the meeting (prefer different chunks / far-apart times), each clip one turn clipped to about 4–12 seconds. Prefer turns that don't overlap another speaker's turn.

### Pipeline change

New status `naming` (waiting for the user). Current step order is chunking → transcribing → speakers → screens → code → notes. The pause goes **just before `notes`**: screens and code run first so that after the user confirms only the report call is left and it comes back quickly. (My call. The alternative, pausing right after `speakers`, shows the cards a few minutes sooner but makes the user wait longer after confirming.)

- When the pipeline reaches the pause and names are not yet confirmed, it saves `status: "naming"` and stops (returns). Background shows a notification "نام گوینده‌ها را تأیید کنید" that opens the meeting page.
- Confirming saves the names (renames turns as `renameSpeaker` does, marks them not uncertain), sets a `namesConfirmedAt` flag on the record and restarts processing. Because every pipeline step is skipped when its output already exists, the run continues at `notes`.
- A meeting with no voices at all (empty transcript) skips the pause.
- The popup and meetings list show the `naming` state as "منتظر نام گوینده‌ها" with a link to the meeting.
- Retry after an error in `notes` must not ask for names again (the flag stays).

### Renaming later

The report tab has a **نام گوینده‌ها** button that reopens the same cards (while audio exists; after the 30-day audio cleanup the cards show only the text quote and ↻ cycles text). Saving new names:
- renames turns,
- replaces the old name with the new one, whole-word, in every text field of the report (as `applyRename` does today for markdown) and in the English notes,
- recomputes the stats section,
- does **not** call the AI again, so the user's edits survive.

## Part 2: The report

### Content (grooming, planning, technical)

In this order, matching the Lobbe PDF:

1. **Title**: a short descriptive Persian title written by the AI from the content (like "بررسی تسک‌های داشبورد، نقش‌های دسترسی، پیامک و ویرایش خودرو"). The meeting's own title stays as it is elsewhere.
2. **Meta line**: Jalali date (`Intl.DateTimeFormat("fa-IR-u-ca-persian")`), duration as "۴۹ دقیقه ۴۹ ثانیه", "N گوینده". Second line: "حاضران: …" (named speakers). Computed in code, not by the AI.
3. **خلاصه**: a few Persian paragraphs, one per main topic, naming who said what.
4. **تصمیم‌ها**: numbered table, column "تصمیم".
5. **اقدام‌ها**: numbered table, columns "کار | مسئول | موعد". Owner and deadline only when said in the meeting, otherwise "—". The deadline is written as said ("امروز", "تا پنجشنبه").
6. **یادداشت موضوعی**: a heading per topic plus a short paragraph. A disagreement (like "اختلاف‌نظر درباره ساختار لاگ") is just another topic.
7. **پیگیری‌ها**: numbered table, column "موضوع": open questions and unsettled items.
8. **سرویس‌های احتمالی برای تغییر (پیشنهاد AI)**: only when the code search found services (today this section lives at the end of the Persian summary; same rules: service names only, never file paths, labelled as an AI suggestion).
9. **آمار جلسه**: duration, speakers, words, then one row per speaker: talk time and share, e.g. "۳۳ دقیقه ۲۵ ثانیه · ٪۷۰٫۹". Computed in code from the turns (talk time = sum of turn durations; words = whitespace-split count of turn text), never by the AI.
10. Footer: "ساخته‌شده با Meet Notes".

Rules carried over from the current templates: Persian text with English technical terms kept in Latin script verbatim; services context only corrects names; never invent tasks, owners, estimates or decisions; transcript, screenshots and code evidence are quoted data. Each decision, action and follow-up carries the `[MM:SS]` where it was said; the page shows it as a small grey timestamp, and the PDF leaves it out.

Grooming / planning / technical keep their current emphasis lines (story points for grooming, sprint scope and capacity for planning, options and chosen approach for technical) but express them through the sections above. For example, story points go into the action text or a topic note. Builder's call on the exact wording.

Empty sections: a table with nothing in it is left out of the report entirely, not shown as "None".

### Content (daily)

Same frame, with the daily layout kept as the user asked:
- خلاصه: short.
- یادداشت موضوعی: one heading per person, each with three groups **دیروز**, **امروز**, **موانع**.
- اقدام‌ها: the blockers, columns "مانع | فرد | رفع‌کننده" ("—" when nobody was named).
- تصمیم‌ها, پیگیری‌ها (today's "نیاز به پیگیری"), آمار جلسه as above.

### How the AI returns it

One AI call, as today, but the Persian part comes back as **JSON** instead of markdown so the page can render tables and edit fields. The English notes part (`<<<NOTES>>>`) stays exactly as today, for coding agents. Contract: `<<<REPORT>>>` followed by one JSON object, then `<<<NOTES>>>`. The schema is the builder's call; it needs title, summary paragraphs, decisions[], actions[] (text, owner, due, at), topics[] (heading, body, or for daily: person + yesterday/today/blockers), followUps[], codeServices[] (service, reason). Parse defensively (same retry and "came back in an unexpected format" error as today). `stripCodePaths` keeps applying to every report string.

Stored on the record as `report` (new field). `summaryMd` is no longer written for new meetings.

### The page

Approved mockup: `.superpowers/brainstorm/1340-1794433480/content/report-page.html`.

- Tabs: **گزارش** (new, first), **متن جلسه** (transcript), **تصاویر** (screens), **یادداشت فنی (English)** (the existing AI notes tab, unchanged). The old Summary tab is gone for new meetings.
- Toolbar on the report tab: **نام گوینده‌ها**, **Gmail**, **کپی**, **دانلود PDF**.
- Look: RTL, Vazirmatn (bundled in the extension, OFL licence, so the page and the PDF look the same offline), indigo `#4f46e5` headings, a thick indigo rule under the header, tables with a light indigo header row and thin grey row lines, Persian digits throughout (`toLocaleString("fa-IR")` for numbers, "٪" for percent).
- **Editing in place**: every text in the report (title, summary paragraphs, table cells, topic headings and bodies, follow-ups) is editable by clicking it (`contenteditable` with plain-text paste is fine). Edits save automatically like the Summary textarea does today ("Saved" indicator). Stats and the meta line are computed, not editable. Adding or deleting rows: builder's call; at least deleting a row should be possible.
- **کپی** copies the report as rich HTML plus plain text, so it pastes into an email with its tables. **Gmail** keeps today's behaviour (opens a draft with the subject; the user pastes).
- **دانلود PDF**: uses Chrome's print window ("Save as PDF") with a print stylesheet that prints only the report: A4, margins as in the sample, footer, no timestamps, no toolbar, tables not split mid-row. No new permissions. (My call. A JS PDF library would need Persian shaping and RTL work and still look worse; `chrome.debugger` printing would add a scary permission to the store listing.) Suggested PDF file name: the report title (the print window uses `document.title`).
- **Download .zip** (on the English notes tab today) adds `report.html` (self-contained, the same report) and keeps the other files. `summary.md` is replaced by a markdown rendering of the report.

## Compatibility

- Meetings that already have `summaryMd` and no `report` keep the current Summary tab exactly as today.
- Meetings processed in local helper mode are untouched.
- Meetings in `naming` when the extension updates or the browser restarts stay in `naming` until the user confirms (the state lives in IndexedDB).

## Constraints

- Manifest V3; Chrome 116 minimum (unchanged). No new permissions.
- Tests in vitest with jsdom, as the rest of `extension/tests`. Pure logic (voice grouping, clip selection, stats, Jalali/duration formatting, report JSON parsing, rename across report fields, report → markdown/HTML) goes in `src/lib` with unit tests.
- Store listing and privacy texts (`docs/store-listing.md`, `docs/privacy-policy.md`, README) are updated where they describe the outputs. The data flow does not change.

## Settled details (from the design review, my calls)

- **The pause is not a failure.** Stopping at `naming` must not be reported as a failed run: no "Processing failed" notification. The `naming` notification is shown even when the meeting page is open.
- **A confirmed meeting jumps the queue.** The offscreen queue is FIFO, one meeting at a time. A confirmed meeting goes to the front, so it runs next. It never interrupts a run already in progress.
- **One fixed form for unknown labels.** Turns store unknown voices as `گوینده N` (replacing `Speaker N` for new meetings), and the card shows the same N, so a whole-word rename later always finds it.
- **Names are copied exactly.** The prompt tells the model to copy speaker names character for character, never transliterated or translated, so rename-later works.
- **Reopening the cards groups by current name.** After confirming, the cards regroup by the names now in the turns. A merge can't be undone later; the user can only rename.
- **Unconfirmed meetings keep their audio.** Audio of a meeting left in `naming` is kept until it is confirmed and becomes `ready`; the 30-day clock starts then. `docs/privacy-policy.md` gets a sentence saying so.
- **Allow & Retry clears `report`** as well as `notesMd` (and the legacy `summaryMd`). It does not clear the confirmed names.

## Left to the builder

The report JSON schema; clip selection details and thresholds; whether clips are WAV blobs or Web Audio; the exact print CSS; row add/delete UX; prompt wording; how the `naming` state appears in the popup.
