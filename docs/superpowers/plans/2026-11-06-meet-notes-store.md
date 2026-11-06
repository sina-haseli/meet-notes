# Meet Notes for the Chrome Web Store: Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the Meet Notes extension work alone, with no helper, Python or config file. It needs one OpenRouter key and a 3-step setup in the popup. It gets a style C UI, a Daily meeting type and an in-extension meeting page, and the v1 local helper stays as an optional mode.

**Architecture:**
- Recording stays in the offscreen document. It now also captures 16 kHz mono PCM through an AudioWorklet and writes everything to IndexedDB as it arrives: PCM slices, WebM slices, screenshots.
- On Stop, a meeting record is queued. The offscreen document runs a resumable pipeline, a TypeScript port of the helper's `audio/transcript/speakers/screens/notes/pipeline` modules. It calls OpenRouter directly and stores each step's output in the record.
- Extension pages (popup, settings, meeting, meetings list) read and write the same IndexedDB and `chrome.storage.local`.

**Tech Stack:** Chrome MV3, TypeScript (strict), esbuild, vitest. New dependencies:
- runtime: `@breezystack/lamejs@1.2.7` (MP3 encoder), `marked@18.1.3` (Markdown → HTML), `fflate@0.8.3` (zip);
- dev: `fake-indexeddb@6.2.7`.

The helper (Python, FastAPI) gets only a pairing page.

**Spec:** `docs/superpowers/specs/2026-11-06-meet-notes-store-design.md` (builds on `docs/superpowers/specs/2026-11-06-meet-notes-design.md`). Read both.

## Global Constraints

- Branch `feat/store-extension`, created from `feat/meet-notes` at its current HEAD.
- Every commit message ends with the trailer line `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- Manifest V3. All code is bundled: no remote code, no CDN, no `eval`. Network calls go only to `https://openrouter.ai/*` and, in helper mode, to `http://127.0.0.1:47821/*` (an optional host permission, requested at runtime).
- **Nothing is sent to any service except OpenRouter:** no analytics, no telemetry, no crash reporting. In helper mode, the local helper is the second exception.
- **Nothing is emailed, posted or shared without a user click.** There is no email sending in the extension.
- The OpenRouter key is stored in `chrome.storage.local` only, never `chrome.storage.sync`, and it is never logged.
- Default models: transcription `google/gemini-2.5-flash`, screenshots `google/gemini-2.5-flash`, notes `anthropic/claude-sonnet-5.5`.
- Chunking: `chunk_s = 600`, `overlap_s = 5`. A trailing piece of `<= overlap` is skipped.
- Speaker mapping: `min_share = 0.6`, `min_overlap_ms = 1000`, `min_coverage = 0.5`, exactly as in `helper/meetnotes/speakers.py`.
- Language:
  - AI notes in English.
  - Summary in Persian, with English terms kept verbatim in Latin script.
  - Transcript as spoken.
  - UI in English.
  - Persian text is shown with `dir="auto"` / RTL.
- **User-facing errors are plain English with one next action.** No stack traces, JSON, "token" or "helper" wording in built-in mode. Raw details go only into a collapsed `<details>` labelled "Technical details".
- **No silent fallback to another model.** A failed step shows an error and offers Retry.
- **A recording is never lost.** Audio is kept until the user retries successfully, downloads it, or deletes the meeting. The 30-day automatic audio deletion applies only to `ready` meetings.
- **Style C:**
  - header gradient `linear-gradient(135deg,#4f46e5,#9333ea)`, page background `#f6f7fb`;
  - white cards, radius 12px, shadow `0 4px 14px rgba(30,30,60,.08)`;
  - primary button `#111827` with a red dot `#ef4444`;
  - selected chip `#ede9fe` / `#6d28d9`.
  - Mockups: `.superpowers/brainstorm/455-1793960910/content/popup-style.html` (card C) and `setup-flow.html` (card A).
- Meeting types: `"grooming" | "planning" | "technical" | "daily"`.
- Tests: `cd extension && npx vitest run`, `npx tsc --noEmit`, `npm run build`. The helper tests are `cd helper && .venv/Scripts/python -m pytest -q`. All existing tests stay green.

## Review Focus

1. **A 1–2 hour meeting.** Building a chunk reads only the PCM slices that overlap that chunk, never the whole recording. *Test: Task 3 `readsOnlyOverlappingSlices`.*
2. **Browser closed or crashed mid-processing.** On the next start, processing resumes and re-transcribes only the chunks without stored turns. *Tests: Task 6 `resumesWithoutRedoingDoneChunks`, Task 8 `resumeQueueOnStartup`.*
3. **Wrong or expired key, or no credit, then fixed in Settings.** Retry uses the new key, because the pipeline reads settings at run time and never caches the key. *Test: Task 6 `retryReadsKeyAtRunTime`.*
4. **A meeting with no speech or no screen share.** The model returns `[]` and there are no screenshots, but notes are still produced, with no error. *Test: Task 6 `emptyTranscriptAndNoScreensStillReady`.*
5. **Recording meeting B while meeting A is still processing.** The offscreen document must not be closed while either is active. *Test: Task 8 `offscreenStaysWhileProcessing`.*

---

## File Structure

```
extension/
  manifest.json                      (modify) permissions, pages, icons, worklet
  build.mjs                          (modify) new entries, copy css, md text loader not needed
  package.json                       (modify) deps, "package" script
  icons/16.png 32.png 48.png 128.png (create, generated)
  scripts/make-icons.mjs             (create) pure-node PNG generator
  scripts/package.mjs                (create) zip for the store
  src/types.ts                       (modify) MeetingType + daily; MeetingRecord etc.
  src/lib/db.ts                      (create) IndexedDB stores + queries
  src/lib/settings.ts                (create) chrome.storage.local settings w/ defaults
  src/lib/slug.ts                    (create) port of store.py slugify + meeting id
  src/lib/transcript.ts              (create) port of transcript.py
  src/lib/speakers.ts                (create) port of speakers.py
  src/lib/audioChunks.ts             (create) planChunks, Downsampler, chunk PCM assembly
  src/lib/mp3.ts                     (create) Int16 PCM -> MP3 Blob
  src/lib/openrouter.ts              (create) client, key check, friendly errors
  src/lib/notes.ts                   (create) prompt build, split output
  src/lib/templates.ts               (create) 4 meeting-type templates as strings
  src/lib/servicesContext.ts         (create) bounded folder sample
  src/lib/screens.ts                 (create) port of screens.py
  src/lib/pipeline.ts                (create) resumable processing
  src/lib/exportZip.ts               (create) meeting -> zip
  src/lib/setupFlow.ts               (create) pure setup-step logic
  src/pcmWorklet.ts                  (create) AudioWorklet processor
  src/offscreen.ts                   (modify) incremental persistence + processing queue
  src/background.ts                  (modify) builtin vs helper flows, resume, notifications, pruning
  src/messages.ts                    (modify) new messages
  src/ui/theme.css                   (create) style C tokens + components
  src/popup.html / popup.ts          (rewrite)
  src/settings.html / settings.ts    (create)
  src/meeting.html / meeting.ts      (create)
  src/meetings.html / meetings.ts    (create)
  src/permission.html                (modify) restyle
  tests/*.test.ts                    (create per task)
helper/meetnotes/server.py           (modify) GET /pair page
helper/meetnotes/review/pair.html    (create)
helper/tests/test_server.py          (modify)
docs/privacy-policy.md               (create)
docs/store-listing.md                (create)
README.md                            (modify)
```

