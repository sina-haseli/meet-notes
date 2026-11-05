import subprocess
from pathlib import Path

import pytest

from meetnotes.audio import ffmpeg_exe


@pytest.fixture
def make_tone(tmp_path_factory):
    """make_tone(seconds) -> path to a mono sine-wave file (webm/opus)."""
    d = tmp_path_factory.mktemp("tones")

    def _make(seconds: int) -> Path:
        out = d / f"tone_{seconds}.webm"
        subprocess.run(
            [ffmpeg_exe(), "-y", "-f", "lavfi", "-i",
             f"sine=frequency=440:duration={seconds}", "-c:a", "libopus", str(out)],
            check=True, capture_output=True,
        )
        return out

    return _make


@pytest.fixture
def chunk_at_600s(tmp_path):
    from meetnotes.audio import Chunk
    return Chunk(1, tmp_path / "chunk_1.mp3", 600000, 605000)


@pytest.fixture
def tiny_chunk(tmp_path):
    from meetnotes.audio import Chunk
    p = tmp_path / "tiny.mp3"
    p.write_bytes(b"ID3fakeaudio")
    return Chunk(0, p, 0, 1000)
