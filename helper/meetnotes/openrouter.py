"""Minimal OpenRouter client (audio transcription, image description, cost).

Endpoint choice: POST /api/v1/chat/completions with an `input_audio` content
part. Verified against https://openrouter.ai/docs/features/multimodal/audio:
chat completions accepts `input_audio` (mp3 is supported); the Responses API
(/api/v1/responses) is the alternative and is not needed. No retries here;
the pipeline owns retry policy.
"""
from __future__ import annotations

import base64
from pathlib import Path

import httpx

from meetnotes.audio import Chunk
from meetnotes.transcript import TRANSCRIBE_PROMPT

URL = "https://openrouter.ai/api/v1/chat/completions"


class OpenRouterError(RuntimeError):
    pass


class OpenRouter:
    def __init__(self, api_key: str, client: httpx.Client | None = None):
        self.api_key = api_key
        self.client = client or httpx.Client(timeout=300)

    def _complete(self, content: list[dict], model: str) -> tuple[str, float]:
        resp = self.client.post(
            URL,
            headers={"Authorization": f"Bearer {self.api_key}"},
            json={"model": model, "messages": [{"role": "user", "content": content}],
                  "usage": {"include": True}},
        )
        if resp.status_code < 200 or resp.status_code >= 300:
            raise OpenRouterError(f"OpenRouter HTTP {resp.status_code}: {resp.text[:500]}")
        data = resp.json()
        try:
            text = data["choices"][0]["message"]["content"]
        except (KeyError, IndexError, TypeError) as e:
            raise OpenRouterError(f"unexpected OpenRouter response: {str(data)[:500]}") from e
        cost = (data.get("usage") or {}).get("cost") or 0.0
        return text, float(cost)

    def transcribe_chunk(self, chunk: Chunk, model: str) -> tuple[str, float]:
        b64 = base64.b64encode(Path(chunk.path).read_bytes()).decode("ascii")
        return self._complete([
            {"type": "text", "text": TRANSCRIBE_PROMPT},
            {"type": "input_audio", "input_audio": {"data": b64, "format": "mp3"}},
        ], model)

    def describe_image(self, path: Path, model: str, prompt: str) -> tuple[str, float]:
        path = Path(path)
        mime = "image/png" if path.suffix.lower() == ".png" else "image/jpeg"
        b64 = base64.b64encode(path.read_bytes()).decode("ascii")
        return self._complete([
            {"type": "text", "text": prompt},
            {"type": "image_url", "image_url": {"url": f"data:{mime};base64,{b64}"}},
        ], model)
