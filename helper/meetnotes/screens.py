import json
from pathlib import Path

DESCRIBE_PROMPT = (
    "Describe this screenshot from a screen share in a work meeting, in 1-3 English sentences. "
    "Say which app or screen it is (give the Figma frame name if visible), the main UI components, "
    "and any readable titles or labels. Keep English technical terms and on-screen text verbatim "
    "in Latin script; do not translate or transliterate them. "
    "Only describe what is actually visible; do not guess or invent anything."
)

_EXTS = {".jpg", ".png"}


def _pick_evenly(items: list, k: int) -> list:
    n = len(items)
    if k >= n:
        return items
    if k == 1:
        return [items[0]]
    idx = sorted({round(i * (n - 1) / (k - 1)) for i in range(k)})
    return [items[i] for i in idx]


def describe_screens(folder: Path, client, model: str, max_screens: int = 60) -> float:
    folder = Path(folder)
    screens_dir = folder / "screens"
    found: list[tuple[int, Path]] = []
    if screens_dir.is_dir():
        for p in screens_dir.iterdir():
            if p.suffix.lower() in _EXTS and p.stem.isdecimal():
                found.append((int(p.stem), p))
    found.sort(key=lambda t: t[0])
    chosen = _pick_evenly(found, max_screens)

    entries = []
    total = 0.0
    for at_ms, path in chosen:
        text, cost = client.describe_image(path, model, DESCRIBE_PROMPT)
        total += cost
        entries.append({"file": f"screens/{path.name}", "at_ms": at_ms, "description": text})

    (folder / "screens.json").write_text(
        json.dumps(entries, ensure_ascii=False, indent=2), encoding="utf-8")
    return total
