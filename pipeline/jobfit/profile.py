"""Archetype-aware candidate profile (Phase 4, diagram 03).

A v2 profile that works for every archetype: BAU fields (years/seniority) are
optional, and evidence/skills carry **provenance** so a skill from a school
project is not treated like five years in production. Kept separate from the v1
``models.CandidateProfile`` (which drives the legacy single-analysis path and
its generated Zod schema) so neither disturbs the other.

The transformation in Phase 5 turns this into a ``matching.MatchCandidate``
(normalizing skills with provenance, deriving a potential score). Here we just
model it and score its completeness for the guided intake.
"""

from __future__ import annotations

from typing import Callable

from pydantic import Field

from . import registry
from .archetype import BAU
from .models import _Base
from .taxonomy import PROVENANCE_WEIGHTS

# Source of truth for the evidence/skill taxonomy shared with the frontend: the
# TS dropdowns (app/_lib/taxonomy.generated.ts) are generated from these lists
# by codegen.py, so adding a kind/level here flows to the UI and the build /
# `npm run schemas:check` gate fails if the generated file drifts (idea-ba28f11b).

# Evidence categories the student/switcher intake collects. Order is the frontend
# dropdown order (student-centric: project/thesis first), since the generated TS
# list mirrors it; logic only ever tests membership, never position.
EVIDENCE_KINDS = (
    "project",
    "thesis",
    "internship",
    "course",
    "extracurricular",
    "certification",
    "job",
    "other",
)
SKILL_LEVELS = ("foundational", "working", "strong")
# Default provenance per evidence kind (overridable per item).
_KIND_PROVENANCE = {
    "job": "professional",
    "internship": "internship",
    "project": "personal_project",
    "thesis": "thesis",
    "course": "coursework",
    "extracurricular": "extracurricular",
    "certification": "certification",
    "other": "unknown",
}

# These developer-authored maps must agree or evidence silently scores wrong:
# every evidence kind needs a default provenance, and every default must be a
# real provenance carrying a scoring weight. Checked at import so a drifting edit
# fails loudly here, not as a zero score deep in matching (idea-ba28f11b).
if set(_KIND_PROVENANCE) != set(EVIDENCE_KINDS):
    raise RuntimeError(
        "EVIDENCE_KINDS and _KIND_PROVENANCE keys disagree: "
        f"{sorted(set(EVIDENCE_KINDS) ^ set(_KIND_PROVENANCE))}"
    )
_unweighted_kind_provenance = sorted(
    v for v in _KIND_PROVENANCE.values() if v not in PROVENANCE_WEIGHTS
)
if _unweighted_kind_provenance:
    raise RuntimeError(
        "_KIND_PROVENANCE maps to provenance(s) with no weight: "
        f"{_unweighted_kind_provenance}"
    )


class Evidence(_Base):
    kind: str = "other"
    title: str = ""
    text: str = ""
    skills: list[str] = Field(default_factory=list)
    provenance: str = "unknown"
    confidence: float = 0.6
    link: str | None = None
    recency: str | None = None

    def resolved_provenance(self) -> str:
        # An explicit, known provenance wins; "unknown"/empty means "infer from kind".
        if self.provenance and self.provenance != "unknown" and self.provenance in PROVENANCE_WEIGHTS:
            return self.provenance
        return _KIND_PROVENANCE.get(self.kind, "unknown")


class SkillClaim(_Base):
    skill: str
    level: str = "working"
    provenance: str = "self_declared"
    confidence: float = 0.4


class CandidateProfileV2(_Base):
    archetype: str = BAU
    archetype_confidence: float = 0.5
    archetype_reasons: list[str] = Field(default_factory=list)

    display_name: str | None = None
    role_family: str = "software_engineering"
    aspirations: list[str] = Field(default_factory=list)

    # BAU fields — optional, because students/early-career often lack them.
    years_experience: float | None = None
    seniority: str | None = None

    education_level: str = "unknown"
    education_detail: str = ""  # programme, specialisation, year / expected graduation
    languages: list[str] = Field(default_factory=list)
    location: str | None = None
    availability: str | None = None

    skill_claims: list[SkillClaim] = Field(default_factory=list)
    evidence: list[Evidence] = Field(default_factory=list)

    # derived in Phase 5
    potential_score: float | None = None
    learning_signals: list[str] = Field(default_factory=list)
    completeness: float = 0.0


