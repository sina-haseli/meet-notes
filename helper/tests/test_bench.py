import importlib.util
import json
from pathlib import Path

import pytest

SCRIPT = Path(__file__).resolve().parents[1] / "scripts" / "bench_models.py"
URL = "https://openrouter.ai/api/v1/chat/completions"
GOOD = json.dumps([{"start": "00:01", "end": "00:04", "speaker": "S1", "text": "سلام endpoint"},
                   {"start": "00:05", "end": "00:08", "speaker": "S2", "text": "ok"}])


@pytest.fixture(scope="module")
def bench():
    spec = importlib.util.spec_from_file_location("bench_models", SCRIPT)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


@pytest.fixture
def meeting(tmp_path, make_tone):
    folder = tmp_path / "2026-11-06_grooming_x"
    folder.mkdir()
    (folder / "audio.webm").write_bytes(make_tone(8).read_bytes())
    return folder


def test_slug(bench):
    assert bench.model_slug("google/gemini-2.5-flash:free") == "google_gemini-2.5-flash_free"


def test_bench_writes_files_and_table_and_survives_errors(bench, meeting, respx_mock, capsys):
    def handler(request):
        import httpx
        model = json.loads(request.content)["model"]
        if model == "bad/model":
            return httpx.Response(500, text="boom")
        if model == "junk/model":
            return httpx.Response(200, json={"choices": [{"message": {"content": "not json"}}]})
        return httpx.Response(200, json={"choices": [{"message": {"content": GOOD}}],
                                         "usage": {"cost": 0.0123}})

    respx_mock.post(URL).mock(side_effect=handler)
    rc = bench.main([str(meeting), "good/model", "bad/model", "junk/model", "--api-key", "k"])
    out = capsys.readouterr().out
    assert rc == 0
    md = (meeting / "bench" / "good_model.md").read_text(encoding="utf-8")
    assert "سلام endpoint" in md and "S1" in md
    assert (meeting / "bench" / "junk_model.md").exists()
    assert not (meeting / "bench" / "bad_model.md").exists()
    lines = out.strip().splitlines()
    assert lines[0].split() == ["model", "cost_usd", "seconds", "turns", "parse_ok"]
    good = next(line for line in lines if line.startswith("good/model"))
    assert "0.0123" in good and " 2 " in good and "yes" in good
    assert "HTTP 500" in next(line for line in lines if line.startswith("bad/model"))
    assert "no" in next(line for line in lines if line.startswith("junk/model"))


def test_missing_key_exits(bench, meeting, monkeypatch):
    monkeypatch.setenv("OPENROUTER_API_KEY", "")
    monkeypatch.setenv("APPDATA", str(meeting.parent / "appdata"))
    with pytest.raises(SystemExit):
        bench.main([str(meeting), "m"])
