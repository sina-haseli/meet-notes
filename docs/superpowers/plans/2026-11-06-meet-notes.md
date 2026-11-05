# Meet Notes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Record Google Meet meetings, held in Persian with English technical terms, and turn each one into a speaker-attributed transcript, a Persian email summary and an English AI-ready `notes.md`. Sina reviews everything on a local page and then sends it through Gmail.

**Architecture:** A Chrome MV3 extension captures tab audio mixed with the mic, screenshots when the screen changes, and a speaker log from Meet's DOM. It uploads them to a local Python helper on `127.0.0.1:47821`. The helper splits the audio into chunks, then:
- transcribes the chunks and describes the screenshots through OpenRouter,
- maps voice labels to names,
- runs Claude Code headless (`claude -p`, read-only, with the repos added) to write the email summary and the notes,
- serves the review page (Option A),
- sends the email through Gmail.

**Tech Stack:**
- Helper: Python 3.12, FastAPI, uvicorn, httpx, ffmpeg (CLI), markdown, google-api-python-client + google-auth-oauthlib, pytest, respx
- Extension: TypeScript, esbuild, vitest
- Review page: vanilla HTML/JS

**Spec:** `docs/superpowers/specs/2026-11-06-meet-notes-design.md`

## Global Constraints

- Nothing is emailed unless Sina presses **Send** on the review page.
- English technical terms stay in Latin script, verbatim. They are never translated or transliterated, and every prompt must say so.
- Uncertain speaker attribution is shown as uncertain (`uncertain: true`, rendered as `(uncertain)`). It is never presented as fact.
- Repo context is used only to normalize names. The notes prompt must forbid adding services, owners, estimates or decisions that weren't said. Unknown values are written as `?`.
- Data leaves the PC only to OpenRouter, Anthropic (through Claude Code) and Gmail.
- Claude is called only through the `claude` CLI on Sina's Pro login. Never use an Anthropic API key.
- When Claude Code fails, show the error and a Retry button. Never fall back to another model.
- `notes.md` is written in **English**, `email.md` in **Persian** (keeping English terms), and the transcript as spoken.
- Helper address: `127.0.0.1:47821`. Every `/api/*` call needs the header `X-MeetNotes-Token: <config.token>`.
- Config lives at `%APPDATA%\meetnotes\config.toml`. Default `notes_root = "D:\\meeting-notes"`, `repos = ["D:\\kifepool"]`.
- Meeting folder: `<notes_root>/YYYY-MM-DD_<type>_<slug>/`.
- Audio chunks are 600 s long with a 5 s overlap.
- Raw audio (`audio.webm`, `chunks/`) is deleted after a successful send.
- The OpenRouter cost per meeting is recorded in `meta.json` (`cost_usd`). Target: under $0.50 per meeting hour.
- Meeting types are exactly `grooming`, `planning`, `technical`.

## Review Focus

1. **The helper isn't running (or crashes) when Sina presses Stop.** The recording must not be lost. The offscreen document keeps the recording, retries the upload, and the popup shows "Upload failed — Retry". This is pinned in Task 11 (`uploadWithRetry`) and Task 12.
2. **A very short or very long meeting** (5 s, or over 2 h). Chunking must produce 1 chunk for the short one and the right count for the long one, with the last chunk shorter. This is pinned in Task 2.
3. **The model returns malformed or fenced JSON for a chunk.** Strip the fences and parse. If parsing still fails, retry the chunk once, then fail with an error that names the chunk. The meeting stays retryable. This is pinned in Task 3 and Task 7.
4. **Renaming a speaker to a name that already exists, or to a name with regex characters.** The two labels merge, and nothing crashes or corrupts the text. This is pinned in Task 9.
5. **Claude Code is missing from PATH, isn't logged in, or hits Pro limits.** Show a clear error naming the cause, keep the meeting in `error` with a working Retry, and send no email. This is pinned in Task 6.

---

## File Structure

```
persian_transacribe/
  helper/
    pyproject.toml
    meetnotes/
      __main__.py        # runs uvicorn on 127.0.0.1:47821
      config.py          # Config dataclass, load/save TOML, token generation
      store.py           # meeting folder layout, slug, meta.json, list meetings
      audio.py           # ffmpeg probe + chunking
      openrouter.py      # OpenRouter HTTP client (audio transcription, image description, cost)
      transcript.py      # Turn model, parse model JSON, merge chunks, render transcript.md
      speakers.py        # map (chunk, voice label) -> participant name
      screens.py         # describe screenshots, write screens.json
      notes.py           # build Claude Code prompt, run `claude -p`, split output
      templates/{grooming,planning,technical}.md
      pipeline.py        # step orchestration, status, retry, cost
      mailer.py          # build MIME, send via Gmail API or SMTP
      server.py          # FastAPI app + static review page
      review/{index.html,meeting.html,app.js,style.css}
    tests/ (one test file per module, fixtures/)
    scripts/bench_models.py   # compare transcription models on a real meeting
    scripts/install-startup.ps1
  extension/
    package.json, tsconfig.json, build.mjs, manifest.json
    src/types.ts
    src/lib/frameDiff.ts        # pure: grayscale thumbnail diff
    src/lib/speakingDetector.ts # pure: mic level -> self-speaking intervals
    src/lib/intervalTracker.ts  # pure: speaking-name snapshots -> intervals
    src/lib/upload.ts           # build FormData, uploadWithRetry
    src/popup.html, src/popup.ts
    src/permission.html, src/permission.ts   # one-time mic permission
    src/background.ts           # service worker: session state, offscreen lifecycle
    src/offscreen.html, src/offscreen.ts     # recording, mixing, frame sampling, upload
    src/content/meetSelectors.ts             # ALL Meet DOM selectors live here
    src/content/speakerLog.ts                # content script
    tests/*.test.ts
  README.md
```

## Shared data contracts (used by several tasks)

**Upload** `POST /api/meetings`, multipart, with these fields:
- `meta`: JSON `{"title": str, "type": "grooming"|"planning"|"technical", "started_at": ISO-8601 str, "duration_ms": int, "self_name": str, "participants": [str]}`
- `speaker_log`: JSON `[{"name": str, "start_ms": int, "end_ms": int}]`, relative to the recording start
- `audio`: `audio/webm` (opus)
- `screens`: 0..n files, each named `<elapsed_ms>.jpg`

The response is `{"id": "<meeting folder name>"}`.

