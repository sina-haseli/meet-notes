"""ffmpeg-based duration probing and audio chunking."""
from __future__ import annotations

import math
import re
import shutil
import subprocess
from dataclasses import dataclass
from pathlib import Path

_TIME_RE = re.compile(r"time=(\d+):(\d+):(\d+(?:\.\d+)?)")


@dataclass
class Chunk:
    index: int
    path: Path
    offset_ms: int
    duration_ms: int


def ffmpeg_exe() -> str:
    exe = shutil.which("ffmpeg")
    if exe:
        return exe
    try:
        import imageio_ffmpeg

        return imageio_ffmpeg.get_ffmpeg_exe()
    except Exception as e:
        raise RuntimeError("ffmpeg not found on PATH") from e


def _run(args: list[str]) -> tuple[str, int]:
    """Run ffmpeg, return decoded stderr."""
    proc = subprocess.run([ffmpeg_exe(), *args], capture_output=True)
    return proc.stderr.decode("utf-8", errors="replace"), proc.returncode


def probe_duration_ms(path: Path) -> int:
    """Duration by decoding to null and reading the last time= stamp.

    MediaRecorder webm usually has no Duration header, so decoding is the
    reliable method.
    """
    err, _ = _run(["-nostdin", "-i", str(path), "-f", "null", "-"])
    times = _TIME_RE.findall(err)
    if not times:
        raise RuntimeError(f"could not determine duration of {path}")
    h, m, s = times[-1]
    return round((int(h) * 3600 + int(m) * 60 + float(s)) * 1000)


def split_audio(src: Path, out_dir: Path, chunk_s: int = 600, overlap_s: int = 5) -> list[Chunk]:
    """Split into mono 16 kHz 32 kbps mp3 chunks; chunk k starts at k*chunk_s
    and lasts chunk_s + overlap_s (clipped at the end)."""
    src, out_dir = Path(src), Path(out_dir)
    out_dir.mkdir(parents=True, exist_ok=True)
    total_ms = probe_duration_ms(src)
    count = max(1, math.ceil(total_ms / (chunk_s * 1000)))
    chunks: list[Chunk] = []
    for k in range(count):
        out = out_dir / f"chunk_{k:03d}.mp3"
        err, rc = _run([
            "-nostdin", "-y", "-ss", str(k * chunk_s), "-t", str(chunk_s + overlap_s),
            "-i", str(src), "-ac", "1", "-ar", "16000", "-b:a", "32k", str(out),
        ])
        if rc != 0 or not out.exists():
            raise RuntimeError(f"ffmpeg failed on chunk {k}: {err[-500:]}")
        chunks.append(Chunk(k, out, k * chunk_s * 1000, probe_duration_ms(out)))
    return chunks
