# Meet Notes: Design

Date: 2026-11-06
Status: draft, waiting for approval

## 1. Intent

Sina's team runs grooming, planning and technical meetings on Google Meet. Everyone speaks Persian and mixes in English technical terms ("payment-gateway باید refactor بشه", "۵ story point بدیم"). A lot of the meeting happens over a shared screen, usually Figma designs for new features.

Sina wants an assistant that works like Gemini's "take notes for me" but handles mixed Persian/English. It should:

1. record the meeting (audio and the shared screen),
2. produce notes that say **who said what**,
3. let Sina **review and edit** the notes,
4. then **email** them to the team.

**The real why:** the email is only how the notes get delivered. The main goal is to turn meeting discussions into **input for AI coding tools (Claude Code) working in the company repos**. From there the tools produce requirements, designs and tasks that fit the existing codebase and design system. Notes have to be structured and accurate enough that an AI can act on them, not just pleasant for a person to read.

## 2. Goals

- Capture Google Meet audio, both remote participants and Sina's own mic, plus screenshots of the shared screen whenever it changes.
- Transcribe mixed Persian/English speech accurately. English technical terms stay in English, as spoken, and are never translated or transliterated into Persian.
- Attribute speech to **real participant names**.
- Produce, per meeting:
  - a human-readable **email summary** in Persian, with English terms kept,
  - a structured **AI notes file** (Markdown) for coding agents,
  - a full **timestamped transcript** with speaker names,
  - the **screenshots** referenced by the notes.
- Use the company repos as context when writing the notes, so service names, components and design-system names are matched to what exists.
- Open a review page where Sina edits everything, then sends the email.
- Save every meeting's output to a separate notes folder.

## 3. Non-goals

- A bot that joins meetings as its own participant.
- Live captions or live notes during the meeting. Processing happens after the meeting ends.
- Use by several people or a team. Only Sina runs it, from Sina's own Chrome on Sina's Windows PC.
- Publishing to the Chrome Web Store. The extension is loaded unpacked.
- Integrations with Jira or other trackers (possible later, not now).
- Meeting platforms other than Google Meet.

## 4. Anti-goals (would count as failure even if it technically works)

- **Anything is emailed before Sina presses Send.**
- **Statements, story points or tasks are credited to the wrong person with confidence.** If attribution is uncertain, it must be marked as uncertain.
- **English technical terms are translated into Persian** (for example "سرویس پرداخت" in place of `payment-gateway`), or transliterated.
- The notes **invent** services, owners, estimates or decisions that weren't said. The repo context is used only to match names, never to add content.
- Meeting audio or screens go to any service other than the ones named here (OpenRouter, Anthropic via Claude Code, Gmail).

## 5. Constraints

- **Claude Pro ($20) has no API access.** Claude is used only through **Claude Code** (`claude -p`, headless) running on Sina's Pro login. Pro usage limits apply, and a one-hour meeting must fit comfortably in them.
- **Claude can't transcribe audio.** Transcription and image understanding go through **OpenRouter** (Sina already has an API key).
- **The GPU is a GTX 1070,** which is too weak for good local Whisper. Don't depend on local models.
- **Windows 11 and Chrome.** Repos live under `D:\kifepool` (and possibly `D:\tashilcar`, `D:\projects`).
- **A Chrome extension can't run local programs by itself,** so a local helper process is required.

## 6. Decided by Sina

| Topic | Decision |
|---|---|
| Meetings covered | Grooming, planning, technical meetings |
| Cloud AI | Fine to use cloud services |
| Claude | Use Sina's own Pro account (via Claude Code) |
| Audio and screen AI | OpenRouter |
| Speaker names | Important, must say who said what |
| Sending | Review first, then send manually |
| Review screen | **Option A: a document with tabs** (Email summary / AI notes / Transcript), a speaker-rename bar on top, and recipients plus a Send button at the bottom |
| Email sender | From Sina's own Gmail / Google Workspace account |
| Email contents | Summary in the body, with the AI notes file and key screenshots attached |
| Notes storage | A **separate notes folder**, not inside the repos |
| AI notes language | **English** (email summary stays Persian) |

## 7. How it works

```
 Google Meet tab
      │  (Start / Stop in extension popup)
      ▼
 Chrome extension (MV3)
   ├─ tab audio + mic  → recorded audio
   ├─ tab video frames → screenshots when screen changes
   └─ Meet page        → speaker log (who was talking when) + participant names
      │  upload when Stop is pressed
      ▼
 Local helper (Windows, http://127.0.0.1)
   1. split audio into ~10 min chunks
   2. OpenRouter: transcribe each chunk (timestamps, voice-based speaker labels)
   3. merge transcript, then map speakers to names using the speaker log
   4. OpenRouter: describe each screenshot (which Figma screen or component)
   5. Claude Code (claude -p, read-only, repos added as dirs):
        transcript + screenshot descriptions + repo context → email summary + AI notes
   6. open the review page in the browser
      │
      ▼
 Review page (Option A) → Sina edits → Send → Gmail
      │
      ▼
 Notes folder: <meeting>/notes.md, email.md, transcript.md, screens/*.png, meta.json
```

### 7.1 Chrome extension