## Shared Types (defined in Task 1, used everywhere)

In `extension/src/types.ts`:

```ts
export type MeetingType = "grooming" | "planning" | "technical" | "daily";
export type MeetingStatus = "recording" | "interrupted" | "queued" | "processing" | "ready" | "error";
export type Step = "chunking" | "transcribing" | "speakers" | "screens" | "notes" | "done";
export interface ChunkPlan { index: number; offsetMs: number; durationMs: number }
export interface Turn { startMs: number; endMs: number; speaker: string; text: string; uncertain: boolean; chunk: number; label: string }
export interface ScreenDesc { atMs: number; description: string }
export interface MeetingRecord {
  id: string;                       // meetingId(), see Task 1
  mode: "builtin" | "helper";
  title: string; type: MeetingType;
  startedAt: string;                // local ISO via lib/localIso
  durationMs: number;
  selfName: string; participants: string[];
  status: MeetingStatus; step?: Step;
  error?: string; errorDetail?: string;
  costUsd: number;
  speakerLog: SpeakerInterval[];
  servicesContext: string | null;   // snapshot taken at Stop (Task 7)
  servicesNotice?: string;          // "Made without your services folder — Allow & Retry"
  chunks?: ChunkPlan[];
  chunkTurns?: (Turn[] | null)[];   // per chunk, null = not yet transcribed
  turns?: Turn[];                   // merged + speaker-mapped
  screens?: ScreenDesc[];
  summaryMd?: string; notesMd?: string;
  pcmSamples: number;               // total 16 kHz samples persisted
  readyAt?: number; audioDeleted?: boolean;
  helperId?: string;                // helper-mode stub only
  createdAt: number;
}
```

The existing `SpeakerInterval`, `UploadMeta` and `Screen` stay. `UploadMeta.type` widens with `MeetingType`. The helper's Python `Turn` uses snake_case; the TS port is camelCase. The JSON shape exchanged with the helper (the upload form) is unchanged.

---

### Task 1: Storage, settings, slug, manifest and build scaffolding

**Files:**
- Modify: `extension/package.json`, `extension/build.mjs`, `extension/manifest.json`, `extension/src/types.ts`
- Create: `extension/src/lib/db.ts`, `extension/src/lib/settings.ts`, `extension/src/lib/slug.ts`
- Test: `extension/tests/db.test.ts`, `extension/tests/settings.test.ts`, `extension/tests/slug.test.ts`

