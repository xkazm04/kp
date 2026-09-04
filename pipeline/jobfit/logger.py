"""Structured JSONL logger for the analysis pipeline.

Writes one JSON line per analyze() invocation to ``tmp/pipeline.log`` with
total + per-stage timings, Gemini token usage, request id, and error info.

When ``KP_LOG_PROMPTS=1`` is set, the full Gemini prompt and response are also
captured to ``tmp/prompts/<request_id>-<suffix>`` — today ``<id>-prompt.txt``
and ``<id>-response.txt``. (This docstring claimed ``<request_id>.json`` for as
long as the module has existed; no writer ever emitted that name, so anyone
looking for the artifacts by the documented path found nothing.)

**These artifacts contain CV PII.** They are off by default, written
owner-only (0600, best-effort — a filesystem without POSIX modes, e.g. a
Windows FAT volume, silently keeps its own), and swept on a TTL: set
``KP_LOG_PROMPTS_TTL_H`` to a number of hours and each write first deletes
artifacts older than that. **With the variable unset the artifacts are NEVER
swept** — they accumulate until an operator removes ``tmp/prompts`` by hand.
That is the honest statement of the retention story, not a promise of one.

Nothing in this module may raise: logging is telemetry, never the request.
"""
from __future__ import annotations

import json
import os
import secrets
import stat
import time
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parents[2]
LOG_DIR = Path(os.getenv("KP_LOG_DIR") or (ROOT / "tmp"))
PIPELINE_LOG = LOG_DIR / "pipeline.log"
PROMPT_DIR = LOG_DIR / "prompts"

# Owner read/write only. The artifacts hold a candidate's whole CV; the process
# umask decides the default mode otherwise, and a permissive umask (0022 is the
# common default) makes them world-readable on a shared host.
_ARTIFACT_MODE = stat.S_IRUSR | stat.S_IWUSR  # 0o600


def new_request_id() -> str:
    return secrets.token_hex(8)


def _ensure_dir(path: Path) -> None:
    try:
        path.mkdir(parents=True, exist_ok=True)
    except Exception:
        # Logging must never break the request; swallow.
        pass


def append_pipeline_log(entry: dict[str, Any]) -> None:
    _ensure_dir(LOG_DIR)
    record = {"ts": time.strftime("%Y-%m-%dT%H:%M:%S", time.gmtime()) + "Z", **entry}
    try:
        with PIPELINE_LOG.open("a", encoding="utf-8") as fh:
            fh.write(json.dumps(record, ensure_ascii=False, default=str) + "\n")
    except Exception:
        # Same contract: a full disk or a read-only tmp must not fail an analysis.
        pass


def prompts_enabled() -> bool:
    return os.getenv("KP_LOG_PROMPTS", "").strip() not in ("", "0", "false", "False")


def prompt_ttl_hours() -> float | None:
    """Retention for prompt artifacts, in hours — ``None`` means never swept.

    Read per call (not cached at import) so an operator can turn retention on
    for a running install the same way every other KP_ flag works. A malformed
    or non-positive value is treated as unset: a broken number must not silently
    delete artifacts, nor silently look like a retention policy that is not one.
    """
    raw = (os.getenv("KP_LOG_PROMPTS_TTL_H") or "").strip()
    if not raw:
        return None
    try:
        hours = float(raw)
    except ValueError:
        return None
    return hours if hours > 0 else None


def sweep_prompt_artifacts(ttl_hours: float | None = None) -> int:
    """Delete prompt artifacts older than the TTL; return how many were removed.

    Called before each write (cheap: one directory listing), so retention needs
    no cron in a self-hosted install. ``0`` when retention is off, the directory
    is absent, or nothing has aged out. Never raises.
    """
    ttl = ttl_hours if ttl_hours is not None else prompt_ttl_hours()
    if ttl is None:
        return 0  # retention off — the documented default
    cutoff = time.time() - ttl * 3600
    removed = 0
    try:
        entries = list(PROMPT_DIR.iterdir())
    except Exception:
        # No directory yet, or unreadable: nothing to sweep, nothing to report.
        return 0
    for entry in entries:
        try:
            if entry.is_file() and entry.stat().st_mtime < cutoff:
                entry.unlink()
                removed += 1
        except Exception:
            # One unremovable artifact (locked, vanished mid-sweep) must not
            # abort the sweep of the rest, nor the write that triggered it.
            continue
    return removed


def write_prompt_artifact(request_id: str, suffix: str, content: str) -> None:
    """Capture one prompt/response artifact under ``tmp/prompts`` (opt-in).

    No-op unless ``KP_LOG_PROMPTS`` is set. Writes ``<request_id>-<suffix>``
    owner-only, after sweeping anything past ``KP_LOG_PROMPTS_TTL_H``.
    """
    if not prompts_enabled():
        return
    _ensure_dir(PROMPT_DIR)
    sweep_prompt_artifacts()
    target = PROMPT_DIR / f"{request_id}-{suffix}"
    try:
        # Create with the restricted mode rather than write-then-chmod: the
        # latter leaves a window where the CV is readable by everyone.
        fd = os.open(target, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, _ARTIFACT_MODE)
        with os.fdopen(fd, "w", encoding="utf-8") as fh:
            fh.write(content)
    except Exception:
        # Telemetry, never the request. An unwritable tmp, a name the platform
        # rejects, a full disk — the analysis still returns.
        return
    try:
        # O_CREAT honours the mode only when the file is NEW; an artifact that
        # already existed keeps its old (possibly wider) permissions otherwise.
        os.chmod(target, _ARTIFACT_MODE)
    except Exception:
        # Best-effort: filesystems without POSIX modes (FAT, some network
        # mounts) reject this. The artifact is still written; the mode is theirs.
        pass


class StageTimer:
    """Context manager that accumulates per-stage durations into a dict.

    Usage:
        timings: dict[str, int] = {}
        with StageTimer(timings, "extract"):
            ...
    """

    def __init__(self, sink: dict[str, int], name: str) -> None:
        self.sink = sink
        self.name = name
        self._start = 0.0

    def __enter__(self) -> "StageTimer":
        self._start = time.monotonic()
        return self

    def __exit__(self, *_exc: object) -> None:
        self.sink[self.name] = int((time.monotonic() - self._start) * 1000)
