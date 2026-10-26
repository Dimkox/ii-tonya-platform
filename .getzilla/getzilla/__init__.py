"""Getzilla runtime."""

import sys
from pathlib import Path as _Path

__version__ = "2.3.1"

# The .getzilla folder. This file stays a real file in every layout: a Getzilla checkout keeps the
# engine beside it as files, a lean install keeps it in getzilla.zip, which joins the package path.
STACK_DIR = _Path(__file__).resolve().parents[1]
ENGINE_ARCHIVE = STACK_DIR / 'getzilla.zip'
if ENGINE_ARCHIVE.is_file():
    __path__.insert(0, str(ENGINE_ARCHIVE / 'getzilla'))  # noqa: F821 - set by the import system


def _utf8_stdio() -> None:
    """Getzilla's CLIs exchange UTF-8 with agents, CI and pipes.

    Python encodes a redirected stdout/stderr with the locale code page on Windows (cp1251 on a
    Russian system), so JSON holding characters such as '\u2192' crashed the governance CLI. A
    console already reports utf-8; only other encodings are switched, keeping each error handler.
    """
    for stream in (sys.stdout, sys.stderr):
        reconfigure = getattr(stream, 'reconfigure', None)
        encoding = (getattr(stream, 'encoding', None) or '').replace('-', '').replace('_', '').lower()
        if reconfigure is not None and encoding != 'utf8':
            reconfigure(encoding='utf-8', errors=getattr(stream, 'errors', None) or 'strict')


_utf8_stdio()
