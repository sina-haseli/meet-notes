# Meet Notes for the Chrome Web Store: Design

Date: 2026-11-06
Status: draft, waiting for approval
Builds on: `docs/superpowers/specs/2026-11-06-meet-notes-design.md` (the "v1 spec"). Everything in the v1 spec still holds unless this document changes it.

## 1. Intent

Meet Notes works today, but only for Sina. It needs a Python helper running on the PC, a hand-edited `config.toml` (token, OpenRouter key, repos), and a Claude Pro login for `claude -p`. The first real test meeting (2026-11-06, `D:\meeting-notes\2026-11-06_technical_test`) produced good Persian transcripts and useful notes. But getting there took Notepad, PowerShell and copying a token by hand.

Sina wants to publish it on the **Chrome Web Store** so that **anyone, PMs and technical people alike,** can use it. Sina also wants to use it every day, including for **daily standups**.

The target experience, in Sina's words: install the extension, open it, add an OpenRouter API key and your name. Technical users give their services folder; others leave it empty. Then start recording, and that's it.

**The why:** the meeting notes are what people actually want: a Persian summary for the team, plus AI-ready notes for coding tools. The setup is what stops anyone but Sina from getting them. Every step that needs a terminal, a config file or a second program loses users.

## 2. Goals

- **Everything runs inside the extension.** No helper, no Python, no Claude Code login, no config file. One OpenRouter key is the only account anyone needs.
- **First-time setup inside the popup, in 3 short steps** (Sina chose option A):
  1. OpenRouter key, checked live.
  2. Your name as Google Meet shows it, and your role (PM/non-technical or Technical).
  3. Services folder: technical users only, and skippable.
