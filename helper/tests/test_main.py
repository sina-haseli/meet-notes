import sys

from uvicorn.logging import DefaultFormatter

from meetnotes.__main__ import ensure_streams


def test_missing_streams_are_redirected_to_log_file(tmp_path, monkeypatch):
    # pythonw (Startup shortcut) starts with no console: sys.stdout / sys.stderr are None.
    monkeypatch.setattr(sys, "stdout", None)
    monkeypatch.setattr(sys, "stderr", None)
    log_path = tmp_path / "cfg" / "helper.log"
    assert ensure_streams(log_path) is True
    try:
        assert sys.stdout is not None and sys.stderr is not None
        DefaultFormatter(fmt="%(message)s", use_colors=None)  # crashed before: None.isatty()
        print("hello from pythonw")
        sys.stderr.write("an error line\n")
        sys.stderr.flush()
        text = log_path.read_text(encoding="utf-8")
        assert "hello from pythonw" in text and "an error line" in text
    finally:
        sys.stdout.close()


def test_present_streams_are_left_alone(tmp_path):
    out, err = sys.stdout, sys.stderr
    assert ensure_streams(tmp_path / "helper.log") is False
    assert sys.stdout is out and sys.stderr is err
    assert not (tmp_path / "helper.log").exists()