**meta.json:**
```json
{"id": "...", "title": "...", "type": "grooming", "started_at": "...", "duration_ms": 0,
 "self_name": "Sina", "participants": [], "status": "processing|ready|error|sent",
 "step": "chunking|transcribing|speakers|screens|notes|done", "error": null,
 "cost_usd": 0.0, "recipients": [], "sent_at": null}
```

**Turn** (in `transcript.json`): `{"start_ms": int, "end_ms": int, "speaker": str, "text": str, "uncertain": bool, "chunk": int, "label": str}`

---

### Task 1: Helper skeleton, config and meeting store

**Files:**
- Create: `helper/pyproject.toml`, `helper/meetnotes/__init__.py`, `helper/meetnotes/config.py`, `helper/meetnotes/store.py`, `.gitignore`
- Test: `helper/tests/test_config.py`, `helper/tests/test_store.py`

**Interfaces:**
- Produces:
  - `Config` dataclass with these fields:
    - `token: str`, `notes_root: Path`, `repos: list[Path]`, `openrouter_api_key: str`
    - `transcribe_model: str = "google/gemini-2.5-flash"`, `vision_model: str = "google/gemini-2.5-flash"`
    - `self_name: str = "Sina"`, `last_recipients: list[str]`
    - `mail_method: Literal["gmail_api","smtp"] = "gmail_api"`, `mail_from: str`, `smtp_app_password: str`
  - `load_config(path: Path | None = None) -> Config`: creates the file with a fresh `secrets.token_hex(32)` token when it's missing.
  - `save_config(cfg: Config, path: Path | None = None) -> None`
  - `slugify(title: str) -> str`
  - `create_meeting(root: Path, meta: dict) -> Path`
  - `read_meta(folder: Path) -> dict`
  - `write_meta(folder: Path, **updates) -> dict`
  - `list_meetings(root: Path) -> list[dict]`: newest first
  - `meeting_dir(root: Path, id: str) -> Path`: raises `KeyError` when the id is unknown, and rejects any id containing `/`, `\` or `..`

- [ ] **Step 1: Run `git init` in `D:\projects\persian_transacribe`. Create `.gitignore` with `.superpowers/`, `node_modules/`, `dist/`, `__pycache__/`, `.venv/`, `*.webm`. Create `pyproject.toml` with the dependencies listed in the Tech Stack, plus `[tool.pytest.ini_options] testpaths=["tests"]`.**
- [ ] **Step 2: Write failing tests**

```python
def test_load_config_creates_file_with_token(tmp_path):
    cfg = load_config(tmp_path / "config.toml")
    assert len(cfg.token) == 64 and (tmp_path / "config.toml").exists()
    assert load_config(tmp_path / "config.toml").token == cfg.token
    assert cfg.notes_root == Path("D:/meeting-notes") and cfg.repos == [Path("D:/kifepool")]

def test_slugify_keeps_persian_and_strips_windows_illegal():
    assert slugify('Wallet top-up: v2 / "شارژ"') == "Wallet-top-up-v2-شارژ"
    assert slugify("   ") == "meeting"

def test_create_meeting_folder_name_and_collision(tmp_path):
    meta = {"title": "Sprint 12", "type": "planning", "started_at": "2026-11-06T10:00:00+03:30"}
    a = create_meeting(tmp_path, meta); b = create_meeting(tmp_path, meta)
    assert a.name == "2026-11-06_planning_Sprint-12" and b.name == "2026-11-06_planning_Sprint-12-2"
    m = read_meta(a)
    assert m["status"] == "processing" and m["step"] == "chunking" and m["cost_usd"] == 0.0 and m["id"] == a.name

def test_meeting_dir_rejects_traversal(tmp_path):
    with pytest.raises(KeyError): meeting_dir(tmp_path, "..\\x")
```

- [ ] **Step 3: Run `cd helper && pytest tests/test_config.py tests/test_store.py -v`. Expected: FAIL (ImportError).**
- [ ] **Step 4: Implement `config.py` and `store.py`.** Config path default is `Path(os.environ["APPDATA"])/"meetnotes"/"config.toml"`. Read it with `tomllib` and write it with `tomli_w`. `create_meeting` fills in every meta.json key from the contract above, plus an `id` equal to the folder name. The date comes from the date part of `started_at`.
- [ ] **Step 5: Run the tests again. Expected: PASS.**
- [ ] **Step 6: Commit** `feat(helper): config and meeting store`

---

### Task 2: Audio chunking

**Files:**
- Create: `helper/meetnotes/audio.py`
- Test: `helper/tests/test_audio.py` (uses ffmpeg to generate a sine wave in a fixture)

**Interfaces:**
- Produces:
  - `@dataclass Chunk(index: int, path: Path, offset_ms: int, duration_ms: int)`
  - `probe_duration_ms(path: Path) -> int` (uses ffprobe)
  - `split_audio(src: Path, out_dir: Path, chunk_s: int = 600, overlap_s: int = 5) -> list[Chunk]`: the output is mono 16 kHz mp3 at 32 kbps. Chunk *k* starts at `k*chunk_s` and lasts `chunk_s + overlap_s` (the last one is clipped to the end of the audio).

- [ ] **Step 1: Write failing tests**

```python
def test_short_audio_one_chunk(tmp_path, make_tone):      # fixture: make_tone(seconds) -> webm path
    chunks = split_audio(make_tone(5), tmp_path)
    assert len(chunks) == 1 and chunks[0].offset_ms == 0 and abs(chunks[0].duration_ms - 5000) < 300

def test_long_audio_chunk_offsets(tmp_path, make_tone):
    chunks = split_audio(make_tone(25), tmp_path, chunk_s=10, overlap_s=2)
    assert [c.offset_ms for c in chunks] == [0, 10000, 20000]
    assert abs(chunks[0].duration_ms - 12000) < 300 and abs(chunks[2].duration_ms - 5000) < 300
    assert all(c.path.suffix == ".mp3" and c.path.exists() for c in chunks)
