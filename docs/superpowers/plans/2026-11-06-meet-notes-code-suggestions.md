# Code-Location Suggestions: Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** After a grooming/planning/technical meeting, search the user's services folder for the meeting's technical keywords and add evidence-backed "which service to change" suggestions to the notes (service names in the Persian email, file paths only in the AI notes), behind a Settings switch that is off by default.

**Architecture:** A new resumable pipeline step `code` between `screens` and `notes`: one cheap OpenRouter call extracts keywords from the transcript, a bounded local walk of the saved `FileSystemDirectoryHandle` collects masked evidence, the result is stored on the meeting record as `codeSearch`, and the notes prompt gets a `## Code evidence` section plus template rules for the two suggestion sections.

**Tech Stack:** Chrome MV3, TypeScript strict, vitest (fake directory handles, fake-indexeddb), existing OpenRouter client.

**Spec:** `docs/superpowers/specs/2026-11-06-meet-notes-code-suggestions-design.md` (builds on `docs/superpowers/specs/2026-11-06-meet-notes-store-design.md`). Read both.

## Global Constraints

- Branch `feat/store-extension` (continue on it). Every commit ends with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- Gate in `extension/`: `rtk proxy npx vitest run && npx tsc --noEmit && npm run build` (use `rtk proxy` for vitest).
- Feature runs only when ALL hold: `settings.codeSuggestions === true` (default **false**, also for existing installs), `settings.role === "technical"`, a services handle is saved, meeting type ∈ {grooming, planning, technical} (never daily), and `queryPermission({mode:"read"}) === "granted"`.
- Offscreen documents only have `chrome.runtime` (store-spec ruling R5); the pipeline gets settings via its provider and reads the handle from IndexedDB (`getHandle("services")`).
- Keyword call uses `settings.models.transcribe`; ≤ 12 keywords; Latin script; generic words excluded.
- Search limits: 20 000 files, 200 MB read, 20 s, 512 KB per file; top 3 services × 5 files × 2 lines × 200 chars.
- Skip dirs: `.git node_modules vendor dist build bin obj target coverage __pycache__ .idea .vscode` and any dir starting with `.`. Read extensions: `.go .ts .tsx .js .jsx .py .php .java .kt .cs .rb .rs .proto .sql .toml .yaml .yml .json .xml .md .graphql` and `Dockerfile`. Never read `.env*`, `*.pem`, `*.key`, names containing `secret` or `credential`, lockfiles (`*.lock`, `package-lock.json`, `go.sum`, `yarn.lock`, `pnpm-lock.yaml`).
- Config files (`.toml .yaml .yml .json .xml`, `Dockerfile`) contribute **paths only**, never lines. Every snippet line is masked before it is stored or sent.
- **Email summary: service names only, never file paths; section omitted when there is no evidence or the step was skipped.** AI notes carry paths. Suggestions are always labelled as AI suggestions and never presented as said or decided.
- Exact copy: email section title `سرویس‌های احتمالی برای تغییر (پیشنهاد AI)`; notes section `## Where to look in the code (AI suggestion)`; empty `No matching code found.`; skipped `Code search skipped (<reason>).`; setting label `Suggest where to change the code`; step text `Searching your code…`.

## Review Focus

1. **A secret in a matching line** (`KAVENEGAR_API_KEY = "4F3A…"`, `"apiKey": "…"`, a bearer token in Go code) never reaches the record or OpenRouter. *Test: Task 1 `masksAssignmentsAndLongTokens`, Task 2 `configFilesGivePathsOnly`.*
2. **A huge folder** (vendored monorepo) can't stall processing: the walk stops at the time/file/byte limits and still returns what it found with `limitHit: true`. *Test: Task 2 `stopsAtLimitsAndKeepsResults`.*
3. **The switch is off or the user is a PM / Daily meeting**: no keyword call, no folder access, record says skipped, email unchanged. *Test: Task 3 `skipsWithoutCallingWhenOff`, `skipsDaily`.*
4. **Permission dropped after a restart**: step skipped with the existing services notice, so Allow & Retry re-runs it. *Test: Task 3 `noPermissionSetsNoticeAndSkips`; Task 3 Allow & Retry clears `codeSearch`.*
5. **Keyword output malformed** (prose, non-JSON, Persian words): parsed defensively; garbage yields an empty list → `done` with no services, never an error that fails the meeting. *Test: Task 1 `parseKeywordsDefensive`.*

