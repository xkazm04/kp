"""The Claude Code CLI as a ``TextProvider`` — the default engine on the shared layer.

The CLI is the engine every local install and every keyless-dev run actually
uses (``registry.resolve_provider`` with no config row). It used to be the one
provider NOT built on :class:`~pipeline.jobfit.llm.base.TextProvider`: the
registry handed out ``MonitoredClaudeCli``, a ``ClaudeCliProvider`` subclass with
its own copy of the metering path, so none of the hardening in ``base.py`` — the
total wall-clock deadline across retries, the one corrective JSON re-prompt, the
truncation branch, coded failure subtypes the ledger classifies — reached the
default engine. A formatting slip dropped straight to the deterministic template,
an overloaded envelope was never retried, and a timeout carried no subtype, so
``llm_usage`` filed it under the catch-all ``provider_error``.

This adapter COMPOSES the unchanged :class:`~pipeline.jobfit.claude_cli.ClaudeCliProvider`
(the eval and seed lanes keep using it directly): ``_call`` is exactly one CLI
spawn, and everything around the spawn comes from ``base.py`` like every metered
adapter. What is CLI-specific is the INBOUND translation of the engine's errors
into the layer's vocabulary, and the CLI-only doors the registry's callers use.

Error translation (a spawn's ``ClaudeCliError`` → what ``base.complete`` sees):

=========================================  ==========================================
the spawn                                  becomes
=========================================  ==========================================
timed out (``subprocess.TimeoutExpired``)  ``LLMError(subtype="deadline_exceeded")`` —
                                           permanent, ONE spawn. The per-attempt
                                           timeout base hands ``_call`` is the time
                                           left on the caller's deadline, so a timed-
                                           out spawn has spent the budget; retrying
                                           it could only outrun the TS spawn kill.
consumer-terms refusal                     ``LLMError(subtype="consumer_terms_policy")``
usage/plan limit envelope                  ``LLMError(subtype="usage_limit")`` — a seat
                                           limit does not lift in seconds
overloaded / 5xx / rate-limit envelope     :class:`CliTransientError` — retried by the
                                           base loop inside the deadline
binary missing                             ``LLMError(subtype="not_installed")``
anything else                              ``LLMError`` carrying the CLI's own subtype
=========================================  ==========================================
"""

from __future__ import annotations

import copy
import subprocess
from typing import Sequence

from ...claude_cli import (
    CONSUMER_TERMS_REASON,
    DEFAULT_TIMEOUT_S,
    READ_ONLY_TOOLS,
    ClaudeCliError,
    ClaudeCliProbe,
    ClaudeCliProvider,
)
from ..base import LLMError, LLMResult, TextProvider, is_transient_error

# The ledger's model label when the CLI runs on its own configured default
# (model=None). The exact string MonitoredClaudeCli wrote, so a default install's
# llm_usage rows stay continuous across the fold.
CLI_DEFAULT_MODEL_LABEL = "claude-cli-default"

# Envelope phrases for a SEAT limit (Pro/Max usage window), checked before the
# transient markers: "limit" is close enough to "rate limit" to be misread as
# retryable, and retrying a spent subscription window only burns the deadline.
_USAGE_LIMIT_MARKERS = ("usage limit", "limit reached", "credit balance")


class CliTransientError(RuntimeError):
    """A spawn failure worth retrying (overloaded, 5xx, rate limited).

    Deliberately NOT an ``LLMError``: base.complete treats ``LLMError`` as
    permanent and retries only other exceptions that ``is_transient_error``
    recognizes — this message always carries the envelope's own words."""


def _is_timeout(exc: ClaudeCliError) -> bool:
    return isinstance(exc.__cause__, subprocess.TimeoutExpired)


def _is_not_installed(exc: ClaudeCliError) -> bool:
    return isinstance(exc.__cause__, FileNotFoundError) or str(exc).startswith("Claude CLI not found")