- Manifest V3. It uses `chrome.tabCapture.getMediaStreamId` from the service worker and an **offscreen document** (`USER_MEDIA`) that records the stream with MediaRecorder.
- **Audio** = tab audio (remote participants) mixed with Sina's **microphone**. Tab audio must be routed back to the speakers, because capture mutes the tab. The mic permission has to be granted once from a visible extension page, because an offscreen document can't prompt for it.
- **Screenshots:** sample the tab video every ~2 s and keep a frame only when it differs noticeably from the last kept frame (perceptual difference above a threshold). Each kept frame gets a timestamp. Store PNG/JPEG.
- **Speaker log:** watch Meet's DOM for the active-speaker indicator and the participant list. Record `(timestamp, participant name)` events. Sina's own speech is known from the mic channel or level. Meet's DOM changes without notice, so isolate the selectors in one module and degrade gracefully: no log means voice-only labels.
- **Popup:** Start/Stop, the meeting type (Grooming / Planning / Technical, which picks a notes template), an optional title, and a recording timer.
- On Stop, upload the audio, screenshots, speaker log and metadata to the helper.

### 7.2 Local helper

- A small local service on `127.0.0.1` with a shared secret between the extension and the helper. It starts with Windows or on demand.
- It holds the OpenRouter key, Gmail credentials and settings (repos list, notes folder, default recipients, model names) in a local config file that is never committed.
- **Transcription:** about 10-minute audio chunks with a short overlap. Use a Gemini audio-capable model via OpenRouter. OpenRouter currently offers both audio input on chat/responses and a dedicated `POST /api/v1/audio/transcriptions` endpoint (e.g. `google/gemini-3.5-transcribe`), so check the live docs and choose. Audio must be base64-encoded (wav/mp3). The prompt has to demand: Persian text, English terms verbatim in Latin script, timestamps, and speaker turns.
- **Speaker mapping:** align transcript turns with the speaker log by timestamp. Each voice label maps to the name it overlaps most. A turn with low overlap is marked `(uncertain)`.
- **Screenshots:** a vision model via OpenRouter writes a short description of each kept frame (which screen, which components, any visible text).
- **Notes:** run Claude Code headless (`claude -p`) with the repo directories added (`--add-dir`), **read-only tools only**, and the meeting-type template. It outputs the email summary and the AI notes. Repo context is used to normalize names (the real service/repo/component names), never to add content.
- **If Claude Code fails or Pro limits are hit:** show the error on the review page with a "Retry" button. Do not silently fall back to another model.

### 7.3 AI notes file (`notes.md`)

A fixed structure so coding agents can rely on it:

- Meeting info: type, date, duration, participants
- **Features discussed**: each has a description, linked screenshots (`screens/…png`) and the timestamp where it was discussed
- **Tasks**: a table with task / service or repo / owner / story points / source timestamp. Unknown values are left as `?`, never guessed
- **Tech debt and technical problems** raised, with who raised them
- **Decisions**
- **Open questions** (unanswered in the meeting)
- **Quotes**: short verbatim lines where the exact wording matters

Every item carries a transcript timestamp, so it can be traced back to what was said.

### 7.4 Review page (Option A)

- Served by the helper and opened automatically when processing finishes.
- **Speakers bar:** a chip for each speaker. Renaming one updates all three tabs. Unknown voices show as "Speaker N → rename?".
- **Tabs:** Email summary (editable), AI notes (editable Markdown), Transcript (read-only apart from names).
- **Bottom bar:** recipients (pre-filled from last time, editable) and **Send email**.
- Edits auto-save to the notes folder. Closing the tab keeps the draft, and a list of past meetings lets Sina reopen any of them.
- Send uses Gmail (Google Workspace account). The body is the email summary, and attachments are `notes.md` and the screenshots referenced in it. Once sent, the meeting is marked as sent with a timestamp.

### 7.5 Notes folder

One folder per meeting: `<notes-root>/YYYY-MM-DD_<type>_<title>/` containing `notes.md`, `email.md`, `transcript.md`, `screens/`, `meta.json`, and the audio until it's deleted (see 8).

## 8. Calls made by Claude (Sina can override)

- The extension is **Chrome MV3, in TypeScript**. The helper is **Python 3.12 + FastAPI** with ffmpeg for audio, chosen because the audio tooling is easiest there.
- Default notes root: **`D:\meeting-notes\`** (configurable).
- Default repo context: **`D:\kifepool`** (configurable list). The popup can't change it per meeting in the first version.
- Meeting type is chosen in the popup and selects one of three prompt templates.
- Audio chunk size is about 10 minutes, with about 5 s of overlap.
- Gmail sending uses the Gmail API with an OAuth desktop client. If the Workspace admin blocks that, fall back to SMTP with an app password.
- **Raw audio is deleted after the email is sent.** The transcript and screenshots are kept.
- No silent fallback when Claude Code fails: the review page shows the error with a Retry button.
- A rough cost target is under $0.50 of OpenRouter per meeting hour. The helper logs the cost per meeting.

## 9. Language

- **AI notes file (`notes.md`): English** (decided by Sina). Short Persian verbatim quotes are kept in the Quotes section and wherever exact wording matters.
- **Email summary: Persian**, with English technical terms kept as spoken.
- **Transcript:** as spoken (Persian, English terms in Latin script).

## 10. Left to the builder

- The exact OpenRouter model IDs and endpoint (check the live docs and pricing). Compare 2–3 audio models on one real recorded meeting before fixing the choice.
- Meet DOM selectors for the active speaker and participant names.
- The screenshot change-detection threshold.
- Prompt wording for the transcription, screenshot and notes steps.
- How the helper is started (tray app, Windows startup task, or manual start).
- Test approach. The speaker mapping, chunk merging and notes structure need unit tests that use fixture transcripts.