---

## Shared types (Task 1 adds them to `extension/src/types.ts` / `lib/settings.ts`)

```ts
export type Step = "chunking" | "transcribing" | "speakers" | "screens" | "code" | "notes" | "done";
export interface CodeFile { path: string; snippets: string[] }      // path relative to the services folder, "/"-separated, starts with the service dir
export interface CodeService { service: string; keywords: string[]; files: CodeFile[] }
export type CodeSkipReason = "off" | "not-technical" | "no-folder" | "daily" | "no-permission";
export type CodeSearch =
  | { status: "skipped"; reason: CodeSkipReason }
  | { status: "done"; keywords: string[]; services: CodeService[]; limitHit: boolean };
// MeetingRecord gains:  codeSearch?: CodeSearch;
// Settings gains:       codeSuggestions: boolean;   // default false
```

---

### Task 1: Types, setting, secret masking, keyword extraction

**Files:**
- Modify: `extension/src/types.ts`, `extension/src/lib/settings.ts`
- Create: `extension/src/lib/redact.ts`, `extension/src/lib/codeKeywords.ts`
- Test: `extension/tests/redact.test.ts`, `extension/tests/codeKeywords.test.ts`, `extension/tests/settings.test.ts` (extend)

**Interfaces:**
- Produces:
  - `redact.ts`: `maskSecrets(line: string): string`; `isConfigFile(name: string): boolean`; `isForbiddenFile(name: string): boolean` (secret-prone + lockfiles per Global Constraints); `READ_EXTENSIONS: ReadonlySet<string>`; `isReadable(name: string): boolean` (extension in READ_EXTENSIONS or name `Dockerfile`, and not forbidden).
  - `codeKeywords.ts`: `KEYWORDS_PROMPT: string`; `MAX_KEYWORDS = 12`; `parseKeywords(raw: string): string[]`; `extractKeywords(key: string, model: string, transcriptMd: string, screens: ScreenDesc[], complete: typeof import("./openrouter").complete): Promise<{ keywords: string[]; cost: number }>`.
- Masking rules (`maskSecrets`): (a) after a name containing (case-insensitive) `key|token|secret|password|passwd|pwd|auth|credential|bearer` followed by `=`, `:`, `:=` or a JSON `"…":`, replace the value (quoted string or the next non-space run) with `***`; (b) replace any run of ≥ 20 chars from `[A-Za-z0-9+/=_-]` that contains at least one letter and one digit with `***`; (c) leave other text unchanged.
- `parseKeywords`: take the first `[`…last `]` JSON array (like `parseChunkOutput`); on any failure return `[]`; keep strings, lowercase, trim, keep only `/^[a-z0-9][a-z0-9_.\-]{1,39}$/`; drop generic words `service, services, page, button, data, code, file, user, users, system, api, app, application, front, frontend, back, backend, design, figma, test`; dedupe in order; cap 12.
- `KEYWORDS_PROMPT`: asks for ONLY a JSON array of ≤ 12 lowercase Latin search terms likely to appear in source code or config for the work discussed (provider/library/service/domain identifiers); Persian-spoken English or brand terms in their Latin spelling (e.g. کاوه‌نگار → kavenegar); exclude generic words; no prose.

