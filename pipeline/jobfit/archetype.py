"""Candidate archetype router (Phase 4, diagram 07).

Routes a candidate to BAU / Student-early-career / Career-switcher / …, which
then selects the intake, transformation, scoring weights, and reasoning lens. The
detection is never silently final: an explicit self-declaration is trusted as the
primary signal (but contradictions are flagged), the candidate can override, and
a confidence is always returned for the recruiter to see.

The taxonomy + detection rules now live in the shared registry (archetypes.json,
read by both Python and the TS app); this module is a thin, back-compatible
facade so existing importers keep their `BAU`/`ARCHETYPES`/`detect_archetype`
surface. Add archetypes in archetypes.json, not here.
"""

from __future__ import annotations

from . import registry

# Stable id constants kept for ergonomic imports (profile.py, transform.py).
BAU = "bau"
STUDENT = "student"
CAREER_SWITCHER = "career_switcher"

# Derived from the registry so the tuple (and its tie-break order) cannot drift
# from the source of truth.
ARCHETYPES = registry.archetype_ids()

_LABELS = registry.python_labels()


def label_for(archetype: str) -> str:
    return _LABELS.get(archetype, archetype)


def detect_archetype(
    *,
    self_declared: str | None = None,
    years_relevant_experience: float | None = None,
    is_enrolled: bool | None = None,
    expected_graduation: str | None = None,
    education_is_dominant: bool | None = None,
    wants_domain_change: bool | None = None,
    has_substantial_experience: bool | None = None,
) -> tuple[str, float, list[str]]:
    """Return (archetype, confidence in [0,1], reasons) — see registry.detect."""
    return registry.detect(
        self_declared=self_declared,
        years_relevant_experience=years_relevant_experience,
        is_enrolled=is_enrolled,
        expected_graduation=expected_graduation,
        education_is_dominant=education_is_dominant,
        wants_domain_change=wants_domain_change,
        has_substantial_experience=has_substantial_experience,
    )
