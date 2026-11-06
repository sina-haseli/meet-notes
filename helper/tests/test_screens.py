import json

from meetnotes.screens import describe_screens


class FakeClient:
    def __init__(self):
        self.calls = []

    def describe_image(self, path, model, prompt):
        self.calls.append((path, model, prompt))
        return "Figma: Wallet top-up screen", 0.001


def _make(folder, names):
    d = folder / "screens"
    d.mkdir()
    for n in names:
        (d / n).write_bytes(b"\xff\xd8fake")


def _read(folder):
    return json.loads((folder / "screens.json").read_text(encoding="utf-8"))


def test_writes_sorted_descriptions_and_cost(tmp_path):
    _make(tmp_path, ["2000.jpg", "500.jpg", "10000.jpg"])
    cost = describe_screens(tmp_path, FakeClient(), "m")
    data = _read(tmp_path)
    assert [e["at_ms"] for e in data] == [500, 2000, 10000]
    assert data[0] == {"file": "screens/500.jpg", "at_ms": 500,
                       "description": "Figma: Wallet top-up screen"}
    assert cost == 0.003


def test_caps_to_max_screens_keeping_first_and_last(tmp_path):
    _make(tmp_path, [f"{i * 100}.jpg" for i in range(1, 101)])
    client = FakeClient()
    describe_screens(tmp_path, client, "m", max_screens=10)
    data = _read(tmp_path)
    assert len(data) == 10
    assert data[0]["at_ms"] == 100
    assert data[-1]["at_ms"] == 10000
    assert len(client.calls) == 10


def test_no_screens_writes_empty_list(tmp_path):
    assert describe_screens(tmp_path, FakeClient(), "m") == 0.0
    assert _read(tmp_path) == []


def test_ignores_non_integer_stems_and_accepts_png(tmp_path):
    _make(tmp_path, ["abc.jpg", "300.png", "100.jpg", "notes.txt"])
    describe_screens(tmp_path, FakeClient(), "m")
    assert [e["file"] for e in _read(tmp_path)] == ["screens/100.jpg", "screens/300.png"]


def test_failure_writes_no_screens_json(tmp_path):
    import pytest
    from meetnotes.openrouter import OpenRouterError

    class Bad:
        def describe_image(self, path, model, prompt):
            raise OpenRouterError("boom")

    _make(tmp_path, ["100.jpg"])
    with pytest.raises(OpenRouterError):
        describe_screens(tmp_path, Bad(), "m")
    assert not (tmp_path / "screens.json").exists()
