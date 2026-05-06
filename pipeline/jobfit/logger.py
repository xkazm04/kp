"""Structured JSONL logger for the analysis pipeline.

Writes one JSON line per analyze() invocation to ``tmp/pipeline.log`` with
total + per-stage timings, Gemini token usage, request id, and error info.
When ``KP_LOG_PROMPTS=1`` is set, the full Gemini prompt and response are
also captured to ``tmp/prompts/<request_id>.json`` (off by default — these
artifacts contain CV PII and can be large).
"""
from __future__ import annotations

import json
import os
import secrets
import time
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parents[2]
LOG_DIR = Path(os.getenv("KP_LOG_DIR") or (ROOT / "tmp"))
PIPELINE_LOG = LOG_DIR / "pipeline.log"
PROMPT_DIR = LOG_DIR / "prompts"


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
        pass


def prompts_enabled() -> bool:
    return os.getenv("KP_LOG_PROMPTS", "").strip() not in ("", "0", "false", "False")


def write_prompt_artifact(request_id: str, suffix: str, content: str) -> None:
    if not prompts_enabled():
        return
    _ensure_dir(PROMPT_DIR)
    target = PROMPT_DIR / f"{request_id}-{suffix}"
    try:
        target.write_text(content, encoding="utf-8")
    except Exception:
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