- [ ] **Step 1: Write failing tests.** `redact.test.ts`: `masksAssignmentsAndLongTokens` — `KAVENEGAR_API_KEY = "4F3A9C2B1D0E8F7A6B5C"` → no `4F3A`; `"apiKey": "abc"` → `"apiKey": ***` (value masked); `Authorization: Bearer eyJhbGciOi12345678901234` → no `eyJ`; `client := kavenegar.New(cfg.Token)` unchanged except nothing (no secret); `func SendDeliveryStatus()` unchanged. `fileRules` — `isConfigFile("conf.toml")`, `isForbiddenFile(".env.local")`, `isForbiddenFile("go.sum")`, `isForbiddenFile("aws-credentials.json")`, `isReadable("informing.go")`, `isReadable("Dockerfile")`, `!isReadable("logo.png")`. `codeKeywords.test.ts`: `parseKeywordsDefensive` — fenced array with prose → kept; `"not json"` → `[]`; Persian items dropped; generic words dropped; 20 items → 12; duplicates and case folded; `extractKeywordsSendsTranscriptAndPrompt` (fake complete records model and text; returns parsed + cost). `settings.test.ts`: `codeSuggestionsDefaultsFalse` (empty storage and v1-keys storage both false).
- [ ] **Step 2: Run** `rtk proxy npx vitest run tests/redact.test.ts tests/codeKeywords.test.ts tests/settings.test.ts` → FAIL.
- [ ] **Step 3: Implement** types, setting default, `redact.ts`, `codeKeywords.ts`.
- [ ] **Step 4: Run** the gate → PASS.
- [ ] **Step 5: Commit** `feat(extension): secret masking and meeting keyword extraction for code search`.

### Task 2: Bounded code search with evidence ranking

**Files:**
- Create: `extension/src/lib/codeSearch.ts`
- Test: `extension/tests/codeSearch.test.ts`

**Interfaces:**
- Consumes: `redact.ts` (Task 1); the directory-iteration pattern and single-repo detection of `extension/src/lib/servicesContext.ts` (reuse its helpers if exported; otherwise export them from there rather than duplicating).
- Produces:
  ```ts
  export interface CodeLimits { maxFiles: number; maxBytes: number; maxMs: number; maxFileBytes: number; topServices: number; filesPerService: number; linesPerFile: number; lineChars: number }
  export const CODE_LIMITS: CodeLimits; // 20000, 200*1024*1024, 20000, 512*1024, 3, 5, 2, 200
  export function searchCode(dir: FileSystemDirectoryHandle, keywords: string[], limits?: CodeLimits, now?: () => number): Promise<{ services: CodeService[]; limitHit: boolean }>;
  ```
- Behaviour: services = top-level subdirs (or the folder itself when it is a single repo, same rule as `servicesContext.ts`). Depth-first walk skipping the skip-dirs; only `isReadable` files; files over `maxFileBytes` skipped (not read). For each file: keyword hits in the path (case-insensitive) and, for non-config files, the matching lines (first `linesPerFile` lines containing any keyword, trimmed to `lineChars`, `maskSecrets` applied). Config files: path match or content match both count, but snippets stay `[]`. Score per service: (distinct keywords matched, where a path match counts double) then total hits; per service keep up to `filesPerService` files, path-matching files first, then by hits. Return top `topServices` services with ≥ 1 hit; `CodeService.keywords` = distinct matched keywords; paths are `<service>/<relative path>`. Stop walking when files visited ≥ maxFiles, bytes read ≥ maxBytes, or `now() - start ≥ maxMs`; set `limitHit`. Empty keyword list → `{services: [], limitHit: false}` without walking.

- [ ] **Step 1: Write failing tests** with fake handles (same style as `tests/servicesContext.test.ts`): `findsKavenegarInMaserati` (tree mirroring `maserati/plugins/kavenegar/informing.go` with `func Send(...)` line mentioning kavenegar, `audi/main.go` unrelated → services `["maserati"]`, file path `maserati/plugins/kavenegar/informing.go` first, snippet contains `kavenegar`); `configFilesGivePathsOnly` (`maserati/configs/conf.toml` containing `kavenegar_api_key = "X…"` → listed with `snippets: []`); `snippetsAreMasked`; `skipsVendorNodeModulesAndDotDirs`; `neverReadsSecretFilesOrLockfiles` (fake `getFile` throws if `.env` or `go.sum` is read); `skipsLargeFiles` (size 600 KB never read); `rankingAndCaps` (4 services → top 3; 8 matching files → 5, path matches first; 5 matching lines → 2, each ≤ 200 chars); `stopsAtLimitsAndKeepsResults` (fake `now` advancing 1 s per file with `maxMs: 3000` → `limitHit: true` and the hits found so far); `emptyKeywordsNoWalk`; `singleRepoFolder`.
- [ ] **Step 2: Run** `rtk proxy npx vitest run tests/codeSearch.test.ts` → FAIL.
- [ ] **Step 3: Implement** `codeSearch.ts`.
- [ ] **Step 4: Run** the gate → PASS.
- [ ] **Step 5: Commit** `feat(extension): bounded local code search with masked evidence`.

