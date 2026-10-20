"""The ONE vocabulary for why an LLM step did not serve the model's answer.

Four classifiers of this taxonomy used to live in two modules:
``automation._call_failure_reason`` and ``automation._classify_fallback_text`` (why
the TEMPLATE served) and ``monitor._failure_reason`` / ``monitor._reason_code`` (why
the CALL died, and how a caller's reason is reduced before it reaches the durable
``llm_usage.reason`` column). ``monitor`` kept its own copy on purpose — "that one
names why the TEMPLATE served, this one why the CALL died", and automation imports
the ``llm`` package, so monitor could not import automation back.

That split is overturned here, deliberately (challenge-r04 tests-llm-eval/A). The
distinction it protected is real and is KEPT — :data:`FAILURE_REASONS` is still its
own name, and it is now a checked strict subset of :data:`DEGRADATION_REASONS`
instead of a second literal that merely promised to spell the overlap the same way.
What the split cost was a third runner: ``devcase.provenance.generate_with_fallback``
(fifteen call sites — devcase, agentfit, intake, jobseeker, repo_scan) had no
classifier at all, because the only one that read the subtype lived inside
automation. Putting the vocabulary in ``llm/`` — below every runner, importing
nothing from them — is what lets all three runners and the ledger share it.

The names in the old homes stay as aliases (``automation.DEGRADATION_REASONS``,
``monitor.FAILURE_REASONS``, …), so no caller and no pin moved.
"""

from __future__ import annotations

import re

# The reasons a MID-CALL descent can have. Deliberately disjoint from the
# availability-gate vocabulary in registry.provider_availability ("offline_policy"
# / "not_installed" / "unavailable") and the caller's "disabled": the whole point
# is that an operator reading the ledger can tell "there was no provider" from
# "the provider answered and we threw the answer away".
PROVIDER_TIMEOUT = "provider_timeout"
UNPARSEABLE_OUTPUT = "unparseable_output"
UNUSABLE_OUTPUT = "unusable_output"
PROVIDER_ERROR = "provider_error"

DEGRADATION_REASONS: tuple[str, ...] = (
    # The call never came back inside its TOTAL wall-clock budget.
    PROVIDER_TIMEOUT,
    # It returned text, and not even the corrective re-prompt made it JSON.
    UNPARSEABLE_OUTPUT,
    # It returned parseable JSON, and coercion kept none of it — the wrong type,
    # every value out of range, a coercer that raised on it, or a letter
    # _letter_is_safe discarded whole.
    UNUSABLE_OUTPUT,
    # Anything else the call raised: transport, a 5xx that outlived its retries,
    # a refusal, a missing capability.
    PROVIDER_ERROR,
)

# Why a FAILED attempt failed — the reasons a raised CALL can have. Every one of
# them is also a reason the template served (a failed call always ends in the
# template), so this is a subset, and ``unusable_output`` is exactly the word it
# lacks: an unusable answer is a call that SUCCEEDED and was paid for.
FAILURE_REASONS: tuple[str, ...] = (PROVIDER_TIMEOUT, UNPARSEABLE_OUTPUT, PROVIDER_ERROR)

if not set(FAILURE_REASONS) < set(DEGRADATION_REASONS):  # pragma: no cover — an edit-time guard
    raise RuntimeError("FAILURE_REASONS must be a strict subset of DEGRADATION_REASONS")


def classify(exc: BaseException) -> str:
    """Classify a failed call into one of :data:`FAILURE_REASONS`.

    Reads ``LLMError.subtype`` rather than the message, because the subtype is
    the part base.py maintains as a contract (``deadline_exceeded`` is raised in
    exactly one place, ``unparseable_json`` in exactly one other), and the message
    is provider-authored text that has no business in a durable column (it can
    echo the prompt)."""
    subtype = getattr(exc, "subtype", None)
    if subtype == "deadline_exceeded":
        return PROVIDER_TIMEOUT
    if subtype == "unparseable_json":
        return UNPARSEABLE_OUTPUT
    return PROVIDER_ERROR


# The message-text mirror of `classify`, for the one caller (automation's
# rematch, through match_reasoning.generate's on_fallback) that only ever sees
# `describe_fallback`'s formatted "<Type>: <message>" line, never the exception
# `.subtype` is read off. The phrases matched are base.py's own, not a test's:
# "exhausted its …s deadline" is raised in exactly the one place
# subtype="deadline_exceeded" is (llm/base.py retry loop), and "parseable JSON"
# only appears on the two subtype="unparseable_json" raises (truncated
# finish_reason has its own subtype and its own wording, "is incomplete", so it
# correctly falls through to provider_error here exactly as `classify` falls
# through for any subtype it does not name). Re-derive both if base.py's wording
# changes.
def classify_fallback_text(text: str) -> str:
    if "deadline" in text and "exhausted" in text:
        return PROVIDER_TIMEOUT
    if "parseable JSON" in text:
        return UNPARSEABLE_OUTPUT
    return PROVIDER_ERROR


_REASON_CODE = re.compile(r"^[a-z][a-z0-9_]{0,63}$")

# The exception TYPE names worth keeping when a prose reason collapses to a code.
# `describe_fallback` writes "<ExceptionType>: <message>"; the type half is ours (a
# Python class name), the message half is the provider's. Mapping the few types that
# name a distinct descent keeps a timeout reading as a timeout instead of flattening
# into the catch-all, without ever storing the message.
_PROSE_TYPE_REASON = {
    "TimeoutError": PROVIDER_TIMEOUT,
    "ReadTimeout": PROVIDER_TIMEOUT,
    "ConnectTimeout": PROVIDER_TIMEOUT,
    "ReadTimeoutError": PROVIDER_TIMEOUT,
}


def reason_code(reason: str | None) -> str | None:
    """Reduce a caller's reason to a CODE before it reaches a durable column.

    Three shapes arrive:

    * a bare code (``"offline_policy"``, ``"unusable_output"``) — kept as is;
    * ``"<code>: <prose>"`` whose leading token is a word of
      :data:`DEGRADATION_REASONS` — the engine already chose the code and wrote a
      sentence for the human after it (``provenance.UNUSABLE_OUTPUT_REASON``). The
      code is kept and the sentence dropped. Only a DECLARED word may lead: a
      provider message that happens to start with a lowercase token (``"timeout:
      …"``) is still prose and must never mint a new code in a durable column;
    * a ``describe_fallback`` line, ``"<ExceptionType>: <message>"`` — right for the
      per-request envelope, wrong for ``llm_usage.reason``. It collapses to
      ``provider_error``, the word the vocabulary reserves for "anything else the
      call raised", unless the TYPE names a timeout."""
    if reason is None:
        return None
    token = reason.strip()
    if not token:
        return None
    if _REASON_CODE.match(token):
        return token
    head = token.split(":", 1)[0].strip()
    if head in DEGRADATION_REASONS:
        return head
    return _PROSE_TYPE_REASON.get(head, PROVIDER_ERROR)
