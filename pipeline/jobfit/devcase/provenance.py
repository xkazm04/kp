"""Shared provenance helper for the Dev pipeline.

ONE definition of "how degraded was this multi-step run": collapse the per-step
``"llm"``/``"deterministic"`` sources into a single tri-state verdict. The CLI
provenance envelope (:mod:`devcase_cli`) and BOTH eval harnesses
(:mod:`submission_eval`, :mod:`lifecycle_eval`) call this one helper, so ``"partial"``
means the same thing everywhere and the reports can never drift back to the misleading
binary "llm-if-any" collapse (which reported a fully-LLM run whenever a single step
used the LLM, overstating coverage and hiding the deterministic fallbacks).
"""

from __future__ import annotations

# The three provenance states a (multi-)step run can collapse to.
SOURCE_LLM = "llm"
SOURCE_PARTIAL = "partial"
SOURCE_DETERMINISTIC = "deterministic"


def combine_source(*srcs: str) -> str:
    """Collapse per-step sources into one tri-state verdict.

    The old ``"llm" if "llm" in srcs else "deterministic"`` reported a fully-LLM run
    whenever a *single* step used the LLM, hiding that the rest fell back to deterministic
    templates. We return a tri-state instead — ``"partial"`` for a mix — so a degraded run
    reads honestly: a fully-LLM run is ``"llm"``, an all-deterministic (or empty) run is
    ``"deterministic"``, and anything mixed is ``"partial"``. Empty/falsy sources are ignored.
    """
    uniq = {s for s in srcs if s}
    if uniq == {SOURCE_LLM}:
        return SOURCE_LLM
    if uniq <= {SOURCE_DETERMINISTIC}:  # all deterministic (or empty)
        return SOURCE_DETERMINISTIC
    return SOURCE_PARTIAL
