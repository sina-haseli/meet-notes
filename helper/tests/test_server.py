import json

import pytest
from fastapi.testclient import TestClient

from meetnotes.config import Config
from meetnotes.server import create_app
from meetnotes.store import create_meeting, read_meta, write_meta
from meetnotes.transcript import Turn, save_turns

TOKEN = "tok123"
H = {"X-MeetNotes-Token": TOKEN}
BASE = "http://127.0.0.1:47821"


def make_client(app):
    return TestClient(app, base_url=BASE)


@pytest.fixture
def cfg(tmp_path):
    return Config(token=TOKEN, notes_root=tmp_path / "notes")


@pytest.fixture
def calls():
    return []


@pytest.fixture
def sends():
    return []


@pytest.fixture
def client(cfg, calls, sends):
    app = create_app(
        cfg,
        run_pipeline=lambda folder, c: calls.append(folder.name),
        send=lambda folder, c, recipients: sends.append((folder.name, recipients)),
    )
    return make_client(app)


@pytest.fixture
def upload_files():
    meta = {"title": "Sprint grooming", "type": "grooming", "started_at": "2026-11-06T10:00:00+03:30",
            "duration_ms": 1000, "self_name": "Sina", "participants": ["Reza"]}
    return [
        ("audio", ("audio.webm", b"webm-bytes", "audio/webm")),
        ("screens", ("500.jpg", b"jpg", "image/jpeg")),
        ("screens", ("evil.exe", b"x", "application/octet-stream")),
    ], {"meta": json.dumps(meta), "speaker_log": json.dumps([{"name": "Reza", "start_ms": 0, "end_ms": 5}])}


def make_ready(cfg, status="ready"):
    folder = create_meeting(cfg.notes_root, {"title": "T", "type": "grooming",
                                             "started_at": "2026-11-06T10:00:00+03:30"})
    turns = [Turn(0, 1000, "Speaker 4", "hi", True), Turn(1000, 2000, "Reza", "yo"),
             Turn(2000, 3000, "Speaker 4", "again")]
    save_turns(folder, turns)
    (folder / "email.md").write_text("Speaker 4 said hi. Speaker 41 stays.", encoding="utf-8")
    (folder / "notes.md").write_text("- Speaker 4: ship", encoding="utf-8")
    (folder / "transcript.md").write_text("old", encoding="utf-8")
    write_meta(folder, status=status)
    return folder.name


@pytest.fixture
def ready_meeting(cfg):
    return make_ready(cfg)


@pytest.fixture
def sent_meeting(cfg):
    return make_ready(cfg, "sent")


def test_requires_token(client):
    assert client.get("/api/meetings").status_code == 401
    assert client.get("/api/meetings", headers={"X-MeetNotes-Token": "bad"}).status_code == 401


def test_upload_creates_meeting_and_runs_pipeline(client, calls, upload_files, cfg):
    files, data = upload_files
    r = client.post("/api/meetings", files=files, data=data, headers=H)
    assert r.status_code == 200
    mid = r.json()["id"]
    d = cfg.notes_root / mid
    assert calls == [mid]
    assert (d / "audio.webm").read_bytes() == b"webm-bytes"
    assert (d / "screens" / "500.jpg").exists()
    assert not (d / "screens" / "evil.exe").exists()
    assert json.loads((d / "speaker_log.json").read_text(encoding="utf-8"))[0]["name"] == "Reza"
    assert read_meta(d)["participants"] == ["Reza"]


def test_upload_bad_type_400(client, upload_files, calls):
    files, data = upload_files
    data["meta"] = json.dumps({"title": "x", "type": "party"})
    assert client.post("/api/meetings", files=files, data=data, headers=H).status_code == 400
    data["meta"] = "not json"
    assert client.post("/api/meetings", files=files, data=data, headers=H).status_code == 400
    assert calls == []


def test_upload_missing_audio_400(client, upload_files):
    _, data = upload_files
    assert client.post("/api/meetings", files=[("screens", ("1.jpg", b"x", "image/jpeg"))],
                       data=data, headers=H).status_code == 400


