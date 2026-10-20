"""The OpenAI Codex CLI (``codex exec``) as a ``TextProvider`` - a PIN-ONLY engine.

The gig plan seats (``app/_lib/gigs/plan-seats.ts``) field GPT 6 Astra beside two Claude
models on a very hard gig, and the one door kp has to that model is the operator's own
Codex CLI login - the same shape as the Claude CLI: a subscription seat on the box,
spawned per call, no key kp holds. So this adapter is modelled on
``adapters/claude_cli.py``: ``_call`` is exactly one spawn, and everything around it (the
total deadline across retries, the one JSON repair re-prompt, the usage ledger) comes from
``base.py`` like every metered adapter.

PIN-ONLY. There is no ``PROVIDER_CAPABILITIES`` row and no ``ADAPTERS`` entry: an operator
cannot route a use case to it from the Models panel (the TS catalogue mirrors
``PROVIDER_CAPABILITIES`` exactly, and a routing row for a CLI engine nobody configured is a
promise kp cannot keep). The only way in is a call-site pin,
``ProviderPin("codex_cli", "<model>", "<effort>")``, which ``registry._pinned_provider``
checks against ``capabilities.PIN_ONLY_PROVIDER_CAPABILITIES``.

THE SPAWN (flags verified against ``codex exec --help``, codex-cli 0.157.1, 2026-09-30)::

    codex exec --skip-git-repo-check --ephemeral --sandbox read-only
               --disable shell_tool --disable unified_exec
               --color never --json -C <neutral empty dir> -m <model>
               [-c model_reasoning_effort=<effort>] [--output-schema <schema.json>]
               -o <last-message file> -

- the prompt travels on STDIN (``-``), never argv: on Windows ``codex`` is an npm ``.cmd``
  shim and ``cmd.exe`` interprets its arguments. The model id and the effort are closed
  shapes (``ProviderPin`` validates the effort, :data:`_MODEL` the id) and the two paths
  are temp paths kp minted;
- ``--sandbox read-only`` plus ``--disable shell_tool --disable unified_exec``: the model
  writes nothing and runs no command (a probe on 2026-09-30 asked it to list its cwd and
  it answered that it could not). ``--ephemeral`` keeps no session file;
- ``-C`` points it at a per-process EMPTY temp directory, never the repository, so no
  AGENTS.md of kp's is folded into the prompt (claude_cli.py ``_neutral_cwd``'s rule);
  the schema and the answer file live in a separate per-call temp dir;
- ``--json`` makes stdout a JSONL event stream, read for the token counts
  (``turn.completed.usage``) and the failure message (``error`` / ``turn.failed``); the
  answer is the last-message file, falling back to the last ``agent_message`` event.

COST. Codex reports TOKENS, not dollars, and a subscription seat has no per-call price:
``cost_usd`` is None (unpriced), never 0.

POLICY, in ``availability()`` order - the same descent the Claude CLI engine answers with,
so a pinned call on a refused engine degrades to the call site's no-provider answer:

- ``offline_policy``: KP_OFFLINE seals it (the CLI reaches OpenAI's cloud through a
  subprocess the TS egress guard cannot see);
- ``consumer_terms_policy``: a ChatGPT-account seat is consumer terms, so a production
  deployment refuses it unless ``KP_ALLOW_CLI_ENGINE`` unlocks the CLI engines (the one
  switch the Claude CLI already honours);
- ``not_installed``: no ``codex`` on PATH.

Error translation (one spawn -> what ``base.complete`` sees): a timeout is
``LLMError(deadline_exceeded)`` (one spawn, the budget is spent); a usage/plan limit is
``LLMError(usage_limit)``; an overloaded / 5xx / rate-limited turn is
:class:`CodexTransientError` (retried by the base loop inside the deadline); a missing
binary is ``LLMError(not_installed)``; anything else ``LLMError(cli_error)``.
"""

from __future__ import annotations

import copy
import json
import os
import re
import shutil
import subprocess
import tempfile
from pathlib import Path
from typing import Any

from ...claude_cli import CONSUMER_TERMS_REASON, cli_engine_unlocked, is_production_deployment
from ..base import DEFAULT_TIMEOUT_S, LLMError, LLMResult, TextProvider, is_transient_error
from ..offline import is_offline

