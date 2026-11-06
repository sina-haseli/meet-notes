"""Compare transcription models on a real recorded meeting.

Usage:
    python scripts/bench_models.py <meeting-folder> <model> [<model>...] [--api-key KEY] [--chunks N]

Transcribes the first N chunks (default 2) of <meeting-folder>/audio.webm with each
model, writes bench/<model-slug>.md inside the meeting folder and prints a table.
"""
from __future__ import annotations

import argparse
import os
import shutil
import sys
import time
from pathlib import Path

from meetnotes.audio import split_audio
from meetnotes.openrouter import OpenRouter
from meetnotes.transcript import TranscriptParseError, parse_chunk_output, render_transcript_md

COLUMNS = ["model", "cost_usd", "seconds", "turns", "parse_ok"]


def model_slug(model: str) -> str:
    return model.replace("/", "_").replace(":", "_")


def bench_model(client: OpenRouter, chunks, model: str, out_dir: Path) -> dict:
    """Transcribe the chunks with one model. Never raises; errors go into the row."""
    row = {"model": model, "cost_usd": 0.0, "seconds": 0.0, "turns": 0, "parse_ok": False, "error": None}
    start = time.monotonic()
    sections: list[str] = []
    turns: list = []
    parse_ok = True
    try:
        for chunk in chunks:
            raw, cost = client.transcribe_chunk(chunk, model)
            row["cost_usd"] += cost
            try:
                got = parse_chunk_output(raw, chunk)
                turns.extend(got)
                sections.append(f"## Chunk {chunk.index}\n\n{render_transcript_md(got)}")
            except TranscriptParseError as e:
                parse_ok = False
                sections.append(f"## Chunk {chunk.index} (PARSE FAILED: {e})\n\n```\n{raw}\n```\n")
    except Exception as e:  # network, HTTP error, ...: report and move on
        row["error"] = str(e)
        row["seconds"] = time.monotonic() - start
        return row
    row.update(seconds=time.monotonic() - start, turns=len(turns), parse_ok=parse_ok)
    out_dir.mkdir(parents=True, exist_ok=True)
    (out_dir / f"{model_slug(model)}.md").write_text(
        f"# {model}\n\ncost_usd: {row['cost_usd']:.4f}  seconds: {row['seconds']:.1f}  "
        f"turns: {len(turns)}  parse_ok: {parse_ok}\n\n" + "\n".join(sections), encoding="utf-8")
    return row


def format_table(rows: list[dict]) -> str:
    cells = [COLUMNS]
    for r in rows:
        if r["error"]:
            cells.append([r["model"], "-", f"{r['seconds']:.1f}", "-", f"ERROR: {r['error'][:200]}"])
        else:
            cells.append([r["model"], f"{r['cost_usd']:.4f}", f"{r['seconds']:.1f}",
                          str(r["turns"]), "yes" if r["parse_ok"] else "no"])
    widths = [max(len(c[i]) for c in cells) for i in range(len(COLUMNS))]
    return "\n".join(" ".join(v.ljust(w) for v, w in zip(c, widths)).rstrip() for c in cells)


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("folder", type=Path)
    ap.add_argument("models", nargs="+")
    ap.add_argument("--api-key", default=None)
    ap.add_argument("--chunks", type=int, default=2, help="how many chunks to transcribe (default 2)")
    args = ap.parse_args(argv)

    key = args.api_key or os.environ.get("OPENROUTER_API_KEY")
    if not key:
        from meetnotes.config import load_config
        key = load_config().openrouter_api_key
    if not key:
        sys.exit("No OpenRouter key: use --api-key, OPENROUTER_API_KEY or openrouter_api_key in config.toml")

    audio = args.folder / "audio.webm"
    if not audio.is_file():
        sys.exit(f"{audio} not found (raw audio is deleted after a successful send)")
    bench_dir = args.folder / "bench"
    chunks_dir = bench_dir / "_chunks"
    try:
        chunks = split_audio(audio, chunks_dir)[: args.chunks]
        client = OpenRouter(key)
        rows = [bench_model(client, chunks, m, bench_dir) for m in args.models]
    finally:
        shutil.rmtree(chunks_dir, ignore_errors=True)
    print(format_table(rows))
    return 0


if __name__ == "__main__":
    sys.exit(main())
