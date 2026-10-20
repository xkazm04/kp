"""Trust findings, coded at birth (challenge-r07 results-core/A).

Every repair, degradation, screen and self-check the engine records about one
analysis is a :class:`Finding`: the sentence a recruiter reads, PLUS the three
things a consumer must never have to guess from that sentence -

- ``code``      a stable identifier (``score_section_missing``, ``blind_redaction_partial``),
                the handle a catalog or a decision gate keys on;
- ``severity``  ``ok`` (a clean check / an informational note), ``warn`` (a human
                should look before trusting the result) or ``blocker`` (the thing the
                scope names was not computed at all - e.g. a defaulted score);
- ``scope``     what the finding is about, so a consumer can ask "is the SCORE
                trustworthy?" without reading English.

The producer is the only party that knows which of those a finding is. Before this
module the UI re-derived severity with a regex over engine prose
(``app/_lib/sanity-checks.ts``) and Python re-derived the authenticity band with a
substring test - two runtimes guessing at one field, and the regex misfired on a
blind-screening redaction miss and an unreadable structured job (both read as clean).

A ``Finding`` IS a ``str`` (its sentence), so every producer that used to return
``list[str]`` still does: ``sanity_checks`` stays byte-identical, list equality with
plain strings holds, and JSON serializes the sentence. The structured half crosses
the wire separately as ``AnalysisResult.trust_findings`` via :func:`to_trust_findings`.
"""

from __future__ import annotations

from typing import Iterable

from .models import TrustFinding, TrustScope, TrustSeverity

__all__ = ["Finding", "to_trust_findings", "UNCLASSIFIED"]

# The code a plain string (a producer that forgot to code its finding) is filed under.
# Loud on purpose: an uncoded finding is shown as a warning rather than hidden as a pass.
UNCLASSIFIED = "unclassified"


class Finding(str):
    """One trust-ledger entry: the sentence (``str`` itself) plus its code, severity,
    scope and an optional machine value (the add-on label, the licence, the
    exception type) a localized rendering can interpolate."""

    code: str
    severity: TrustSeverity
    scope: TrustScope
    value: str | None

    def __new__(
        cls,
        text: str,
        *,
        code: str,
        severity: TrustSeverity,
        scope: TrustScope,
        value: str | None = None,
    ) -> "Finding":
        obj = super().__new__(cls, text)
        obj.code = code
        obj.severity = severity
        obj.scope = scope
        obj.value = value
        return obj

    @property
    def text(self) -> str:
        return str.__str__(self)

    def to_model(self) -> TrustFinding:
        return TrustFinding(
            code=self.code,
            severity=self.severity,
            scope=self.scope,
            text=self.text,
            value=self.value,
        )


def to_trust_findings(checks: Iterable[str]) -> list[TrustFinding]:
    """The wire form of a ledger, in ledger order - one model per sentence, so
    ``[f.text for f in to_trust_findings(c)] == list(c)`` always holds. A plain
    string (uncoded) is filed as ``unclassified``/``warn`` so it is surfaced,
    never silently passed."""
    out: list[TrustFinding] = []
    for check in checks:
        if isinstance(check, Finding):
            out.append(check.to_model())
        else:
            out.append(
                TrustFinding(code=UNCLASSIFIED, severity="warn", scope="input", text=str(check))
            )
    return out