```

- [ ] **Step 2: Run `pytest tests/test_audio.py -v`. Expected: FAIL.**
- [ ] **Step 3: Implement it with `subprocess.run(["ffmpeg","-y","-ss",...,"-t",...,"-i",src,"-ac","1","-ar","16000","-b:a","32k",out])` and read the actual duration back with `probe_duration_ms`.** If ffmpeg is missing from PATH, raise `RuntimeError("ffmpeg not found on PATH")`.
- [ ] **Step 4: Run the tests. Expected: PASS.**
- [ ] **Step 5: Commit** `feat(helper): audio chunking`

---

### Task 3: OpenRouter client and transcript model

**Files:**
- Create: `helper/meetnotes/openrouter.py`, `helper/meetnotes/transcript.py`
- Test: `helper/tests/test_openrouter.py` (respx), `helper/tests/test_transcript.py`

**Interfaces:**
- Consumes: `Chunk` (Task 2), `Config` (Task 1)
- Produces:
  - `class OpenRouter(api_key: str, client: httpx.Client | None = None)`
    - `.transcribe_chunk(chunk: Chunk, model: str) -> tuple[str, float]`: returns the raw model text and its cost in USD
    - `.describe_image(path: Path, model: str, prompt: str) -> tuple[str, float]`
  - `TRANSCRIBE_PROMPT: str`
  - `@dataclass Turn(start_ms, end_ms, speaker, text, uncertain=False, chunk=0, label="")`
  - `parse_chunk_output(raw: str, chunk: Chunk) -> list[Turn]`: raises `TranscriptParseError`
  - `merge_chunks(per_chunk: list[list[Turn]], chunk_s: int = 600, overlap_s: int = 5) -> list[Turn]`
  - `render_transcript_md(turns: list[Turn]) -> str`
  - `save_turns(folder, turns)`, `load_turns(folder) -> list[Turn]`: stored in `transcript.json`

- [ ] **Step 1: Check the live OpenRouter audio docs** (https://openrouter.ai/docs/features/multimodal/audio). Use `POST https://openrouter.ai/api/v1/chat/completions` with a user message whose content is `[{"type":"text","text":TRANSCRIBE_PROMPT},{"type":"input_audio","input_audio":{"data":<base64 mp3>,"format":"mp3"}}]` and `"usage":{"include":true}`. If the docs say chat completions no longer accepts `input_audio`, send the same content to `/api/v1/responses` instead. Record which one you chose in a code comment. Cost comes from `response["usage"]["cost"]`, or 0.0 if it's missing.
- [ ] **Step 2: Write failing tests**

```python
RAW = '```json\n[{"start":"00:03","end":"00:09","speaker":"S1","text":"این endpoint رو باید refactor کنیم"},' \
      '{"start":"01:02","end":"01:05","speaker":"S2","text":"۵ story point"}]\n```'

def test_parse_strips_fences_and_offsets(chunk_at_600s):
    turns = parse_chunk_output(RAW, chunk_at_600s)
    assert turns[0].start_ms == 603000 and turns[0].label == "S1" and turns[0].chunk == 1
    assert "endpoint" in turns[0].text and "refactor" in turns[0].text   # Latin terms preserved verbatim

def test_parse_garbage_raises(chunk_at_600s):
    with pytest.raises(TranscriptParseError): parse_chunk_output("sorry I can't", chunk_at_600s)

def test_merge_uses_overlap_midpoint():
    a = [Turn(598000, 604000, "S1", "end of a", chunk=0, label="S1")]
    b = [Turn(601000, 604000, "S1", "dup", chunk=1, label="S1"), Turn(603000, 610000, "S2", "b", chunk=1, label="S2")]
    merged = merge_chunks([a, b], chunk_s=600, overlap_s=5)
    assert [t.text for t in merged] == ["end of a", "b"]      # cutoff = 600000 + 2500

def test_transcribe_chunk_sends_audio_and_returns_cost(respx_mock, tiny_chunk):
    route = respx_mock.post("https://openrouter.ai/api/v1/chat/completions").respond(
        json={"choices":[{"message":{"content":"[]"}}], "usage":{"cost":0.0123}})
    text, cost = OpenRouter("k").transcribe_chunk(tiny_chunk, "m")
    body = json.loads(route.calls[0].request.content)
    assert body["messages"][0]["content"][1]["type"] == "input_audio" and cost == 0.0123 and text == "[]"
```

- [ ] **Step 3: Run `pytest tests/test_openrouter.py tests/test_transcript.py -v`. Expected: FAIL.**
- [ ] **Step 4: Implement it.** `TRANSCRIBE_PROMPT` must require:
  - output that is only a JSON array of `{start "MM:SS", end "MM:SS", speaker "S1".."Sn", text}`,
  - Persian written in Persian script,
  - **English words and technical terms kept verbatim in Latin script, never translated or transliterated**,
  - one item per speaker turn, without merging different speakers.

  `merge_chunks` keeps a turn from chunk *k* when `start_ms < (k+1)*chunk_s*1000 + overlap_s*500`. For *k* > 0 it also requires `start_ms >= k*chunk_s*1000 + overlap_s*500`. The httpx timeout is 300 s.

  `render_transcript_md` writes one line per turn: `**[MM:SS] Name:** text`, with ` *(uncertain)*` appended when the turn is uncertain.
- [ ] **Step 5: Run the tests. Expected: PASS.**
- [ ] **Step 6: Commit** `feat(helper): OpenRouter client and transcript parsing`

---

### Task 4: Speaker mapping

**Files:**
- Create: `helper/meetnotes/speakers.py`
- Test: `helper/tests/test_speakers.py`

**Interfaces:**
- Consumes: `Turn` (Task 3), the speaker_log contract
- Produces:
  - `assign_speakers(turns: list[Turn], log: list[dict], min_share: float = 0.6, min_overlap_ms: int = 1000) -> list[Turn]`
  - `rename_speaker(turns: list[Turn], old: str, new: str) -> list[Turn]`: used by Task 9

**Algorithm:**
1. For each key `(chunk, label)`, sum the overlap in ms between that key's turns and the log intervals, separately for each name.
2. The best name wins if `best >= min_overlap_ms` and `best / total_overlap >= min_share`. Every turn with that key then gets `speaker=name, uncertain=False`.
3. Otherwise, all turns of the key get `speaker="Speaker N"` (N is assigned globally in order of first appearance) and `uncertain=True`.

- [ ] **Step 1: Write failing tests**

