from __future__ import annotations

import json
import re
from pathlib import Path

_ILLEGAL_OR_SPACE = re.compile(r'[<>:"/\|?*\x00-\x1f\s]+')


def slugify(title: str) -> str:
    slug = _ILLEGAL_OR_SPACE.sub("-", title or "")
    slug = re.sub(r"-{2,}", "-", slug).strip("-.")
    return slug or "meeting"


def read_meta(folder: Path) -> dict:
    return json.loads((Path(folder) / "meta.json").read_text(encoding="utf-8"))


def _dump_meta(folder: Path, meta: dict) -> None:
    (Path(folder) / "meta.json").write_text(
        json.dumps(meta, ensure_ascii=False, indent=2), encoding="utf-8")


def write_meta(folder: Path, **updates) -> dict:
    meta = read_meta(folder)
    meta.update(updates)
    _dump_meta(folder, meta)
    return meta


def create_meeting(root: Path, meta: dict) -> Path:
    root = Path(root)
    root.mkdir(parents=True, exist_ok=True)
    started_at = meta.get("started_at") or ""
    date = started_at[:10] if re.fullmatch(r"\d{4}-\d{2}-\d{2}", started_at[:10]) else ""
    if not date:
        from datetime import datetime
        date = datetime.now().strftime("%Y-%m-%d")
        started_at = started_at or datetime.now().astimezone().isoformat(timespec="seconds")
    mtype = meta.get("type") or "technical"
    base = f"{date}_{mtype}_{slugify(meta.get('title', ''))}"
    folder, n = root / base, 1
    while True:
        try:
            folder.mkdir()
            break
        except FileExistsError:
            n += 1
            folder = root / f"{base}-{n}"
    full = {
        "id": folder.name,
        "title": meta.get("title", ""),
        "type": mtype,
        "started_at": started_at,
        "duration_ms": meta.get("duration_ms", 0),
        "self_name": meta.get("self_name", ""),
        "participants": list(meta.get("participants", [])),
        "status": "processing",
        "step": "chunking",
        "error": None,
        "cost_usd": 0.0,
        "recipients": [],
        "sent_at": None,
    }
    _dump_meta(folder, full)
    return folder


def list_meetings(root: Path) -> list[dict]:
    root = Path(root)
    if not root.is_dir():
        return []
    metas = []
    for d in root.iterdir():
        if (d / "meta.json").is_file():
            try:
                metas.append(read_meta(d))
            except (OSError, ValueError):
                continue
    metas.sort(key=lambda m: (m.get("started_at", ""), m.get("id", "")), reverse=True)
    return metas


def meeting_dir(root: Path, id: str) -> Path:
    if not id or "/" in id or "\\" in id or ".." in id:
        raise KeyError(id)
    d = Path(root) / id
    if not (d / "meta.json").is_file():
        raise KeyError(id)
    return d
