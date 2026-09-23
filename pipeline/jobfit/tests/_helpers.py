"""Shared test factories + named thresholds for the unittest suite.

This is a plain importable module, NOT a pytest ``conftest.py`` — the suite runs
under ``python -m unittest discover`` (see package.json ``test:python``), where
conftest fixtures would never fire. Import the factories explicitly.
"""
from __future__ import annotations

import contextlib
import io
import json
import os
import re
import tempfile
from collections.abc import Callable, Mapping, Sequence
from contextlib import contextmanager
from dataclasses import dataclass
from pathlib import Path
from typing import Any
from unittest import mock

from pipeline.jobfit import _cli
from pipeline.jobfit.jobs import normalize_job

# Named thresholds, replacing inline magic numbers across the suite.
STRONG_SKILL_SCORE = 0.6  # a confident must-have skill match
PARTIAL_SKILL_SCORE = 0.5  # a transferable/adjacent skill match
MIN_CONFIDENCE_SPREAD = 8  # min total spread between confidence_high/low
MIN_LINKEDIN_TEXT_LEN = 5000  # a real LinkedIn export is at least this long


def mkjob(**over):
    """A normalized job with sensible defaults; override any field via kwargs."""
    base = {
        "title": "Role",
        "seniority": "senior",
        "role_family": "software_engineering",
        "languages": ["English"],
        "description": "A team building things.",
        "requirements": [{"skill": "Python", "kind": "must_have", "hardness": "prerequisite"}],
    }
    base.update(over)
    return normalize_job(base)


@contextmanager
def env(*clear: str, **overrides: str | None):
    """Isolate named env vars for the block; the rest of the environment survives.

    Four modules had each grown their own version of this — two as `_clean_env`
    rebuilding `os.environ` into a `mock.patch.dict(..., clear=True)`, two as
    ad-hoc pop/restore in a try/finally — and they disagreed on the part that
    matters: a `clear=True` patch also deletes PATH, TMP and the suite's own
    hermeticity vars, so a test written that way passes locally and fails wherever
    the code under test shells out. This one CLEARS ONLY WHAT IT IS TOLD TO.

        with env("ELEVENLABS_API_KEY", "KP_OFFLINE"):        # unset these
        with env(ENV_VAR, OPENAI_API_KEY="k"):               # unset one, set one
        with env(OPENAI_BASE_URL=None):                      # None also unsets

    Positional names are unset; keyword `None` is unset; any other keyword value is
    set. Restoration is `mock.patch.dict`'s, so it survives an exception in the body.
    """
    with mock.patch.dict(os.environ, {}, clear=False):
        for key in clear:
            os.environ.pop(key, None)
        for key, value in overrides.items():
            if value is None:
                os.environ.pop(key, None)
            else:
                os.environ[key] = value
        yield


# ── Reading a CLI the way the bridge reads it ─────────────────────────────────
#
# Every CLI here exists to be read by ONE program, app/_lib/python-runner.ts. The CLI
# suites used to parse output their own way — whole-stdout ``json.loads(out or "{}")``
# (an EMPTY stdout read as ``{}``), a strict last line, an inline re-parse of stderr —
# i.e. through a reader production never runs. The two functions below port the
# bridge's readers line for line; ``fixtures/bridge_read_cases.json`` pins them to the
# originals (test_bridge_reader.py runs the port over it, python-runner-bridge-cases
# .test.ts runs the real TS). Change one reader and not the other, and a suite goes red.

# JS String.prototype.trim() strips WhiteSpace + LineTerminator, which is NOT
# str.strip()'s set (Python also strips \x1c-\x1f, JS also strips ﻿).
_JS_WS = "\t\n\v\f\r                  　﻿"
_LINE_BREAK = re.compile(r"\r?\n")  # stdout.split(/\r?\n/), not str.splitlines()


class BridgeReadError(AssertionError):
    """The bridge could not read this output (it would 500), or read a code outside
    ``_cli.ERROR_CODES``. An AssertionError, so a test fails rather than errors."""


def _js_trim(text: str) -> str:
    return text.strip(_JS_WS)


def _reject_constant(name: str) -> Any:
    # JSON.parse has no NaN / Infinity; json.loads accepts them by default.
    raise ValueError(f"not JSON: {name}")


def _js_json_parse(text: str) -> Any:
    return json.loads(text, parse_constant=_reject_constant)


def read_stdout_payload(stdout: str, stderr: str = "") -> Any:
    """Port of ``parsePythonJson``: the LAST line that parses to an object or array.

    Trailing chatter (ResourceWarning, atexit) and a pre-result warning are skipped;
    a bare scalar never counts as the result; nothing readable raises."""
    lines = [ln for ln in (_js_trim(raw) for raw in _LINE_BREAK.split(stdout)) if ln]
    for line in reversed(lines):
        try:
            parsed = _js_json_parse(line)
        except ValueError:
            continue
        if isinstance(parsed, (dict, list)):
            return parsed
    detail = " | ".join(
        part
        for part in (
            _js_trim(stdout) and f"stdout: …{_js_trim(stdout)[-400:]}",
            _js_trim(stderr) and f"stderr: …{_js_trim(stderr)[-400:]}",
        )
        if part
    )
    raise BridgeReadError(f"Python returned non-JSON output{f' — {detail}' if detail else ''}.")


