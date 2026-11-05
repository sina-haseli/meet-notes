"""Map (chunk, voice label) keys to participant names using the speaker log."""
from __future__ import annotations

from collections import defaultdict
from dataclasses import replace

from meetnotes.transcript import Turn


def _overlap(a_start: int, a_end: int, b_start: int, b_end: int) -> int:
    return max(0, min(a_end, b_end) - max(a_start, b_start))


def assign_speakers(
    turns: list[Turn], log: list[dict], min_share: float = 0.6, min_overlap_ms: int = 1000
) -> list[Turn]:
    overlaps: dict[tuple[int, str], dict[str, int]] = defaultdict(lambda: defaultdict(int))
    for t in turns:
        per_name = overlaps[(t.chunk, t.label)]
        for entry in log:
            ms = _overlap(t.start_ms, t.end_ms, entry["start_ms"], entry["end_ms"])
            if ms > 0:
                per_name[entry["name"]] += ms

    resolved: dict[tuple[int, str], str | None] = {}
    for key, per_name in overlaps.items():
        total = sum(per_name.values())
        name, best = max(per_name.items(), key=lambda kv: kv[1], default=(None, 0))
        resolved[key] = name if name is not None and best >= min_overlap_ms and best / total >= min_share else None

    numbers: dict[tuple[int, str], int] = {}
    out: list[Turn] = []
    for t in turns:
        key = (t.chunk, t.label)
        name = resolved[key]
        if name is not None:
            out.append(replace(t, speaker=name, uncertain=False))
        else:
            n = numbers.setdefault(key, len(numbers) + 1)
            out.append(replace(t, speaker=f"Speaker {n}", uncertain=True))
    return out


def rename_speaker(turns: list[Turn], old: str, new: str) -> list[Turn]:
    return [replace(t, speaker=new, uncertain=False) if t.speaker == old else t for t in turns]
