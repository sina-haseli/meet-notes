from __future__ import annotations

import json
import logging
import re
import secrets
from dataclasses import asdict
from pathlib import Path

from fastapi import APIRouter, BackgroundTasks, Depends, FastAPI, Header, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.middleware.trustedhost import TrustedHostMiddleware
from fastapi.responses import HTMLResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel
from starlette.datastructures import UploadFile

from .config import Config
from .mailer import send_meeting
from .pipeline import process_meeting
from .speakers import rename_speaker
from .store import create_meeting, fail_interrupted, list_meetings, meeting_dir, read_meta, write_meta
from .transcript import load_turns, render_transcript_md, save_turns

log = logging.getLogger("meetnotes.server")

REVIEW_DIR = Path(__file__).parent / "review"
MEETING_TYPES = {"grooming", "planning", "technical"}
SCREEN_NAME = re.compile(r"^\d+\.(jpg|png)$")
ALLOWED_HOSTS = ["127.0.0.1", "localhost"]
INTERRUPTED_ERROR = "helper restarted while processing — press Retry"
MAX_UPLOAD_FILES = 5000
MAX_FIELD_BYTES = 50 * 1024 * 1024


class DocBody(BaseModel):
    text: str


class RenameBody(BaseModel):
    old: str
    new: str


class SendBody(BaseModel):
    recipients: list[str]


def _read_text(path: Path) -> str:
    return path.read_text(encoding="utf-8") if path.is_file() else ""


async def _form_text(value) -> str | None:
    """A JSON form field may arrive as a plain string or as a Blob (file) part."""
    if isinstance(value, UploadFile):
        return (await value.read()).decode("utf-8")
    return value if isinstance(value, str) else None