def _evidence_kinds(profile: CandidateProfileV2) -> set[str]:
    return {e.kind for e in profile.evidence}


# Named completeness predicates the registry's checklist `check` ids resolve to.
# The registry says *which* checks (and their weights/labels) apply per archetype;
# the logic of each check lives here. A new archetype that reuses these checks is
# pure config; a genuinely new check is the only thing that needs a line here.
CHECKS: dict[str, Callable[[CandidateProfileV2], bool]] = {
    "education_known": lambda p: p.education_level != "unknown",
    "has_languages": lambda p: bool(p.languages),
    "min_3_skills": lambda p: len(p.skill_claims) >= 3,
    "has_aspirations": lambda p: bool(p.aspirations),
    "has_education_detail": lambda p: bool(p.education_detail.strip()),
    "has_project_or_thesis": lambda p: bool(_evidence_kinds(p) & {"project", "thesis"}),
    "has_activity": lambda p: bool(_evidence_kinds(p) & {"internship", "extracurricular", "certification", "job"}),
    "has_seniority": lambda p: p.seniority is not None,
    "has_years": lambda p: p.years_experience is not None,
    "has_job": lambda p: bool(_evidence_kinds(p) & {"job"}),
}


def _checklist(profile: CandidateProfileV2) -> list[tuple[bool, float, str]]:
    """(satisfied, weight, label) items whose weighted ratio is the completeness.

    The specs (which checks, weights, labels) come from the shared registry; the
    predicates are CHECKS above. An unknown check id fails closed (counts as a
    not-yet-satisfied gap) rather than raising.
    """
    return [
        (CHECKS.get(check, lambda _p: False)(profile), weight, label)
        for check, weight, label in registry.checklist_specs(profile.archetype)
    ]


def completeness(profile: CandidateProfileV2) -> tuple[float, list[str]]:
    """Return (score in [0,1], the still-missing item labels, biggest-gap first)."""
    checks = _checklist(profile)
    total = sum(w for _ok, w, _label in checks)
    got = sum(w for ok, w, _label in checks if ok)
    missing = [label for ok, _w, label in checks if not ok]
    # order missing by weight desc so the UI can nudge the biggest gap first
    weight_by_label = {label: w for _ok, w, label in checks}
    missing.sort(key=lambda label: weight_by_label.get(label, 0.0), reverse=True)
    score = round(got / total, 2) if total else 0.0
    return score, missing


def completeness_gaps(profile: CandidateProfileV2) -> list[dict[str, str]]:
    """Machine-readable twin of :func:`completeness`'s missing list: the unmet
    checklist items as ``{check, label}`` dicts, biggest weight first — so an
    intake follow-up UI can render one TARGETED field per gap (keyed by the
    check id) instead of a generic "profile incomplete" nudge."""
    unmet = [
        (weight, check, label)
        for check, weight, label in registry.checklist_specs(profile.archetype)
        if not CHECKS.get(check, lambda _p: False)(profile)
    ]
    unmet.sort(key=lambda item: item[0], reverse=True)
    return [{"check": check, "label": label} for _weight, check, label in unmet]


def normalize_profile(profile: CandidateProfileV2) -> tuple[float, list[str]]:
    """Resolve evidence provenance defaults, stamp completeness, and return the
    ``(score, missing)`` it already computes.

    The profile is mutated in place (provenance + ``completeness``); the return
    value hands callers BOTH the stamp and the still-missing gaps so they never
    have to re-run the archetype checklist a second time.
    """
    for ev in profile.evidence:
        ev.provenance = ev.resolved_provenance()
    score, missing = completeness(profile)
    profile.completeness = score
    return score, missing
