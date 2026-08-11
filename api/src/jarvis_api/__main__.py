from __future__ import annotations

import logging

from aiohttp import web

from .app import create_app
from .config import Config


def main() -> None:
    logging.basicConfig(level=logging.INFO, format="%(levelname)s jarvis-api %(message)s")
    config = Config.from_env()
    web.run_app(
        create_app(config),
        host=config.host,
        port=config.port,
        access_log=None,
        print=None,
    )


if __name__ == "__main__":
    main()
