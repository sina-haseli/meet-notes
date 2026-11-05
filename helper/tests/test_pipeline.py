import json

import pytest

from meetnotes import pipeline
from meetnotes.audio import Chunk
from meetnotes.config import Config
from meetnotes.store import create_meeting, read_meta

GOOD = '[{"start": "00:01", "end": "00:03", "speaker": "S1", "text": "salam"}]'


class FakeClient:
    def __init__(self, bad_chunk=None):
        self.calls = []
        self.bad_chunk = bad_chunk

    def transcribe_chunk(self, chunk, model):
        self.calls.append(chunk.index)
        if chunk.index == self.bad_chunk:
            return "garbage", 0.01
        return GOOD, 0.01

    def describe_image(self, path, model, prompt):
        return "a screen", 0.002


def fake_split(n=2):
    calls = []

    def split(src, out_dir, *a, **kw):
        calls.append(out_dir)
        out_dir.mkdir(parents=True, exist_ok=True)
        chunks = []
        for k in range(n):
            p = out_dir / f"chunk_{k:03d}.mp3"
            p.write_bytes(b"x")
            chunks.append(Chunk(k, p, k * 600000, 605000))
        return chunks

    split.calls = calls
    return split


@pytest.fixture
def folder(tmp_path):
    f = create_meeting(tmp_path, {"title": "T", "type": "grooming", "started_at": "2026-11-06T10:00:00"})
    (f / "audio.webm").write_bytes(b"audio")
    (f / "screens").mkdir()
    (f / "screens" / "500.jpg").write_bytes(b"\xff\xd8")
    (f / "speaker_log.json").write_text(json.dumps([{"name": "Sina", "start_ms": 0, "end_ms": 700000}]))
    return f


def notes_ok(folder, cfg):
    (folder / "email.md").write_text("e")
    (folder / "notes.md").write_text("n")


def run(folder, monkeypatch, client=None, notes_fn=notes_ok, opened=None, split=None):
    monkeypatch.setattr(pipeline, "split_audio", split or fake_split())
    pipeline.process_meeting(folder, Config(), client or FakeClient(), notes_fn=notes_fn,
                             open_browser=(opened.append if opened is not None else (lambda u: None)))


def test_happy_path_sets_ready_and_opens_review(folder, monkeypatch):
    opened = []
    run(folder, monkeypatch, opened=opened)
    meta = read_meta(folder)
    assert (meta["status"], meta["step"], meta["error"]) == ("ready", "done", None)
    assert opened == [f"http://127.0.0.1:47821/meetings/{meta['id']}"]
    for name in ("transcript.json", "transcript.md", "screens.json", "email.md", "chunks.json"):
        assert (folder / name).exists()


def test_parse_failure_retries_chunk_once_then_errors_naming_chunk(folder, monkeypatch):
    client = FakeClient(bad_chunk=1)
    opened = []
    run(folder, monkeypatch, client=client, opened=opened)
    meta = read_meta(folder)
    assert meta["status"] == "error"
    assert "chunk 1" in meta["error"]
    assert meta["error"].startswith("transcribing: ")
    assert client.calls == [0, 1, 1]
    assert opened == []


def test_retry_resumes_from_failed_step(folder, monkeypatch):
    client = FakeClient()

    def boom(folder, cfg):
        raise RuntimeError("claude down")

    split = fake_split()
    run(folder, monkeypatch, client=client, notes_fn=boom, split=split)
    meta = read_meta(folder)
    assert meta["status"] == "error" and meta["error"] == "notes: claude down"
    first_calls = list(client.calls)
    run(folder, monkeypatch, client=client, split=split)
    assert client.calls == first_calls
    assert len(split.calls) == 1
    assert read_meta(folder)["status"] == "ready"
    assert read_meta(folder)["error"] is None


def test_cost_accumulates(folder, monkeypatch):
    run(folder, monkeypatch)
    assert read_meta(folder)["cost_usd"] == pytest.approx(0.02 + 0.002)


def test_cost_kept_when_step_fails(folder, monkeypatch):
    run(folder, monkeypatch, client=FakeClient(bad_chunk=1))
    assert read_meta(folder)["cost_usd"] == pytest.approx(0.03)


def test_partial_chunks_dir_without_manifest_is_rechunked(folder, monkeypatch):
    (folder / "chunks").mkdir()
    (folder / "chunks" / "chunk_000.mp3").write_bytes(b"partial")
    split = fake_split()
    run(folder, monkeypatch, split=split)
    assert len(split.calls) == 1
    assert read_meta(folder)["status"] == "ready"