```python
def T(s, e, label, chunk=0): return Turn(s, e, label, "x", chunk=chunk, label=label)

def test_label_maps_to_dominant_name():
    log = [{"name":"Reza","start_ms":0,"end_ms":5000},{"name":"Sara","start_ms":5000,"end_ms":9000}]
    out = assign_speakers([T(0,4800,"S1"), T(5100,8900,"S2")], log)
    assert [(t.speaker, t.uncertain) for t in out] == [("Reza",False),("Sara",False)]

def test_no_log_gives_numbered_uncertain_speakers():
    out = assign_speakers([T(0,1000,"S1"), T(1000,2000,"S2"), T(2000,3000,"S1")], [])
    assert [t.speaker for t in out] == ["Speaker 1","Speaker 2","Speaker 1"] and all(t.uncertain for t in out)

def test_same_label_in_different_chunks_mapped_independently():
    log = [{"name":"Reza","start_ms":0,"end_ms":1000},{"name":"Sara","start_ms":600000,"end_ms":601000}]
    out = assign_speakers([T(0,1000,"S1",0), T(600000,601000,"S1",1)], log)
    assert [t.speaker for t in out] == ["Reza","Sara"]

def test_rename_merges_into_existing_name_and_clears_uncertain():
    turns = [Turn(0,1,"Speaker 4","a",uncertain=True), Turn(1,2,"Reza","b")]
    out = rename_speaker(turns, "Speaker 4", "Reza")
    assert {t.speaker for t in out} == {"Reza"} and not any(t.uncertain for t in out)
```

- [ ] **Step 2: Run `pytest tests/test_speakers.py -v`. Expected: FAIL.**
- [ ] **Step 3: Implement it.**
- [ ] **Step 4: Run the tests. Expected: PASS.**
- [ ] **Step 5: Commit** `feat(helper): speaker mapping`

---

### Task 5: Screenshot descriptions

**Files:**
- Create: `helper/meetnotes/screens.py`
- Test: `helper/tests/test_screens.py`

**Interfaces:**
- Consumes: `OpenRouter.describe_image` (Task 3)
- Produces: `describe_screens(folder: Path, client: OpenRouter, model: str, max_screens: int = 60) -> float`. It writes `screens.json` = `[{"file": "screens/<ms>.jpg", "at_ms": int, "description": str}]` sorted by `at_ms`, and returns the total cost. When there are more than `max_screens` files, it keeps an evenly spaced subset that always includes the first and the last.

- [ ] **Step 1: Write failing tests,** using a fake client object with `describe_image` returning `("Figma: Wallet top-up screen", 0.001)`:
  - `test_writes_sorted_descriptions_and_cost`: given 3 files `2000.jpg`, `500.jpg`, `10000.jpg`, expect `at_ms == [500, 2000, 10000]` and cost `0.003`
  - `test_caps_to_max_screens_keeping_first_and_last`: given 100 files and `max_screens=10`, expect 10 entries, with the first and last `at_ms` preserved
  - `test_no_screens_writes_empty_list`
- [ ] **Step 2: Run `pytest tests/test_screens.py -v`. Expected: FAIL.**
- [ ] **Step 3: Implement it.** The prompt asks for 1–3 English sentences covering: which app/screen it is (Figma frame name if visible), the main UI components, and readable titles or labels. It must not guess anything that isn't visible.
- [ ] **Step 4: Run the tests. Expected: PASS.**
- [ ] **Step 5: Commit** `feat(helper): screenshot descriptions`

---

### Task 6: Notes via Claude Code

**Files:**
- Create: `helper/meetnotes/notes.py`, `helper/meetnotes/templates/grooming.md`, `planning.md`, `technical.md`
- Test: `helper/tests/test_notes.py`

**Interfaces:**
- Consumes: `load_turns`, `render_transcript_md` (Task 3), `screens.json` (Task 5), `Config.repos`
- Produces:
  - `class NotesError(Exception)`
  - `build_prompt(meta: dict, transcript_md: str, screens: list[dict]) -> str`
  - `split_output(text: str) -> tuple[str, str]`: returns `(email_md, notes_md)`
  - `generate_notes(folder: Path, cfg: Config, run=subprocess.run) -> None`: writes `email.md` and `notes.md`, raises `NotesError`

**The command,** run with `cwd=folder`, the prompt on stdin, and `timeout=900`:
`[shutil.which("claude"), "-p", "--output-format", "json", "--allowedTools", "Read,Grep,Glob", "--disallowedTools", "Write,Edit,Bash,WebFetch,WebSearch", *sum((["--add-dir", str(r)] for r in cfg.repos), [])]`

Parse `json.loads(stdout)`. If `is_error` is true or the exit code is nonzero, raise `NotesError` with the `result`/stderr text.

**Output contract:** Claude must answer with exactly this layout:

```
<<<EMAIL>>>
...
<<<NOTES>>>
...
```

**The template (per meeting type)** fixes the notes.md sections, in this order:
1. `# <title> — <type> — <date>`
2. `## Participants`
3. `## Features discussed` (each with `![](screens/<ms>.jpg)` links and `[MM:SS]` refs)
4. `## Tasks` (table: Task | Service/Repo | Owner | Story points | Source)
5. `## Tech debt & technical problems`
6. `## Decisions`
7. `## Open questions`
8. `## Quotes`

The type-specific emphasis differs:
- grooming: features + estimates
- planning: sprint scope, owners, capacity
- technical: problems, options, chosen approach

**Rules the template must contain verbatim:**
- notes.md in English; email.md in Persian with English technical terms in Latin script unchanged
- use the repos only to correct service/repo/component names to their real names; never add tasks, owners, estimates or decisions not present in the transcript
- unknown values are `?`
- items attributed to uncertain speakers keep the `(uncertain)` marker
- every item cites a `[MM:SS]` timestamp

- [ ] **Step 1: Write failing tests**