# A model id lands in argv through a .cmd shim on Windows: a closed shape, not a free string.
_MODEL = re.compile(r"^[a-z0-9][a-z0-9._-]{1,79}$")
# Envelope phrases for a SEAT limit (checked before the transient markers, which a "rate
# limit" would also match): retrying a spent subscription window only burns the deadline.
_USAGE_LIMIT_MARKERS = ("usage limit", "limit reached", "quota", "insufficient_quota", "plan limit")
# The captured stdout kp keeps (claude_cli.MAX_STDOUT_BYTES' rule): a JSONL stream for one
# answer is kilobytes; anything near this is a runaway child.
MAX_STDOUT_BYTES = 4 * 1024 * 1024
# What of a failure message reaches an exception (and the ledger's classifier): enough to
# read, never a whole transcript.
_MESSAGE_CHARS = 400

_NEUTRAL_CWD: str | None = None


def _neutral_cwd() -> str:
    """A per-process EMPTY temp directory the child runs in (``-C``): no AGENTS.md above it
    for Codex to discover, no repository to read. Created lazily, reused, left empty."""
    global _NEUTRAL_CWD
    if _NEUTRAL_CWD is None or not os.path.isdir(_NEUTRAL_CWD):
        _NEUTRAL_CWD = tempfile.mkdtemp(prefix="kp-codex-neutral-")
    return _NEUTRAL_CWD


class CodexTransientError(RuntimeError):
    """A spawn failure worth retrying (overloaded, 5xx, rate limited). Deliberately NOT an
    ``LLMError``: base.complete retries only non-LLMError exceptions that
    ``is_transient_error`` recognises, and this message carries the CLI's own words."""


def parse_events(stdout: str) -> dict[str, Any]:
    """The JSONL event stream's facts: the last agent message, the usage, the failure
    message. Lines that are not JSON objects are skipped (a banner, a warning). Pure."""
    text: str | None = None
    usage: dict[str, Any] = {}
    error: str | None = None
    for line in stdout.splitlines():
        line = line.strip()
        if not line.startswith("{"):
            continue
        try:
            event = json.loads(line)
        except json.JSONDecodeError:
            continue
        if not isinstance(event, dict):
            continue
        kind = event.get("type")
        item = event.get("item") if isinstance(event.get("item"), dict) else None
        if kind == "item.completed" and item and item.get("type") == "agent_message" and isinstance(item.get("text"), str):
            text = item["text"]
        elif kind == "turn.completed" and isinstance(event.get("usage"), dict):
            usage = {k: v for k, v in event["usage"].items() if isinstance(v, int) and not isinstance(v, bool)}
        elif kind == "turn.failed" and isinstance(event.get("error"), dict):
            error = str(event["error"].get("message") or "turn failed")
        elif kind == "error" and isinstance(event.get("message"), str):
            error = event["message"]
    return {"text": text, "usage": usage, "error": error}


