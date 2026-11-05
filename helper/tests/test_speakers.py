from meetnotes.speakers import assign_speakers, rename_speaker
from meetnotes.transcript import Turn


def T(s, e, label, chunk=0):
    return Turn(s, e, label, "x", chunk=chunk, label=label)


def test_label_maps_to_dominant_name():
    log = [{"name": "Reza", "start_ms": 0, "end_ms": 5000}, {"name": "Sara", "start_ms": 5000, "end_ms": 9000}]
    out = assign_speakers([T(0, 4800, "S1"), T(5100, 8900, "S2")], log)
    assert [(t.speaker, t.uncertain) for t in out] == [("Reza", False), ("Sara", False)]


def test_no_log_gives_numbered_uncertain_speakers():
    out = assign_speakers([T(0, 1000, "S1"), T(1000, 2000, "S2"), T(2000, 3000, "S1")], [])
    assert [t.speaker for t in out] == ["Speaker 1", "Speaker 2", "Speaker 1"] and all(t.uncertain for t in out)


def test_same_label_in_different_chunks_mapped_independently():
    log = [{"name": "Reza", "start_ms": 0, "end_ms": 1000}, {"name": "Sara", "start_ms": 600000, "end_ms": 601000}]
    out = assign_speakers([T(0, 1000, "S1", 0), T(600000, 601000, "S1", 1)], log)
    assert [t.speaker for t in out] == ["Reza", "Sara"]


def test_rename_merges_into_existing_name_and_clears_uncertain():
    turns = [Turn(0, 1, "Speaker 4", "a", uncertain=True), Turn(1, 2, "Reza", "b")]
    out = rename_speaker(turns, "Speaker 4", "Reza")
    assert {t.speaker for t in out} == {"Reza"} and not any(t.uncertain for t in out)


def test_split_overlap_below_share_is_uncertain_and_numbering_is_global():
    log = [{"name": "Reza", "start_ms": 0, "end_ms": 2000}, {"name": "Sara", "start_ms": 2000, "end_ms": 4000}]
    turns = [T(0, 4000, "S1", 0), T(0, 4000, "S1", 1), T(0, 4000, "S2", 1)]
    out = assign_speakers(turns, log)
    assert [t.speaker for t in out] == ["Speaker 1", "Speaker 2", "Speaker 3"]
    assert all(t.uncertain for t in out)


def test_overlap_below_minimum_is_uncertain():
    log = [{"name": "Reza", "start_ms": 0, "end_ms": 500}]
    out = assign_speakers([T(0, 500, "S1")], log)
    assert out[0].speaker == "Speaker 1" and out[0].uncertain


def test_inputs_not_mutated_and_rename_leaves_others():
    turns = [T(0, 1000, "S1")]
    assign_speakers(turns, [])
    assert turns[0].speaker == "S1"
    out = rename_speaker([Turn(0, 1, "A", "a", uncertain=True), Turn(1, 2, "B", "b", uncertain=True)], "A", "C")
    assert [(t.speaker, t.uncertain) for t in out] == [("C", False), ("B", True)]
