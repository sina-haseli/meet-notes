import json

import httpx
import pytest

from meetnotes.openrouter import OpenRouter, OpenRouterError


def test_transcribe_chunk_sends_audio_and_returns_cost(respx_mock, tiny_chunk):
    route = respx_mock.post("https://openrouter.ai/api/v1/chat/completions").respond(
        json={"choices": [{"message": {"content": "[]"}}], "usage": {"cost": 0.0123}})
    text, cost = OpenRouter("k").transcribe_chunk(tiny_chunk, "m")
    req = route.calls[0].request
    body = json.loads(req.content)
    assert body["messages"][0]["content"][1]["type"] == "input_audio"
    assert body["messages"][0]["content"][1]["input_audio"]["format"] == "mp3"
    assert body["usage"] == {"include": True} and body["model"] == "m"
    assert req.headers["authorization"] == "Bearer k"
    assert cost == 0.0123 and text == "[]"


def test_missing_cost_is_zero(respx_mock, tiny_chunk):
    respx_mock.post("https://openrouter.ai/api/v1/chat/completions").respond(
        json={"choices": [{"message": {"content": "x"}}]})
    assert OpenRouter("k").transcribe_chunk(tiny_chunk, "m") == ("x", 0.0)


def test_error_status_raises_with_body(respx_mock, tiny_chunk):
    respx_mock.post("https://openrouter.ai/api/v1/chat/completions").respond(402, text="no credits" + "x" * 900)
    with pytest.raises(OpenRouterError) as e:
        OpenRouter("k").transcribe_chunk(tiny_chunk, "m")
    msg = str(e.value)
    assert "402" in msg and "no credits" in msg and len(msg) < 700


def test_describe_image(respx_mock, tmp_path):
    img = tmp_path / "a.png"
    img.write_bytes(b"\x89PNGdata")
    route = respx_mock.post("https://openrouter.ai/api/v1/chat/completions").respond(
        json={"choices": [{"message": {"content": "a slide"}}], "usage": {"cost": 0.5}})
    text, cost = OpenRouter("k", client=httpx.Client()).describe_image(img, "m", "describe")
    part = json.loads(route.calls[0].request.content)["messages"][0]["content"]
    assert part[0] == {"type": "text", "text": "describe"}
    assert part[1]["image_url"]["url"].startswith("data:image/png;base64,")
    assert (text, cost) == ("a slide", 0.5)