```python
def test_split_output():
    assert split_output("<<<EMAIL>>>\nسلام\n<<<NOTES>>>\n# T\n") == ("سلام", "# T")

def test_split_output_missing_marker_raises():
    with pytest.raises(NotesError): split_output("just text")

def test_prompt_contains_rules_and_inputs():
    p = build_prompt({"type":"grooming","title":"W","started_at":"2026-11-06T10:00:00"}, "**[00:03] Reza:** hi", [{"file":"screens/500.jpg","at_ms":500,"description":"Figma"}])
    assert "never add tasks" in p and "**[00:03] Reza:** hi" in p and "screens/500.jpg" in p and "## Tech debt" in p

def test_generate_notes_writes_files(meeting_folder, cfg):
    fake = lambda *a, **k: CompletedProcess(a, 0, stdout=json.dumps({"is_error": False, "result": "<<<EMAIL>>>\nE\n<<<NOTES>>>\nN"}), stderr="")
    generate_notes(meeting_folder, cfg, run=fake)
    assert (meeting_folder/"email.md").read_text("utf-8") == "E" and (meeting_folder/"notes.md").read_text("utf-8") == "N"

def test_claude_missing_raises_clear_error(meeting_folder, cfg, monkeypatch):
    monkeypatch.setattr(shutil, "which", lambda _: None)
    with pytest.raises(NotesError, match="Claude Code .*not found"): generate_notes(meeting_folder, cfg)

def test_usage_limit_surfaces_message(meeting_folder, cfg):
    fake = lambda *a, **k: CompletedProcess(a, 1, stdout=json.dumps({"is_error": True, "result": "Usage limit reached"}), stderr="")
    with pytest.raises(NotesError, match="Usage limit reached"): generate_notes(meeting_folder, cfg, run=fake)
```

- [ ] **Step 2: Run `pytest tests/test_notes.py -v`. Expected: FAIL.**
- [ ] **Step 3: Implement `notes.py` and the three templates.** Pass `encoding="utf-8"` to `subprocess.run`.
- [ ] **Step 4: Run the tests. Expected: PASS.**
- [ ] **Step 5: Manual check:** run `generate_notes` on a fixture folder with the real `claude`. Expected: `email.md` is Persian, `notes.md` is English and has all 8 sections.
- [ ] **Step 6: Commit** `feat(helper): notes generation via Claude Code`

---

### Task 7: Processing pipeline

**Files:**
- Create: `helper/meetnotes/pipeline.py`
- Test: `helper/tests/test_pipeline.py`

**Interfaces:**
- Consumes: Tasks 1–6
- Produces: `process_meeting(folder: Path, cfg: Config, client: OpenRouter | None = None, notes_fn=generate_notes, open_browser=webbrowser.open) -> None`

**The steps, in order:**

| Step | Skip if this file exists | Work |
|---|---|---|
| `chunking` | `chunks/` | `split_audio(folder/"audio.webm", folder/"chunks")` |
| `transcribing` | `transcript.json` | each chunk is transcribed and parsed; on `TranscriptParseError`, retry that chunk once; then `merge_chunks` |
| `speakers` | (always runs when `transcribing` ran) | `assign_speakers` with `speaker_log.json`, then save `transcript.json` + `transcript.md` |
| `screens` | `screens.json` | `describe_screens` |
| `notes` | `email.md` | `notes_fn` |

At each step, call `write_meta(step=...)` and add to `cost_usd`.

- On success: `status="ready"`, `step="done"`, then `open_browser(f"http://127.0.0.1:47821/meetings/{id}")`.
- On any exception: `status="error"` and `error=f"{step}: {exc}"`. For a parse failure, the message includes the chunk index. Don't re-raise.

Retrying means calling `process_meeting` again. The skip rules resume from the failed step.

- [ ] **Step 1: Write failing tests,** using fakes for the client, `notes_fn` and `split_audio` (monkeypatched):
  - `test_happy_path_sets_ready_and_opens_review`
  - `test_parse_failure_retries_chunk_once_then_errors_naming_chunk`: the fake returns garbage twice for chunk 1; expect `status=="error"` and `"chunk 1" in error`
  - `test_retry_resumes_from_failed_step`: run once with a failing `notes_fn`, then again with a working one; expect the transcription fake to have been called only during the first run
  - `test_cost_accumulates`
- [ ] **Step 2: Run `pytest tests/test_pipeline.py -v`. Expected: FAIL.**
- [ ] **Step 3: Implement it.**
- [ ] **Step 4: Run the tests. Expected: PASS.**
- [ ] **Step 5: Commit** `feat(helper): processing pipeline with resume`

---

### Task 8: Mailer

**Files:**
- Create: `helper/meetnotes/mailer.py`
- Test: `helper/tests/test_mailer.py`

**Interfaces:**
- Consumes: the meeting folder files, `Config`
- Produces:
  - `build_message(folder: Path, sender: str, recipients: list[str], subject: str) -> EmailMessage`
  - `send_meeting(folder: Path, cfg: Config, recipients: list[str], transport=None) -> None`

**The message:**
- plain text = `email.md`
- HTML alternative = `markdown.markdown(email.md)`, wrapped in `<div dir="rtl" style="text-align:right;font-family:Tahoma">`
- attachments: `notes.md`, plus every `screens/*.jpg` referenced in `notes.md` (regex `screens/\d+\.jpg`)
- subject: `[<type>] <title> — <YYYY-MM-DD>`

**Sending:**
- `gmail_api`: OAuth desktop flow with scope `https://www.googleapis.com/auth/gmail.send`. The client secret is at `%APPDATA%\meetnotes\gmail_client.json` and the token at `%APPDATA%\meetnotes\gmail_token.json`. Call `users().messages().send(userId="me", body={"raw": base64url(msg)})`.
- `smtp`: `smtp.gmail.com:587`, STARTTLS, with the app password.

**After a successful send:**
- `write_meta(status="sent", sent_at=now, recipients=recipients)`
- `cfg.last_recipients = recipients` and `save_config`
- delete `audio.webm` and `chunks/`

- [ ] **Step 1: Write failing tests**
  - `test_message_has_rtl_html_and_referenced_screens_only`: `notes.md` references `screens/500.jpg` while the folder also has `screens/900.jpg`. Expect the attachments to be `{"notes.md", "500.jpg"}` and the HTML part to contain `dir="rtl"`.
  - `test_send_marks_sent_saves_recipients_and_deletes_audio`, using a fake transport that records the message
  - `test_send_failure_keeps_status_and_audio`: the transport raises, so expect the exception to propagate, `status` to be unchanged and `audio.webm` to still exist
- [ ] **Step 2: Run `pytest tests/test_mailer.py -v`. Expected: FAIL.**
- [ ] **Step 3: Implement it.** The `transport` argument is a callable `(EmailMessage) -> None`. When it's None, build it from `cfg.mail_method`.
- [ ] **Step 4: Run the tests. Expected: PASS.**
- [ ] **Step 5: Commit** `feat(helper): gmail sending`

---

### Task 9: HTTP API

**Files:**
- Create: `helper/meetnotes/server.py`, `helper/meetnotes/__main__.py`
- Test: `helper/tests/test_server.py` (FastAPI `TestClient`)

