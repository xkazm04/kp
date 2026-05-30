"""Headless Claude Code CLI as a batch LLM engine for dev / test workloads.

Runs ``claude -p --output-format json`` as a subprocess and returns the
assistant's final text from the ``result`` field. With ``ANTHROPIC_API_KEY``
unset the CLI executes under the user's Claude subscription (Pro/Max) rather
than metered API billing, which makes it the cheap engine for *mass* jobs:
preparing synthetic test data, bulk fixture generation, and large eval sweeps.

This is intentionally separate from ``gemini.py``. The production
single-analysis path stays on Gemini (multimodal CV bytes, grounding); this
provider is a text-in/text-out batch tool for offline data prep and quality
iteration, where running hundreds of calls on the subscription beats paying
per token.

Usage::

    from pipeline.jobfit.claude_cli import ClaudeCliProvider

    claude = ClaudeCliProvider()
    if claude.available():
        text = claude.complete("Write a one-line Czech junior-dev job ad.").text
        ad = claude.complete_json("Return JSON {title, must_have:[...]} for ...")
        results = claude.map([p1, p2, p3])  # concurrent, subscription-billed
"""

from __future__ import annotations

import json
import os
import re
import shutil
import subprocess
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass, field
from typing import Any, Sequence

# Keys we strip from the child environment so the CLI uses the subscription
# (interactive auth) instead of falling back to metered API billing.
_API_KEY_ENV = ("ANTHROPIC_API_KEY", "ANTHROPIC_AUTH_TOKEN")

DEFAULT_TIMEOUT_S = 180


class ClaudeCliError(RuntimeError):
    """Raised when the CLI is missing, times out, errors, or returns junk."""

    def __init__(self, message: str, *, stderr: str = "", subtype: str | None = None):
        super().__init__(message)
        self.stderr = stderr
        self.subtype = subtype


@dataclass(frozen=True)
class ClaudeResult:
    """One ``claude -p`` invocation: the answer text plus the envelope metadata."""

    text: str
    raw: dict[str, Any] = field(default_factory=dict)
    cost_usd: float = 0.0
    duration_ms: int = 0
    num_turns: int = 0
    session_id: str | None = None
    usage: dict[str, Any] = field(default_factory=dict)

    def json(self) -> Any:
        """Parse ``text`` as JSON (tolerates markdown fences / surrounding prose)."""
        return _extract_json(self.text)


