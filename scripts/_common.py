"""Shared helpers for the headless analysis scripts.

Each script in this folder calls into ``pipeline.jobfit.service.analyze`` and
renders a focused slice of the result for the terminal. This module owns:

* ANSI color helpers that degrade to plain text when stdout is not a TTY
  or ``NO_COLOR`` is set.
* Minimal box / section / bullet renderers so every script looks the same.
* A small wrapper around ``analyze()`` that prints stage progress to stderr.
"""

from __future__ import annotations

import argparse
import os
import shutil
import sys
from pathlib import Path
from typing import Any, Iterable, Sequence

# Make the project root importable so the scripts can be launched from
# anywhere — both ``python scripts/analyze.py ...`` and
# ``python -m scripts.analyze ...`` work.
ROOT = Path(__file__).resolve().parent.parent
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from pipeline.jobfit.service import analyze as _analyze  # noqa: E402

if os.name == "nt":
    # Trigger ConPTY so ANSI escapes render in legacy cmd.exe sessions.
    os.system("")

USE_COLOR = sys.stdout.isatty() and os.environ.get("NO_COLOR") is None


def _c(code: str) -> str:
    return f"\033[{code}m" if USE_COLOR else ""


RESET = _c("0")
BOLD = _c("1")
DIM = _c("2")
RED = _c("31")
GREEN = _c("32")
YELLOW = _c("33")
BLUE = _c("34")
MAGENTA = _c("35")
CYAN = _c("36")
GRAY = _c("90")


def term_width(default: int = 88) -> int:
    try:
        return min(shutil.get_terminal_size((default, 20)).columns, 120)
    except OSError:
        return default


def header(title: str, *, color: str = CYAN) -> None:
    width = term_width()
    bar = "─" * max(4, width - len(title) - 4)
    print(f"\n{color}╭─ {BOLD}{title}{RESET}{color} {bar}╮{RESET}")


def footer(*, color: str = CYAN) -> None:
    width = term_width()
    print(f"{color}╰{'─' * (width - 2)}╯{RESET}")


def section(title: str) -> None:
    print(f"\n{BOLD}{title}{RESET}")
    print(f"{GRAY}{'·' * len(title)}{RESET}")


def kv(label: str, value: Any, *, label_width: int = 18, value_color: str = "") -> None:
    if value is None or value == "":
        value = "—"
    print(f"  {DIM}{label.ljust(label_width)}{RESET} {value_color}{value}{RESET}")


def bullets(items: Iterable[str], *, prefix: str = "•", color: str = "") -> None:
    rendered = [str(i) for i in items if str(i).strip()]
    if not rendered:
        print(f"  {DIM}(none){RESET}")
        return
    for item in rendered:
        wrapped = _wrap(item, indent=4)
        print(f"  {color}{prefix}{RESET} {wrapped}")


def _wrap(text: str, *, indent: int) -> str:
    """Wrap ``text`` to terminal width with continuation indent."""
    width = term_width() - indent - 2
    if width < 20 or len(text) <= width:
        return text
    words = text.split()
    lines: list[str] = []
    current = ""
    for word in words:
        if not current:
            current = word
        elif len(current) + 1 + len(word) <= width:
            current += " " + word
        else:
            lines.append(current)
            current = word
    if current:
        lines.append(current)
    pad = " " * indent
    return ("\n" + pad).join(lines)


# Score→tone cutoffs, mirrored from scoreTone() in app/_lib/format.ts (the
# canonical source: SCORE_STRONG_MIN / SCORE_MID_MIN). Kept in lockstep so a
# score is colored the same in the terminal as in the web UI — >=75 green/strong,
# >=50 yellow/mid, else red/weak. Update both sides together if the bands change.
SCORE_STRONG_MIN = 75
SCORE_MID_MIN = 50


def score_color(score: int, *, good: int = SCORE_STRONG_MIN, ok: int = SCORE_MID_MIN) -> str:
    if score >= good:
        return GREEN
    if score >= ok:
        return YELLOW
    return RED


