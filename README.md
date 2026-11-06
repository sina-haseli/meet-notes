# Meet Notes

Records a Google Meet meeting (Persian speech with English technical terms), turns it into a transcript and structured notes, shows them on a review page, and emails them only when you press **Send**.

Two parts:

- `extension/` is a Chrome (Manifest V3) extension. It records the tab audio plus your microphone, logs who is speaking, grabs a screenshot when the shared screen changes, and uploads everything to the helper when you press Stop.
- `helper/` is a local Python server on `127.0.0.1:47821`. It splits the audio, transcribes it through OpenRouter (Gemini), has Claude Code write the notes, serves the review page and sends the email through Gmail.

Data leaves your PC only to OpenRouter (audio and screenshots), Anthropic (through Claude Code, text only) and Gmail (the email you send). Nothing is emailed until you press Send.

Outputs per meeting, in `D:\meeting-notes\YYYY-MM-DD_<type>_<slug>\`: `transcript.md` (as spoken), `notes.md` (English), `email.md` (Persian, English terms kept), screenshots, `meta.json` (including `cost_usd`). `audio.webm` and `chunks/` are deleted after a successful send.

## Prerequisites

- Windows, Chrome.
- Python 3.12 (3.11 also works).
- Node 22.22 or newer (the extension tests use jsdom, which needs it).
- Claude Code installed and logged in with your Pro account (`claude` must work in a terminal). The helper calls `claude -p`; no Anthropic API key is used.
- An OpenRouter API key with some credit.
- ffmpeg is NOT required. It comes bundled through `imageio-ffmpeg` (a `ffmpeg` on PATH is used if you have one).

## Helper setup

```powershell
cd D:\projects\persian_transacribe\helper
py -3.12 -m venv .venv
.venv\Scripts\python -m pip install -e .[dev]
.venv\Scripts\python -m meetnotes
```

The first run creates `%APPDATA%\meetnotes\config.toml` with a random `token`. Stop the helper (Ctrl+C), edit the file, and start it again.

### Config fields (`%APPDATA%\meetnotes\config.toml`)

| Field | Default | Meaning |
|---|---|---|
| `token` | random, generated | Shared secret. Every `/api/*` call must send it; paste it into the extension popup. |
| `notes_root` | `D:\meeting-notes` | Where meeting folders are created. |
| `repos` | `["D:\\kifepool"]` | Repo folders Claude Code may read to normalise service/module names in the notes. They are used only for names; nothing is added from them. |
| `openrouter_api_key` | `""` | Your OpenRouter key. **Required.** |
| `transcribe_model` | `google/gemini-2.5-flash` | OpenRouter model used to transcribe audio. See "Choosing the transcription model". |
| `vision_model` | `google/gemini-2.5-flash` | Model that describes screenshots. |
| `self_name` | `Sina` | Your name, used to label your own microphone. |
| `last_recipients` | `[]` | Filled in automatically with the last addresses you sent to. |
| `mail_method` | `gmail_api` | `gmail_api` or `smtp`. |
| `mail_from` | `""` | Your Gmail address (needed for `smtp`; used as the sender). |
| `smtp_app_password` | `""` | Gmail app password, only for `mail_method = "smtp"`. |

Use forward slashes or doubled backslashes in paths (`"D:/meeting-notes"` or `"D:\\meeting-notes"`).

## Gmail setup

Default method is the Gmail API (OAuth):

1. Open Google Cloud Console, create or pick a project.
2. APIs and Services, Library, enable the **Gmail API**.
3. APIs and Services, OAuth consent screen: set it up (External is fine); add your Gmail address as a test user.
4. APIs and Services, Credentials, Create credentials, **OAuth client ID**, application type **Desktop app**.
5. Download the JSON and save it as `%APPDATA%\meetnotes\gmail_client.json`.
6. The first time you press Send, a browser window opens for consent. After you approve, the helper stores `gmail_token.json` next to the config and does not ask again.

Fallback, SMTP with an app password: turn on 2-Step Verification for your Google account, create an App Password, then in `config.toml` set

```toml
mail_method = "smtp"
mail_from = "you@gmail.com"
smtp_app_password = "xxxx xxxx xxxx xxxx"
```

## Extension setup

```powershell
cd D:\projects\persian_transacribe\extension
npm install
npm run build
```

Then in Chrome: `chrome://extensions`, turn on **Developer mode**, **Load unpacked**, choose the `extension\` folder. Rebuild (`npm run build`) and press the reload icon on the extension card after any change.

Open the extension popup, expand **Settings**, paste the helper **token** from `config.toml` and your **name** (as it appears in Meet), and Save. The first time you press Start, a page asks for microphone permission. Allow it, go back to the Meet tab, and press Start again.

## Daily use

1. Make sure the helper is running (see Auto-start below).
2. In a Meet tab, open the popup, pick the meeting type (`grooming`, `planning` or `technical`), optionally type a title, press **Start**.
3. When the meeting is over, press **Stop**. The popup shows "Uploading..." then "Uploaded".
4. The review page opens when processing finishes (a few minutes for an hour-long meeting). Check the three tabs (notes, email, transcript), rename speakers (`Speaker 2` to a real name; this updates all three tabs), and edit anything that is wrong.
5. Enter the recipients and press **Send**. Nothing is sent before that.

## Choosing the transcription model

`helper/scripts/bench_models.py` transcribes the first two chunks (about 10 minutes) of a recorded meeting with each model you list, so you can compare accuracy and cost on your own voice and vocabulary.

Run it on a meeting folder that still has `audio.webm` (i.e. before you press Send, or a fresh test recording):

```powershell
cd D:\projects\persian_transacribe\helper
$env:OPENROUTER_API_KEY = "sk-or-..."     # or rely on openrouter_api_key in config.toml
.venv\Scripts\python scripts\bench_models.py D:\meeting-notes\2026-11-06_grooming_foo google/gemini-2.5-flash google/gemini-2.5-pro
```

Take the model ids from openrouter.ai (audio-input models). It prints a table with columns `model, cost_usd, seconds, turns, parse_ok` and writes `bench\<model-slug>.md` inside the meeting folder (slug: `/` and `:` become `_`). A model that errors gets a row with the error and the run continues.

To pick one: read the `bench\*.md` files side by side and compare Persian accuracy, whether English terms stay in Latin script, and speaker separation. Reject any with `parse_ok = no`. Keep cost under the target of $0.50 per meeting hour (the benchmark covers about 10 minutes, so multiply `cost_usd` by 6 for an hour). Then set `transcribe_model` in `config.toml` and restart the helper.

## Auto-start

```powershell
powershell -ExecutionPolicy Bypass -File D:\projects\persian_transacribe\helper\scripts\install-startup.ps1
```

This creates `Meet Notes Helper.lnk` in your Startup folder (`shell:startup`), which runs `helper\.venv\Scripts\pythonw.exe -m meetnotes` from `helper\` with no console window. Delete the shortcut to undo it. To stop a running helper, end `pythonw.exe` in Task Manager.

## First real-meeting checklist

None of this has been run against a live Meet, OpenRouter or Gmail yet. Do it once with a short test meeting (a second device or colleague).

**Recording**
1. Helper running, extension built and loaded, token and name saved in the popup.
2. Join the test Meet, press Start. On first use allow the mic on the permission page, return to Meet, press Start again.
3. While recording: you still hear the meeting, and the popup timer runs.
4. Speak from both devices. Share a screen and change slides twice. Press Stop.
5. Expected: "Uploading..." then "Uploaded"; the meeting folder exists with `audio.webm` (both voices audible) and 2+ files in `screens\`.
6. Failure check: stop the helper, record 20 s, press Stop. After about 6 s the popup shows "Upload failed - Retry". Start the helper and press Retry; it should upload and the folder appears.
7. Optional: close the Meet tab mid-recording; it should stop and upload by itself.

**Speaker detection (selectors)**

The Meet page markup is not documented and changes, so the selectors are best guesses. All of them live in `extension/src/content/meetSelectors.ts` as three commented constants: `TILE_SELECTORS` (participant tiles), `NAME_STRATEGIES` (where the name text is), and `SPEAKING_ATTRS` / `SPEAKING_CLASSES` (the "is speaking" signal).

1. In a Meet with 2+ people, press F12, Elements.
2. Tiles: right-click a participant tile, Inspect, find the ancestor with `data-participant-id` (or similar). In the console, `document.querySelectorAll('[data-participant-id]').length` should equal the number of participants on screen. If not, change `TILE_SELECTORS`.
3. Names: inside a tile find the element that shows the name and note its `data-*` attribute or class. Add it to `NAME_STRATEGIES` (`"attr:foo"` for an attribute, otherwise a CSS selector).
4. Speaking: have one person talk and watch the tile's small animated audio indicator. See which class or attribute toggles while they talk (right-click the node, Break on, attribute modifications). Put it in `SPEAKING_CLASSES`, or `SPEAKING_ATTRS` as `[selector, attribute, speaking-value]`. Remove wrong guesses. **If every tile looks like it is speaking at once, that class is always present: remove it.**
5. `npm run build`, reload the extension, record 2 minutes with two speakers. `speaker_log.json` in the meeting folder should show intervals for both names.
6. Optionally paste a real tile's HTML (names replaced by Reza and Sara) into `extension\tests\fixtures\meet-speaking.html` and keep `npx vitest run` green.

**Review page (in the browser)**
1. The review page opens by itself when processing finishes (or open `http://127.0.0.1:47821/` and pick the meeting).
2. English terms are in Latin script in all three tabs. `notes.md` has all 8 sections and real service names from `D:\kifepool`. Unknown story points and owners show `?`; uncertain speakers show `(uncertain)`.
3. Rename a speaker and confirm all three tabs update. Edit some text, reload the page, confirm the edit is kept.
4. Nothing has been emailed at this point.

**Gmail send**
1. Press Send with your own address as recipient. First time: approve the browser consent, then the send completes.
2. The email arrives with right-to-left Persian HTML, `notes.md` attached, and the referenced screenshots attached.
3. Afterwards `audio.webm` and `chunks\` are gone and `meta.json` has `status: "sent"` and a `cost_usd` value.

## Troubleshooting

- **Popup says "Upload failed - Retry":** the helper was not reachable. Start it, then press Retry; the recording is kept in memory until it uploads. If the recording is lost (browser closed), the popup says so.
- **Helper not running / popup cannot connect:** run `.venv\Scripts\python -m meetnotes` in `helper\` and check nothing else uses port 47821. Check the token in the popup matches `config.toml`. Run `install-startup.ps1` to start it at login.
- **Claude Code usage limit or other error while writing notes:** the review page shows the error and a **Retry** button. Wait for your limit to reset and press Retry. There is no fallback to another model, by design.
- **OpenRouter errors (HTTP 401/402):** check `openrouter_api_key` and your credit. The meeting shows the error; retry from the review page.
- **Voice labels like "Speaker 2" instead of names:** the Meet selectors are not matching (Meet changed its markup). Rename the speakers on the review page for this meeting, and fix the selectors using the checklist above.
- **Gmail consent or send fails:** make sure `gmail_client.json` is a Desktop-app client in `%APPDATA%\meetnotes\` and your address is a test user. Delete `gmail_token.json` to redo consent, or switch to `mail_method = "smtp"`.

## Development

```powershell
cd helper;    .venv\Scripts\python -m pytest
cd extension; npx vitest run; npx tsc --noEmit
```