**Interfaces:**
- Produces:
  - `db.ts`. Database `meetnotes`, version 1. Stores:
    - `meetings` (keyPath `id`);
    - `pcm` (key `[meetingId, seq]`, value `Int16Array`);
    - `webm` (key `[meetingId, seq]`, value `Blob`);
    - `screens` (key `[meetingId, atMs]`, value `Blob`);
    - `handles` (key string, value `FileSystemDirectoryHandle`).
  - `db.ts` functions:
    - `putMeeting(r: MeetingRecord): Promise<void>`
    - `getMeeting(id): Promise<MeetingRecord | undefined>`
    - `updateMeeting(id, patch: Partial<MeetingRecord>): Promise<MeetingRecord>` (read-modify-write in one transaction)
    - `listMeetings(): Promise<MeetingRecord[]>` (newest `createdAt` first)
    - `deleteMeeting(id)` (removes all stores' rows for it)
    - `putPcm(id, seq, pcm)`, `getPcmRange(id, fromSeq, toSeq): Promise<Int16Array[]>`
    - `putWebm(id, seq, blob)`, `getWebm(id): Promise<Blob>` (concatenated in seq order, `audio/webm`)
    - `putScreen(id, atMs, blob)`, `listScreens(id): Promise<{atMs:number; blob:Blob}[]>` (sorted)
    - `deleteAudio(id)` (pcm + webm rows; sets `audioDeleted: true`)
    - `pruneExpiredAudio(nowMs: number, days = 30): Promise<string[]>` (ready meetings with `readyAt <= now - days`; returns their ids)
    - `putHandle(key, h)`, `getHandle(key)`, `deleteHandle(key)`
  - `settings.ts`:
    ```ts
    export interface Settings {
      openrouterKey: string; selfName: string; role: "" | "pm" | "technical";
      servicesFolderName: string; servicesSkipped: boolean;
      setupStep: 1 | 2 | 3; setupDone: boolean;
      models: { transcribe: string; vision: string; notes: string };
      helper: { enabled: boolean; url: string; token: string };
      lastType: MeetingType;
    }
    export const DEFAULT_MODELS: Settings["models"];
    export const HELPER_URL = "http://127.0.0.1:47821";
    export function getSettings(store?: StorageArea): Promise<Settings>;
    export function saveSettings(patch: Partial<Settings>, store?: StorageArea): Promise<Settings>;
    ```
    - `StorageArea` is a minimal `{get(keys), set(items)}` interface, defaulting to `chrome.storage.local`, and is stored under the single key `settings`.
    - When `settings` is absent, the old v1 key `token` pre-fills `helper.token`, and the old `selfName` pre-fills `selfName` (spec §8 "no migration" note). Nothing else is read from the old keys.
  - `slug.ts`:
    - `slugify(title: string): string` is a port of `helper/meetnotes/store.py` `slugify`, with the 80-char cap and stripping trailing `-`/`.`.
    - `meetingId(startedAtIso, type, title, exists: (id) => boolean): string` returns `YYYY-MM-DD_<type>_<slug>` (with `_<slug>` omitted when the slug is empty), adding `-2`, `-3`… while `exists`.

- [ ] **Step 1: Branch and dependencies.** Run `git checkout -b feat/store-extension`. In `extension/`, run `npm i @breezystack/lamejs@1.2.7 marked@18.1.3 fflate@0.8.3 && npm i -D fake-indexeddb@6.2.7`.
- [ ] **Step 2: Write the failing tests.**
  - `db.test.ts`. Add `import "fake-indexeddb/auto"` at the top.
    - `putGetUpdateList`: two records; list is newest first; `updateMeeting` merges a patch.
    - `pcmRangeAndWebmConcat`: `getPcmRange(id,2,3)` returns exactly seq 2 and 3; `getWebm` size equals the sum of the parts.
    - `deleteMeetingRemovesAllRows`.
    - `pruneExpiredAudio`: ready with `readyAt` 31 days ago → pruned, `audioDeleted` true. Ready 29 days ago → kept. Status `error` 40 days ago → kept.
  - `settings.test.ts` (in-memory StorageArea fake):
    - `defaultsWhenEmpty`: models equal `DEFAULT_MODELS`, `setupDone` false, helper url `HELPER_URL`.
    - `saveMergesNested`: saving `{models:{...DEFAULT_MODELS, notes:"x"}}` keeps the other fields.
    - `prefillsFromV1Keys`: storage `{token:"t", selfName:"Sina"}` → `helper.token === "t"`, `selfName === "Sina"`.
  - `slug.test.ts`:
    - port the cases in `helper/tests/test_store.py` for slugify (200-char input capped at 80, no trailing dash);
    - `meetingIdAddsSuffix`: with `exists` true once → `…-2`.
- [ ] **Step 3: Run them.** Run `npx vitest run tests/db.test.ts tests/settings.test.ts tests/slug.test.ts`. Expected: FAIL (modules missing).
- [ ] **Step 4: Implement the three modules and widen `MeetingType`.** In `popup.html`, add `<option value="daily">Daily</option>` for now; the popup is replaced in Task 9.
- [ ] **Step 5: Update the manifest and build.**
  - `manifest.json`:
    - `version` `0.2.0`; `description` "Record Google Meet and get Persian/English meeting notes, summaries and transcripts.";
    - `permissions`: `["tabCapture","offscreen","storage","unlimitedStorage","notifications","downloads"]` (drop `activeTab`, unused);
    - `host_permissions`: `["https://openrouter.ai/*"]`;
    - `optional_host_permissions`: `["http://127.0.0.1:47821/*"]`;
    - `icons` and `action.default_icon` 16/32/48/128 → `icons/<n>.png`.
  - `build.mjs`:
    - entries for `src/settings.ts`, `src/meeting.ts`, `src/meetings.ts` (esm) and `src/pcmWorklet.ts` (esm), skipped while missing (existing behaviour);
    - copy `src/ui/*.css` to `dist/`.
  - `package.json`: script `"package": "node scripts/package.mjs"`. The script itself comes in Task 12.
- [ ] **Step 6: Verify.** Run `npx vitest run && npx tsc --noEmit && npm run build`. Expected: all pass. Manifest icons are missing until Task 12; that's acceptable for an unpacked build test.
- [ ] **Step 7: Commit** as `feat(extension): IndexedDB store, settings, meeting ids`.

### Task 2: Transcript and speaker mapping (port)

**Files:**
- Create: `extension/src/lib/transcript.ts`, `extension/src/lib/speakers.ts`
- Test: `extension/tests/transcript.test.ts`, `extension/tests/speakers.test.ts`

**Interfaces:**
- Consumes: `Turn`, `ChunkPlan` (Task 1).
- Produces:
  - `transcript.ts`:
    - `TRANSCRIBE_PROMPT: string`, verbatim from `helper/meetnotes/transcript.py`;
    - `class TranscriptParseError extends Error`;
    - `parseChunkOutput(raw: string, chunk: ChunkPlan): Turn[]`;
    - `mergeChunks(perChunk: Turn[][], chunkS = 600, overlapS = 5): Turn[]`;
    - `renderTranscriptMd(turns: Turn[]): string`, same format: `**[MM:SS] name:** text` plus ` *(uncertain)*`.
  - `speakers.ts`:
    - `assignSpeakers(turns, log: SpeakerInterval[], minShare = 0.6, minOverlapMs = 1000, minCoverage = 0.5): Turn[]`;
    - `renameSpeaker(turns, old, next): Turn[]`.

- [ ] **Step 1: Port every test case** in `helper/tests/test_transcript.py` and `helper/tests/test_speakers.py` 1:1 to vitest, with the same inputs and expected outputs. Field names become camelCase. Add `parseEmptyArray`: `"[]"` → `[]`.
- [ ] **Step 2: Run them.** Run `npx vitest run tests/transcript.test.ts tests/speakers.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement as straight ports** of the Python logic. Keep these exactly: `raw.indexOf("[")`/`lastIndexOf("]")` slicing, `MM:SS`/`H:MM:SS` parsing, the overlap-midpoint merge, and global "Speaker N" numbering by first appearance.
- [ ] **Step 4: Run.** Expected: PASS.
- [ ] **Step 5: Commit** as `feat(extension): port transcript parsing and speaker mapping`.

### Task 3: Audio chunks, resampler, MP3

**Files:**
- Create: `extension/src/lib/audioChunks.ts`, `extension/src/lib/mp3.ts`
- Test: `extension/tests/audioChunks.test.ts`, `extension/tests/mp3.test.ts`

**Interfaces:**
- Produces:
  - `PCM_RATE = 16000` and `SLICE_SAMPLES = 160000` (10 s per stored PCM slice).
  - `planChunks(totalMs: number, chunkS = 600, overlapS = 5): ChunkPlan[]`. It ports the `split_audio` boundaries: `count = max(1, ceil(total/chunk))`; chunk k has offset `k*chunkS*1000` and duration `min(chunkS+overlapS, rest)`; break when `k>0 && total - k*chunk <= overlap`.
  - `class Downsampler { constructor(inRate: number, outRate = PCM_RATE); push(input: Float32Array): Int16Array }` takes streaming mono input and returns Int16 output. It averages over each output sample's input window, keeps fractional position across calls, and clamps to [-1, 1] before `* 32767`.
  - `downmix(channels: Float32Array[]): Float32Array` averages the channels.
  - `assembleChunk(plan: ChunkPlan, readSlices: (fromSeq: number, toSeq: number) => Promise<Int16Array[]>): Promise<Int16Array>`. It computes `fromSeq = floor(startSample/SLICE_SAMPLES)` and `toSeq = floor((endSample-1)/SLICE_SAMPLES)`, reads only that range and returns exactly the samples `[startSample, endSample)` (or fewer at the end).
  - `mp3.ts`: `encodeMp3(pcm: Int16Array, sampleRate = PCM_RATE, kbps = 32): Blob` (`audio/mpeg`), using `Mp3Encoder` from `@breezystack/lamejs` in 1152-sample frames, then `flush()`.

- [ ] **Step 1: Write the failing tests.**
  - `planChunks`: port `helper/tests/test_audio.py`'s cases by duration:
    - 30 s → 1 chunk `{0,0,30000}`;
    - 1250 s → offsets `[0,600000,1200000]`, durations `[605000,605000,50000]`;
    - 1203 s → 2 chunks (trailing 3 s ≤ overlap skipped);
    - 21 s with `chunkS=10, overlapS=5` → offsets `[0,10000]`.
  - `downsamplerLengthAndDc`: 48 000 samples of 0.5 at 48 kHz pushed in 7 uneven pieces → 16 000 samples total (±1), each `≈ 16384` (±2).
  - `downsamplerSine`: a 440 Hz sine at 48 kHz keeps RMS within 10%.
  - `readsOnlyOverlappingSlices`: a fake `readSlices` records its args. For a plan `{index:1, offsetMs:600000, durationMs:605000}`, it's called once with `(60, 120)`, and the result length is `605000*16`.
  - `mp3.test.ts` `encodesSilence`: 16 000 zero samples → a Blob of type `audio/mpeg`, size > 0 and < 10 000 bytes.
- [ ] **Step 2: Run them.** Expected: FAIL.
- [ ] **Step 3: Implement.** Check the `@breezystack/lamejs` export name in its `package.json`/types. If it differs (`lamejs` default export with `Mp3Encoder`), adapt the import and note it in the report.
- [ ] **Step 4: Run.** Expected: PASS.
- [ ] **Step 5: Commit** as `feat(extension): in-browser audio chunking and mp3 encoding`.

### Task 4: OpenRouter client with friendly errors

**Files:**
- Create: `extension/src/lib/openrouter.ts`
- Test: `extension/tests/openrouter.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export class OpenRouterError extends Error { constructor(public userMessage: string, public detail: string, public status?: number) }
  export interface OpenRouterDeps { fetch: typeof fetch; sleep: (ms: number) => Promise<void> }
  export function complete(key: string, model: string, content: unknown[], opts?: { maxTokens?: number }, deps?: OpenRouterDeps): Promise<{ text: string; cost: number }>;
  export function transcribeChunk(key: string, model: string, mp3: Blob, deps?): Promise<{ text: string; cost: number }>;
  export function describeImage(key: string, model: string, jpeg: Blob, prompt: string, deps?): Promise<{ text: string; cost: number }>;
  export function checkKey(key: string, deps?): Promise<{ ok: true; remainingUsd: number | null } | { ok: false; userMessage: string }>;
  ```
- `complete`:
  - POSTs `https://openrouter.ai/api/v1/chat/completions` with body `{model, messages:[{role:"user",content}], usage:{include:true}, max_tokens?}`;
  - headers `Authorization: Bearer <key>`, `X-Title: Meet Notes`;
  - reads `choices[0].message.content` and `usage.cost` (0 when missing).
- Audio parts are `{type:"input_audio", input_audio:{data:<base64>, format:"mp3"}}`; images are `{type:"image_url", image_url:{url:"data:image/jpeg;base64,…"}}`. Base64 is encoded in 32 KB pieces, never `String.fromCharCode(...wholeArray)`.
- `checkKey` calls `GET https://openrouter.ai/api/v1/key`. It returns `data.limit_remaining` (null when no limit).
- Retry policy: a network error, 429 or 5xx is retried twice, after `sleep(2000)` then `sleep(8000)`. 400/401/402/403 fail immediately.
- `userMessage` copy, exact:
  - 401/403: `OpenRouter rejected your API key. Check it in Settings, then press Retry.`
  - 402: `Your OpenRouter credit ran out. Add credit at openrouter.ai, then press Retry.`
  - 429/5xx after retries: `OpenRouter is busy or unavailable right now. Press Retry in a few minutes.`
  - network after retries: `Couldn't reach OpenRouter. Check your internet connection, then press Retry.`
  - other or a bad body: `OpenRouter returned something unexpected. Press Retry.`
  - `detail` holds `HTTP <status>: <first 500 chars of body>`.

- [ ] **Step 1: Write the failing tests** with a fake `fetch` and a recording `sleep`:
  - `sendsModelContentAndUsage`: asserts the URL, the bearer header and `usage.include === true`;
  - `parsesTextAndCost`;
  - `retries429Then200`: sleeps `[2000]`;
  - `gives503FriendlyAfterThreeTries`: sleeps `[2000,8000]` and the busy message;
  - `fails402Immediately`: one call, the credit message;
  - `fails401Immediately`;
  - `networkErrorFriendly`;
  - `checkKeyOkAndRemaining`: `limit_remaining: 1.98` → 1.98;
  - `checkKey401`;
  - `transcribeChunkSendsMp3Base64`: decodes `data` back to the input bytes;
  - `base64LargeBlob`: a 3 MB blob doesn't throw.
- [ ] **Step 2: Run them.** Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run.** Expected: PASS.
- [ ] **Step 5: Commit** as `feat(extension): OpenRouter client with plain-English errors`.

### Task 5: Notes prompt, templates (incl. Daily), services context

**Files:**
- Create: `extension/src/lib/templates.ts`, `extension/src/lib/notes.ts`, `extension/src/lib/servicesContext.ts`
- Test: `extension/tests/notes.test.ts`, `extension/tests/servicesContext.test.ts`

**Interfaces:**
- Produces:
  - `templates.ts`: `TEMPLATES: Record<MeetingType, string>`.
    - grooming/planning/technical are copied from `helper/meetnotes/templates/*.md`, with the email wording changed to the summary and two changes:
      - the repo rule becomes "use the services context only to correct service/repo/component names to their real names; never add tasks, owners, estimates or decisions not present in the transcript. If there is no services context, write `?` for unknown Service/Repo cells";
      - the line "The repos are read-only context (use Read, Grep, Glob)…" is deleted.
    - The markers are `<<<SUMMARY>>>` / `<<<NOTES>>>`.
    - `daily` uses the same rules header with this content:
      - **Summary (Persian):** per participant `دیروز` / `امروز` / `موانع` bullet groups, then `نیاز به پیگیری`.
      - **Notes (English)** sections in order: `# <title> — daily — <date>`, `## Participants`, `## Per person` (each `### <name>` with `- Done:`, `- Doing:`, `- Blocked:` items, each with `[MM:SS]`), `## Blockers` (table Blocker | Person | Owner to unblock | Source), `## Decisions`, `## Open questions`.
      - No story points. Unsaid items are omitted, never guessed. Uncertain speakers keep `(uncertain)`.
  - `notes.ts`:
    - `SUMMARY_MARK = "<<<SUMMARY>>>"`, `NOTES_MARK = "<<<NOTES>>>"`;
    - `class NotesError extends Error`;
    - `buildNotesPrompt(rec: Pick<MeetingRecord,"title"|"type"|"startedAt"|"durationMs"|"participants">, transcriptMd: string, screens: ScreenDesc[], servicesContext: string | null): string`. It ports `build_prompt`, and appends `## Services context\n<ctx>` or `## Services context\n(none)`. Screenshot lines are `- screens/<atMs>.jpg [MM:SS]: <description>`.
    - `splitNotesOutput(text: string): { summaryMd: string; notesMd: string }` ports `split_output` with the new markers. Missing or empty parts raise `NotesError`.
    - `NOTES_MAX_TOKENS = 16000`.
  - `servicesContext.ts`: `readServicesContext(dir: FileSystemDirectoryHandle, caps = SERVICES_CAPS): Promise<string>`, with `SERVICES_CAPS = { maxServices: 80, readmeChars: 3000, totalChars: 40000 }`.
    - **Single repo:** if `dir` itself contains `package.json`, `pyproject.toml`, `go.mod` or `.git`, treat it as one service named `dir.name`.
    - **Otherwise:** each subdirectory (skipping names starting with `.` and `node_modules`), sorted by name, is a service.
    - Per service:
      - manifest summary: `package.json` → `name — description`; `pyproject.toml` → the `name =` / `description =` lines; `go.mod` → the `module` line;
      - the first README file (case-insensitive `README*`), truncated to `readmeChars`.
    - Output format:
      ```
      ### <dir name>
      manifest: <summary or ->
      README:
      <text or ->
      ```
      The whole thing is truncated at `totalChars` with the line `…(truncated)`.

- [ ] **Step 1: Write the failing tests.**
  - `notes.test.ts`:
    - port `test_split_output` and `test_split_output_bad_raises` with the new markers;
    - `promptHasTemplateInfoScreensTranscript` for each of the 4 types: the prompt contains the `## Meeting type: <type>` line of its template, `Duration: 05:00`, the screenshot line format, the transcript and `## Services context\n(none)`;
    - `dailyTemplateSections`: `TEMPLATES.daily` contains `## Per person`, `## Blockers`, `دیروز`, `امروز`, `موانع` and no `Story points`;
    - `noReadGrepGlobInTemplates`: no template contains `Read, Grep, Glob`.
  - `servicesContext.test.ts`, with a hand-made fake directory handle (`{kind:"directory", name, values(), getFileHandle}`):
    - `multiServiceFolder`: 2 services, with manifest and README in the output;
    - `skipsDotAndNodeModules`;
    - `singleRepoFolder`: a root `package.json` → one `### <root>`;
    - `capsReadmeAndTotal`: a 10 KB README → 3000 chars; 200 services → the output ends with `…(truncated)` and is ≤ 40 000 + 20 chars.
- [ ] **Step 2: Run them.** Expected: FAIL.
- [ ] **Step 3: Implement.** Add `"FileSystemDirectoryHandle"` types via the DOM lib, which is already enabled.
- [ ] **Step 4: Run.** Expected: PASS.
- [ ] **Step 5: Commit** as `feat(extension): notes prompt, daily standup template, services context`.

### Task 6: Screens and resumable pipeline

**Files:**
- Create: `extension/src/lib/screens.ts`, `extension/src/lib/pipeline.ts`
- Test: `extension/tests/screens.test.ts`, `extension/tests/pipeline.test.ts`

**Interfaces:**
- Consumes: Tasks 1–5.
- Produces:
  - `screens.ts`:
    - `DESCRIBE_PROMPT`, verbatim from `screens.py`;
    - `pickEvenly<T>(items: T[], k: number): T[]`, a port;
    - `MAX_DESCRIBED = 60`.
  - `pipeline.ts`:
    ```ts
    export interface PipelineDeps {
      db: Pick<typeof import("./db"), "getMeeting" | "updateMeeting" | "getPcmRange" | "listScreens">;
      settings: () => Promise<Settings>;          // read at run time (Review Focus 3)
      transcribe: typeof transcribeChunk; describe: typeof describeImage; complete: typeof complete;
      encode: typeof encodeMp3;
    }
    export async function processMeeting(id: string, deps: PipelineDeps): Promise<MeetingRecord>;
    ```
- Behaviour, in order. Each step's output is saved with `updateMeeting` before the next step, and `step` is set at each step start.
  1. **Status.** Set `processing`; clear `error`/`errorDetail`.
  2. **chunking:** if `!rec.chunks`, `chunks = planChunks(rec.pcmSamples / 16)` (ms) and `chunkTurns = chunks.map(() => null)`.
  3. **transcribing:** for each chunk with `chunkTurns[i] === null`: `assembleChunk` → `encode` → `transcribe`, adding the cost. Parse with `parseChunkOutput`. On `TranscriptParseError`, transcribe once more, as the helper does. On a second failure the error is `The transcription of part <i+1> came back unreadable. Press Retry.` Store `chunkTurns[i]` immediately after each chunk.
  4. **speakers:** if `!rec.turns`, `turns = assignSpeakers(mergeChunks(chunkTurns), rec.speakerLog)`.
  5. **screens:** if `!rec.screens`, describe `pickEvenly(listScreens, 60)` in time order with the settings' vision model and `DESCRIBE_PROMPT`, adding the cost. No screenshots → `screens = []`.
  6. **notes:** if `!rec.notesMd`, call `complete(key, models.notes, [{type:"text", text: buildNotesPrompt(...)}], {maxTokens: NOTES_MAX_TOKENS})`, then `splitNotesOutput`. On `NotesError` the error is `The notes came back in an unexpected format. Press Retry.`
  7. **Done.** Set `status: "ready"`, `step: "done"`, `readyAt: Date.now()`.
- On any error: `status: "error"`; `error` = `OpenRouterError.userMessage`, the copy above, or `Something went wrong while processing (<step>). Press Retry.`; `errorDetail` = the raw message. The cost so far is kept. The function resolves with the record and never throws.
- An empty key fails with `Add your OpenRouter key in Settings, then press Retry.` and makes no network call.

- [ ] **Step 1: Write the failing tests.**
  - `screens.test.ts`: port `test_caps_to_max_screens_keeping_first_and_last` (as `pickEvenly`).
  - `pipeline.test.ts` (fake deps over an in-memory db):
    - `happyPathReady`: status ready, all fields set, cost = the sum of the fakes' costs;
    - `parseFailureRetriesOnceThenErrorsNamingPart`: the message mentions "part 2";
    - `resumesWithoutRedoingDoneChunks`: `chunkTurns` `[turns, null, turns]` → `transcribe` called once, for index 1;
    - `retryResumesFromFailedStep`: notes fails, then retry → transcribe and describe not called again;
    - `costKeptWhenStepFails`;
    - `retryReadsKeyAtRunTime`: the first run's settings key `"bad"` → 401 friendly error; settings change to `"good"`, then retry → `transcribe` receives `"good"`;
    - `emptyTranscriptAndNoScreensStillReady`: transcribe returns `"[]"`, there are no screens → ready, and the notes prompt is still called;
    - `emptyKeyFailsWithoutNetwork`;
    - `servicesContextPassedToPrompt`: `rec.servicesContext = "### pay"` → the prompt contains it.
- [ ] **Step 2: Run them.** Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run.** Expected: PASS.
- [ ] **Step 5: Commit** as `feat(extension): resumable in-browser processing pipeline`.

### Task 7: Recording with incremental persistence and services snapshot

**Files:**
- Create: `extension/src/pcmWorklet.ts`
- Modify: `extension/src/offscreen.ts`, `extension/src/messages.ts`
- Test: `extension/tests/recordingStore.test.ts`

**Interfaces:**
- Consumes: `db.ts`, `Downsampler`/`downmix`/`SLICE_SAMPLES` (Task 3), `readServicesContext` (Task 5).
- Produces:
  - `pcmWorklet.ts` registers the processor `"pcm-capture"`. It downmixes and downsamples with `Downsampler(sampleRate)` and posts `Int16Array` batches of about 1 s (16 000 samples) through `port.postMessage(buf, [buf.buffer])`.
  - In `offscreen.ts`, a new exported pure helper (put it in `src/lib/sliceBuffer.ts`): `class SliceBuffer { constructor(onSlice: (seq: number, pcm: Int16Array) => Promise<void>, size = SLICE_SAMPLES); push(pcm: Int16Array): void; flush(): Promise<void>; get totalSamples(): number }`. It emits fixed-size slices in order, the last one partial on `flush`.
  - Message changes in `messages.ts`:
    - `ToOffscreen` `start` gains `meetingId: string` and `persist: boolean`. `persist` is true in built-in mode. In helper mode it's false and v1 behaviour is unchanged.
    - New `{target:"offscreen"; type:"stop-builtin"; meetingId: string; log: SpeakerInterval[]; participants: string[]}` → `Ack`.
    - New `{target:"offscreen"; type:"process"; meetingId: string}` → `Ack`.
    - New report `{target:"background"; type:"processed"; meetingId: string; ok: boolean}`, plus `{target:"background"; type:"offscreen-idle"}`.
- Behaviour when `persist`:
  - On start, connect `micSrc` and `tabSrc` → `AudioWorkletNode("pcm-capture")`. Its module is loaded with `ctx.audioWorklet.addModule(chrome.runtime.getURL("dist/pcmWorklet.js"))`. It isn't connected to the destination.
  - PCM goes into a `SliceBuffer` → `putPcm`. Each WebM `dataavailable` → `putWebm(meetingId, seq++)`. Each kept screen → `putScreen`.
  - `r.chunks` and `r.screens` are no longer kept in memory.
  - Every slice write also calls `updateMeeting(id, {pcmSamples})`.
- On `stop-builtin`:
  - stop the recorder and flush both buffers;
  - set the log: content-script log merged with the self log (the existing `mergeLogs`);
  - set `durationMs = round(pcmSamples/16)`, `participants`, and the services snapshot below;
  - set `status: "queued"`; then enqueue processing.
- **Services snapshot:**
  - When `role === "technical"` and `getHandle("services")` exists: if `await h.queryPermission({mode:"read"}) === "granted"`, set `servicesContext = await readServicesContext(h)`.
  - Otherwise set `servicesContext = null` and `servicesNotice = "Made without your services folder — Allow & Retry"`.
  - With no folder, or a PM role: `servicesContext = null` and no notice.
- **Processing queue in offscreen:** one meeting at a time, in FIFO order. It calls `processMeeting(id, realDeps)` and reports `processed`. When it isn't recording and the queue is empty, it reports `offscreen-idle`.

- [ ] **Step 1: Write the failing tests** (`recordingStore.test.ts`, with fake-indexeddb, testing `SliceBuffer` and a pure `snapshotServices(settings, getHandle, read)` exported from `src/lib/servicesSnapshot.ts`):
  - `emitsFixedSlicesInOrderAndPartialOnFlush`: pushes of 70 000 + 100 000 + 5 000 with size 160 000 → slices of `[160000]`, then on flush `[15000]`; seq 0, 1; `totalSamples` 175 000;
  - `snapshotGrantedReadsContext`;
  - `snapshotPromptGivesNotice`: `queryPermission` returns `"prompt"` → null plus the exact notice text;
  - `snapshotPmNoNotice`;
  - `snapshotNoFolderNoNotice`.
- [ ] **Step 2: Run them.** Expected: FAIL.
- [ ] **Step 3: Implement** `SliceBuffer`, `snapshotServices`, the worklet and the offscreen changes. Keep the helper-mode (`persist: false`) path byte-for-byte compatible with v1: existing `upload.test.ts`/`download.test.ts` stay green.
- [ ] **Step 4: Run** `npx vitest run && npx tsc --noEmit && npm run build`. Expected: PASS, and `dist/pcmWorklet.js` exists.
- [ ] **Step 5: Commit** as `feat(extension): crash-safe recording to IndexedDB with 16 kHz PCM capture`.

### Task 8: Background orchestration: modes, resume, interrupted, notifications, pruning

**Files:**
- Modify: `extension/src/background.ts`, `extension/src/messages.ts`
- Create: `extension/src/lib/lifecycle.ts`
- Test: `extension/tests/lifecycle.test.ts`

**Interfaces:**
- Consumes: Tasks 1, 6, 7.
- Produces, in `lifecycle.ts` (pure, tested):
  - `shouldCloseOffscreen(s: { recording: boolean; processing: boolean; queued: number; helperUploadPending: boolean }): boolean`;
  - `recordsToResume(all: MeetingRecord[]): string[]` returns builtin ids with status `queued` or `processing`, oldest first;
  - `recordsInterrupted(all: MeetingRecord[], recordingId: string | undefined): string[]` returns builtin `recording` records that aren't the live one.
- New popup messages:
  - `{type:"process-saved"; meetingId}` processes an interrupted meeting: it sets `durationMs = round(pcmSamples/16)` and `status: "queued"`, ensures the offscreen doc and sends `process`;
  - `{type:"retry-meeting"; meetingId}` takes an `error` meeting: it sets `status: "queued"`, ensures the offscreen doc and sends `process`;
  - `{type:"delete-meeting"; meetingId}` calls `deleteMeeting` and refuses a meeting that is currently `recording` or `processing`.
- `start(msg)`:
  - **Built-in mode** (settings `helper.enabled` false):
    - create the record with `meetingId(...)` (checking existence via `getMeeting`), status `recording`, `mode: "builtin"`, `costUsd: 0`, `pcmSamples: 0`, `speakerLog: []`, `servicesContext: null`, `createdAt: Date.now()`;
    - send the offscreen `start` with `persist: true`.
  - **Helper mode:** v1 flow with `persist: false`.
- `stop()`:
  - Built-in: collect the speaker log (existing `collectSpeakerLog`) → `stop-builtin`. The session goes back to `idle` right away (the meeting shows as processing in Recent).
  - Helper: v1 flow. On `upload-result ok`, write a stub record `{mode:"helper", helperId: id, status:"ready", …}` so it shows in Recent.
- Ensuring the offscreen doc: always create it with `reasons: ["USER_MEDIA", "BLOBS"]`. Close it only when `shouldCloseOffscreen` is true, i.e. on `offscreen-idle` / `processed` with nothing left.
- **On `processed`:**
  - If `ok`, and no tab of `dist/meeting.html?id=<id>` is open (check with `chrome.runtime.getContexts({contextTypes:["TAB"]})` and match `documentUrl`), create a notification `chrome.notifications.create("meeting:<id>", {type:"basic", iconUrl:"icons/128.png", title:"Notes ready", message: rec.title || "Your meeting"})`.
  - On `!ok`, the notification title is `Processing failed` and the message is `rec.error`.
  - `notifications.onClicked` opens `dist/meeting.html?id=<id>`.
- **On `runtime.onStartup` and `onInstalled`:**
  1. mark `recordsInterrupted` as `interrupted`;
  2. `pruneExpiredAudio(Date.now())`;
  3. if `recordsToResume` isn't empty, ensure the offscreen doc and send `process` for each;
  4. on `onInstalled` with `reason === "install"`, open nothing (setup happens in the popup).

- [ ] **Step 1: Write the failing tests** (`lifecycle.test.ts`):
  - `offscreenStaysWhileProcessing`: `{recording:false, processing:true, queued:0}` → false; `{recording:true, processing:false, queued:0}` → false; everything false/0 → true;
  - `resumeQueueOnStartup`: a mix of statuses and modes → only builtin queued/processing ids, oldest first;
  - `interruptedExcludesLive`.
- [ ] **Step 2: Run them.** Expected: FAIL.
- [ ] **Step 3: Implement** `lifecycle.ts` and the background changes. Keep the v1 handlers for helper mode (`retry-upload`, `save-discard`) working.
- [ ] **Step 4: Run** `npx vitest run && npx tsc --noEmit && npm run build`. Expected: PASS.
- [ ] **Step 5: Commit** as `feat(extension): queue, resume and notify for in-browser processing`.

### Task 9: Style C theme and the new popup (setup, idle, recording, states)

**Files:**
- Create: `extension/src/ui/theme.css`, `extension/src/lib/setupFlow.ts`
- Rewrite: `extension/src/popup.html`, `extension/src/popup.ts`
- Modify: `extension/src/permission.html` (theme only)
- Test: `extension/tests/setupFlow.test.ts`

**Interfaces:**
- Consumes: settings (Task 1), `checkKey` (Task 4), messages (Tasks 7–8), `listMeetings` (Task 1).
- Produces:
  - `theme.css` classes, shared by every page:
    - `.mn-header` (gradient band), `.mn-card` (floating white card; `.mn-header + .mn-card` pulls up 42px);
    - `.mn-btn` (primary dark), `.mn-btn-ghost`, `.mn-chip` / `.mn-chip.on`, `.mn-input`, `.mn-label`;
    - `.mn-badge.ready|processing|error|interrupted`, `.mn-seg`, `.mn-progress`, `.mn-row`.
    - Tokens are CSS variables on `:root`.
  - `setupFlow.ts`:
    - `setupState(s: Settings): { done: boolean; step: 1 | 2 | 3 }`. Done when the key is non-empty, `selfName` is non-empty, the role is set, and (role `pm`, or `servicesFolderName`, or `servicesSkipped`). Step = the first incomplete item, but never lower than `s.setupStep` while still valid.
    - `nextStep(s, from)` returns 3 only for the `technical` role. From step 2 with role `pm` it returns `done`.
- **Popup states** (310–330 px wide, per the mockups):
  - **Setup.** Header: "Welcome to Meet Notes", "Step N of 3", a 3-segment bar.
    - Step 1: the key field, plus the link `https://openrouter.ai/keys` opened in a new tab. On input, debounce 600 ms, then `checkKey`: "Connected · $X.XX left" ("Connected" when there's no limit), or its `userMessage`. Next is enabled only when connected.
    - Step 2: name, with the hint "Must match exactly how Google Meet shows your name.", plus the role `.mn-seg` (PM / non-technical | Technical).
    - Step 3: "Choose folder…" opens `dist/settings.html?pick=folder` in a new tab. The folder picker can't run inside a popup, because a picker closes it. "Skip" sets `servicesSkipped`.
    - Every change calls `saveSettings` straight away, including `setupStep`.
  - **Idle:**
    - header with logo "M", "Meet Notes", the line "Meet tab detected" / "Open a Google Meet tab", and ⚙ (opens `dist/settings.html`), plus a "Local helper" badge in helper mode;
    - card: title (pre-filled from the active tab's title with a trailing " - Google Meet" stripped, editable), the chips Grooming · Planning · Technical · Daily (`lastType`), and "● Start recording" (disabled off Meet);
    - below: "Recent", the latest 5 from `listMeetings` (title, a date line "Today 10:00 · 14 min", a badge), each opening `dist/meeting.html?id=` (or `<helper.url>/meetings/<helperId>` for helper stubs); then "See all" → `dist/meetings.html`.
      - A `processing` item shows its step text under the title ("Transcribing part 2 of 6…", "Describing screens…", "Writing notes…") and a thin `.mn-progress` bar.
      - An `error` item shows `rec.error` in one line; clicking it opens the meeting page, which has Retry.
      - The popup re-reads the list every 1 s while it's open.
  - **Recording:** a large timer, "Recording…", a mic level dot, and Stop.
  - **Interrupted** (any record with `interrupted`): a card "Recording interrupted — <title>" with **Process what was saved** (`process-saved`) and **Delete** (two-click, no `confirm()`).
  - **Helper mode:** the v1 `uploading` / `upload-failed` lines with Retry and "Save audio & discard" keep working, restyled.
  - The microphone permission flow is unchanged (`PERMISSION_PATH`).

- [ ] **Step 1: Write the failing tests** (`setupFlow.test.ts`):
  - `emptyIsStep1`;
  - `keyOnlyIsStep2`;
  - `pmDoneWithoutFolder`;
  - `technicalNeedsFolderOrSkip`: step 3 until `servicesSkipped` → done;
  - `nextStepSkips3ForPm`;
  - `resumesSavedStep`: `setupStep:2` with a key → 2.
- [ ] **Step 2: Run them.** Expected: FAIL.
- [ ] **Step 3: Implement** `setupFlow.ts`, `theme.css`, the popup and the restyled permission page.
- [ ] **Step 4: Run** `npx vitest run && npx tsc --noEmit && npm run build`. Expected: PASS.
- [ ] **Step 5: Manual check.** Load `extension/` unpacked. The popup should show the setup step 1 card in style C. Take a screenshot for the review if a browser is available; otherwise note it in the report.
- [ ] **Step 6: Commit** as `feat(extension): style C popup with 3-step setup`.

### Task 10: Settings page

**Files:**
- Create: `extension/src/settings.html`, `extension/src/settings.ts`
- Test: `extension/tests/settingsPage.test.ts`

**Interfaces:**
- Consumes: settings, `checkKey`, `putHandle`/`getHandle`/`deleteHandle`, `listMeetings`/`deleteMeeting`.
- Produces: a pure helper exported from `settings.ts`'s sibling `src/lib/storageUsage.ts`, `formatBytes(n: number): string` (`"0 B"`, `"1.5 MB"`, `"2.0 GB"`). Usage comes from `navigator.storage.estimate()`.
- Page sections (style C header "Settings"):
  1. **OpenRouter key:** masked `sk-or-…<last4>`, "Change" → field plus the live check (same copy as the popup).
  2. **Your name** and **Role**.
  3. **Services folder:**
     - "Choose folder…" → `showDirectoryPicker({mode:"read"})` → `putHandle("services", h)` and `servicesFolderName = h.name`;
     - "Remove";
     - when `queryPermission` isn't `granted`: "Chrome needs permission again → **Allow**" (`requestPermission`);
     - copy: "Meet Notes reads only folder names, README files and package manifests, to get service names right. They are sent to OpenRouter with the meeting.";
     - with `?pick=folder` the page scrolls to this section and highlights the button. A click is still required. After choosing, `setupDone` is recomputed with `setupState`.
  4. **Advanced** (`<details>`):
     - **Models:** three text fields with "Reset";
     - **Local helper:**
       - toggle; turning it on calls `chrome.permissions.request({origins:["http://127.0.0.1:47821/*"]})`, and if that's denied the toggle stays off with "Permission is needed to talk to the local helper.";
       - URL field;
       - token field;
       - "Connect" opens `<url>/pair` in a new tab (Task 12).
  5. **Storage:** "Using <formatBytes(usage)>", plus "Delete all meetings" (two-click).

- [ ] **Step 1: Write the failing test** `formatBytes` cases: 0, 1536, 1610612736, 2147483648.
- [ ] **Step 2: Run it.** Expected: FAIL.
- [ ] **Step 3: Implement** the page.
- [ ] **Step 4: Run** `npx vitest run && npx tsc --noEmit && npm run build`. Expected: PASS, and `dist/settings.html` exists.
- [ ] **Step 5: Commit** as `feat(extension): settings page with folder access, models and local helper`.

### Task 11: Meeting page and meetings list

**Files:**
- Create: `extension/src/meeting.html`, `extension/src/meeting.ts`, `extension/src/meetings.html`, `extension/src/meetings.ts`, `extension/src/lib/exportZip.ts`, `extension/src/lib/gmail.ts`
- Test: `extension/tests/exportZip.test.ts`, `extension/tests/gmail.test.ts`, `extension/tests/meetingView.test.ts`

**Interfaces:**
- Consumes: db, `renameSpeaker`, `renderTranscriptMd`, `readServicesContext`, messages (`retry-meeting`, `delete-meeting`), `marked`.
- Produces:
  - `exportZip.ts`: `buildMeetingZip(rec: MeetingRecord, screens: {atMs:number; blob:Blob}[]): Promise<Blob>` (fflate `zipSync`). Contents: `notes.md`, `summary.md`, `transcript.md`, `meta.json` (the record minus `servicesContext`, `chunkTurns`, `turns`, `chunks`), and `screens/<atMs>.jpg`. The download filename is `<rec.id>.zip`.
  - `gmail.ts`: `gmailComposeUrl(subject: string): string` → `https://mail.google.com/mail/?view=cm&fs=1&su=<encodeURIComponent(subject)>`; and `meetingSubject(rec): string` → `<title or type label> — <YYYY-MM-DD>`.
  - `meetingView.ts` (pure, in `src/lib/`): `applyRename(rec, old, next): Pick<MeetingRecord,"turns"|"summaryMd"|"notesMd">`. Turns use `renameSpeaker`. In `summaryMd`/`notesMd`, whole-name occurrences are replaced literally (a function replacer, no `$` patterns). This ports the v1 rename (ruling R4).
- **Meeting page** `dist/meeting.html?id=<id>`:
  - **Header:** title, date, duration, a type chip, "$0.12".
  - **Banners:**
    - `processing`/`queued`: step text and a progress bar (`transcribing` shows "part i of n"); poll the record every 1 s;
    - `error`: `rec.error`, **Retry**, a collapsed "Technical details" (`errorDetail`), and **Download audio** (`getWebm` → `chrome.downloads` via `audioFileName`);
    - `servicesNotice`: **Allow & Retry** → `requestPermission` on the handle → `readServicesContext` → `updateMeeting({servicesContext, servicesNotice: undefined, notesMd: undefined, summaryMd: undefined})` → `retry-meeting`.
  - **Speakers bar:** a chip per distinct speaker; uncertain ones show "Speaker N → rename?". Click → inline input → `applyRename` → save.
  - **Tabs:**
    - *Summary:* an editable `textarea dir="auto"` with a rendered preview toggle. **Copy** = `navigator.clipboard.write([new ClipboardItem({"text/html": html, "text/plain": md})])` with `html = marked.parse(md)`, falling back to `writeText(md)`. **Open in Gmail** = `chrome.tabs.create({url: gmailComposeUrl(meetingSubject(rec))})`.
    - *AI notes:* an editable `textarea dir="ltr"`; **Copy as Markdown**; **Download .zip**.
    - *Transcript:* rendered lines; **Copy**; **Download .md**.
    - *Screens:* a grid with `atMs` as MM:SS and the description; click opens the full image.
  - Edits save on input with an 800 ms debounce. A "Saved" indicator is shown.
  - Delete meeting is two-click.
- **Meetings list** `dist/meetings.html`: a style C header and a card list (title, type, date, duration, badge), newest first. Helper stubs link to the helper. The empty state reads "No meetings yet. Open a Google Meet and press Start recording."

- [ ] **Step 1: Write the failing tests.**
  - `exportZip`: unzip with fflate `unzipSync`; the file names and their contents match; `meta.json` has no `servicesContext`.
  - `gmail`: an encoded subject with Persian text and `&` round-trips through `new URL(...).searchParams.get("su")`.
  - `meetingView`: a rename updates turns, summary and notes; the replacement `"$1"` is inserted literally; `"Reza"` doesn't touch `"Rezaei"`.
- [ ] **Step 2: Run them.** Expected: FAIL.
- [ ] **Step 3: Implement** the modules and pages.
- [ ] **Step 4: Run** `npx vitest run && npx tsc --noEmit && npm run build`. Expected: PASS.
- [ ] **Step 5: Commit** as `feat(extension): meeting page with copy, Gmail draft and zip export`.

### Task 12: Helper pairing page, icons, store package and docs

**Files:**
- Modify: `helper/meetnotes/server.py`, `helper/tests/test_server.py`, `README.md`
- Create: `helper/meetnotes/review/pair.html`, `extension/scripts/make-icons.mjs`, `extension/icons/*.png`, `extension/scripts/package.mjs`, `docs/privacy-policy.md`, `docs/store-listing.md`
- Test: `helper/tests/test_server.py::test_pair_page_shows_token_with_copy`, `extension/tests/package.test.ts`

**Interfaces:**
- **Helper `GET /pair`:** HTML, same token embedding as the existing pages (`__TOKEN__` replace), behind the existing TrustedHost middleware. It shows "Meet Notes helper is running", the token in a read-only input, and a **Copy** button (`navigator.clipboard.writeText`) with the instruction "Paste it into Meet Notes → Settings → Advanced → Local helper → Token."
- `make-icons.mjs`:
  - pure Node (`zlib` + a hand-written PNG chunk/CRC encoder);
  - draws at 16/32/48/128: a rounded square with the style C gradient (`#4f46e5 → #9333ea`), a white circle (a record dot) and three white vertical waveform bars to its right;
  - writes `extension/icons/<n>.png`, and the PNGs are committed.
- `package.mjs`: runs `npm run build` first. With fflate it zips `manifest.json`, `dist/**` and `icons/**` into `extension/meet-notes-<manifest.version>.zip`, and fails if any file the manifest references is missing.
- `docs/privacy-policy.md`:
  - what is collected (meeting audio, screenshots, speaker names from the Meet page, the OpenRouter key, optional services-folder text);
  - where it goes (only OpenRouter, to make the notes; in local helper mode, the user's own `127.0.0.1` helper);
  - storage (only in the user's browser);
  - retention (audio deleted 30 days after the notes are ready; the rest until the user deletes it);
  - no analytics, no sale and no transfer of data;
  - the Chrome Web Store Limited Use statement;
  - a contact placeholder `<your email>` for Sina to fill in.
- `docs/store-listing.md`:
  - name, a short description (≤ 132 chars), a detailed description;
  - category Productivity;
  - the single-purpose statement;
  - a justification line for each permission (tabCapture, offscreen, storage, unlimitedStorage, notifications, downloads, `https://openrouter.ai/*`, the content script on `https://meet.google.com/*`, the optional `http://127.0.0.1:47821/*`);
  - the data-usage disclosure answers;
  - the screenshot checklist (1280×800).

- [ ] **Step 1: Write the failing tests.**
  - `test_pair_page_shows_token_with_copy`: GET `/pair` → 200; the body contains the token and `navigator.clipboard.writeText`. With `Host: evil.example` → 400.
  - `package.test.ts`: a `listPackageFiles(manifest, fsExists)` exported from `scripts/package.mjs`'s sibling `scripts/packageFiles.mjs` returns every manifest-referenced path. A missing icon → throws naming it.
- [ ] **Step 2: Run them.** Expected: FAIL.
- [ ] **Step 3: Implement.** Run `node scripts/make-icons.mjs` and commit the PNGs. In `README.md`:
  - a new top section "Install from the Chrome Web Store / first run", covering the 3 setup steps;
  - the old helper setup moved under "Local helper mode (advanced)", including "Connect" via `/pair`;
  - "Publishing" pointing to spec §10 and `docs/store-listing.md`.
- [ ] **Step 4: Run** `cd helper && .venv/Scripts/python -m pytest -q`, then `cd extension && npx vitest run && npx tsc --noEmit && npm run package`. Expected: all pass, and `extension/meet-notes-0.2.0.zip` exists. Add `extension/*.zip` to `.gitignore`.
- [ ] **Step 5: Commit** as `feat: helper pairing page, icons, store package and listing docs`.

---

## Manual checks for Sina after the build (not automatable here)

1. Load `extension/` unpacked after removing the old version. Do the 3-step setup with your real key, as Technical with `D:\kifepool` and `D:\tashilcar`; the folder picker takes one folder, so choose `D:\` or one of them.
2. Record a 3–5 minute Meet. Press Stop. The notification "Notes ready" should appear; open the meeting page and check all 4 tabs, Copy, Open in Gmail, and Download .zip.
3. Close Chrome during processing, reopen it, and check that processing resumes.
4. Record a short Daily with at least one other person, and check the per-person summary and the speaker names.
5. Turn on the local helper in Advanced, then Connect via `/pair`, and record a short meeting. It should land in the helper as in v1.
