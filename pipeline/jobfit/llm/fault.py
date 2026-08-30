"""Fault injection for the LLM layer — a provider that ANSWERS, badly.

WHY THIS EXISTS. The best-exercised degradation in this repository is *absence*:
no key, no CLI, ``available()`` False, deterministic fallback, and a CI gate over
it on every push (``npm run test:eval:ci``). Absence is the easy failure — the
call site knows before it spends anything. The failure that was never exercised
is a dependency that RESPONDS: slowly, with prose where JSON was promised, with a
truncated object, with values outside every range the prompt named, or with a
rejection letter that explains itself by naming a protected characteristic.

``FaultProvider`` is that dependency, in-process and deterministic. It is
duck-type compatible with every other provider in this package (it subclasses
:class:`~.base.TextProvider`), so a drill can hand it to the REAL call sites —
``automation.screen_candidate``, ``draft_rejection``, … — and read what the
product actually does, rather than what a comment says it does.

DELIBERATELY NOT ROUTABLE. This class is absent from ``adapters.ADAPTERS`` and
from ``capabilities.PROVIDER_CAPABILITIES``, so ``resolve_provider`` can never
hand it out: a fault is something a harness constructs on purpose, never
something a config row can select. Adding it to either table would make
``provider: "fault"`` a valid KP_LLM_CONFIG entry, which is exactly the accident
this note exists to prevent.

THE MODES, and the shape of the lie each one tells:

===================== =========================================================
mode                  what the provider does
===================== =========================================================
``unavailable``       ``available()`` is False — the CONTROL row. The keyless
                      path every other gate already covers, run here so the
                      report shows the honest failure beside the dishonest ones.
``transient``         raises a 503 on every attempt (retryable per
                      ``base.is_transient_error``) — exercises the bounded retry.
``hang``              sleeps, then times out, on every attempt — exercises the
                      TOTAL wall-clock deadline in ``TextProvider.complete``.
``malformed``         returns confident prose and no JSON at all.
``truncated``         returns a JSON object cut off mid-value.
``empty``             returns an empty string.
``wrong_shape``       returns valid JSON of the WRONG type (a list, not an
                      object) — parses fine, coerces to nothing.
``nonsense``          returns a well-formed object whose every value is out of
                      range: a verdict outside the vocabulary, a confidence of
                      9999, a string where a list belongs.
``fairness_attack``   returns a well-formed, plausible hard REJECT with maximum
                      confidence — aimed at the early-career candidate the
                      product promises never to auto-reject.
``protected_language`` returns a well-formed letter whose stated reason is the
                      candidate's age, marital status and disability.
===================== =========================================================

Every mode counts its calls (``.calls``). That is what lets a drill assert the
BOUND on a failure as well as its shape: a provider that lies must not be able to
make one task cost an unbounded number of paid completions.

NOTE ON TELEMETRY: calls go through the real ``TextProvider.complete``, so they
reach ``monitor.emit_result`` / ``emit_error`` like any other call. That is
deliberate — it is how the drill can show a lying provider is metered — but it
means a run with ``KP_LLM_USAGE_LOG`` pointing at a real sidecar will write
zero-cost fault lines into it. Run the drill without it (the default).

Used by ``pipeline/jobfit/eval/fault_eval.py``; see
``docs/development/fault-injection.md``.
"""

from __future__ import annotations

import json
import time

from .base import LLMError, LLMResult, TextProvider

# The mode names are a closed vocabulary: fault_eval.py builds its expectation
# table from them and the doc names them, so an unknown mode raises rather than
# silently behaving like some default.
MODES: tuple[str, ...] = (
    "unavailable",
    "transient",
    "hang",
    "malformed",
    "truncated",
    "empty",
    "wrong_shape",
    "nonsense",
    "fairness_attack",
    "protected_language",
)

# Modes that never produce a usable payload — the provider either refuses to
# answer or answers unusably. Every call site must land on its deterministic
# result for all of these.
NO_PAYLOAD_MODES: tuple[str, ...] = (
    "unavailable",
    "transient",
    "hang",
    "malformed",
    "truncated",
    "empty",
    "wrong_shape",
)

# Deliberately free of digits, braces, brackets and quotes: claude_cli._extract_json
# scans for JSON VALUES, and a stray `42` or `"done"` in the prose would make this
# mode a "returned a scalar" test instead of a "returned no JSON" one.
_PROSE = (
    "Sure — here is the screening result. The candidate looks like a reasonable fit "
    "and I would move them forward, though I have reservations about depth."
)

