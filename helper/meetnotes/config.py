from __future__ import annotations

import os
import secrets
import tomllib
from dataclasses import dataclass, field, fields
from pathlib import Path
from typing import Literal

import tomli_w


def default_config_path() -> Path:
    return Path(os.environ["APPDATA"]) / "meetnotes" / "config.toml"


@dataclass
class Config:
    token: str = ""
    notes_root: Path = Path("D:/meeting-notes")
    repos: list[Path] = field(default_factory=lambda: [Path("D:/kifepool")])
    openrouter_api_key: str = ""
    transcribe_model: str = "google/gemini-2.5-flash"
    vision_model: str = "google/gemini-2.5-flash"
    self_name: str = "Sina"
    last_recipients: list[str] = field(default_factory=list)
    mail_method: Literal["gmail_api", "smtp"] = "gmail_api"
    mail_from: str = ""
    smtp_app_password: str = ""
    # Where this config was loaded from; never serialized.
    path: Path | None = None


_PATH_FIELDS = {"notes_root"}
_PATH_LIST_FIELDS = {"repos"}


def _to_toml_dict(cfg: Config) -> dict:
    out: dict = {}
    for f in fields(cfg):
        if f.name == "path":
            continue
        v = getattr(cfg, f.name)
        if f.name in _PATH_FIELDS:
            v = str(v)
        elif f.name in _PATH_LIST_FIELDS:
            v = [str(p) for p in v]
        out[f.name] = v
    return out


def save_config(cfg: Config, path: Path | None = None) -> None:
    target = path or cfg.path
    if target is None:
        raise ValueError("no config path given and cfg.path is unset")
    target = Path(target)
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_bytes(tomli_w.dumps(_to_toml_dict(cfg)).encode("utf-8"))


def load_config(path: Path | None = None) -> Config:
    path = Path(path) if path else default_config_path()
    if not path.exists():
        cfg = Config(token=secrets.token_hex(32), path=path)
        save_config(cfg, path)
        return cfg
    data = tomllib.loads(path.read_text(encoding="utf-8"))
    known = {f.name for f in fields(Config)} - {"path"}
    kwargs = {k: v for k, v in data.items() if k in known}
    if "notes_root" in kwargs:
        kwargs["notes_root"] = Path(kwargs["notes_root"])
    if "repos" in kwargs:
        kwargs["repos"] = [Path(p) for p in kwargs["repos"]]
    cfg = Config(**kwargs, path=path)
    if not cfg.token:
        cfg.token = secrets.token_hex(32)
        save_config(cfg, path)
    return cfg
