from __future__ import annotations

import json
import os
import shutil
import subprocess
from importlib import resources
from pathlib import Path

from .config import Config
from .store import read_meta
from .transcript import load_turns, render_transcript_md

TIMEOUT_S = 900
EMAIL_MARK = "<<<EMAIL>>>"
NOTES_MARK = "<<<NOTES>>>"


class NotesError(Exception):
    pass


def _template(kind: str) -> str:
    try:
        return (resources.files("meetnotes") / "templates" / f"{kind}.md").read_text(encoding="utf-8")
    except (FileNotFoundError, OSError) as e:
        raise NotesError(f"No notes template for meeting type {kind!r}") from e


def _mmss(ms: int) -> str:
    s = int(ms) // 1000
    return f"{s // 60:02d}:{s % 60:02d}"


def build_prompt(meta: dict, transcript_md: str, screens: list[dict]) -> str:
    date = str(meta.get("started_at", "?"))[:10] or "?"
    dur = _mmss(meta["duration_ms"]) if meta.get("duration_ms") is not None else "?"
    parts = ", ".join(meta.get("participants") or []) or "?"
    info = (
        "## Meeting info\n"
        f"- Title: {meta.get('title', '?')}\n"
        f"- Type: {meta.get('type', '?')}\n"
        f"- Date: {date}\n"
        f"- Duration: {dur}\n"
        f"- Participants: {parts}\n"
    )
    if screens:
        lines = [f"- {s['file']} [{_mmss(s['at_ms'])}]: {s['description']}" for s in screens]
        shots = "## Screenshots\n" + "\n".join(lines) + "\n"
    else:
        shots = "## Screenshots\n(none)\n"
    return (f"{_template(meta['type'])}\n{info}\n{shots}\n"
            f"## Transcript\n{transcript_md}\n")


def split_output(text: str) -> tuple[str, str]:
    e = text.find(EMAIL_MARK)
    n = text.find(NOTES_MARK, e + len(EMAIL_MARK)) if e != -1 else -1
    if e == -1 or n == -1:
        raise NotesError("Claude's answer is missing the <<<EMAIL>>> / <<<NOTES>>> markers")
    email = text[e + len(EMAIL_MARK):n].strip()
    notes = text[n + len(NOTES_MARK):].strip()
    if not email or not notes:
        raise NotesError("Claude's answer has an empty email or notes section")
    return email, notes


def generate_notes(folder: Path, cfg: Config, run=subprocess.run) -> None:
    folder = Path(folder)
    exe = shutil.which("claude")
    if not exe:
        raise NotesError("Claude Code CLI not found on PATH — install it and log in with your Pro account")
    meta = read_meta(folder)
    transcript_md = render_transcript_md(load_turns(folder))
    sp = folder / "screens.json"
    screens = json.loads(sp.read_text(encoding="utf-8")) if sp.exists() else []
    prompt = build_prompt(meta, transcript_md, screens)
    cmd = [exe, "-p", "--output-format", "json",
           "--allowedTools", "Read,Grep,Glob",
           "--disallowedTools", "Write,Edit,Bash,WebFetch,WebSearch",
           *sum((["--add-dir", str(r)] for r in cfg.repos), [])]
    # Force the Pro login: never let an API key from the environment be used.
    env = {k: v for k, v in os.environ.items()
           if k.upper() not in ("ANTHROPIC_API_KEY", "ANTHROPIC_AUTH_TOKEN")}
    try:
        proc = run(cmd, cwd=folder, input=prompt, capture_output=True, text=True,
                   encoding="utf-8", timeout=TIMEOUT_S, env=env)
    except subprocess.TimeoutExpired as e:
        raise NotesError(f"Claude Code timed out after {TIMEOUT_S} s") from e
    except OSError as e:
        raise NotesError(f"Claude Code could not be started: {e}") from e

    out = proc.stdout or ""
    err = proc.stderr or ""
    try:
        data = json.loads(out)
    except ValueError:
        raise NotesError(f"Claude Code returned non-JSON output (exit {proc.returncode}): "
                         f"{(out.strip() or err.strip())[:500]}")
    if not isinstance(data, dict):
        raise NotesError(f"Claude Code returned unexpected output: {out[:500]}")
    result = data.get("result")
    if data.get("is_error") or proc.returncode != 0:
        raise NotesError(str(result or err.strip() or out[:500] or f"exit code {proc.returncode}"))
    email, notes = split_output(result if isinstance(result, str) else "")
    (folder / "email.md").write_text(email, encoding="utf-8")
    (folder / "notes.md").write_text(notes, encoding="utf-8")
