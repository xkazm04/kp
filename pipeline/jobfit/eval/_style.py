"""Shared ANSI styling for the eval suite.

One colorizer and one ``should_color`` decision, used by every eval entry point
(:mod:`runner`, :mod:`matching_eval`, :mod:`seed_cv_fixtures`) so verdicts render
identically — PASS green, FAIL red — and the ``--no-color`` / ``NO_COLOR`` /
non-TTY opt-outs behave the same everywhere instead of being re-derived (and
quietly drifting) in three places.
"""
from __future__ import annotations

import os
import sys
from typing import Any, Callable, TextIO

# SGR codes by semantic name — the ONE palette for the whole eval suite.
_ANSI = {"green": "32", "red": "31", "yellow": "33", "bold": "1", "dim": "2"}


def _make_styler(enabled: bool) -> Callable[..., str]:
    """Return a colorizer; a no-op when color is disabled (piped output / NO_COLOR)."""
    def style(text: str, *names: str) -> str:
        codes = ";".join(_ANSI[n] for n in names if n in _ANSI)
        return f"\033[{codes}m{text}\033[0m" if enabled and codes else text
    return style


def should_color(args: Any = None, stream: TextIO | None = None) -> bool:
    """Whether to emit ANSI color on ``stream`` (defaults to stdout).

    Consolidates the three opt-outs in one place so every entry point agrees:

    - an explicit ``--no-color`` flag (read off the parsed ``args`` namespace
      when present; pass ``args=None`` for callers that have no such flag),
    - the ``NO_COLOR`` environment convention (any value, even empty, disables),
    - a non-TTY ``stream`` (piped / redirected / CI) — pass ``sys.stderr`` for
      progress written there rather than to stdout.
    """
    if getattr(args, "no_color", False):
        return False
    if os.getenv("NO_COLOR") is not None:
        return False
    target = stream if stream is not None else sys.stdout
    return target.isatty()