**Interfaces:**
- Consumes: Tasks 1, 4, 7, 8
- Produces: `create_app(cfg: Config, run_pipeline=process_meeting, send=send_meeting) -> FastAPI`, with these endpoints (all `/api/*` require the `X-MeetNotes-Token` header and return 401 without it):

| Method | Path | Behavior |
|---|---|---|
| POST | `/api/meetings` | upload contract → `create_meeting`, save the files, start `run_pipeline` in a `BackgroundTasks`, return `{"id"}` |
| GET | `/api/meetings` | `list_meetings` |
| GET | `/api/meetings/{id}` | meta + `{"email": str, "notes": str, "turns": [...], "speakers": [unique names in order]}` (empty strings/lists while processing) |
| PUT | `/api/meetings/{id}/docs/{name}` | `name` must be `email` or `notes`; body `{"text": str}` is written to `<name>.md`; 409 if status is `sent` |
| POST | `/api/meetings/{id}/speakers` | `{"old","new"}` → `rename_speaker` on the turns, then rewrite `transcript.json`/`.md`; in `email.md` and `notes.md` replace `old` using `re.sub(rf"(?<!\w){re.escape(old)}(?!\w)", new, text)` |
| POST | `/api/meetings/{id}/retry` | only when status is `error`: set `status=processing`, `error=None`, start the pipeline |
| POST | `/api/meetings/{id}/send` | `{"recipients": [str]}` → 400 if the list is empty or status isn't `ready`; else `send(...)`; on an exception return 502 with the message |
| GET | `/api/config/recipients` | `cfg.last_recipients` |

**CORS:** allow only `chrome-extension://*` origins on `POST /api/meetings`.

**Pages:**
- `GET /` serves `review/index.html`
- `GET /meetings/{id}` serves `review/meeting.html`
- `/static` serves the review folder

Both HTML pages get the token injected server-side, by replacing `__TOKEN__` in the HTML.

`__main__` runs `uvicorn.run(create_app(load_config()), host="127.0.0.1", port=47821)`.

- [ ] **Step 1: Write failing tests**

```python
def test_requires_token(client): assert client.get("/api/meetings").status_code == 401

def test_upload_creates_meeting_and_runs_pipeline(client, calls, upload_files):
    r = client.post("/api/meetings", files=upload_files, headers=H)
    mid = r.json()["id"]
    assert calls == [mid] and (cfg.notes_root/mid/"audio.webm").exists() and (cfg.notes_root/mid/"screens"/"500.jpg").exists()

def test_rename_with_regex_chars_and_merge(client, ready_meeting):   # transcript has "Speaker 4" and "Reza", email mentions "Speaker 4"
    client.post(f"/api/meetings/{ready_meeting}/speakers", json={"old":"Speaker 4","new":"Ali (PM)"}, headers=H)
    d = client.get(f"/api/meetings/{ready_meeting}", headers=H).json()
    assert "Ali (PM)" in d["speakers"] and "Speaker 4" not in d["email"]
    client.post(f"/api/meetings/{ready_meeting}/speakers", json={"old":"Ali (PM)","new":"Reza"}, headers=H)
    assert client.get(f"/api/meetings/{ready_meeting}", headers=H).json()["speakers"] == ["Reza"]

def test_send_requires_recipients_and_ready(client, ready_meeting):
    assert client.post(f"/api/meetings/{ready_meeting}/send", json={"recipients": []}, headers=H).status_code == 400

def test_edit_after_sent_is_rejected(client, sent_meeting):
    assert client.put(f"/api/meetings/{sent_meeting}/docs/email", json={"text":"x"}, headers=H).status_code == 409

def test_unknown_id_404(client): assert client.get("/api/meetings/nope", headers=H).status_code == 404
```

- [ ] **Step 2: Run `pytest tests/test_server.py -v`. Expected: FAIL.**
- [ ] **Step 3: Implement it.** Map `KeyError` from `meeting_dir` to 404.
- [ ] **Step 4: Run the tests. Expected: PASS.**
- [ ] **Step 5: Commit** `feat(helper): HTTP API`

---

### Task 10: Review page (Option A)

**Files:**
- Create: `helper/meetnotes/review/index.html`, `meeting.html`, `app.js`, `style.css`
- Test: manual browser check (no JS test framework on the helper side)

**Interfaces:**
- Consumes: the Task 9 endpoints. The token is available as `const TOKEN = "__TOKEN__"`.

**Layout,** matching the approved mockup (`.superpowers/brainstorm/*/content/review-screen.html`, option A):
- **Header:** title · type · date · duration · status
- **Speakers bar:** one chip per name in `speakers`. Uncertain-only names get a warning style and a "rename?" hint. Clicking a chip prompts for a new name inline (an input inside the chip, **not** `window.prompt`), then POSTs to `/speakers` and reloads the data.
- **Tabs:**
  - **Email summary:** textarea with `dir="auto"`
  - **AI notes (.md):** textarea in a monospace font
  - **Transcript:** a read-only list of `[MM:SS] name: text`, where uncertain lines are marked
- **Saving:** textarea edits auto-save via PUT after 1 s of no typing. A "Saved ✓ / Saving…" indicator shows the state.
- **Bottom bar:** a recipients input (comma-separated, pre-filled from `/api/config/recipients`) and a **Send email** button.
  - Send asks for confirmation inline: the button changes to "Confirm send to N recipients".
  - After it's sent, everything turns read-only and shows "Sent at …".
  - On a 502, the error is shown inline.
- **While `processing`:** show the current `step` and poll every 3 s.
- **While `error`:** show the error text and a **Retry** button.
- **`index.html`:** a list of meetings (title, type, date, status) linking to `/meetings/{id}`.

- [ ] **Step 1: Build the pages.**
- [ ] **Step 2: Manual check.** Start the helper and put a fixture meeting folder (status `ready`, with Persian email text) under `notes_root`. Then:
  - Open `/meetings/<id>`. Expected: the 3 tabs render, and the Persian text displays right-to-left.
  - Rename "Speaker 2". Expected: it updates in all tabs.
  - Edit the email and reload. Expected: the edit is kept.
  - Send with empty recipients. Expected: an inline error.
- [ ] **Step 3: Commit** `feat(helper): review page`

---

### Task 11: Extension skeleton and pure modules