def test_cors_for_extension_origin(client):
    r = client.options("/api/meetings", headers={"Origin": "chrome-extension://abc",
                                                 "Access-Control-Request-Method": "POST",
                                                 "Access-Control-Request-Headers": "x-meetnotes-token"})
    assert r.headers.get("access-control-allow-origin") == "chrome-extension://abc"
    r = client.options("/api/meetings", headers={"Origin": "https://evil.com",
                                                 "Access-Control-Request-Method": "POST"})
    assert "access-control-allow-origin" not in r.headers


def test_list_and_get(client, ready_meeting):
    assert [m["id"] for m in client.get("/api/meetings", headers=H).json()] == [ready_meeting]
    d = client.get(f"/api/meetings/{ready_meeting}", headers=H).json()
    assert d["speakers"] == ["Speaker 4", "Reza"]
    assert len(d["turns"]) == 3 and d["status"] == "ready" and "ship" in d["notes"]


def test_get_while_processing_is_empty(client, cfg):
    folder = create_meeting(cfg.notes_root, {"title": "P", "type": "planning"})
    d = client.get(f"/api/meetings/{folder.name}", headers=H).json()
    assert d["email"] == "" and d["notes"] == "" and d["turns"] == [] and d["speakers"] == []


def test_rename_with_regex_chars_and_merge(client, ready_meeting, cfg):
    r = client.post(f"/api/meetings/{ready_meeting}/speakers",
                    json={"old": "Speaker 4", "new": "Ali (PM)"}, headers=H)
    assert r.status_code == 200
    d = client.get(f"/api/meetings/{ready_meeting}", headers=H).json()
    assert "Ali (PM)" in d["speakers"] and "Speaker 4 " not in d["email"]
    assert "Ali (PM) said hi. Speaker 41 stays." == d["email"]
    assert "Ali (PM)" in (cfg.notes_root / ready_meeting / "transcript.md").read_text(encoding="utf-8")
    client.post(f"/api/meetings/{ready_meeting}/speakers",
                json={"old": "Ali (PM)", "new": "Reza"}, headers=H)
    assert client.get(f"/api/meetings/{ready_meeting}", headers=H).json()["speakers"] == ["Reza"]


def test_rename_replacement_is_literal(client, ready_meeting):
    client.post(f"/api/meetings/{ready_meeting}/speakers",
                json={"old": "Speaker 4", "new": r"A\1\g<0>"}, headers=H)
    assert r"A\1\g<0> said hi" in client.get(f"/api/meetings/{ready_meeting}", headers=H).json()["email"]


def test_rename_blank_400_and_sent_409(client, ready_meeting, sent_meeting):
    assert client.post(f"/api/meetings/{ready_meeting}/speakers",
                       json={"old": "Speaker 4", "new": "  "}, headers=H).status_code == 400
    assert client.post(f"/api/meetings/{sent_meeting}/speakers",
                       json={"old": "Speaker 4", "new": "X"}, headers=H).status_code == 409


def test_put_doc(client, ready_meeting, cfg):
    r = client.put(f"/api/meetings/{ready_meeting}/docs/notes", json={"text": "new"}, headers=H)
    assert r.status_code == 200
    assert (cfg.notes_root / ready_meeting / "notes.md").read_text(encoding="utf-8") == "new"
    assert client.put(f"/api/meetings/{ready_meeting}/docs/other", json={"text": "x"},
                      headers=H).status_code == 400


def test_edit_after_sent_is_rejected(client, sent_meeting):
    assert client.put(f"/api/meetings/{sent_meeting}/docs/email", json={"text": "x"},
                      headers=H).status_code == 409


def test_send_requires_recipients_and_ready(client, ready_meeting, cfg):
    assert client.post(f"/api/meetings/{ready_meeting}/send", json={"recipients": []},
                       headers=H).status_code == 400
    write_meta(cfg.notes_root / ready_meeting, status="processing")
    assert client.post(f"/api/meetings/{ready_meeting}/send", json={"recipients": ["a@b.c"]},
                       headers=H).status_code == 400


def test_send_ok_and_failure_502(cfg, ready_meeting, sends):
    ok = make_client(create_app(cfg, send=lambda f, c, r: sends.append((f.name, r))))
    assert ok.post(f"/api/meetings/{ready_meeting}/send", json={"recipients": ["a@b.c"]},
                   headers=H).status_code == 200
    assert sends == [(ready_meeting, ["a@b.c"])]

    def boom(f, c, r):
        raise RuntimeError("gmail down")
    bad = make_client(create_app(cfg, send=boom))
    r = bad.post(f"/api/meetings/{ready_meeting}/send", json={"recipients": ["a@b.c"]}, headers=H)
    assert r.status_code == 502 and "gmail down" in r.text


