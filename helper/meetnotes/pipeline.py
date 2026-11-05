"""Resumable processing pipeline: chunking -> transcribing -> speakers -> screens -> notes."""
from __future__ import annotations

import json
import logging
import webbrowser
from pathlib import Path

from .audio import Chunk, split_audio
from .config import Config
from .notes import generate_notes
from .openrouter import OpenRouter
from .screens import describe_screens
from .speakers import assign_speakers
from .store import read_meta, write_meta
from .transcript import (
    TranscriptParseError, merge_chunks, parse_chunk_output,
    render_transcript_md, save_turns,
)

log = logging.getLogger(__name__)


def _add_cost(folder: Path, cost: float) -> None:
    write_meta(folder, cost_usd=read_meta(folder).get("cost_usd", 0.0) + cost)


def _chunk_step(folder: Path) -> list[Chunk]:
    manifest = folder / "chunks.json"
    if manifest.exists():
        return [
            Chunk(d["index"], folder / d["path"], d["offset_ms"], d["duration_ms"])
            for d in json.loads(manifest.read_text(encoding="utf-8"))
        ]
    chunks = split_audio(folder / "audio.webm", folder / "chunks")
    manifest.write_text(json.dumps([
        {"index": c.index, "path": Path(c.path).relative_to(folder).as_posix(),
         "offset_ms": c.offset_ms, "duration_ms": c.duration_ms}
        for c in chunks
    ], indent=2), encoding="utf-8")
    return chunks


def _transcribe_chunk(folder: Path, client, model: str, chunk: Chunk):
    last_err: TranscriptParseError | None = None
    for _ in range(2):
        raw, cost = client.transcribe_chunk(chunk, model)
        _add_cost(folder, cost)
        try:
            return parse_chunk_output(raw, chunk)
        except TranscriptParseError as e:
            last_err = e
    raise TranscriptParseError(f"chunk {chunk.index} could not be parsed: {last_err}")


def process_meeting(folder: Path, cfg: Config, client: OpenRouter | None = None,
                    notes_fn=generate_notes, open_browser=webbrowser.open) -> None:
    folder = Path(folder)
    step = "chunking"
    try:
        write_meta(folder, status="processing", error=None)
        client = client or OpenRouter(cfg.openrouter_api_key)

        write_meta(folder, step="chunking")
        chunks = _chunk_step(folder)

        if not (folder / "transcript.json").exists():
            step = "transcribing"
            write_meta(folder, step=step)
            per_chunk = [_transcribe_chunk(folder, client, cfg.transcribe_model, c) for c in chunks]
            turns = merge_chunks(per_chunk)

            step = "speakers"
            write_meta(folder, step=step)
            log_path = folder / "speaker_log.json"
            speaker_log = json.loads(log_path.read_text(encoding="utf-8")) if log_path.exists() else []
            turns = assign_speakers(turns, speaker_log)
            save_turns(folder, turns)
            (folder / "transcript.md").write_text(render_transcript_md(turns), encoding="utf-8")

        if not (folder / "screens.json").exists():
            step = "screens"
            write_meta(folder, step=step)
            _add_cost(folder, describe_screens(folder, client, cfg.vision_model))

        if not (folder / "email.md").exists():
            step = "notes"
            write_meta(folder, step=step)
            notes_fn(folder, cfg)

        meta = write_meta(folder, status="ready", step="done", error=None)
    except Exception as exc:
        log.exception("pipeline failed at step %s for %s", step, folder)
        write_meta(folder, status="error", error=f"{step}: {exc}")
        return
    open_browser(f"http://127.0.0.1:47821/meetings/{meta['id']}")
