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