def progress_bar(value: int, *, total: int = 100, width: int = 24) -> str:
    """Return a simple ASCII progress bar with embedded value/total."""
    pct = max(0, min(total, value)) / total
    filled = int(round(pct * width))
    bar = "█" * filled + "░" * (width - filled)
    color = score_color(value)
    return f"{color}{bar}{RESET} {BOLD}{value}{RESET}/{total}"


def format_money(amount: int | float | None, *, currency: str = "CZK") -> str:
    if amount is None:
        return "—"
    return f"{int(amount):,} {currency}".replace(",", " ")


def add_common_args(parser: argparse.ArgumentParser, *, require_jd: bool = False) -> None:
    parser.add_argument("cv", type=Path, help="Path to a CV / profile file (PDF, DOCX, TXT, MD).")
    jd_help = "Path to a job description file."
    if require_jd:
        parser.add_argument("--jd", type=Path, required=True, help=jd_help)
    else:
        parser.add_argument("--jd", type=Path, help=jd_help)
    parser.add_argument("--jd-text", help="Inline job description text (alternative to --jd).")
    parser.add_argument("--company", type=Path, help="Path to a company-overview file.")
    parser.add_argument("--company-text", help="Inline company-overview text.")
    parser.add_argument(
        "--grounding",
        action="store_true",
        help="Enable Google Search grounding for live market context.",
    )
    parser.add_argument(
        "--quiet",
        action="store_true",
        help="Suppress stage progress logging on stderr.",
    )


def run_analysis(args: argparse.Namespace) -> dict[str, Any]:
    """Invoke the pipeline with progress logging on stderr."""
    if not args.cv.exists():
        print(f"{RED}error:{RESET} CV file not found: {args.cv}", file=sys.stderr)
        sys.exit(2)

    progress = None
    if not args.quiet:
        def progress(stage: str, status: str) -> None:
            mark = {"start": "→", "ok": "✓", "skip": "·", "error": "✗"}.get(status, status)
            color = {"ok": GREEN, "error": RED, "skip": GRAY}.get(status, CYAN)
            print(f"{color}{mark}{RESET} {DIM}{stage}{RESET}", file=sys.stderr)

    try:
        return _analyze(
            args.cv,
            grounding=args.grounding,
            job_description_path=getattr(args, "jd", None),
            job_description_text=getattr(args, "jd_text", None),
            company_path=getattr(args, "company", None),
            company_text=getattr(args, "company_text", None),
            progress=progress,
        )
    except ValueError as exc:
        print(f"{RED}error:{RESET} {exc}", file=sys.stderr)
        sys.exit(2)
    except Exception as exc:  # pragma: no cover — surfaces upstream failures
        print(f"{RED}error:{RESET} {exc}", file=sys.stderr)
        sys.exit(1)


def get(payload: dict[str, Any], *path: str, default: Any = None) -> Any:
    """Walk a dotted path through nested dict/list payloads."""
    cur: Any = payload
    for key in path:
        if cur is None:
            return default
        if isinstance(cur, dict):
            cur = cur.get(key)
        else:
            return default
    return cur if cur is not None else default


def truncate(text: str, *, limit: int) -> str:
    if not text:
        return ""
    if len(text) <= limit:
        return text
    return text[: limit - 1].rstrip() + "…"


def render_candidate_summary(payload: dict[str, Any]) -> None:
    """Compact one-line candidate identity used at the top of every script."""
    candidate = payload.get("candidate", {})
    name = candidate.get("name") or "Candidate"
    role = candidate.get("roleFamily") or "—"
    seniority = candidate.get("currentSeniority") or "—"
    years = candidate.get("yearsExperience")
    years_str = f"{years:g} yrs" if isinstance(years, (int, float)) else "—"
    print(
        f"{BOLD}{name}{RESET}  "
        f"{DIM}·{RESET}  {role}  "
        f"{DIM}·{RESET}  {seniority}  "
        f"{DIM}·{RESET}  {years_str}"
    )


def join_short(items: Sequence[str], *, limit: int = 12) -> str:
    if not items:
        return "—"
    head = list(items)[:limit]
    suffix = "" if len(items) <= limit else f" {DIM}(+{len(items) - limit} more){RESET}"
    return ", ".join(head) + suffix