def create_app(cfg: Config, run_pipeline=process_meeting, send=send_meeting) -> FastAPI:
    # Pipelines run in-process; anything still "processing" was cut off by a restart/crash.
    for mid in fail_interrupted(cfg.notes_root, INTERRUPTED_ERROR):
        log.warning("meeting %s was processing when the helper stopped; marked as error", mid)

    app = FastAPI(title="Meet Notes helper")
    # Pages embed the token: reject foreign Host headers so DNS rebinding can't read them.
    app.add_middleware(TrustedHostMiddleware, allowed_hosts=ALLOWED_HOSTS)
    app.add_middleware(CORSMiddleware, allow_origin_regex=r"chrome-extension://.*",
                       allow_methods=["*"], allow_headers=["*"])

    def require_token(x_meetnotes_token: str | None = Header(default=None)) -> None:
        if not x_meetnotes_token or not secrets.compare_digest(
                x_meetnotes_token.encode("utf-8"), cfg.token.encode("utf-8")):
            raise HTTPException(401, "invalid or missing token")

    api = APIRouter(prefix="/api", dependencies=[Depends(require_token)])

    def folder_of(mid: str) -> Path:
        try:
            return meeting_dir(cfg.notes_root, mid)
        except KeyError:
            raise HTTPException(404, "meeting not found")

    @api.post("/meetings")
    async def upload(request: Request, background: BackgroundTasks):
        form = await request.form(max_files=MAX_UPLOAD_FILES, max_part_size=MAX_FIELD_BYTES)
        audio = form.get("audio")
        if not isinstance(audio, UploadFile):
            raise HTTPException(400, "audio is required")
        try:
            meta = json.loads(await _form_text(form.get("meta")) or "")
        except (ValueError, UnicodeDecodeError):
            raise HTTPException(400, "meta must be valid JSON")
        if not isinstance(meta, dict) or meta.get("type") not in MEETING_TYPES:
            raise HTTPException(400, "meta.type must be grooming, planning or technical")
        try:
            speaker_log = await _form_text(form.get("speaker_log"))
        except UnicodeDecodeError:
            speaker_log = None
        if speaker_log is None:
            speaker_log = "[]"
        folder = create_meeting(cfg.notes_root, meta)
        (folder / "audio.webm").write_bytes(await audio.read())
        (folder / "speaker_log.json").write_text(speaker_log, encoding="utf-8")
        screens_dir = folder / "screens"
        for f in form.getlist("screens"):
            if isinstance(f, UploadFile) and SCREEN_NAME.match(f.filename or ""):
                screens_dir.mkdir(exist_ok=True)
                (screens_dir / f.filename).write_bytes(await f.read())
        background.add_task(run_pipeline, folder, cfg)
        return {"id": folder.name}

    @api.get("/meetings")
    def list_all():
        return list_meetings(cfg.notes_root)

    @api.get("/meetings/{mid}")
    def get_one(mid: str):
        folder = folder_of(mid)
        meta = read_meta(folder)
        try:
            turns = load_turns(folder)
        except (OSError, ValueError):
            turns = []
        speakers = list(dict.fromkeys(t.speaker for t in turns))
        return {**meta, "email": _read_text(folder / "email.md"), "notes": _read_text(folder / "notes.md"),
                "turns": [asdict(t) for t in turns], "speakers": speakers}

    @api.put("/meetings/{mid}/docs/{name}")
    def put_doc(mid: str, name: str, body: DocBody):
        folder = folder_of(mid)
        if name not in ("email", "notes"):
            raise HTTPException(400, "name must be email or notes")
        if read_meta(folder)["status"] == "sent":
            raise HTTPException(409, "meeting already sent")
        (folder / f"{name}.md").write_text(body.text, encoding="utf-8")
        return {"ok": True}

    @api.post("/meetings/{mid}/speakers")
    def rename(mid: str, body: RenameBody):
        folder = folder_of(mid)
        new = body.new.strip()
        if not new:
            raise HTTPException(400, "new name must not be blank")
        if read_meta(folder)["status"] == "sent":
            raise HTTPException(409, "meeting already sent")
        old = body.old
        turns = rename_speaker(load_turns(folder), old, new)
        save_turns(folder, turns)
        (folder / "transcript.md").write_text(render_transcript_md(turns), encoding="utf-8")
        pattern = rf"(?<!\w){re.escape(old)}(?!\w)"
        for name in ("email.md", "notes.md"):
            p = folder / name
            if p.is_file():
                p.write_text(re.sub(pattern, lambda m: new, p.read_text(encoding="utf-8")),
                             encoding="utf-8")
        return {"ok": True}

    @api.post("/meetings/{mid}/retry")
    def retry(mid: str, background: BackgroundTasks):
        folder = folder_of(mid)
        if read_meta(folder)["status"] != "error":
            raise HTTPException(409, "only failed meetings can be retried")
        write_meta(folder, status="processing", error=None)
        background.add_task(run_pipeline, folder, cfg)
        return {"ok": True}

    @api.post("/meetings/{mid}/send")
    def send_it(mid: str, body: SendBody):
        folder = folder_of(mid)
        if not body.recipients:
            raise HTTPException(400, "at least one recipient is required")
        if read_meta(folder)["status"] != "ready":
            raise HTTPException(400, "meeting is not ready to send")
        try:
            send(folder, cfg, body.recipients)
        except Exception as e:  # noqa: BLE001 - surfaced to the review page
            log.exception("send failed for %s", mid)
            raise HTTPException(502, str(e) or e.__class__.__name__)
        return {"ok": True}

    @api.get("/config/recipients")
    def recipients():
        return cfg.last_recipients

    app.include_router(api)

    def page(name: str) -> HTMLResponse:
        html = (REVIEW_DIR / name).read_text(encoding="utf-8")
        return HTMLResponse(html.replace("__TOKEN__", cfg.token))

    @app.get("/", response_class=HTMLResponse)
    def index():
        return page("index.html")

    @app.get("/pair", response_class=HTMLResponse)
    def pair_page():
        return page("pair.html")

    @app.get("/meetings/{mid}", response_class=HTMLResponse)
    def meeting_page(mid: str):
        return page("meeting.html")

    app.mount("/static", StaticFiles(directory=REVIEW_DIR), name="static")
    return app