**Files:**
- Create: `extension/package.json` (devDeps: typescript, esbuild, vitest, @types/chrome), `tsconfig.json`, `build.mjs` (bundles each entry to `dist/`), `src/types.ts`, `src/lib/frameDiff.ts`, `src/lib/speakingDetector.ts`, `src/lib/intervalTracker.ts`, `src/lib/upload.ts`
- Test: `extension/tests/frameDiff.test.ts`, `speakingDetector.test.ts`, `intervalTracker.test.ts`, `upload.test.ts`

**Interfaces:**
- Produces:
  - `types.ts`: `MeetingType = "grooming"|"planning"|"technical"`; `SpeakerInterval {name; start_ms; end_ms}`; `UploadMeta` (the upload contract); `Screen {atMs: number; blob: Blob}`
  - `frameDiff(a: Uint8Array, b: Uint8Array): number`: the mean absolute difference of two equal-length grayscale thumbnails, normalized to 0..1. `CHANGE_THRESHOLD = 0.08`.
  - `class SpeakingDetector(name: string, threshold = 0.02, minOnMs = 300, hangMs = 700)`:
    - `.push(rms: number, tMs: number): void`
    - `.finish(tMs: number): SpeakerInterval[]`
  - `class IntervalTracker`:
    - `.update(speaking: Set<string>, tMs: number): void`
    - `.finish(tMs: number): SpeakerInterval[]`
  - `buildUploadForm(meta: UploadMeta, log: SpeakerInterval[], audio: Blob, screens: Screen[]): FormData`
  - `uploadWithRetry(form: FormData, url: string, token: string, opts?: {tries?: number; delayMs?: number; fetchFn?: typeof fetch}): Promise<{id: string}>`: defaults to `tries=3`, `delayMs=2000`, with linear backoff. It throws `UploadError` after the last try.

- [ ] **Step 1: Write failing tests**

```ts
test("frameDiff identical is 0, inverted is 1", () => {
  const a = new Uint8Array([0, 255]); expect(frameDiff(a, a)).toBe(0); expect(frameDiff(a, new Uint8Array([255, 0]))).toBe(1);
});
test("SpeakingDetector ignores blips and closes after hang", () => {
  const d = new SpeakingDetector("Sina");
  d.push(0.5, 0); d.push(0.0, 100);                       // 100ms blip: ignored
  for (let t = 1000; t <= 2000; t += 50) d.push(0.5, t);  // 1s speech
  d.push(0.0, 2050);
  expect(d.finish(5000)).toEqual([{ name: "Sina", start_ms: 1000, end_ms: 2050 }]);
});
test("IntervalTracker opens/closes per name and closes open ones on finish", () => {
  const t = new IntervalTracker();
  t.update(new Set(["Reza"]), 0); t.update(new Set(["Reza", "Sara"]), 1000); t.update(new Set(["Sara"]), 2000);
  expect(t.finish(3000)).toEqual([{ name: "Reza", start_ms: 0, end_ms: 2000 }, { name: "Sara", start_ms: 1000, end_ms: 3000 }]);
});
test("uploadWithRetry retries then succeeds", async () => {
  let n = 0; const fetchFn = async () => (++n < 3 ? Promise.reject(new Error("ECONNREFUSED")) : new Response('{"id":"m1"}'));
  await expect(uploadWithRetry(new FormData(), "u", "t", { fetchFn, delayMs: 0 })).resolves.toEqual({ id: "m1" });
});
test("uploadWithRetry throws UploadError after last try and sends token", async () => {
  const seen: Headers[] = []; const fetchFn = async (_: any, i: any) => { seen.push(new Headers(i.headers)); throw new Error("down"); };
  await expect(uploadWithRetry(new FormData(), "u", "tok", { fetchFn, delayMs: 0 })).rejects.toBeInstanceOf(UploadError);
  expect(seen).toHaveLength(3); expect(seen[0].get("X-MeetNotes-Token")).toBe("tok");
});
test("buildUploadForm names screens by atMs", () => {
  const f = buildUploadForm(meta, [], new Blob(["a"]), [{ atMs: 500, blob: new Blob(["j"]) }]);
  expect((f.getAll("screens")[0] as File).name).toBe("500.jpg"); expect(JSON.parse(f.get("meta") as string).type).toBe(meta.type);
});
```

- [ ] **Step 2: Run `cd extension && npx vitest run`. Expected: FAIL.**
- [ ] **Step 3: Implement the modules.** Also treat non-2xx responses as failures in `uploadWithRetry`.
- [ ] **Step 4: Run `npx vitest run`. Expected: PASS.**
- [ ] **Step 5: Commit** `feat(extension): skeleton and pure modules`

---

### Task 12: Extension recording (popup, background, offscreen, mic permission)

