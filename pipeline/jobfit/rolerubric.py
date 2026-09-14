"""Role rubric — the weighted axes a role's candidates are judged against.

ADR-0010 (docs/architecture/decisions/0010-need-role-slate-one-board.md) §2: a
role FREEZES ONE rubric, derived from the RoleBrief's own graded requirements and
its ``core`` facets, and every population on the slate — a person or an AI agent —
is scored against that same list of axes. :class:`RubricAxis` is the shape of one
axis; the frozen, versioned store that persists a list of them is
``app/_lib/db/role-rubrics.ts`` (``role_rubrics.axes_json``), which validates every
write against the codegen'd ``rubricAxisSchema``.

The vocabularies are ``Literal`` on purpose: they are emitted as ``z.enum`` so a
persisted axis naming an evidence source no scorer knows is an invalid row, not a
string that silently scores nothing.
"""

from __future__ import annotations

from typing import Literal

from .models import _Base

# What in the brief produced an axis. "cost" is the budget facet — split out
# because its evidence (salary band / budget) is not a conversation.
RUBRIC_AXIS_ORIGINS = ("requirement", "facet", "cost")

# What KIND of evidence scores an axis — the rows of ADR-0010 §3's table.
RUBRIC_EVIDENCE_CLASSES = ("requirement_coverage", "demonstrated_work", "conversation", "cost")

# class -> (human evidence source, agent evidence source): the per-population
# adapters of ADR-0010 §3 ("one score, two evidence adapters"). A scorer reads
# THESE names off the axis, never its own.
RUBRIC_EVIDENCE_SOURCES: dict[str, tuple[str, str]] = {
    "requirement_coverage": ("analysis", "agent_fit"),
    "demonstrated_work": ("devcase", "trial_run"),
    "conversation": ("scorecard", "mandate_exchange"),
    "cost": ("salary_band", "budget"),
}

AxisOrigin = Literal["requirement", "facet", "cost"]
AxisKind = Literal["must_have", "nice_to_have", "core"]
AxisHardness = Literal["prerequisite", "learnable", ""]
EvidenceClass = Literal["requirement_coverage", "demonstrated_work", "conversation", "cost"]
HumanEvidence = Literal["analysis", "devcase", "scorecard", "salary_band"]
AgentEvidence = Literal["agent_fit", "trial_run", "mandate_exchange", "budget"]


class RubricAxis(_Base):
    """One weighted axis of a role's rubric. ``key`` is stable across re-derivations
    of an unchanged brief, which is what lets a score recorded against version 1 be
    read back against the axis it was actually produced under."""

    key: str = ""                          # "req:<skill>" | "facet:<facet key>"
    label: str = ""                        # the requestor's own words — skill or facet label
    origin: AxisOrigin = "requirement"     # RUBRIC_AXIS_ORIGINS
    kind: AxisKind = "must_have"           # must_have | nice_to_have (requirement) | core (facet)
    hardness: AxisHardness = ""            # prerequisite | learnable; "" for a facet
    weight: float = 0.0                    # share of the rubric, 0..1; a rubric's axes sum to 1
    blocking: bool = False                 # must_have x prerequisite only
    provenance: str = "inferred"           # the brief's BRIEF_PROVENANCE for the source row
    evidence_class: EvidenceClass = "requirement_coverage"  # RUBRIC_EVIDENCE_CLASSES
    human_evidence: HumanEvidence = "analysis"              # what scores it for a person
    agent_evidence: AgentEvidence = "agent_fit"             # what scores it for an AI agent
    rationale: str = ""                    # requirement rationale / facet value, verbatim
