from pathlib import Path

from meetnotes.config import load_config, save_config


def test_load_config_creates_file_with_token(tmp_path):
    cfg = load_config(tmp_path / "config.toml")
    assert len(cfg.token) == 64 and (tmp_path / "config.toml").exists()
    assert load_config(tmp_path / "config.toml").token == cfg.token
    assert cfg.notes_root == Path("D:/meeting-notes") and cfg.repos == [Path("D:/kifepool")]


def test_save_config_roundtrip_uses_cfg_path(tmp_path):
    cfg = load_config(tmp_path / "config.toml")
    cfg.self_name = "Ali"
    cfg.last_recipients = ["a@x.com"]
    save_config(cfg)
    again = load_config(tmp_path / "config.toml")
    assert again.self_name == "Ali" and again.last_recipients == ["a@x.com"]
    assert again.path == tmp_path / "config.toml"