**Files:**
- Create: `extension/manifest.json`, `src/popup.html`, `src/popup.ts`, `src/permission.html`, `src/permission.ts`, `src/background.ts`, `src/offscreen.html`, `src/offscreen.ts`
- Test: manual (Chrome capture APIs can't be unit tested)

**Interfaces:**
- Consumes: Task 11 modules; the content script messages from Task 13 (`{type:"speaker-log:start", t0}` and `{type:"speaker-log:collect"} -> {log: SpeakerInterval[], participants: string[]}`)
- Produces: messages `{type:"start", tabId, streamId, meetingType, title}`, `{type:"stop"}`, `{type:"status"} -> {state: "idle"|"recording"|"uploading"|"upload-failed"|"done", elapsedMs, error?, meetingId?}`, `{type:"retry-upload"}`

**manifest.json:**
- MV3, `"permissions": ["tabCapture","offscreen","storage"]`
- `"host_permissions": ["http://127.0.0.1:47821/*"]`
- a content script on `https://meet.google.com/*` → `dist/content/speakerLog.js`
- `action.default_popup = popup.html`

**Flow:**
- **Popup:**
  - Settings section: helper token and your name, saved in `chrome.storage.local`.
  - Meeting type select and title input.
  - Start/Stop button and a timer.
  - It's only enabled when the active tab URL starts with `https://meet.google.com/`.
  - On Start, if `navigator.permissions.query({name:"microphone"})` isn't `granted`, it opens `permission.html` in a tab. That page calls `getUserMedia({audio:true})` and then closes.
  - Otherwise it calls `chrome.tabCapture.getMediaStreamId({targetTabId})` and sends `start` to the background.
  - It shows "Upload failed — Retry" when the status is `upload-failed`.
- **Background:**
  - Creates the offscreen document (`reasons:["USER_MEDIA"]`) and forwards `start`.
  - Sends `speaker-log:start` with `t0` to the tab.
  - Keeps the state in `chrome.storage.session`.
  - On `stop`: collects the speaker log from the tab and forwards it to the offscreen document with `stop`.
  - Closes the offscreen document only after a successful upload.
- **Offscreen:**
  - Calls `getUserMedia` with `chromeMediaSource:"tab"` for audio and video (video `maxFrameRate: 2`), and separately for the mic.
  - In an AudioContext, connects tab → `ctx.destination` (so Sina still hears the meeting) and tab + mic → a `MediaStreamDestination`.
  - Runs `MediaRecorder` on the mixed destination with `audio/webm;codecs=opus`, `audioBitsPerSecond: 32000` and a 10 s timeslice.
  - Feeds a mic `AnalyserNode` RMS to `SpeakingDetector(selfName)` every 50 ms.
  - Every 2 s, draws the video to a 64×36 canvas, converts it to grayscale and compares it with `frameDiff` against the last kept frame. When the difference is ≥ `CHANGE_THRESHOLD`, it saves a full-size JPEG (quality 0.8) as `Screen{atMs}`.
  - If the tab track fires `ended` (tab closed or meeting left), it behaves like `stop`.
  - On stop, it merges the self intervals into the log, calls `buildUploadForm` and `uploadWithRetry`, and reports the result. The blobs stay in memory until the upload succeeds.

- [ ] **Step 1: Implement the files and `npm run build`.**
- [ ] **Step 2: Manual check.** Load `extension/` unpacked, start the helper, and join a test Meet with a second device. Speak from both, share a screen and change slides twice, then Stop. Expected:
  - the meeting audio stays audible during recording,
  - the helper creates the meeting folder with `audio.webm` (both voices audible),
  - there are 2+ screens,
  - the review page opens once processing finishes.
- [ ] **Step 3: Failure check.** Stop the helper, record 20 s and press Stop. Expected: the popup shows "Upload failed — Retry". Start the helper and press Retry. Expected: the upload succeeds.
- [ ] **Step 4: Commit** `feat(extension): recording and upload`

---

### Task 13: Meet speaker log content script

**Files:**
- Create: `extension/src/content/meetSelectors.ts`, `extension/src/content/speakerLog.ts`
- Test: `extension/tests/meetSelectors.test.ts` (jsdom fixture of saved Meet DOM)

**Interfaces:**
- Consumes: `IntervalTracker` (Task 11)
- Produces:
  - `getSpeakingNames(root: Document): Set<string>`
  - `getParticipantNames(root: Document): string[]`
  - the message handlers listed in Task 12

All selectors live only in `meetSelectors.ts`.

- [ ] **Step 1: Capture the DOM.** In a live Meet with 2+ participants (one of them talking, one presenting), save `document.body.outerHTML` to `extension/tests/fixtures/meet-speaking.html`. Note which elements mark the active speaker and which hold participant display names. Redact real names in the fixture to `Reza`/`Sara`.
- [ ] **Step 2: Write failing tests:** with the fixture, `getSpeakingNames` returns `{"Reza"}` and `getParticipantNames` contains `"Reza"` and `"Sara"`. With an empty document, both return empty values and don't throw.
- [ ] **Step 3: Run `npx vitest run tests/meetSelectors.test.ts`. Expected: FAIL.**
- [ ] **Step 4: Implement it.** `speakerLog.ts` polls `getSpeakingNames` every 250 ms after `speaker-log:start`, feeding `IntervalTracker.update(names, Date.now() - t0)`. On `speaker-log:collect` it returns `{log: tracker.finish(now - t0), participants}`. Any selector exception gives an empty set, never a throw.
- [ ] **Step 5: Run the tests. Expected: PASS.**
- [ ] **Step 6: Manual check:** record 2 minutes with two speakers. Expected: `speaker_log.json` has intervals for both names, and the transcript turns map to the right names.
- [ ] **Step 7: Commit** `feat(extension): Meet speaker log`

---

### Task 14: Model benchmark, startup and README

**Files:**
- Create: `helper/scripts/bench_models.py`, `helper/scripts/install-startup.ps1`, `README.md`
- Modify: the `transcribe_model` / `vision_model` defaults in `helper/meetnotes/config.py`, if the benchmark picks different ones

**Interfaces:**
- Consumes: `split_audio`, `OpenRouter.transcribe_chunk`, `parse_chunk_output`

**What to build:**
- `bench_models.py <meeting-folder> <model> [<model>...]` transcribes the first 2 chunks with each model. For each model it writes `bench/<model-slug>.md` and prints a table of cost, seconds, turn count and parse success.
- `install-startup.ps1` creates a shortcut in `shell:startup` that runs `pythonw -m meetnotes` from `helper/`.
- `README.md` covers:
  - prerequisites (Python 3.12, Node 20+, ffmpeg on PATH, Claude Code logged in with Pro, OpenRouter key)
  - config fields
  - the Gmail OAuth client setup (Google Cloud console → Desktop OAuth client → `gmail_client.json`), with the SMTP app-password fallback
  - loading the extension unpacked
  - first-run mic permission

**Steps:**
- [ ] **Step 1: Implement the bench script.**
- [ ] **Step 2: Benchmark.** On one real recorded meeting, run it with 2–3 audio-capable Gemini models currently listed on OpenRouter, for example the default plus `google/gemini-3.5-transcribe` if it's reachable through the same endpoint. Choose the model with the best Persian/English accuracy, judged by Sina reading the two outputs, within the $0.50/hour target. Update the config default.
- [ ] **Step 3: Write the startup script and the README.**
- [ ] **Step 4: End-to-end check.** Run a real grooming meeting through the whole flow:
  - **Recording:** record it and press Stop.
  - **Review page:** it opens.
  - **Content:**
    - English terms are in Latin script in all three tabs,
    - `notes.md` has all 8 sections and uses real service names from `D:\kifepool`,
    - unknown story points show `?`.
  - **Before sending:** nothing has been emailed.
  - **Sending:** press Send. The email arrives with RTL Persian HTML, `notes.md` and the referenced screenshots attached.
  - **Afterwards:** `audio.webm` has been deleted and `meta.json` has `cost_usd` set.
- [ ] **Step 5: Commit** `docs: README, startup script, model choice`
