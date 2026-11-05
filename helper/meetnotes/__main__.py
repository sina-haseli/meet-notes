import logging

import uvicorn

from .config import load_config
from .server import create_app


def main() -> None:
    logging.basicConfig(level=logging.INFO)
    uvicorn.run(create_app(load_config()), host="127.0.0.1", port=47821)


if __name__ == "__main__":
    main()