class CodexCliAdapter(TextProvider):
    """``TextProvider`` over one ``codex exec`` spawn per attempt. See the module header."""

    name = "codex_cli"

    def __init__(
        self,
        *,
        model: str,
        effort: str | None = None,
        timeout: int = DEFAULT_TIMEOUT_S,
        use_case: str | None = None,
        command: str = "codex",
        output_schema: dict[str, Any] | None = None,
    ) -> None:
        if not isinstance(model, str) or not _MODEL.match(model):
            raise ValueError(f"codex_cli model must be a model id (lower-case letters, digits, '.', '_', '-'), got {model!r}")
        super().__init__(model=model, timeout=timeout, use_case=use_case)
        self.effort = effort
        self.command = command
        self.output_schema = output_schema

    # -- doors ----------------------------------------------------------------

    def with_output_schema(self, schema: dict[str, Any]) -> "CodexCliAdapter":
        """A COPY whose calls pass ``--output-schema``: Codex constrains the final message to
        this JSON Schema (strict: every property required, no additional ones). The
        registry's instance keeps none, like the Claude CLI's doors."""
        clone = copy.copy(self)
        clone.output_schema = schema
        return clone

    # -- availability ---------------------------------------------------------

    def consumer_terms_blocked(self) -> bool:
        """A ChatGPT-account seat is consumer terms: refused in production unless the CLI
        engines are unlocked (claude_cli.CLI_ENGINE_UNLOCK_ENV). Dev is never affected."""
        return is_production_deployment() and not cli_engine_unlocked()

    def _resolved_command(self) -> str | None:
        return shutil.which(self.command) or (self.command if os.path.isfile(self.command) else None)

    def availability(self) -> tuple[bool, str | None]:
        if is_offline():
            return False, "offline_policy"
        if self.consumer_terms_blocked():
            return False, CONSUMER_TERMS_REASON
        if self._resolved_command() is None:
            return False, "not_installed"
        return True, None

    def _allowed_offline(self) -> bool:
        # The CLI reaches OpenAI's cloud through a subprocess - never on-box.
        return False

    # -- the one spawn --------------------------------------------------------

    def cli_args(self, *, executable: str, schema_path: str | None, out_path: str) -> list[str]:
        """The argv for one call (module header). Pure over its inputs."""
        args = [
            executable,
            "exec",
            "--skip-git-repo-check",
            "--ephemeral",
            "--sandbox",
            "read-only",
            "--disable",
            "shell_tool",
            "--disable",
            "unified_exec",
            "--color",
            "never",
            "--json",
            "-C",
            _neutral_cwd(),
            "-m",
            self.model,
        ]
        if self.effort:
            args += ["-c", f"model_reasoning_effort={self.effort}"]
        if schema_path:
            args += ["--output-schema", schema_path]
        args += ["-o", out_path, "-"]
        return args

    def _call(self, prompt: str, *, system: str | None, timeout: int) -> LLMResult:
        if self.consumer_terms_blocked():
            raise LLMError("the Codex CLI engine is refused on a production deployment (consumer terms)", provider=self.name, subtype=CONSUMER_TERMS_REASON)
        executable = self._resolved_command()
        if executable is None:
            raise LLMError(f"Codex CLI not found (command={self.command!r}). Is it installed and on PATH?", provider=self.name, subtype="not_installed")
        full_prompt = f"<system>\n{system.strip()}\n</system>\n\n{prompt}" if system and system.strip() else prompt
        with tempfile.TemporaryDirectory(prefix="kp-codex-io-") as io_dir:
            schema_path = None
            if self.output_schema is not None:
                schema_path = str(Path(io_dir) / "schema.json")
                Path(schema_path).write_text(json.dumps(self.output_schema, ensure_ascii=False), encoding="utf-8")
            out_path = str(Path(io_dir) / "last-message.txt")
            try:
                completed = subprocess.run(
                    self.cli_args(executable=executable, schema_path=schema_path, out_path=out_path),
                    input=full_prompt,
                    capture_output=True,
                    text=True,
                    encoding="utf-8",
                    errors="replace",
                    cwd=_neutral_cwd(),
                    timeout=timeout,
                )
            except FileNotFoundError as exc:
                raise LLMError(f"Codex CLI not found (command={self.command!r})", provider=self.name, subtype="not_installed") from exc
            except subprocess.TimeoutExpired as exc:
                raise LLMError(f"{self.name} call exhausted its {timeout}s deadline after 1 spawn", provider=self.name, subtype="deadline_exceeded") from exc
            stdout = completed.stdout or ""
            if len(stdout.encode("utf-8", errors="ignore")) > MAX_STDOUT_BYTES:
                raise LLMError(f"Codex CLI stdout exceeded the {MAX_STDOUT_BYTES} byte cap", provider=self.name, subtype="runaway_output")
            events = parse_events(stdout)
            answer = ""
            try:
                answer = Path(out_path).read_text(encoding="utf-8").strip()
            except OSError:
                answer = ""  # no last-message file: the event stream's last message is the answer, if any
        # A reconnect notice is an `error` event on a turn that still answered: only a
        # failed exit, or an error with no answer at all, is a failure.
        if completed.returncode != 0 or (events["error"] is not None and not answer):
            raise self._failure(events["error"] or (completed.stderr or "").strip() or f"exit {completed.returncode}")
        if not answer:
            answer = (events["text"] or "").strip()
        if not answer:
            raise LLMError("Codex CLI produced no answer", provider=self.name, subtype="empty_output")
        return LLMResult(
            text=answer,
            provider=self.name,
            model=self.model,
            usage=events["usage"],
            # Tokens, not dollars: a subscription seat has no per-call price. Unpriced, never 0.
            cost_usd=None,
        )

    def _failure(self, message: str) -> Exception:
        """One failed spawn in the layer's vocabulary (module header)."""
        short = message[:_MESSAGE_CHARS]
        lowered = short.lower()
        if any(marker in lowered for marker in _USAGE_LIMIT_MARKERS):
            return LLMError(f"{self.name}: {short}", provider=self.name, subtype="usage_limit")
        if is_transient_error(RuntimeError(short)):
            return CodexTransientError(f"{self.name}: {short}")
        return LLMError(f"{self.name}: {short}", provider=self.name, subtype="cli_error")
