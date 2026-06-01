"""Shared terminal formatting for the seed generators' ``summarize()`` output.

The seed scripts print a corpus summary to stderr after a run. The *shape* of
the corpus (balanced across families? skewed senior?) is the whole point, so we
render each categorical distribution as a sorted mini bar chart — rows ordered by
count descending, labels left-aligned to a common width, counts right-aligned,
and a proportional inline bar — instead of a brace-littered ``dict`` repr.
"""

from __future__ import annotations

import sys
from collections import Counter
from typing import Any, Mapping


def _pick_bar_char() -> str:
    """Prefer the full block, but fall back to ASCII where the output stream can't encode it.

    The summary prints to stderr at the end of a seed run; on a Windows console
    redirected to a cp1250 pipe/file, ``█`` (U+2588) would raise UnicodeEncodeError
    and crash that final line. Degrade to ``#`` rather than risk it.
    """
    for stream in (sys.stdout, sys.stderr):
        enc = getattr(stream, "encoding", None)
        if not enc:
            continue
        try:
            "█".encode(enc)
        except (UnicodeError, LookupError):
            return "#"
    return "█"


# Solid bar; the bar is purely a visual proportion cue.
_BAR_CHAR = _pick_bar_char()
_BAR_WIDTH = 24


def format_distribution(title: str, counts: Mapping[Any, int], *, bar_width: int = _BAR_WIDTH) -> str:
    """Render ``counts`` as an aligned, count-sorted bar table under ``title``.

    Example::

        role_family:
          software_engineering   82  ████████████████████████
          data_ai                41  ████████████
          product_project        27  ████████

    Rows are sorted by count descending (ties keep first-seen order). The bar is
    scaled to the largest count, with any non-zero count getting at least one cell.
    """
    items = Counter(counts).most_common()
    if not items:
        return f"{title}: (empty)"

    label_w = max(len(str(label)) for label, _ in items)
    count_w = max(len(str(count)) for _, count in items)
    top = max(count for _, count in items) or 1

    lines = [f"{title}:"]
    for label, count in items:
        bar = _BAR_CHAR * (max(1, round(count / top * bar_width)) if count else 0)
        lines.append(f"  {str(label).ljust(label_w)}  {str(count).rjust(count_w)}  {bar}")
    return "\n".join(lines)