### Task 3: Pipeline step, notes prompt and templates

**Files:**
- Modify: `extension/src/lib/pipeline.ts`, `extension/src/lib/notes.ts`, `extension/src/lib/templates.ts`, `extension/src/lib/popupView.ts`, `extension/src/meeting.ts`, `extension/src/offscreen.ts`
- Test: `extension/tests/pipeline.test.ts`, `extension/tests/notes.test.ts`, `extension/tests/popupView.test.ts` (extend)

**Interfaces:**
- Consumes: Tasks 1–2; `SERVICES_NOTICE` from `lib/servicesSnapshot.ts`; `getHandle` from `lib/db.ts`.
- Produces:
  - `PipelineDeps` gains `codeDir: () => Promise<{ status: "ok"; dir: FileSystemDirectoryHandle } | { status: "none" } | { status: "no-permission" }>` and `searchCode: typeof searchCode`, `extractKeywords: typeof extractKeywords`. `defaultPipelineDeps(settings)` wires `codeDir` as: `getHandle("services")` → none if absent; `queryPermission({mode:"read"})` → `"granted"` ok, else no-permission.
  - `notes.ts`: `renderCodeEvidence(cs: CodeSearch | undefined): string` and `buildNotesPrompt(rec, transcriptMd, screens, servicesContext, codeSearch?: CodeSearch)` appending `## Code evidence\n…` after `## Services context`. Rendering: undefined → `(code search not run)`; skipped → `(code search skipped: <reason>)`; done with no services → `(no matching code found)`; done → per service `### <service> (matched: k1, k2)` then `- <path>` lines each followed by indented snippet lines `    > <snippet>`; plus `(search stopped at a limit; results may be partial)` when `limitHit`.
- Pipeline `code` step, after `screens`, before `notes`, only `if (!rec.codeSearch)`: set `step: "code"`; decide skip reason in this order: type daily → `daily`; `!settings.codeSuggestions` → `off`; role ≠ technical → `not-technical`; `codeDir()` none → `no-folder`; no-permission → `no-permission` **and** `servicesNotice: SERVICES_NOTICE`; else `extractKeywords(key, models.transcribe, renderTranscriptMd(turns), screens, deps.complete)` (cost added) → `searchCode(dir, keywords)` → `{status:"done", keywords, services, limitHit}`. A thrown error inside keywords/search (other than `OpenRouterError`) stores `{status:"done", keywords: [], services: [], limitHit: false}` and continues (never fails the meeting); an `OpenRouterError` fails the step like other OpenRouter errors. Then the notes step passes `rec.codeSearch`.
- Templates: in `STANDARD` (not `DAILY`):
  - Summary instruction gains: "If `## Code evidence` lists services, end the summary with a section titled `سرویس‌های احتمالی برای تغییر (پیشنهاد AI)`: one line per service — the service name and a short Persian reason based on the evidence. Service names only; never file paths. Make clear these are AI suggestions from the code, not something said in the meeting. If the code evidence is empty, skipped or not run, omit this section entirely."
  - Notes sections gain `9. ## Where to look in the code (AI suggestion)` — per suggested service: the service, the file paths from the evidence, and why they match (which keywords, what the snippet shows). If the evidence lists no services write `No matching code found.`; if skipped or not run write `Code search skipped (<reason>).`; if partial, say so.
  - Tasks rule: "Service/Repo may be `<service> (suggested)` only when the code evidence clearly ties that task to that service; otherwise `?` (or the name actually said)."
  - RULES line about the services context is amended to: "use the services context only to correct names; suggestions about where code lives come only from `## Code evidence`, only in the sections above, labelled as AI suggestions, never presented as said or decided; never add tasks, owners, estimates or decisions not present in the transcript…" (keep the existing `?` clause).
