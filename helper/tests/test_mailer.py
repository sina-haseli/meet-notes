import json

import pytest

from meetnotes.config import Config
from meetnotes.mailer import build_message, send_meeting
from meetnotes.store import read_meta


@pytest.fixture
def meeting(tmp_path):
    f = tmp_path / "2026-11-06_grooming_x"
    (f / "screens").mkdir(parents=True)
    (f / "chunks").mkdir()
    (f / "chunks" / "c0.mp3").write_bytes(b"x")
    (f / "audio.webm").write_bytes(b"audio")
    (f / "screens" / "500.jpg").write_bytes(b"\xff\xd8jpeg500")
    (f / "screens" / "900.jpg").write_bytes(b"\xff\xd8jpeg900")
    (f / "notes.md").write_text(
        "# Notes\n![a](screens/500.jpg) again screens/500.jpg and screens/777.jpg",
        encoding="utf-8")
    (f / "email.md").write_text("# خلاصه\n\nسلام **دنیا**", encoding="utf-8")
    (f / "meta.json").write_text(json.dumps({
        "id": f.name, "title": "Sprint", "type": "grooming",
        "started_at": "2026-11-06T10:00:00+03:30", "status": "ready",
        "recipients": [], "sent_at": None}), encoding="utf-8")
    return f


def test_message_has_rtl_html_and_referenced_screens_only(meeting):
    msg = build_message(meeting, "me@x.com", ["a@x.com", "b@x.com"], "[grooming] Sprint — 2026-11-06")
    names = {p.get_filename() for p in msg.iter_attachments()}
    assert names == {"notes.md", "500.jpg"}
    assert msg["Subject"] == "[grooming] Sprint — 2026-11-06"
    assert msg["To"] == "a@x.com, b@x.com"
    html = msg.get_body(("html",)).get_content()
    assert 'dir="rtl"' in html and "<strong>دنیا</strong>" in html
    assert "سلام" in msg.get_body(("plain",)).get_content()


def test_send_marks_sent_saves_recipients_and_deletes_audio(meeting, tmp_path):
    cfg = Config(mail_from="me@x.com", path=tmp_path / "cfg" / "config.toml")
    sent = []
    send_meeting(meeting, cfg, ["a@x.com"], transport=sent.append)
    assert len(sent) == 1
    assert sent[0]["Subject"] == "[grooming] Sprint — 2026-11-06"
    meta = read_meta(meeting)
    assert meta["status"] == "sent" and meta["recipients"] == ["a@x.com"] and meta["sent_at"]
    assert cfg.last_recipients == ["a@x.com"]
    assert "a@x.com" in cfg.path.read_text(encoding="utf-8")
    assert not (meeting / "audio.webm").exists()
    assert not (meeting / "chunks").exists()


def test_send_failure_keeps_status_and_audio(meeting, tmp_path):
    cfg = Config(mail_from="me@x.com", path=tmp_path / "config.toml")

    def boom(msg):
        raise OSError("network down")

    with pytest.raises(OSError):
        send_meeting(meeting, cfg, ["a@x.com"], transport=boom)
    assert read_meta(meeting)["status"] == "ready"
    assert (meeting / "audio.webm").exists() and (meeting / "chunks").exists()
    assert cfg.last_recipients == []
    assert not cfg.path.exists()


def test_empty_recipients_rejected(meeting, tmp_path):
    cfg = Config(path=tmp_path / "config.toml")
    with pytest.raises(ValueError):
        send_meeting(meeting, cfg, [], transport=lambda m: None)


def test_transports_construct_and_missing_client_is_clear(tmp_path):
    from meetnotes.mailer import gmail_api_transport, smtp_transport
    cfg = Config(mail_from="me@x.com", smtp_app_password="pw", path=tmp_path / "config.toml")
    assert callable(smtp_transport(cfg))
    with pytest.raises(RuntimeError, match="gmail_client.json"):
        gmail_api_transport(cfg)


class _FakeFlow:
    def __init__(self, token_file, log):
        self.token_file, self.log = token_file, log

    def run_local_server(self, port=0):
        self.log.append(("consent", self.token_file.exists()))
        return _NewCreds()


class _NewCreds:
    valid = True

    def to_json(self):
        return '{"fresh": true}'


@pytest.fixture
def gmail_files(tmp_path, monkeypatch):
    from google_auth_oauthlib.flow import InstalledAppFlow
    client = tmp_path / "gmail_client.json"
    client.write_text("{}", encoding="utf-8")
    token = tmp_path / "gmail_token.json"
    log = []
    monkeypatch.setattr(InstalledAppFlow, "from_client_secrets_file",
                        classmethod(lambda cls, path, scopes: _FakeFlow(token, log)))
    return token, client, log


def test_expired_refresh_token_falls_back_to_consent(gmail_files, monkeypatch):
    # Google "Testing" apps: refresh tokens die after 7 days -> RefreshError on every send.
    from google.auth.exceptions import RefreshError
    from google.oauth2.credentials import Credentials
    from meetnotes.mailer import load_gmail_credentials
    token, client, log = gmail_files
    token.write_text('{"old": true}', encoding="utf-8")

    class Stale:
        expired, valid, refresh_token = True, False, "r"

        def refresh(self, request):
            log.append(("refresh",))
            raise RefreshError("invalid_grant: Token has been expired or revoked.")

    monkeypatch.setattr(Credentials, "from_authorized_user_file", classmethod(lambda cls, p, s: Stale()))
    creds = load_gmail_credentials(token, client)
    assert isinstance(creds, _NewCreds)
    assert log == [("refresh",), ("consent", False)]  # the dead token was deleted before consent
    assert token.read_text(encoding="utf-8") == '{"fresh": true}'


def test_invalid_token_file_falls_back_to_consent(gmail_files):
    from meetnotes.mailer import load_gmail_credentials
    token, client, log = gmail_files
    token.write_text("not json at all", encoding="utf-8")
    creds = load_gmail_credentials(token, client)
    assert isinstance(creds, _NewCreds) and log == [("consent", False)]
    assert token.read_text(encoding="utf-8") == '{"fresh": true}'


def test_valid_refresh_keeps_token_and_skips_consent(gmail_files, monkeypatch):
    from google.oauth2.credentials import Credentials
    from meetnotes.mailer import load_gmail_credentials
    token, client, log = gmail_files
    token.write_text('{"old": true}', encoding="utf-8")

    class Refreshable:
        expired, valid, refresh_token = True, False, "r"

        def refresh(self, request):
            self.valid, self.expired = True, False

        def to_json(self):
            return '{"refreshed": true}'

    monkeypatch.setattr(Credentials, "from_authorized_user_file", classmethod(lambda cls, p, s: Refreshable()))
    load_gmail_credentials(token, client)
    assert log == [] and token.read_text(encoding="utf-8") == '{"refreshed": true}'
