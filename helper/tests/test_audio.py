from meetnotes.audio import probe_duration_ms, split_audio


def test_probe_duration(make_tone):
    assert abs(probe_duration_ms(make_tone(5)) - 5000) < 300


def test_short_audio_one_chunk(tmp_path, make_tone):
    chunks = split_audio(make_tone(5), tmp_path)
    assert len(chunks) == 1 and chunks[0].offset_ms == 0 and abs(chunks[0].duration_ms - 5000) < 300


def test_long_audio_chunk_offsets(tmp_path, make_tone):
    chunks = split_audio(make_tone(25), tmp_path, chunk_s=10, overlap_s=2)
    assert [c.offset_ms for c in chunks] == [0, 10000, 20000]
    assert abs(chunks[0].duration_ms - 12000) < 300 and abs(chunks[2].duration_ms - 5000) < 300
    assert all(c.path.suffix == ".mp3" and c.path.exists() for c in chunks)


def test_creates_out_dir(tmp_path, make_tone):
    out = tmp_path / "a" / "chunks"
    chunks = split_audio(make_tone(3), out)
    assert chunks[0].path.parent == out