def _code_for_status(status: float) -> str:
    # Port of codeForStatus.
    if status == 404:
        return "not_found"
    if status == 504:
        return "timeout"
    return "invalid_input" if status == 400 else "engine_error"


def _last_stderr_object(stderr: str) -> Any:
    # The line parseStderrError reads: split + filter(Boolean) on the TRIMMED text, so a
    # whitespace-only line in the middle still counts as a line.
    lines = [ln for ln in _LINE_BREAK.split(_js_trim(stderr)) if ln]
    try:
        parsed = _js_json_parse(lines[-1] if lines else "")
    except ValueError:
        return None
    # `parsed && typeof parsed === "object"` — {} is truthy in JS, falsy in Python.
    return parsed if isinstance(parsed, (dict, list)) else None


def read_stderr_envelope(stderr: str, exit_code: int | None) -> dict[str, Any]:
    """Port of ``parseStderrError``: ``{message, status, code}`` as the route receives it."""
    parsed = _last_stderr_object(stderr)
    if parsed is not None:
        record = parsed if isinstance(parsed, dict) else {}
        message = record.get("error") if isinstance(record.get("error"), str) else "Pipeline failed."
        raw_status = record.get("status")
        if isinstance(raw_status, (int, float)) and not isinstance(raw_status, bool):
            status = raw_status
        else:
            status = 400 if exit_code == 2 else 500
        raw_code = record.get("code")
        emitted = _js_trim(raw_code) if isinstance(raw_code, str) and _js_trim(raw_code) else None
        return {"message": message, "status": status, "code": emitted or _code_for_status(status)}
    status = 400 if exit_code == 2 else 500
    return {
        "message": _js_trim(stderr) or f"Pipeline exited with code {'?' if exit_code is None else exit_code}.",
        "status": status,
        "code": _code_for_status(status),
    }


@dataclass(frozen=True)
class CliRun:
    """One CLI run, read as the bridge reads it.

    ``payload`` is the success read (exit 0) and ``envelope`` the failure read
    (non-zero exit) — the bridge reads exactly one of the two, so the other is None.
    ``raw_envelope`` is the object the CLI itself wrote on its last stderr line, before
    the bridge derives anything: for pinning that the engine NAMED its code rather than
    leaving the bridge to guess one."""

    code: int
    payload: Any
    envelope: dict[str, Any] | None
    raw_envelope: dict[str, Any] | None
    stdout: str
    stderr: str


def run_cli(
    main: Callable[[list[str]], int | None],
    argv: Sequence[str],
    *,
    files: Mapping[str, Any] | None = None,
    check_codes: bool = True,
) -> CliRun:
    """Run a CLI ``main`` in-process and read its output through the bridge's readers.

    ``files`` maps a file name to its content (a str is written verbatim — how a test
    hands a CLI malformed JSON; anything else is ``json.dumps``-ed) inside a temporary
    directory; an argv item ``"@<name>"`` is replaced by that file's path.

    Fails at READ time (``BridgeReadError``) when a successful run carries no payload the
    bridge could read, or — unless ``check_codes=False`` — when a failure's code falls
    outside ``_cli.ERROR_CODES`` (a code no ``errors.<CODE>`` catalog key resolves)."""
    out, err = io.StringIO(), io.StringIO()
    with tempfile.TemporaryDirectory() as tmp:
        paths: dict[str, str] = {}
        for name, content in (files or {}).items():
            path = Path(tmp) / name
            path.write_text(content if isinstance(content, str) else json.dumps(content), encoding="utf-8")
            paths[f"@{name}"] = str(path)
        resolved = [paths.get(arg, arg) for arg in argv]
        with contextlib.redirect_stdout(out), contextlib.redirect_stderr(err):
            try:
                rc = main(resolved)
            except SystemExit as exc:  # argparse: usage errors exit 2 like the real process
                if exc.code is None or isinstance(exc.code, int):
                    rc = exc.code
                else:
                    print(exc.code, file=err)
                    rc = 1
    code = 0 if rc is None else int(rc)
    stdout, stderr = out.getvalue(), err.getvalue()
    if code == 0:
        return CliRun(code, read_stdout_payload(stdout, stderr), None, None, stdout, stderr)
    envelope = read_stderr_envelope(stderr, code)
    if check_codes and envelope["code"] not in _cli.ERROR_CODES:
        raise BridgeReadError(
            f"CLI envelope code {envelope['code']!r} is outside _cli.ERROR_CODES {_cli.ERROR_CODES}: "
            f"stderr: …{_js_trim(stderr)[-400:]}"
        )
    raw = _last_stderr_object(stderr)
    return CliRun(code, None, envelope, raw if isinstance(raw, dict) else None, stdout, stderr)
