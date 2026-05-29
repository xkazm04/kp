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

from pydantic import Field

from .archetype import BAU, CAREER_SWITCHER, STUDENT
from .models import _Base
from .taxonomy import PROVENANCE_WEIGHTS

# Evidence categories the student/switcher intake collects.
EVIDENCE_KINDS = (
    "job",
    "internship",
    "project",
    "thesis",
    "course",
    "extracurricular",
    "certification",
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


def _checklist(profile: CandidateProfileV2) -> list[tuple[bool, float, str]]:
    """(satisfied, weight, label) items whose weighted ratio is the completeness."""
    kinds = _evidence_kinds(profile)
    items: list[tuple[bool, float, str]] = [
        (profile.education_level != "unknown", 1.0, "education level"),
        (bool(profile.languages), 1.0, "languages"),
        (len(profile.skill_claims) >= 3, 1.5, "at least 3 skills"),
    ]
    if profile.archetype in (STUDENT, CAREER_SWITCHER):
        items += [
            (bool(profile.aspirations), 1.5, "target roles / aspirations"),
            (bool(profile.education_detail.strip()), 1.0, "study programme & specialisation"),
            (bool(kinds & {"project", "thesis"}), 2.0, "a project or thesis (your strongest evidence)"),
            (
                bool(kinds & {"internship", "extracurricular", "certification", "job"}),
                1.0,
                "an internship, activity, or certification",
            ),
        ]
    else:  # BAU
        items += [
            (profile.seniority is not None, 1.5, "seniority"),
            (profile.years_experience is not None, 1.0, "years of experience"),
            (bool(kinds & {"job"}), 1.5, "a work-experience entry"),
        ]
    return items


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


def normalize_profile(profile: CandidateProfileV2) -> CandidateProfileV2:
    """Stamp completeness and resolve evidence provenance defaults."""
    for ev in profile.evidence:
        ev.provenance = ev.resolved_provenance()
    score, _missing = completeness(profile)
    profile.completeness = score
    return profile
