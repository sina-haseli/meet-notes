import logging
import sys
from pathlib import Path

import uvicorn

from .config import default_config_path, load_config
from .server import create_app


def ensure_streams(log_path: Path) -> bool:
    """Under pythonw (the Startup shortcut) sys.stdout/sys.stderr are None and uvicorn's
    log formatter crashes on None.isatty(). Point both at the log file in that case.
    Returns True when the streams were redirected."""
    if sys.stdout is not None and sys.stderr is not None:
        return False
    log_path.parent.mkdir(parents=True, exist_ok=True)
    stream = open(log_path, "a", encoding="utf-8", buffering=1)  # line-buffered
    sys.stdout = stream
    sys.stderr = stream
    return True


def configure_logging(log_path: Path, redirected: bool) -> None:
    """Always log to helper.log; also to the console when there is one."""
    if redirected:
        # stderr already is helper.log; one handle avoids duplicated lines.
        handlers: list[logging.Handler] = [logging.StreamHandler(sys.stderr)]
    else:
        log_path.parent.mkdir(parents=True, exist_ok=True)
        handlers = [logging.FileHandler(log_path, encoding="utf-8"), logging.StreamHandler()]
    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s %(levelname)s %(name)s: %(message)s",
        handlers=handlers,
        force=True,
    )


def main() -> None:
    log_path = default_config_path().parent / "helper.log"
    redirected = ensure_streams(log_path)
    configure_logging(log_path, redirected)
    uvicorn.run(create_app(load_config()), host="127.0.0.1", port=47821)


if __name__ == "__main__":
    main()
