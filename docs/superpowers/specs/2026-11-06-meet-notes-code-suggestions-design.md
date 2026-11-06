# Meet Notes: "Where to look in the code" suggestions — Design

Date: 2026-11-06
Status: draft, waiting for approval
Builds on: `docs/superpowers/specs/2026-11-06-meet-notes-store-design.md` (the "store spec"). Everything there still holds unless this document changes it.

## 1. Intent

In a real grooming on 2026-11-06, Sina discussed a story about SMS delivery status from Kavenegar, and said he didn't remember which service handles SMS. The notes said `Service: ?`. Sina had given the extension his services folder (`D:\tashilcar`), but the extension only reads folder names, READMEs and package manifests to spell names correctly. Those READMEs are about 330 bytes each, so the AI saw only car-brand service names and could not know that `maserati/plugins/kavenegar/informing.go` is where Kavenegar is handled. A plain text search of the folder finds it immediately.

Sina wants the meeting notes to say **where in the code the work probably lives**, so the team email tells people which service to change.

**The why:** a grooming is only useful if someone can pick up the story. "Which service do I change?" is the first question a developer asks, and the answer is usually findable in the code from the words people used in the meeting.

## 2. Goals

- After transcription, find the technical keywords of the meeting (service names, providers, libraries, API and domain terms), including Latin forms of Persian-spoken English/brand terms (کاوه‌نگار → Kavenegar).
- Search the user's services folder for those keywords, inside Chrome, with strict limits.
- Turn the matches into **suggestions with evidence**:
  - **Summary (Persian email):** a short section listing the suggested **service names only**, each with a one-line reason, clearly marked as an AI suggestion. **No file paths in the email** (Sina's decision).
  - **AI notes (English):** a section "Where to look in the code (AI suggestion)" with service, file paths and why each matched. In the Tasks table, the Service/Repo column may say `<service> (suggested)` when the evidence ties that task to that service.

## 3. Non-goals

- Local helper mode (Claude Code). Built-in extension only, for now (Sina's decision).
- Daily standups. Only grooming, planning and technical meetings.
- Non-technical (PM) users and users without a services folder: nothing changes for them.
- Code changes, diffs or implementation plans. The feature points to places; it doesn't propose code.
- Searching outside the chosen folder, or any remote repository.

## 4. Anti-goals (failure even if it works)

The store spec's anti-goals still hold. One is **amended**, deliberately:

- **Old:** "The notes invent services… The services folder is used only to match names, never to add content."
- **New:** the notes may add **service suggestions**, but **only** in the dedicated suggestion sections (and as `<service> (suggested)` in the Tasks table), **only** when backed by code evidence found by the search, and always **labelled as an AI suggestion**. They are never presented as something said or decided in the meeting. Everything else about "never invent" is unchanged: no invented tasks, owners, estimates or decisions, and no service suggestion from a name alone.

New for this feature:

- **A suggestion without evidence.** If the search finds nothing, there is no suggestion — never a guess from service names. (The email leaves the section out; the AI notes say "No matching code found.")
- **Code leaves the computer without the user switching it on.** The feature is off until each user turns it on in Settings.
- **Whole files or secrets sent to OpenRouter.** Only short snippets around matching lines go out, capped in size, and files that commonly hold secrets are never read (see §6).
- **File paths in the email summary.**
- **A slow or stuck meeting** because of a huge folder. The search has hard limits and a time budget; when it hits them it stops and uses what it found.

## 5. Constraints

- Runs inside the extension's offscreen document (store spec R5: only `chrome.runtime` there; settings come from the background). Folder access uses the saved `FileSystemDirectoryHandle`; at processing time only `queryPermission` is possible (no user gesture). If permission isn't granted, the step is skipped and the existing "Made without your services folder — Allow & Retry" notice is shown; Allow & Retry must also re-run this step.
- Must be resumable like every other pipeline step (store spec §7.3): its output is stored on the meeting record before notes start, and a retry doesn't redo it unless it was cleared.
- Folders can be large monorepos (Sina's `D:\tashilcar` has 15 Go services with vendored code). The search must be bounded in files, bytes and time.
- Cost: at most one extra small OpenRouter call per meeting (keyword extraction).

## 6. How it works

```
 ... speakers → screens → [code: keywords → search → evidence] → notes ...
```

1. **Keywords** (new OpenRouter call, using the transcription model — cheap, multilingual):
   - Input: the merged transcript (and screenshot descriptions).
   - Output: a JSON array of up to 12 search terms, Latin script, each a word or identifier likely to appear in code or config (`kavenegar`, `sms`, `delivery`, `status`, `polling`, …). Persian-spoken English or brand terms are given in their Latin spelling. Generic words (`service`, `page`, `button`, `data`) are excluded.
   - The cost is added to the meeting cost like other calls.
2. **Search** (local, in the offscreen document):
   - Walk the services folder. A service is a top-level subdirectory (or the folder itself if it is a single repo — same rule as the store spec's services context).
   - Skip directories: `.git`, `node_modules`, `vendor`, `dist`, `build`, `bin`, `obj`, `target`, `coverage`, `__pycache__`, `.idea`, `.vscode`, and any directory starting with `.`.
   - Read only text files with these extensions: `.go .ts .tsx .js .jsx .py .php .java .kt .cs .rb .rs .proto .sql .toml .yaml .yml .json .xml .md .graphql`, and `Dockerfile`. Never read `.env*`, `*.pem`, `*.key`, `*secret*`, `*credential*` files, lockfiles, or files over 512 KB.
   - Match keywords case-insensitively as substrings, against **file paths and file contents**.
   - Limits: at most 20 000 files visited, 200 MB read, and 20 seconds; whichever comes first ends the search, keeping what was found.
3. **Evidence** (local ranking):
   - Score each service by distinct keywords matched (path matches count double), then by hit count.
   - Keep the top 3 services; for each, up to 5 files (path-matching files first), each with up to 2 matching lines (trimmed to 200 characters) as snippets.
   - Store on the meeting record: keywords, the ranked evidence, and whether a limit was hit.
4. **Notes**: the notes prompt gets a `## Code evidence` section (the ranked evidence) and the template rules for the two suggestion sections. If evidence is empty, the prompt says so and the sections say "No matching code found."

The step runs only when: the user has turned on **"Suggest where to change the code"** in Settings (off by default, §6.5), role is Technical, a services folder is saved, the meeting type is grooming, planning or technical, and folder permission is granted. Otherwise it is skipped (with the existing notice when the only problem is permission).

5. **The switch** (Sina's decision): a new setting `codeSuggestions: boolean`, **default off** for everyone, including existing installs. It lives on the Settings page in the Services folder section, as a toggle labelled "Suggest where to change the code", with the copy: "After each grooming, planning or technical meeting, Meet Notes searches your folder's code for words from the meeting and suggests which services the work belongs to. Short snippets around matching lines are sent to OpenRouter with the meeting. Config files contribute only their paths." The toggle is disabled (with a hint) while no folder is chosen. Nothing else in the UI changes.

6. **Secrets** (Claude's call, see §8): config-type files (`.toml .yaml .yml .json .xml`, `Dockerfile`) contribute **paths only**, never lines. In every snippet line, the value after a key/token/password/secret/apikey/auth-like name (`=`, `:` or `"…":` forms) is replaced with `***`, and any run of 20+ characters drawn from `[A-Za-z0-9+/=_-]` that mixes letters and digits is replaced with `***`. Masking happens before anything is stored on the record or sent.

7. **Stored states** (Claude's call): the record holds one of: field absent (not run yet — Retry/Allow & Retry runs it), `{status:"skipped", reason}` (switch off, not Technical, no folder, daily, or no permission), or `{status:"done", keywords, services:[…], limitHit}` (possibly with no services). Allow & Retry clears it so the step runs again with the folder. The `limitHit` flag only goes into the prompt (the notes may say the search was partial); no UI.

## 7. Decided by Sina

| Topic | Decision |
|---|---|
| Purpose | Notes say which service to change, to send in the email |
| Email | Suggested **service names** may be in the email; **file paths only in the AI notes** |
| Labelling | Suggestions are clearly the AI's, with evidence |
| Scope | Built-in extension only; not helper mode for now |
| Consent | A switch in Settings that each person turns on themselves (off by default) |

## 8. Calls made by Claude (Sina can override)

- Daily standups are excluded.
- Keyword extraction uses the transcription model (`google/gemini-2.5-flash` by default), not the notes model, to keep cost low.
- The limits in §6 (12 keywords, 20 000 files, 200 MB, 20 s, 512 KB/file, top 3 services × 5 files × 2 lines × 200 chars).
- Secret-prone files are never read (§6.2), even inside the chosen folder.
- Email wording: a section titled «سرویس‌های احتمالی برای تغییر (پیشنهاد AI)» with lines like «maserati — احتمالاً محل پیاده‌سازی Kavenegar و ارسال پیامک».
- The privacy policy and store listing are updated: "short code snippets around matching lines from your services folder are sent to OpenRouter with the meeting".
- The settings page's services-folder copy is updated to say the folder's code is searched for words from the meeting.
- The meeting page needs no new UI: the suggestions are part of the Summary and AI notes text.
- Secrets (§6.6): config files give paths only; key/token/password/secret values and long random strings in snippet lines are masked as `***` before storing or sending.
- Empty or skipped (§6.7): the **email summary omits the suggestion section entirely**; only the AI notes say "No matching code found." or "Code search skipped (<reason>)."

## 9. Left to the builder

- Prompt wording for keyword extraction and for the two suggestion sections (within the rules above).
- How the walk is scheduled to stay responsive (chunked async iteration is fine; the offscreen document has no UI).
- The exact record field names and the test approach — use fake directory handles like the existing services-context tests, and mock OpenRouter.
