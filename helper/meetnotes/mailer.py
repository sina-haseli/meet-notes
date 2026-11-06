from __future__ import annotations

import base64
import logging
import mimetypes
import re
import shutil
import smtplib
from datetime import datetime
from email.message import EmailMessage
from pathlib import Path
from typing import Callable

import markdown

from .config import Config, save_config
from .store import read_meta, write_meta

log = logging.getLogger("meetnotes.mailer")

GMAIL_SCOPES = ["https://www.googleapis.com/auth/gmail.send"]
_SCREEN_RE = re.compile(r"screens/\d+\.jpg")
_HTML_WRAP = '<div dir="rtl" style="text-align:right;font-family:Tahoma">{}</div>'


def _read(path: Path) -> str:
    return path.read_text(encoding="utf-8") if path.is_file() else ""


def build_message(folder: Path, sender: str, recipients: list[str], subject: str) -> EmailMessage:
    folder = Path(folder)
    email_md = _read(folder / "email.md")
    notes_md = _read(folder / "notes.md")

    msg = EmailMessage()
    msg["Subject"] = subject
    msg["From"] = sender
    msg["To"] = ", ".join(recipients)
    msg.set_content(email_md)
    msg.add_alternative(_HTML_WRAP.format(markdown.markdown(email_md)), subtype="html")

    if (folder / "notes.md").is_file():
        msg.add_attachment(notes_md.encode("utf-8"), maintype="text", subtype="markdown",
                           filename="notes.md", params={"charset": "utf-8"})
    seen: set[str] = set()
    for ref in _SCREEN_RE.findall(notes_md):
        if ref in seen:
            continue
        seen.add(ref)
        path = folder / ref
        if not path.is_file():
            continue
        ctype = mimetypes.guess_type(path.name)[0] or "image/jpeg"
        maintype, subtype = ctype.split("/", 1)
        msg.add_attachment(path.read_bytes(), maintype=maintype, subtype=subtype,
                           filename=path.name)
    return msg


def load_gmail_credentials(token_file: Path, client_file: Path):
    """Saved Gmail credentials, refreshed if needed. Falls back to the browser consent flow when
    there is no usable token: missing, unreadable, or a refresh token Google no longer accepts
    (apps in "Testing" mode get refresh tokens that expire after 7 days)."""
    from google.auth.exceptions import RefreshError
    from google.auth.transport.requests import Request
    from google.oauth2.credentials import Credentials
    from google_auth_oauthlib.flow import InstalledAppFlow

    creds = None
    if token_file.is_file():
        try:
            creds = Credentials.from_authorized_user_file(str(token_file), GMAIL_SCOPES)
        except (ValueError, OSError):
            log.warning("Gmail token file %s is invalid; asking for consent again", token_file)
            token_file.unlink(missing_ok=True)
    if creds and creds.expired and creds.refresh_token:
        try:
            creds.refresh(Request())
            token_file.write_text(creds.to_json(), encoding="utf-8")
            return creds
        except RefreshError as e:
            log.warning("Gmail token refresh failed (%s); asking for consent again", e)
            token_file.unlink(missing_ok=True)
            creds = None
    if not creds or not creds.valid:
        if not client_file.is_file():
            raise RuntimeError(
                f"Gmail API client secret not found. Put your OAuth desktop client file at "
                f"{client_file} (named gmail_client.json).")
        flow = InstalledAppFlow.from_client_secrets_file(str(client_file), GMAIL_SCOPES)
        creds = flow.run_local_server(port=0)
        token_file.write_text(creds.to_json(), encoding="utf-8")
    return creds


def gmail_api_transport(cfg: Config) -> Callable[[EmailMessage], None]:
    from googleapiclient.discovery import build

    if cfg.path is None:
        raise RuntimeError("config path unknown; cannot locate the meetnotes data directory")
    base = Path(cfg.path).parent
    creds = load_gmail_credentials(base / "gmail_token.json", base / "gmail_client.json")

    def send(msg: EmailMessage) -> None:
        service = build("gmail", "v1", credentials=creds, cache_discovery=False)
        raw = base64.urlsafe_b64encode(msg.as_bytes()).decode("ascii")
        service.users().messages().send(userId="me", body={"raw": raw}).execute()

    return send


def smtp_transport(cfg: Config) -> Callable[[EmailMessage], None]:
    def send(msg: EmailMessage) -> None:
        with smtplib.SMTP("smtp.gmail.com", 587, timeout=60) as s:
            s.starttls()
            s.login(cfg.mail_from, cfg.smtp_app_password)
            s.send_message(msg)

    return send


def send_meeting(folder: Path, cfg: Config, recipients: list[str],
                 transport: Callable[[EmailMessage], None] | None = None) -> None:
    if not recipients:
        raise ValueError("at least one recipient is required")
    folder = Path(folder)
    meta = read_meta(folder)
    subject = f"[{meta['type']}] {meta['title']} — {meta['started_at'][:10]}"
    msg = build_message(folder, cfg.mail_from, recipients, subject)
    if transport is None:
        transport = smtp_transport(cfg) if cfg.mail_method == "smtp" else gmail_api_transport(cfg)

    transport(msg)  # raises on failure: nothing below runs

    write_meta(folder, status="sent", recipients=list(recipients),
               sent_at=datetime.now().astimezone().isoformat(timespec="seconds"))
    cfg.last_recipients = list(recipients)
    save_config(cfg)
    (folder / "audio.webm").unlink(missing_ok=True)
    shutil.rmtree(folder / "chunks", ignore_errors=True)
