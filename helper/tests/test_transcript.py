import pytest

from meetnotes.transcript import (
    Turn, TranscriptParseError, parse_chunk_output, merge_chunks,
    render_transcript_md, save_turns, load_turns, TRANSCRIBE_PROMPT,
)

RAW = '```json\n[{"start":"00:03","end":"00:09","speaker":"S1","text":"این endpoint رو باید refactor کنیم"},' \
      '{"start":"01:02","end":"01:05","speaker":"S2","text":"۵ story point"}]\n```'


def test_parse_strips_fences_and_offsets(chunk_at_600s):
    turns = parse_chunk_output(RAW, chunk_at_600s)
    assert turns[0].start_ms == 603000 and turns[0].label == "S1" and turns[0].chunk == 1
    assert turns[0].speaker == "S1" and turns[1].start_ms == 662000
    assert "endpoint" in turns[0].text and "refactor" in turns[0].text


def test_parse_bare_array_and_prose_and_hms(chunk_at_600s):
    arr = '[{"start":"01:00:01","end":"01:00:02","speaker":"S1","text":"x"}]'
    assert parse_chunk_output(arr, chunk_at_600s)[0].start_ms == 3601000 + 600000
    assert parse_chunk_output("Here you go:\n" + arr + "\nDone.", chunk_at_600s)[0].text == "x"


@pytest.mark.parametrize("raw", [
    "sorry I can't", '{"a":1}', '[1,2]', '[{"start":"00:01","end":"00:02","speaker":"S1"}]',
    '[{"start":"bad","end":"00:02","speaker":"S1","text":"t"}]',
])
def test_parse_garbage_raises(chunk_at_600s, raw):
    with pytest.raises(TranscriptParseError):
        parse_chunk_output(raw, chunk_at_600s)


def test_merge_uses_overlap_midpoint():
    a = [Turn(598000, 604000, "S1", "end of a", chunk=0, label="S1")]
    b = [Turn(601000, 604000, "S1", "dup", chunk=1, label="S1"), Turn(603000, 610000, "S2", "b", chunk=1, label="S2")]
    merged = merge_chunks([a, b], chunk_s=600, overlap_s=5)
    assert [t.text for t in merged] == ["end of a", "b"]


def test_render_and_roundtrip(tmp_path):
    turns = [Turn(65000, 70000, "Sina", "سلام API", uncertain=True), Turn(0, 1000, "Ali", "hi")]
    md = render_transcript_md(turns)
    assert md.splitlines()[0] == "**[01:05] Sina:** سلام API *(uncertain)*"
    assert md.splitlines()[1] == "**[00:00] Ali:** hi"
    save_turns(tmp_path, turns)
    assert "سلام" in (tmp_path / "transcript.json").read_text(encoding="utf-8")
    assert load_turns(tmp_path) == turns


def test_prompt_requires_latin_terms():
    assert "Latin" in TRANSCRIBE_PROMPT and "JSON" in TRANSCRIBE_PROMPT