- **A redesigned UI in "style C"** (Sina's choice): a purple gradient header band (`#4f46e5 → #9333ea`) with white cards floating over it, a dark Record button with a red dot, and soft chips. The popup, setup, settings and meeting pages all use it. Mockups are in `.superpowers/brainstorm/455-1793960910/content/` (`popup-style.html` option C, `setup-flow.html` option A).
- **A new meeting type: Daily (standup).** Its own notes template and its own summary layout: one block per person with yesterday / today / blockers.
- **A meeting page inside the extension** replaces the helper's review page. It has 4 tabs (Summary, AI notes, Transcript, Screens), each with copy and download actions. Sending email is manual: copy the summary, or open a Gmail draft.
- **Sina's local helper stays as an optional mode** for Sina: Claude Code notes with full repo access, saved to `D:\meeting-notes`.
- **Ready to publish on the Chrome Web Store:** permissions are justified, there is a privacy policy, and no remote code.

## 3. Non-goals (this version)

- **Sending email automatically.** No Gmail API and no SMTP in the extension. (The local helper mode keeps its own Send.)
- Anything from the "later" list: asking questions about a meeting, search across meetings, exporting tasks to Jira/Linear/GitHub, a weekly digest of dailies, automatic Gmail sending. Sina explicitly parked these.
- Accounts, a backend server, or syncing meetings between computers. Nothing is hosted by us.
- Meeting platforms other than Google Meet.
- Billing, or a shared/paid key. Every user brings their own OpenRouter key.
- Translating the UI into Persian. The UI is English; the meeting content stays Persian (see §9).

## 4. Anti-goals (failure even if it technically works)

Carried over from the v1 spec, still binding:

- **Statements, story points or tasks credited to the wrong person with confidence.** Uncertain attribution must be marked uncertain. The `min_share` and `min_coverage` rules from `helper/meetnotes/speakers.py` carry over unchanged.
- **English technical terms translated into Persian**, or transliterated.
- **Notes that invent** services, owners, estimates or decisions. The services folder is used only to match names, never to add content.

New for the store version:

- **The user's OpenRouter key, audio, screenshots or folder contents go anywhere except OpenRouter.** No analytics, no telemetry, no crash reporting, no server of ours.
- **Something is emailed, posted or shared without the user acting.** Copy and "Open in Gmail" happen only on a click.
- **A non-technical user hits a technical wall:** a terminal, a config file, a JSON error, a stack trace, or the word "token" or "helper". Errors are written in plain English with one clear next action ("Your OpenRouter credit ran out. Add credit, then press Retry.").
- **A recording is lost.** If processing fails at any step, the audio stays until the user retries, downloads it, or deletes the meeting.

## 5. Constraints

- **Chrome Web Store policy:**
  - Manifest V3, and all code is bundled in the package. Calling OpenRouter's API is fine; fetching and running code is not.
  - A single clear purpose, and every permission must be justified in the listing.
  - A privacy policy URL is required, because the extension handles audio, a key and user files.
  - Limited Use: data is used only to make the user's notes.
- **MV3 service workers are short-lived.** They are killed after about 30 s idle, and an event can't run longer than about 5 min. Processing a 1-hour meeting takes minutes, so the pipeline must run in a long-lived extension document (the existing offscreen document, or the meeting page). It must be resumable step by step, like the helper's `pipeline.py` with its `chunks.json` manifest and per-step outputs, so a closed page or browser restart picks up where it stopped.
- **No ffmpeg in the browser.** The recording is WebM/Opus. OpenRouter's `input_audio` takes base64 audio in formats like wav/mp3. Splitting into ~10-minute chunks with ~5 s overlap and encoding a format OpenRouter accepts must happen in the browser. Re-check the formats against OpenRouter's live docs.
- **Storage is per Chrome profile.** Meetings (audio, screenshots, transcript, notes) live in IndexedDB; request `unlimitedStorage`. The OpenRouter key lives in `chrome.storage.local`, never `storage.sync`.
- **Folder access goes through the File System Access API** (`showDirectoryPicker`). The handle is persisted in IndexedDB. Chrome may ask for permission again after a restart; that needs a user click (`requestPermission`), and the UI must offer that click.
- **Popups close when they lose focus.** The setup progress must be saved after every field, so reopening resumes on the same step.
- **The mic permission prompt** has to come from a visible extension page. The existing `permission.html` flow stays.
- **Meet's DOM is not a stable API.** The speaker-log selectors in `extension/src/content/meetSelectors.ts` stay isolated, and missing data degrades to voice labels. In the 2026-11-06 test Sina was alone in the meeting, so a log containing only Sina's name was correct. Multi-person attribution is still unverified against live Meet. Reworking the selectors is not in scope; a real multi-person meeting checks them after the build, and the speaker-rename UI covers any gaps.

## 6. Decided by Sina

| Topic | Decision |
|---|---|
| Audience | Anyone on the Chrome Web Store: PMs and technical users |
| Setup | Inside the popup, 3 steps: key → name & role → services folder (technical, skippable) |
| Visual style | Style C: gradient header + floating white card |
| New meeting type | Daily = standup |
| After the meeting | The notes show up; the user can copy the summary, the AI notes and the transcript, and sends email manually for now |
| Later ideas | Kept for later: ask-the-meeting, search, task export, weekly digest, automatic Gmail |
| Local helper | Kept as an optional mode, for Sina |
| Role and notes layout | The role only decides whether setup asks for a services folder. The notes layout is the same for everyone; without services context, the service/repo column shows `?` |

## 7. How it works

```
 Google Meet tab
      │  popup: Start / Stop
      ▼
 Extension (MV3)
   recording (unchanged from v1): tab audio + mic, screen changes, Meet speaker log
      │  on Stop: save everything to IndexedDB as one meeting
      ▼
 Processing (in a long-lived extension document, resumable per step)
   1. split audio into ~10 min chunks (in browser)
   2. OpenRouter: transcribe each chunk          ← port of openrouter.py / transcript.py
   3. merge chunks, map speakers to names        ← port of speakers.py (min_share, min_coverage)
   4. OpenRouter: describe screenshots           ← port of screens.py
   5. OpenRouter: write summary + AI notes       ← new; replaces claude -p
        input: transcript + screenshot descriptions + services-folder context + type template
      │  Chrome notification "… — notes ready"
      ▼
 Meeting page (extension tab, style C)
   Summary | AI notes | Transcript | Screens   → copy / download / open Gmail draft

 Optional (Sina): Settings → Advanced → "Use my local helper"
   On Stop, upload to the helper exactly as today; the helper does everything and
   its own review page opens. None of the built-in processing runs.
```

### 7.1 Popup

The states, all in style C:

- **Setup** (until finished). There is no Record button in this state.
  - Step 1, **OpenRouter key.** A field, plus a link "Get a key at openrouter.ai/keys". On paste, call OpenRouter's key endpoint (`GET /api/v1/key`) and show "Connected · $X.XX left", or a plain error.
  - Step 2, **Your name in Google Meet.** A hint says it must match exactly. Below it, the **role** segmented control: PM / non-technical vs Technical.
  - Step 3, **Services folder** (Technical only). "Choose folder…" or "Skip". PM users skip this step.
  - Progress bar, Back/Next; progress is saved after every field.
- **Idle:**
  - Header: logo, "Meet Notes", "Meet tab detected" or "Open a Google Meet tab", ⚙.
  - Card: meeting title (pre-filled from the Meet tab title, editable), type chips (Grooming · Planning · Technical · Daily; defaults to the last used), and **Start recording**.
  - Below the card: **Recent** meetings (latest 3–5) with a Ready / Processing / Failed badge. A click opens the meeting page. A "See all" link opens the meetings list.
- **Recording:** a timer, a live mic indicator, a "screen captured" counter, and **Stop**.
- **Processing:** step text ("Transcribing 2 of 6…") and a progress bar. The popup can be closed; processing continues.
- **Failed:** a plain-English error, **Retry** as the main action, and "Download audio" as the safety exit. This replaces the v1 "Save audio & discard" wording, because the meeting stays in the list.

### 7.2 Settings page

An extension page opened from ⚙, in style C. It contains:

- OpenRouter key: masked, with a "Change" button and the live credit check.
- Your name; your role.
- Services folder: choose / change / remove. It shows the folder name and "permission needed → Allow" when Chrome has dropped access.
- **Models**, collapsed under "Advanced":
  - transcription model, default `google/gemini-2.5-flash`;
  - screenshot model, default `google/gemini-2.5-flash`;
  - notes model, default `anthropic/claude-sonnet-5.5`.
  These ids were verified on OpenRouter on 2026-11-06. Each is a text field, with the default restored by a "Reset" link.
- **Local helper (Sina)**, also under "Advanced": an on/off toggle, the helper URL (default `http://127.0.0.1:47821`) and a pairing token.
  - When it's on, the extension also needs host permission for `http://127.0.0.1:47821/*`. Request it at runtime as an **optional host permission**, so store users never see it.
  - **My call:** to fix "copying the token with Notepad", the helper gains a pairing page. `http://127.0.0.1:47821/pair` shows the token with a **Copy** button. Even better, the extension's "Connect" button opens that page and the page hands the token to the extension. The builder picks the mechanism; it must not weaken the v1 fix for DNS rebinding (TrustedHost).
- Storage used, plus "Delete all meetings".

### 7.3 Processing pipeline (built-in mode)

Port the helper's logic to TypeScript and keep its behaviour and tests:

- **Chunking:** the same boundaries as `audio.py`: ~10 min chunks, ~5 s overlap, and no trailing chunk that sits inside the overlap.
- **Transcription:** prompt and parsing from `openrouter.py` / `transcript.py` and their tests. Persian text, English terms verbatim in Latin script, timestamps, voice labels.
- **Merging and speaker mapping:** `speakers.py` exactly, including `min_share` and the new `min_coverage = 0.5`. The Python test cases become TS test cases with the same inputs and outputs.
- **Screenshot descriptions:** `screens.py`, with its cap and even spacing.
- **Notes:** one OpenRouter chat call with the notes model. The inputs:
  - the meeting-type template, adapted from `helper/meetnotes/templates/{grooming,planning,technical}.md` plus a new `daily.md`;
  - the transcript, the screenshot descriptions and the services context.
  It returns the AI notes (English, structure as in v1 §7.3) and the summary (Persian), in a format the code can split reliably.
- **Services context:** only for Technical users with a folder. Read a bounded sample with a fixed size cap, so a huge monorepo can't blow up cost:
  - top-level folder names (= service names);
  - each service's README (first N KB);
  - package manifests (`package.json` name/description, `pyproject`, `go.mod` module line).
  The context is used only to match names (v1 rule). The settings page says exactly what is read.
- **Every step's output is stored** before the next starts. Retry resumes from the first missing step.
- **The cost of every OpenRouter call is summed** and shown on the meeting page ("$0.12").
- **No silent fallback** to another model when a call fails. Show the error and offer Retry (v1 rule).

### 7.4 Meeting page

An extension tab in style C: the title, date, duration, type and cost in the header, and a speakers bar under it. Renaming a speaker updates all tabs, as in v1. The four tabs:

| Tab | Content | Actions |
|---|---|---|
| **Summary** | Persian email summary, editable. Dailies use the per-person yesterday / today / blockers layout | **Copy** (rich text, so it pastes formatted into Gmail; plain text as a fallback), **Open in Gmail** (a new compose window with the subject filled in; the user pastes the body) |
| **AI notes** | English Markdown, editable | **Copy as Markdown**, **Download .zip** (`notes.md`, `transcript.md`, `summary.md`, `screens/`, `meta.json`, the same layout as the v1 notes folder so Claude Code can read it) |
| **Transcript** | Timestamped, with speaker names; `(uncertain)` is shown | **Copy**, **Download .md** |
| **Screens** | A grid of the screenshots with their timestamps and descriptions | Click to enlarge |

- Edits save automatically. A **meetings list** page shows all meetings (newest first) with their status. Deleting a meeting is a two-click action, with no `confirm()`.
- Persian text is right-to-left, as on the v1 review page (`helper/meetnotes/review/`).
- When processing finishes and the page isn't open, a Chrome notification opens it on click.

### 7.5 Daily standup template

`daily.md` produces:

- **Summary (Persian):** for each participant, دیروز (yesterday) / امروز (today) / موانع (blockers). Each item is short, with English terms kept. Then a short "needs follow-up" list.
- **AI notes (English):** per person, done / doing / blocked with timestamps; blockers with an owner if one was said; no story points. Anything not said is left out, never guessed.

### 7.6 Local helper mode

- **Off by default** and hidden under Advanced.
- When it's on, the popup shows a small "Local helper" badge. Stop uploads to the helper exactly as v1 does: same endpoint, same token, `uploadWithRetry`, same failure handling. The meeting appears in the helper's review page, not in the extension's list.
- The helper keeps working unchanged, apart from the pairing page in §7.2.

## 8. Calls made by Claude (Sina can override)

- **Default models:** `google/gemini-2.5-flash` for transcription and screenshots (proven in the 2026-11-06 test, $0.018 for 5 minutes), and `anthropic/claude-sonnet-5.5` for notes. It is the closest to the `claude -p` quality in v1; my estimate is about $0.10–0.20 for a 1-hour meeting. All three can be changed in Advanced.
- **The UI is English;** the content languages are as in §9.
- **The extension keeps the name "Meet Notes"** for now. Before publishing, Sina may want a more distinctive store name, because the store has similar names.
- **Retention:** meetings are kept until the user deletes them. Audio is deleted automatically 30 days after a meeting's notes are ready; the transcript, notes and screenshots stay. Failed meetings keep their audio until they are fixed or deleted.
- **The meeting title** is pre-filled from the Meet tab title, and the type defaults to the last one used.
- **The key is checked live** in setup and settings. Its remaining credit is shown there and nowhere else.
- **Branch:** build on top of `feat/meet-notes` (not yet merged), on a new branch `feat/store-extension`.
- **Mic:** v1's `permission.html` flow stays, restyled in style C.
- **Services context is read at Stop:** the popup's Stop click is a user gesture, so `requestPermission` works there. The sample (§7.3) is saved into the meeting record, so the pipeline never touches the folder handle.
  - If permission is denied or the folder is gone, the notes are still made without context. The meeting page shows a visible notice, "Made without your services folder — Allow & Retry". This is not a silent fallback: the user is told, and Retry with access redoes only the notes step.
- **Crash-safe recording:** today `offscreen.ts` keeps the MediaRecorder timeslices in memory (`r.chunks`) until Stop. The store version writes each timeslice, plus the screenshots and the speaker log, to IndexedDB as it arrives. After a crash or browser close, the meeting can be finished from what was saved; on the next popup open it shows as "Recording interrupted — Process what was saved / Delete".
- **Helper-mode meetings in Recent:** in local helper mode the extension stores a stub record (`mode: "helper"`, the title, date and helper meeting id). Clicking it opens the helper's review page (`/meetings/<id>`). Stubs have no audio and no pipeline state.
- **No settings migration:** the existing install (only Sina's) goes through the new setup once. The old `token` in `chrome.storage.local` may be pre-filled into the helper settings if present, but nothing depends on it.
- **Privacy policy:** a short static page in the repo (`docs/privacy-policy.md`), published by Sina (for example on GitHub Pages). It states that data goes only to OpenRouter, nothing is collected by us, and everything else stays in the browser.

## 9. Language

Unchanged from v1:

- **AI notes:** English.
- **Summary:** Persian, with English terms kept as spoken.
- **Transcript:** as spoken.
- **UI:** English.

## 10. Publishing on the Chrome Web Store (Sina's steps, after the build)

1. Register a Chrome Web Store developer account at the Developer Dashboard (one-time $5 fee, Google account, identity checks).
2. Publish the privacy policy at a public URL.
3. Run `npm run build` in `extension/` and zip the extension (`manifest.json`, `dist/`, icons). The builder adds a `npm run package` script that produces this zip.
4. In the dashboard, upload the zip and fill in the listing:
   - name, short description, detailed description;
   - icon 128×128, at least one screenshot 1280×800, optional promo tile 440×280;
   - category: Productivity.
5. Privacy tab:
   - the single-purpose statement;
   - a justification for each permission (tabCapture, offscreen, storage, unlimitedStorage, notifications, downloads, the content script on meet.google.com, the optional 127.0.0.1 host);
   - the data-usage disclosures (audio, the key and user files, sent only to OpenRouter);
   - the Limited Use certification.
6. Submit for review. It usually takes a few days, longer with sensitive permissions such as tabCapture. Publish as "Unlisted" first to test with the team, then switch to Public.

The builder supplies: the icons (16/32/48/128), the listing text draft, the permission justifications and the privacy policy draft.

## 11. Left to the builder

- **In-browser chunking and encoding:** WebCodecs/AudioContext with a bundled encoder, or another approach. The audio format must be one OpenRouter accepts, checked against the live docs.
- **Which long-lived document runs processing** (offscreen or the meeting page), and how resuming works after a browser restart.
- **The output format** of the notes call, so it can be split into summary and notes reliably.
- **The rich-text copy** implementation and the Gmail compose URL shape.
- **The exact services-context caps** (files, KB per file, total).
- **The helper pairing mechanism.**
- **Icons and illustrations** in style C.
- **Test approach:**
  - port the Python unit tests for chunking, parsing, merging and speaker mapping to vitest with the same cases;
  - mock OpenRouter in the pipeline tests;
  - keep the existing extension tests green.