- `popupView.stepText`: `case "code": return "Searching your code…";`.
- `meeting.ts` Allow & Retry: the patch that clears `servicesContext/servicesNotice/notesMd/summaryMd` also clears `codeSearch` (`codeSearch: undefined`).
- `offscreen.ts`: nothing beyond passing `defaultPipelineDeps(fetchSettings)` (already) — confirm the new deps need no `chrome.*` besides runtime.

- [ ] **Step 1: Write failing tests.** `pipeline.test.ts` (fake deps with `codeDir`, `searchCode`, `extractKeywords` spies): `codeStepDoneFeedsNotesPrompt` (technical + on + ok dir → `codeSearch.status === "done"`, notes prompt contains `## Code evidence` and `maserati`); `skipsWithoutCallingWhenOff` (off → `{skipped,"off"}`, `extractKeywords`/`searchCode`/`codeDir` not called); `skipsDaily`; `skipsNotTechnical`; `noFolderSkips`; `noPermissionSetsNoticeAndSkips` (`servicesNotice === SERVICES_NOTICE`); `searchErrorDoesNotFailMeeting` (searchCode throws → ready, `services: []`); `keywordOpenRouterErrorFailsStep` (402 → error with credit message, `codeSearch` absent so Retry re-runs); `resumeSkipsDoneCodeStep` (existing `codeSearch` → not re-run); keyword cost added to `costUsd`. `notes.test.ts`: `renderCodeEvidenceStates` (4 states + limitHit line); `standardTemplatesHaveSuggestionRules` (grooming/planning/technical contain the Persian section title, `## Where to look in the code (AI suggestion)`, `never file paths`; `daily` contains neither). `popupView.test.ts`: `stepTextCode`.
- [ ] **Step 2: Run** the focused tests → FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** the gate → PASS.
- [ ] **Step 5: Commit** `feat(extension): suggest where to change the code in meeting notes`.

### Task 4: Settings switch and privacy texts

**Files:**
- Modify: `extension/src/settings.html`, `extension/src/settings.ts`, `docs/privacy-policy.md`, `docs/store-listing.md`, `README.md`
- Test: `extension/tests/settingsPage.test.ts` (extend with a pure helper)

**Interfaces:**
- Produces: pure `codeSwitchState(s: Settings, hasFolder: boolean): { checked: boolean; disabled: boolean; hint: string | null }` exported from `extension/src/lib/codeSwitch.ts` — disabled with hint `Choose a services folder first.` when no folder; hint `Only for the Technical role.` when role ≠ technical (disabled too); otherwise enabled, `checked = s.codeSuggestions`.
- Settings page, Services folder section: a toggle labelled `Suggest where to change the code`, with the copy from the spec §6.5 verbatim ("After each grooming, planning or technical meeting, Meet Notes searches your folder's code for words from the meeting and suggests which services the work belongs to. Short snippets around matching lines are sent to OpenRouter with the meeting. Config files contribute only their paths."). Toggling saves `codeSuggestions` immediately. The existing folder copy ("reads only folder names, README files and package manifests…") gains: "With the switch below on, it also searches the code."
- Privacy policy: the services-folder item adds "If you turn on “Suggest where to change the code”, short snippets of matching lines from your folder's code (secrets masked; config files only by name) are sent to OpenRouter with the meeting." Store listing: same in data disclosures and the detailed description. README store section: one line about the switch.

- [ ] **Step 1: Write failing test** `codeSwitchStates` (no folder; pm role; technical on; technical off).
- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Implement** helper, page toggle, docs.
- [ ] **Step 4: Run** the gate and `npm run package` → PASS.
- [ ] **Step 5: Commit** `feat(extension): settings switch for code suggestions; privacy texts`.
