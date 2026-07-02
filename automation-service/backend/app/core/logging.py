# -*- coding: utf-8 -*-
"""로깅 설정"""

import logging
from .config import LOGS_DIR, ensure_dirs


def setup_logging() -> None:
    ensure_dirs()
    log_path = LOGS_DIR / "app.log"

    logger = logging.getLogger()
    logger.setLevel(logging.INFO)

    if logger.handlers:
        return

    fmt = logging.Formatter("[%(asctime)s] [%(levelname)s] %(message)s")

    fh = logging.FileHandler(log_path, encoding="utf-8")
    fh.setFormatter(fmt)
    logger.addHandler(fh)

    ch = logging.StreamHandler()
    ch.setFormatter(fmt)
    logger.addHandler(ch)
