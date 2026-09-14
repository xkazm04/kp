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

:func:`derive_role_rubric` is the derivation, deterministic and keyless by
construction: the brief's grading is already structured (kind x hardness x
weight), so turning it into axes needs no provider — an LLM could only improve the
axis PROSE, never which axes exist or what they weigh. ``app/_lib/role-rubric.ts``
mirrors it for the TS callers, and both are pinned to one fixture
(``pipeline/jobfit/tests/fixtures/role_rubric_cases.json``) so they cannot drift
apart. The rules, stated once:

* Each requirement with a skill becomes a ``requirement`` axis keyed
  ``req:<skill>``. Rows naming the same skill (case/whitespace-insensitive)
  collapse into ONE axis: the stronger kind wins (must_have over nice_to_have),
  then the stronger hardness (prerequisite over learnable), and the axis keeps the
  largest weight — a brief that says a skill twice has not asked for it to count
  twice. Label and provenance come from the first row that named the skill; the
  rationale from the first row that gave one.
* Each ``core`` facet with a name and a value becomes an axis; the first statement
  of a facet name wins. ``budget_band`` is a ``cost`` axis (``cost:budget_band``);
  every other core facet is a ``facet`` axis (``facet:<name>``). ``valuable`` and
  ``context`` facets do not become axes: ADR-0010 names only ``core`` ("losing it
  changes who you hire"), and an axis nobody said was decisive would dilute the
  ones that are.
* Raw weight = the brief's weight clamped to 0.05..1 (a stated-but-zero-weighted
  requirement still counts; a non-finite weight reads as the schema default 0.5)
  x a kind factor (must_have 1, nice_to_have 0.5); a core facet carries a fixed raw
  weight of 0.5. Axis ``weight`` is the raw weight's share of the total, so a
  rubric's axes sum to 1.
* ``blocking`` is true only for must_have x prerequisite — the one grading that
  says "without this, no". Nothing else may end a candidacy on its own.
* Order is part of the contract: requirement axes first — blocking, then
  must_have, then raw weight descending, then key — followed by the facet and cost
  axes in key order.
"""

from __future__ import annotations

import math
from typing import Literal

from .models import _Base
from .rolebrief import RoleBrief

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

    key: str = ""                          # "req:<skill>" | "facet:<name>" | "cost:<name>"
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


# Core facet names whose evidence is not a conversation. Everything else a core
# facet can say ("team_context", "why_now", "success_90d", ...) is judged by talking.
_FACET_EVIDENCE_CLASS = {
    "budget_band": "cost",
    "work_environment": "demonstrated_work",
    "codebase_dossier": "demonstrated_work",
}

_KIND_FACTOR = {"must_have": 1.0, "nice_to_have": 0.5}
_KIND_RANK = {"must_have": 0, "nice_to_have": 1}
_HARDNESS_RANK = {"prerequisite": 0, "learnable": 1}
_MIN_REQUIREMENT_WEIGHT = 0.05
_DEFAULT_REQUIREMENT_WEIGHT = 0.5
_CORE_FACET_RAW_WEIGHT = 0.5


def _collapse(text: str) -> str:
    return " ".join(text.split())


def _evidence(evidence_class: str) -> dict[str, str]:
    human, agent = RUBRIC_EVIDENCE_SOURCES[evidence_class]
    return {"evidence_class": evidence_class, "human_evidence": human, "agent_evidence": agent}


def derive_role_rubric(brief: RoleBrief) -> list[RubricAxis]:
    """The rubric axes a RoleBrief states. Pure: same brief, same list, every time.

    An empty list is a real answer (a brief with no graded requirement and no core
    facet), not an error — refusing to mint an empty rubric is the store's call."""

    merged: dict[str, dict] = {}
    for req in brief.requirements:
        label = _collapse(req.skill)
        if not label:
            continue
        kind = req.kind if req.kind in _KIND_FACTOR else "must_have"
        hardness = req.hardness if req.hardness in _HARDNESS_RANK else "prerequisite"
        stated = float(req.weight) if math.isfinite(req.weight) else _DEFAULT_REQUIREMENT_WEIGHT
        weight = max(_MIN_REQUIREMENT_WEIGHT, min(1.0, stated))
        key = f"req:{label.lower()}"
        seen = merged.get(key)
        if seen is None:
            merged[key] = {
                "key": key,
                "label": label,
                "kind": kind,
                "hardness": hardness,
                "weight": weight,
                "provenance": req.provenance,
                "rationale": req.rationale.strip(),
            }
            continue
        if _KIND_RANK[kind] < _KIND_RANK[seen["kind"]]:
            seen["kind"] = kind
        if _HARDNESS_RANK[hardness] < _HARDNESS_RANK[seen["hardness"]]:
            seen["hardness"] = hardness
        seen["weight"] = max(seen["weight"], weight)
        if not seen["rationale"]:
            seen["rationale"] = req.rationale.strip()

    facets: dict[str, dict] = {}
    for facet in brief.facets:
        if facet.importance != "core":
            continue
        name = _collapse(facet.key).lower() or _collapse(facet.label).lower()
        value = facet.value.strip()
        if not name or not value:
            continue
        evidence_class = _FACET_EVIDENCE_CLASS.get(name, "conversation")
        origin = "cost" if evidence_class == "cost" else "facet"
        key = f"{origin}:{name}"
        if key in facets:
            continue  # first statement of a facet wins; a repeat is not a second axis
        facets[key] = {
            "key": key,
            "label": facet.label.strip() or facet.key.strip(),
            "origin": origin,
            "provenance": facet.provenance,
            "rationale": value,
            "evidence_class": evidence_class,
        }

    requirements = sorted(
        merged.values(),
        key=lambda r: (
            0 if (r["kind"] == "must_have" and r["hardness"] == "prerequisite") else 1,
            _KIND_RANK[r["kind"]],
            -(r["weight"] * _KIND_FACTOR[r["kind"]]),
            r["key"],
        ),
    )
    facet_rows = sorted(facets.values(), key=lambda f: f["key"])

    raws = [r["weight"] * _KIND_FACTOR[r["kind"]] for r in requirements]
    raws += [_CORE_FACET_RAW_WEIGHT] * len(facet_rows)
    # Summed left to right on purpose: the TS mirror sums in the same order, so the
    # shares are bit-identical in both languages rather than merely close.
    total = 0.0
    for raw in raws:
        total += raw

    axes: list[RubricAxis] = []
    for index, r in enumerate(requirements):
        axes.append(
            RubricAxis(
                key=r["key"],
                label=r["label"],
                origin="requirement",
                kind=r["kind"],
                hardness=r["hardness"],
                weight=raws[index] / total,
                blocking=r["kind"] == "must_have" and r["hardness"] == "prerequisite",
                provenance=r["provenance"],
                rationale=r["rationale"],
                **_evidence("requirement_coverage"),
            )
        )
    offset = len(requirements)
    for index, f in enumerate(facet_rows):
        axes.append(
            RubricAxis(
                key=f["key"],
                label=f["label"],
                origin=f["origin"],
                kind="core",
                hardness="",
                weight=raws[offset + index] / total,
                blocking=False,
                provenance=f["provenance"],
                rationale=f["rationale"],
                **_evidence(f["evidence_class"]),
            )
        )
    return axes
