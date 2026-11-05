"""Turn model, parsing of model output, chunk merging and rendering."""
from __future__ import annotations

import json
import re
from dataclasses import asdict, dataclass
from pathlib import Path

from meetnotes.audio import Chunk

TRANSCRIBE_PROMPT = (
    "Transcribe this meeting audio (Persian speech mixed with English technical terms).\n"
    "Output ONLY a JSON array, with no prose and no markdown. Each item must be an object "
    '{"start": "MM:SS", "end": "MM:SS", "speaker": "S1", "text": "..."} where start/end are '
    "times from the beginning of this audio and speaker is S1, S2, ... Sn, consistent within this audio.\n"
    "Rules:\n"
    "- Write Persian in Persian script.\n"
    "- Keep English words and technical terms (e.g. endpoint, refactor, story point, API names) "
    "verbatim in Latin script. Never translate them and never transliterate them into Persian script.\n"
    "- One item per speaker turn. Never merge different speakers into one item.\n"
    "- Transcribe only what is said. Do not invent or summarize."
)


class TranscriptParseError(ValueError):
    pass


@dataclass
class Turn:
    start_ms: int
    end_ms: int
    speaker: str
    text: str
    uncertain: bool = False
    chunk: int = 0
    label: str = ""


def _ts_ms(value) -> int:
    if not isinstance(value, str):
        raise TranscriptParseError(f"bad timestamp: {value!r}")
    parts = value.strip().split(":")
    try:
        nums = [float(p) for p in parts]
    except ValueError:
        raise TranscriptParseError(f"bad timestamp: {value!r}") from None
    if len(nums) == 2:
        nums = [0.0] + nums
    if len(nums) != 3:
        raise TranscriptParseError(f"bad timestamp: {value!r}")
    h, m, s = nums
    return round((h * 3600 + m * 60 + s) * 1000)


def parse_chunk_output(raw: str, chunk: Chunk) -> list[Turn]:
    first, last = raw.find("["), raw.rfind("]")
    if first == -1 or last <= first:
        raise TranscriptParseError("no JSON array in model output")
    try:
        data = json.loads(raw[first:last + 1])
    except json.JSONDecodeError as e:
        raise TranscriptParseError(f"invalid JSON: {e}") from e
    if not isinstance(data, list):
        raise TranscriptParseError("expected a JSON array")
    turns = []
    for item in data:
        if not isinstance(item, dict) or not all(k in item for k in ("start", "end", "speaker", "text")):
            raise TranscriptParseError(f"bad item: {item!r}")
        speaker, text = item["speaker"], item["text"]
        if not isinstance(speaker, str) or not isinstance(text, str):
            raise TranscriptParseError(f"bad item: {item!r}")
        turns.append(Turn(
            start_ms=_ts_ms(item["start"]) + chunk.offset_ms,
            end_ms=_ts_ms(item["end"]) + chunk.offset_ms,
            speaker=speaker, text=text, chunk=chunk.index, label=speaker,
        ))
    return turns


def merge_chunks(per_chunk: list[list[Turn]], chunk_s: int = 600, overlap_s: int = 5) -> list[Turn]:
    half = overlap_s * 500
    merged: list[Turn] = []
    for k, turns in enumerate(per_chunk):
        hi = (k + 1) * chunk_s * 1000 + half
        lo = k * chunk_s * 1000 + half
        for t in turns:
            if t.start_ms < hi and (k == 0 or t.start_ms >= lo):
                merged.append(t)
    return merged


def _mmss(ms: int) -> str:
    s = ms // 1000
    return f"{s // 60:02d}:{s % 60:02d}"


def render_transcript_md(turns: list[Turn]) -> str:
    return "\n".join(
        f"**[{_mmss(t.start_ms)}] {t.speaker}:** {t.text}" + (" *(uncertain)*" if t.uncertain else "")
        for t in turns
    ) + ("\n" if turns else "")


def save_turns(folder, turns: list[Turn]) -> None:
    (Path(folder) / "transcript.json").write_text(
        json.dumps([asdict(t) for t in turns], ensure_ascii=False, indent=2), encoding="utf-8")


def load_turns(folder) -> list[Turn]:
    data = json.loads((Path(folder) / "transcript.json").read_text(encoding="utf-8"))
    return [Turn(**d) for d in data]