class ClaudeCliProvider:
    """Thin wrapper around the headless ``claude`` CLI.

    Parameters
    ----------
    command:
        Executable name or path. Defaults to ``"claude"`` (resolved on PATH).
    model:
        Optional ``--model`` value (e.g. ``"sonnet"``, ``"haiku"``). ``None``
        uses the CLI's configured default.
    timeout:
        Per-call wall-clock budget in seconds.
    strip_api_key:
        When True (default) remove ``ANTHROPIC_API_KEY`` / ``ANTHROPIC_AUTH_TOKEN``
        from the child env so the call runs on the subscription, not the API.
    extra_args:
        Extra CLI flags appended verbatim (escape hatch for power users).
    """

    def __init__(
        self,
        *,
        command: str = "claude",
        model: str | None = None,
        timeout: int = DEFAULT_TIMEOUT_S,
        strip_api_key: bool = True,
        extra_args: Sequence[str] = (),
    ) -> None:
        self.command = command
        self.model = model
        self.timeout = timeout
        self.strip_api_key = strip_api_key
        self.extra_args = tuple(extra_args)

    # -- discovery ----------------------------------------------------------

    def available(self) -> bool:
        """True if the CLI is resolvable on PATH (or ``command`` is an abs path)."""
        return shutil.which(self.command) is not None or os.path.isfile(self.command)

    def _executable(self) -> str:
        """Resolve ``command`` to a launchable path.

        On Windows the npm-installed ``claude`` is a ``.CMD`` shim; passing the
        bare name to ``subprocess.run`` fails because ``CreateProcess`` does not
        apply ``PATHEXT``. ``shutil.which`` does, so we resolve first and invoke
        the absolute path. The prompt goes over stdin (never argv), so the
        ``.cmd`` quoting hazards don't apply.
        """
        resolved = shutil.which(self.command)
        if resolved:
            return resolved
        if os.path.isfile(self.command):
            return self.command
        raise ClaudeCliError(
            f"Claude CLI not found (command={self.command!r}). Is it installed and on PATH?"
        )

    # -- single call --------------------------------------------------------

    def complete(
        self,
        prompt: str,
        *,
        system: str | None = None,
        timeout: int | None = None,
    ) -> ClaudeResult:
        """Run one prompt and return the parsed :class:`ClaudeResult`.

        ``system`` is prepended to the prompt as a delimited preamble (robust
        across CLI versions; no dependency on a specific system-prompt flag).
        """
        if not prompt or not prompt.strip():
            raise ValueError("prompt must be non-empty")

        full_prompt = prompt
        if system and system.strip():
            full_prompt = f"<system>\n{system.strip()}\n</system>\n\n{prompt}"

        args = [self._executable(), "-p", "--output-format", "json"]
        if self.model:
            args += ["--model", self.model]
        args += list(self.extra_args)

        try:
            completed = subprocess.run(
                args,
                input=full_prompt,
                capture_output=True,
                text=True,
                encoding="utf-8",
                env=self._child_env(),
                timeout=timeout or self.timeout,
            )
        except FileNotFoundError as exc:
            raise ClaudeCliError(
                f"Claude CLI not found (command={self.command!r}). Is it installed and on PATH?"
            ) from exc
        except subprocess.TimeoutExpired as exc:
            raise ClaudeCliError(
                f"Claude CLI timed out after {timeout or self.timeout}s"
            ) from exc

        return self._parse_envelope(completed.stdout or "", completed.stderr or "", completed.returncode)

    # -- batch / mass execution --------------------------------------------

    def map(
        self,
        prompts: Sequence[str],
        *,
        system: str | None = None,
        max_workers: int = 4,
        return_exceptions: bool = True,
    ) -> list[ClaudeResult | ClaudeCliError]:
        """Run many prompts concurrently (one subprocess each); preserves order.

        Each call is an independent ``claude -p`` process, so this is I/O bound —
        a small thread pool gives real parallelism. With ``return_exceptions``
        (default) a failed item yields its :class:`ClaudeCliError` instead of
        aborting the whole batch, so a single bad prompt can't sink a sweep.
        """
        prompts = list(prompts)
        if not prompts:
            return []
        workers = max(1, min(max_workers, len(prompts)))

        def _one(p: str) -> ClaudeResult | ClaudeCliError:
            try:
                return self.complete(p, system=system)
            except ClaudeCliError as exc:
                if return_exceptions:
                    return exc
                raise

        with ThreadPoolExecutor(max_workers=workers) as pool:
            return list(pool.map(_one, prompts))

    # -- convenience --------------------------------------------------------

    def complete_json(
        self,
        prompt: str,
        *,
        system: str | None = None,
        timeout: int | None = None,
        expected_keys: Sequence[str] | None = None,
    ) -> Any:
        """Run a prompt expected to return JSON and parse it (object or array).

        Appends a terse 'JSON only' instruction and extracts the last complete
        JSON value from the result, tolerating markdown fences or stray prose.
        Pass ``expected_keys`` when the schema is known to pin the answer object
        even if the model echoes an example object alongside it.
        """
        guarded = (
            f"{prompt}\n\n"
            "Respond with ONLY valid JSON — no markdown fences, no commentary."
        )
        result = self.complete(guarded, system=system, timeout=timeout)
        try:
            return _extract_json(result.text, expected_keys=expected_keys)
        except ValueError as exc:
            raise ClaudeCliError(
                f"Claude did not return parseable JSON: {result.text[:300]!r}"
            ) from exc

    # -- internals ----------------------------------------------------------

    def _child_env(self) -> dict[str, str]:
        env = dict(os.environ)
        if self.strip_api_key:
            for key in _API_KEY_ENV:
                env.pop(key, None)
        return env

    def _parse_envelope(self, stdout: str, stderr: str, returncode: int) -> ClaudeResult:
        stdout = stdout.strip()
        if not stdout:
            raise ClaudeCliError(
                f"Claude CLI produced no output (exit {returncode}).", stderr=stderr
            )
        try:
            envelope = json.loads(stdout)
        except json.JSONDecodeError as exc:
            raise ClaudeCliError(
                f"Claude CLI output was not JSON: {stdout[:300]!r}", stderr=stderr
            ) from exc

        if not isinstance(envelope, dict):
            raise ClaudeCliError(f"Unexpected CLI envelope type: {type(envelope).__name__}")

        subtype = envelope.get("subtype")
        if envelope.get("is_error") or (subtype and subtype != "success"):
            raise ClaudeCliError(
                f"Claude CLI returned an error (subtype={subtype}): "
                f"{envelope.get('result') or envelope.get('error') or 'unknown'}",
                stderr=stderr,
                subtype=subtype,
            )

        text = str(envelope.get("result") or "")
        return ClaudeResult(
            text=text,
            raw=envelope,
            cost_usd=float(envelope.get("total_cost_usd") or 0.0),
            duration_ms=int(envelope.get("duration_ms") or 0),
            num_turns=int(envelope.get("num_turns") or 0),
            session_id=envelope.get("session_id"),
            usage=envelope.get("usage") if isinstance(envelope.get("usage"), dict) else {},
        )


def _scan_json_values(text: str) -> list[Any]:
    """Every top-level JSON value embedded in ``text``, in order of appearance.

    Walks the string, and at each ``{``/``[`` attempts ``raw_decode``; on success
    it records the value and skips past it, on failure it advances one char. A
    nested ``{`` inside a decoded value is consumed as part of that value, so the
    list holds only *top-level* values (an array of objects is one entry).
    """
    decoder = json.JSONDecoder()
    values: list[Any] = []
    idx, n = 0, len(text)
    while idx < n:
        if text[idx] in "{[":
            try:
                value, end = decoder.raw_decode(text, idx)
                values.append(value)
                idx = end
                continue
            except json.JSONDecodeError:
                pass
        idx += 1
    return values


def _extract_json(text: str, *, expected_keys: Sequence[str] | None = None) -> Any:
    """Best-effort JSON extraction from an LLM text answer.

    Returns the LAST complete top-level JSON value (preferring a fenced ```json
    block when present). Returning the last value — not the first — is deliberate:
    few-shot prompts often make the model echo the example schema object before
    the real answer, and the old first-value behaviour silently returned that
    echo. When ``expected_keys`` is given, the last value carrying any of those
    keys wins, which pins the answer even if it isn't the trailing value.
    Raises ``ValueError`` if nothing parses.
    """
    text = (text or "").strip()
    if not text:
        raise ValueError("empty text")

    # Prefer fenced blocks (the model's deliberate answer envelope) if any parse.
    candidates: list[Any] = []
    for block in re.findall(r"```(?:json)?\s*(.*?)```", text, flags=re.DOTALL):
        candidates.extend(_scan_json_values(block.strip()))
    if not candidates:
        candidates = _scan_json_values(text)
    if not candidates:
        raise ValueError("no JSON value found")

    if expected_keys:
        keyed = [v for v in candidates if isinstance(v, dict) and any(k in v for k in expected_keys)]
        if keyed:
            return keyed[-1]
    return candidates[-1]
