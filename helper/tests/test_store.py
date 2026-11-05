import pytest

from meetnotes.store import (create_meeting, list_meetings, meeting_dir, read_meta,
                             slugify, write_meta)


def test_slugify_keeps_persian_and_strips_windows_illegal():
    assert slugify('Wallet top-up: v2 / "شارژ"') == "Wallet-top-up-v2-شارژ"
    assert slugify("   ") == "meeting"


def test_create_meeting_folder_name_and_collision(tmp_path):
    meta = {"title": "Sprint 12", "type": "planning", "started_at": "2026-11-06T10:00:00+03:30"}
    a = create_meeting(tmp_path, meta); b = create_meeting(tmp_path, meta)
    assert a.name == "2026-11-06_planning_Sprint-12" and b.name == "2026-11-06_planning_Sprint-12-2"
    m = read_meta(a)
    assert m["status"] == "processing" and m["step"] == "chunking" and m["cost_usd"] == 0.0 and m["id"] == a.name


def test_meta_has_full_contract_and_persian_roundtrip(tmp_path):
    a = create_meeting(tmp_path, {"title": "شارژ کیف پول", "type": "grooming",
                                  "started_at": "2026-11-06T10:00:00+03:30"})
    m = read_meta(a)
    assert set(m) == {"id", "title", "type", "started_at", "duration_ms", "self_name", "participants",
                      "status", "step", "error", "cost_usd", "recipients", "sent_at"}
    assert m["error"] is None and m["recipients"] == [] and m["sent_at"] is None
    assert m["duration_ms"] == 0 and m["participants"] == []
    assert "شارژ" in (a / "meta.json").read_text(encoding="utf-8")


def test_write_meta_and_list_newest_first(tmp_path):
    a = create_meeting(tmp_path, {"title": "A", "type": "technical", "started_at": "2026-11-05T09:00:00+03:30"})
    b = create_meeting(tmp_path, {"title": "B", "type": "technical", "started_at": "2026-11-06T09:00:00+03:30"})
    assert write_meta(a, status="ready", step="done")["status"] == "ready"
    assert read_meta(a)["step"] == "done"
    assert [m["id"] for m in list_meetings(tmp_path)] == [b.name, a.name]
    assert list_meetings(tmp_path / "missing") == []


def test_meeting_dir(tmp_path):
    a = create_meeting(tmp_path, {"title": "A", "type": "planning", "started_at": "2026-11-06T09:00:00+03:30"})
    assert meeting_dir(tmp_path, a.name) == a
    with pytest.raises(KeyError): meeting_dir(tmp_path, "nope")


@pytest.mark.parametrize("bad", ["..\\x", "../x", "a/b", "a\\b", ".."])
def test_meeting_dir_rejects_traversal(tmp_path, bad):
    with pytest.raises(KeyError): meeting_dir(tmp_path, bad)
