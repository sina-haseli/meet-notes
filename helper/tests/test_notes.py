import json
import shutil
from subprocess import CompletedProcess, TimeoutExpired

import pytest

from meetnotes.config import Config
from meetnotes.notes import NotesError, build_prompt, generate_notes, split_output
from meetnotes.transcript import Turn, save_turns

META = {"id": "m", "title": "Weekly", "type": "grooming", "started_at": "2026-11-06T10:00:00",
        "duration_ms": 125000, "participants": ["Reza", "Sina"]}


@pytest.fixture
def meeting_folder(tmp_path):
    f = tmp_path / "2026-11-06_grooming_weekly"
    f.mkdir()
    (f / "meta.json").write_text(json.dumps(META), encoding="utf-8")
    save_turns(f, [Turn(3000, 5000, "Reza", "سلام، بیایید API را ببینیم", False, 0, "A")])
    return f


@pytest.fixture
def cfg(tmp_path):
    return Config(token="t", notes_root=tmp_path, repos=[])


def ok_run(*a, **k):
    return CompletedProcess(a, 0, stdout=json.dumps(
        {"is_error": False, "result": "<<<EMAIL>>>\nE\n<<<NOTES>>>\nN"}), stderr="")


@pytest.fixture(autouse=True)
def fake_claude(monkeypatch):
    monkeypatch.setattr(shutil, "which", lambda _: "C:/bin/claude.exe")


def test_split_output():
    assert split_output("<<<EMAIL>>>\nسلام\n<<<NOTES>>>\n# T\n") == ("سلام", "# T")


@pytest.mark.parametrize("text", ["just text", "<<<EMAIL>>>\nx", "<<<EMAIL>>>\n\n<<<NOTES>>>\nN",
                                  "<<<EMAIL>>>\nE\n<<<NOTES>>>\n  \n"])
def test_split_output_bad_raises(text):
    with pytest.raises(NotesError):
        split_output(text)


@pytest.mark.parametrize("typ", ["grooming", "planning", "technical"])
def test_prompt_contains_rules_and_inputs(typ):
    p = build_prompt({"type": typ, "title": "W", "started_at": "2026-11-06T10:00:00"},
                     "**[00:03] Reza:** hi",
                     [{"file": "screens/500.jpg", "at_ms": 500, "description": "Figma"}])
    for s in ["never add tasks", "**[00:03] Reza:** hi", "screens/500.jpg", "## Tech debt",
              "unknown values are `?`", "(uncertain)", "<<<EMAIL>>>", "<<<NOTES>>>", "2026-11-06",
              "[00:00]", "Figma"]:
        assert s in p, s


def test_generate_notes_writes_files(meeting_folder, cfg):
    generate_notes(meeting_folder, cfg, run=ok_run)
    assert (meeting_folder / "email.md").read_text("utf-8") == "E"
    assert (meeting_folder / "notes.md").read_text("utf-8") == "N"


def test_command_line(meeting_folder, tmp_path):
    cfg = Config(token="t", notes_root=tmp_path, repos=[tmp_path / "r1", tmp_path / "r2"])
    seen = {}

    def run(cmd, **kw):
        seen.update(cmd=cmd, kw=kw)
        return ok_run()

    generate_notes(meeting_folder, cfg, run=run)
    cmd, kw = seen["cmd"], seen["kw"]
    assert cmd == [
        "C:/bin/claude.exe", "-p", "--output-format", "json",
        # Isolate from Sina's global Claude Code setup (settings, hooks, plugins, MCP, mode, model).
        "--restricted",
        "--tools", "Read,Grep,Glob",
        "--allowedTools", "Read,Grep,Glob",
        "--disallowedTools", "Write,Edit,Bash,WebFetch,WebSearch",
        "--strict-mcp-config",
        "--permission-mode", "dontAsk",
        "--model", "sonnet",
        "--add-dir", str(tmp_path / "r1"), "--add-dir", str(tmp_path / "r2"),
    ]
    assert kw["cwd"] == meeting_folder and kw["timeout"] == 900 and kw["encoding"] == "utf-8"
    assert "**[00:03] Reza:**" in kw["input"]


def test_command_line_uses_configured_model(meeting_folder, tmp_path):
    cfg = Config(token="t", notes_root=tmp_path, repos=[], claude_model="opus")
    seen = {}

    def run(cmd, **kw):
        seen.update(cmd=cmd)
        return ok_run()

    generate_notes(meeting_folder, cfg, run=run)
    i = seen["cmd"].index("--model")
    assert seen["cmd"][i + 1] == "opus"


def test_claude_missing_raises_clear_error(meeting_folder, cfg, monkeypatch):
    monkeypatch.setattr(shutil, "which", lambda _: None)
    with pytest.raises(NotesError, match="Claude Code .*not found"):
        generate_notes(meeting_folder, cfg)


def test_usage_limit_surfaces_message(meeting_folder, cfg):
    fake = lambda *a, **k: CompletedProcess(a, 1, stdout=json.dumps(
        {"is_error": True, "result": "Usage limit reached"}), stderr="")
    with pytest.raises(NotesError, match="Usage limit reached"):
        generate_notes(meeting_folder, cfg, run=fake)


def test_nonzero_exit_without_json_raises(meeting_folder, cfg):
    fake = lambda *a, **k: CompletedProcess(a, 2, stdout="", stderr="boom")
    with pytest.raises(NotesError, match="boom"):
        generate_notes(meeting_folder, cfg, run=fake)


def test_non_json_stdout_raises(meeting_folder, cfg):
    fake = lambda *a, **k: CompletedProcess(a, 0, stdout="garbage out", stderr="")
    with pytest.raises(NotesError, match="garbage out"):
        generate_notes(meeting_folder, cfg, run=fake)


def test_timeout_raises(meeting_folder, cfg):
    def fake(*a, **k):
        raise TimeoutExpired("claude", 900)
    with pytest.raises(NotesError, match="timed out after 900"):
        generate_notes(meeting_folder, cfg, run=fake)


def test_bad_output_leaves_no_files(meeting_folder, cfg):
    fake = lambda *a, **k: CompletedProcess(a, 0, stdout=json.dumps(
        {"is_error": False, "result": "no markers"}), stderr="")
    with pytest.raises(NotesError):
        generate_notes(meeting_folder, cfg, run=fake)
    assert not (meeting_folder / "notes.md").exists()


def test_screens_json_used(meeting_folder, cfg):
    (meeting_folder / "screens.json").write_text(json.dumps(
        [{"file": "screens/500.jpg", "at_ms": 500, "description": "Login form"}]), encoding="utf-8")
    seen = {}
    generate_notes(meeting_folder, cfg, run=lambda c, **k: (seen.update(k), ok_run())[1])
    assert "Login form" in seen["input"]


def test_api_keys_stripped_from_env(meeting_folder, cfg, monkeypatch):
    monkeypatch.setenv("ANTHROPIC_API_KEY", "sk-x")
    monkeypatch.setenv("ANTHROPIC_AUTH_TOKEN", "tok")
    monkeypatch.setenv("MEETNOTES_KEEP", "yes")
    seen = {}
    generate_notes(meeting_folder, cfg, run=lambda c, **k: (seen.update(k), ok_run())[1])
    env = seen["env"]
    assert "ANTHROPIC_API_KEY" not in env and "ANTHROPIC_AUTH_TOKEN" not in env
    assert env["MEETNOTES_KEEP"] == "yes"
    assert any(k.upper() == "PATH" for k in env)