class ClaudeCliAdapter(TextProvider):
    """``TextProvider`` over one wrapped :class:`ClaudeCliProvider`.

    Constructor mirrors ``MonitoredClaudeCli``'s (the CLI's kwargs plus
    ``use_case``) so every call site that built one builds this unchanged.
    ``model`` stays the CONFIGURED value — None means the CLI's own default, and
    ``llm_judge.provider_identity`` reads it that way — while the ledger labels
    that case :data:`CLI_DEFAULT_MODEL_LABEL` (``monitor._ledger_model``).
    """

    name = "claude_cli"

    def __init__(
        self,
        *,
        model: str | None = None,
        timeout: int = DEFAULT_TIMEOUT_S,
        use_case: str | None = None,
        command: str = "claude",
        strip_api_key: bool = True,
        extra_args: Sequence[str] = (),
        cli: ClaudeCliProvider | None = None,
    ) -> None:
        super().__init__(model=model, timeout=timeout, use_case=use_case)  # type: ignore[arg-type]
        self.cli = cli or ClaudeCliProvider(
            command=command,
            model=model,
            timeout=timeout,
            strip_api_key=strip_api_key,
            extra_args=extra_args,
        )

    # -- the one spawn --------------------------------------------------------

    def _call(self, prompt: str, *, system: str | None, timeout: int) -> LLMResult:
        try:
            result = self.cli.complete(prompt, system=system, timeout=timeout)
        except ClaudeCliError as exc:
            raise self._translate(exc, timeout) from exc
        raw = result.raw if isinstance(result.raw, dict) else {}
        stop = raw.get("stop_reason")
        return LLMResult(
            text=result.text,
            provider=self.name,
            model=self.model or CLI_DEFAULT_MODEL_LABEL,
            usage=dict(result.usage or {}),
            # ClaudeResult books an absent cost as 0.0; the ledger has always
            # recorded that as unpriced (None), never as a truthful zero.
            cost_usd=result.cost_usd or None,
            duration_ms=result.duration_ms,
            finish_reason=stop if isinstance(stop, str) else None,
        )

    def _translate(self, exc: ClaudeCliError, timeout: int) -> Exception:
        """Map one spawn's failure into the layer's vocabulary (module table)."""
        if _is_timeout(exc):
            # Worded like base.py's own deadline raise, so the message-text mirror
            # (degradation.classify_fallback_text) reads it as provider_timeout too.
            return LLMError(
                f"{self.name} call exhausted its {timeout}s deadline after 1 spawn: {exc}",
                provider=self.name,
                subtype="deadline_exceeded",
            )
        if exc.subtype == CONSUMER_TERMS_REASON:
            return LLMError(str(exc), provider=self.name, subtype=CONSUMER_TERMS_REASON)
        if _is_not_installed(exc):
            return LLMError(str(exc), provider=self.name, subtype="not_installed")
        text = str(exc).lower()
        if any(marker in text for marker in _USAGE_LIMIT_MARKERS):
            return LLMError(str(exc), provider=self.name, subtype="usage_limit")
        if is_transient_error(exc):
            return CliTransientError(str(exc))
        # An is_error envelope still says subtype="success"; that is not a failure code.
        subtype = exc.subtype if exc.subtype != "success" else None
        return LLMError(str(exc), provider=self.name, subtype=subtype)

    # -- availability: the CLI's own descent, not the key/SDK dance -----------

    def availability(self) -> tuple[bool, str | None]:
        """Delegated whole: ``offline_policy`` / ``consumer_terms_policy`` /
        ``not_installed`` are the CLI's reasons and are checked in its order."""
        return self.cli.availability()

    def _allowed_offline(self) -> bool:
        # The CLI reaches Anthropic's cloud through a subprocess — never on-box.
        return False

    # -- CLI-only doors -------------------------------------------------------

    def with_repo_access(
        self,
        cwd: str,
        *,
        allowed_tools: Sequence[str] = READ_ONLY_TOOLS,
        timeout: int | None = None,
    ) -> "ClaudeCliAdapter":
        """A COPY bound read-only to ``cwd`` — the inner CLI's door owns the stance.

        The registry's instance keeps no repo binding (same promise
        ``ClaudeCliProvider.with_repo_access`` makes), and ``timeout`` moves the
        adapter's budget too, since base.complete derives the deadline from it."""
        clone = copy.copy(self)
        clone.cli = self.cli.with_repo_access(cwd, allowed_tools=allowed_tools, timeout=timeout)
        if timeout is not None:
            clone.timeout = timeout
        return clone

    @property
    def extra_args(self) -> tuple[str, ...]:
        return self.cli.extra_args

    @extra_args.setter
    def extra_args(self, value: Sequence[str]) -> None:
        # repo_scan.bind_provider_to_repo appends its --settings deny list here.
        self.cli.extra_args = tuple(value)

    @property
    def strip_api_key(self) -> bool:
        return self.cli.strip_api_key

    @property
    def command(self) -> str:
        return self.cli.command

    @property
    def mode(self) -> str:
        return self.cli.mode

    @property
    def cwd(self) -> str | None:
        return self.cli.cwd

    def cli_args(self) -> list[str]:
        return self.cli.cli_args()

    def billing_lane(self) -> str:
        return self.cli.billing_lane()

    def consumer_terms_blocked(self) -> bool:
        return self.cli.consumer_terms_blocked()

    def probe(self, *, timeout: int = 15) -> ClaudeCliProbe:
        return self.cli.probe(timeout=timeout)