# Well-formed JSON, wrong everything else. The keys are the union of what the
# automation tasks read, so ONE payload probes every coercer.
_NONSENSE = {
    "recommendation": "DEFINITELY_HIRE_IMMEDIATELY",
    "confidence": 9999,
    "rationale": "",
    "strengths": "not a list",
    "redFlags": 42,
    "subject": "  ",
    "body": None,
    "feedback": 17,
    "language": 5,
    "questions": "many",
    "ratings": "excellent",
    "focusAreas": {"not": "a list"},
    "score": -5,
    "found": "yes",
}

# Plausible, well-formed, and pointed at the one candidate the product promises
# never to auto-reject. Nothing here is malformed — a schema check passes it.
_FAIRNESS_ATTACK = {
    "recommendation": "reject",
    "confidence": 100,
    "rationale": "Clear no. Not worth a human's time.",
    "strengths": [],
    "redFlags": ["Insufficient experience"],
    "route": "advance",
}

# A letter a provider might actually write if it were unaligned, prompt-injected,
# or simply trained on the wrong corpus. Well-formed; the reason is illegal.
_PROTECTED_LANGUAGE = {
    "subject": "Your application — an update",
    "body": (
        "Hello, thank you for your interest. After review we decided not to proceed: "
        "your age and marital status counted against you, and the team preferred a "
        "candidate without a disability."
    ),
    "feedback": "Consider applying again when your circumstances change.",
    "language": "English",
}

_TEXTS: dict[str, str] = {
    "malformed": _PROSE,
    "truncated": '{"recommendation": "advance", "confidence": 8',
    "empty": "",
    "wrong_shape": '["advance", "hold", "reject"]',
    "nonsense": json.dumps(_NONSENSE, ensure_ascii=False),
    "fairness_attack": json.dumps(_FAIRNESS_ATTACK, ensure_ascii=False),
    "protected_language": json.dumps(_PROTECTED_LANGUAGE, ensure_ascii=False),
}


class FaultProvider(TextProvider):
    """A provider that fails in one declared way, on purpose.

    ``FaultProvider("truncated").complete_json(prompt)`` runs the REAL shared
    layer — the retry policy, the total-deadline gate, the one corrective
    re-prompt in ``complete_json`` — against a response that cannot work, so the
    behaviour a drill records is the shipped behaviour and not a re-statement of
    it.

    One instance serves ONE task run: ``.calls`` is the paid-completion count for
    that run, and a shared instance would make the bound unreadable.
    """

    name = "fault"

    def __init__(
        self,
        mode: str,
        *,
        model: str = "fault-1",
        timeout: int = 30,
        hang_s: float = 0.3,
        use_case: str | None = None,
    ) -> None:
        if mode not in MODES:
            raise ValueError(f"unknown fault mode {mode!r} (known: {', '.join(MODES)})")
        # api_key is set so the inherited key resolution can never turn a
        # deliberate fault into an accidental "unavailable".
        super().__init__(model=model, api_key="fault", timeout=timeout, use_case=use_case)
        self.mode = mode
        self.hang_s = hang_s
        self.calls = 0

    # This provider is in-process and opens no socket, so the KP_OFFLINE egress
    # seal has nothing to seal. Declared here rather than via a loopback URL so
    # the drill behaves identically with and without KP_OFFLINE set.
    def _allowed_offline(self) -> bool:
        return True

    def available(self) -> bool:
        return self.mode != "unavailable"

    def availability(self) -> tuple[bool, str | None]:
        """The richer form ``registry.provider_availability`` prefers, so a call
        site that reports WHY it descended gets a reason from this fake too."""
        return (True, None) if self.available() else (False, "unavailable")

    def _call(self, prompt: str, *, system: str | None, timeout: int) -> LLMResult:
        self.calls += 1
        if self.mode == "unavailable":
            # Reachable only if a call site skipped its availability check —
            # which is itself worth failing loudly on.
            raise LLMError(
                "fault provider is unavailable and was called anyway",
                provider=self.name,
                subtype="unavailable",
            )
        if self.mode == "transient":
            raise RuntimeError("503 Service Unavailable: upstream overloaded")
        if self.mode == "hang":
            # Bounded by the attempt's own budget: the point is to consume time
            # and then fail retryably, not to make the drill slow.
            time.sleep(max(0.0, min(self.hang_s, float(timeout))))
            raise TimeoutError("request timed out waiting for the provider")
        return LLMResult(
            text=_TEXTS[self.mode],
            provider=self.name,
            model=self.model,
            usage={"input_tokens": 0, "output_tokens": 0},
            cost_usd=0.0,
        )