def test_retry(client, cfg, calls):
    folder = create_meeting(cfg.notes_root, {"title": "E", "type": "technical"})
    write_meta(folder, status="error", error="boom")
    assert client.post(f"/api/meetings/{folder.name}/retry", headers=H).status_code == 200
    assert calls == [folder.name]
    assert read_meta(folder)["status"] == "processing" and read_meta(folder)["error"] is None


def test_retry_non_error_409(client, ready_meeting, calls):
    assert client.post(f"/api/meetings/{ready_meeting}/retry", headers=H).status_code == 409
    assert calls == []


def test_recipients(client, cfg):
    cfg.last_recipients = ["a@b.c"]
    assert client.get("/api/config/recipients", headers=H).json() == ["a@b.c"]


def test_unknown_id_404(client):
    assert client.get("/api/meetings/nope", headers=H).status_code == 404
    assert client.post("/api/meetings/nope/retry", headers=H).status_code == 404


def test_pages_inject_token(client, ready_meeting):
    for path in ("/", f"/meetings/{ready_meeting}"):
        r = client.get(path)
        assert r.status_code == 200 and TOKEN in r.text and "__TOKEN__" not in r.text


def test_foreign_host_header_rejected(client):
    # DNS rebinding: a page on evil.example resolving to 127.0.0.1 must not read the token page.
    r = client.get("/", headers={"Host": "evil.example"})
    assert r.status_code == 400 and TOKEN not in r.text
    assert client.get("/api/meetings", headers={**H, "Host": "evil.example:47821"}).status_code == 400
    assert client.get("/", headers={"Host": "localhost:47821"}).status_code == 200
    assert client.get("/").status_code == 200


def test_startup_marks_interrupted_processing_as_error(cfg):
    stuck = create_meeting(cfg.notes_root, {"title": "S", "type": "planning"})
    done = create_meeting(cfg.notes_root, {"title": "D", "type": "planning"})
    write_meta(done, status="ready")
    create_app(cfg)
    meta = read_meta(stuck)
    assert meta["status"] == "error" and "helper restarted" in meta["error"]
    assert read_meta(done)["status"] == "ready" and read_meta(done)["error"] is None


def test_startup_with_missing_notes_root(tmp_path):
    create_app(Config(token=TOKEN, notes_root=tmp_path / "does-not-exist"))


def test_upload_accepts_json_fields_as_file_parts(client, upload_files, cfg):
    files, data = upload_files
    files = files + [("meta", ("meta.json", data["meta"].encode(), "application/json")),
                     ("speaker_log", ("speaker_log.json", data["speaker_log"].encode(), "application/json"))]
    r = client.post("/api/meetings", files=files, headers=H)
    assert r.status_code == 200
    d = cfg.notes_root / r.json()["id"]
    assert json.loads((d / "speaker_log.json").read_text(encoding="utf-8"))[0]["name"] == "Reza"
    assert read_meta(d)["title"] == "Sprint grooming"


def test_upload_allows_many_screens_and_large_string_log(client, upload_files, cfg):
    files, data = upload_files
    files = files[:1] + [("screens", (f"{i}.jpg", b"j", "image/jpeg")) for i in range(1200)]
    big_log = [{"name": "Reza", "start_ms": i, "end_ms": i + 1} for i in range(40000)]
    data["speaker_log"] = json.dumps(big_log)
    assert len(data["speaker_log"]) > 1024 * 1024
    r = client.post("/api/meetings", files=files, data=data, headers=H)
    assert r.status_code == 200, r.text
    d = cfg.notes_root / r.json()["id"]
    assert len(list((d / "screens").iterdir())) == 1200
    assert len(json.loads((d / "speaker_log.json").read_text(encoding="utf-8"))) == 40000


def test_pair_page_shows_token_with_copy(client):
    r = client.get("/pair")
    assert r.status_code == 200
    assert TOKEN in r.text
    assert "__TOKEN__" not in r.text
    assert "navigator.clipboard.writeText" in r.text
    assert "Meet Notes helper is running" in r.text
    assert client.get("/pair", headers={"Host": "evil.example"}).status_code == 400
