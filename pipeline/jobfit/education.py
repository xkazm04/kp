"""The education vocabulary and the one gate that compares its two ladders.

Education is the only hard gate whose candidate-side input is an INFERENCE from a
surface match, not a stated fact, so the two sides use different ladders:

* **Job side** (``JOB_MIN_LEVELS``): the minimum a posting states. ``university``
  there means "any university degree"; ``high_school`` a school-leaving diploma;
  ``none`` no requirement.
* **Candidate side** (``CANDIDATE_LEVELS``): what the CV lets us read.
  ``university`` there means "the CV names a school but states no degree" —
  taxonomy.classify_education falls through to it exactly when no phd/master/
  bachelor term matched — and ``unknown`` means the CV names nothing.

The two ``university`` slugs share a spelling (stored profiles keep it), not a
meaning. A candidate ``university`` is a LOWER BOUND: they attended, so any
requirement at or below "any degree" is met, and anything above it is not
measured — ``uncertain``, never ``below``. Only a measured shortfall
(``high_school`` against ``bachelor``, ``bachelor`` against ``master``) is
``below``, and only ``below`` is a knock-out (matching.ko_filter).

Import-free on purpose: jobs, taxonomy, transform, matching, pipeline and codegen
all import from here, so this module must never import any of them.
"""

from __future__ import annotations

from typing import Literal

# Job side, in the order the extraction prompt and _choice() list them.
JOB_MIN_LEVELS: tuple[str, ...] = ("phd", "master", "bachelor", "university", "high_school", "none")

# Candidate side, in the order the profile editor offers them (codegen emits this
# as CANDIDATE_EDUCATION_LEVELS; profileTypes.ts re-exports it as EDU_LEVELS).
CANDIDATE_LEVELS: tuple[str, ...] = ("unknown", "university", "bachelor", "master", "phd")

# classify_education: the first level whose taxonomy terms matched wins; a school
# name with no degree title matches only ``university``.
CLASSIFY_PRIORITY: tuple[str, ...] = ("phd", "master", "bachelor", "university")

# The early-career readiness model's "foundation quality" weight per level.
FOUNDATION_WEIGHTS: dict[str, float] = {"phd": 1.0, "master": 0.85, "bachelor": 0.7, "university": 0.5}

# One ordinal over MEASURED attainment. ``university`` sits at "any degree".
EDU_RANK: dict[str, int] = {"none": 0, "high_school": 1, "university": 2, "bachelor": 3, "master": 4, "phd": 5}

# Candidate levels that are a floor, not a measurement: the CV proves at least
# this much and says nothing about more.
_LOWER_BOUND_LEVELS: frozenset[str] = frozenset({"university"})

EducationGate = Literal["not_required", "meets", "below", "uncertain"]


def education_gate(candidate_level: str | None, job_min: str | None) -> EducationGate:
    """Compare a candidate's read level with a posting's minimum.

    ``not_required`` — the posting states no minimum (None, "" or "none").
    ``meets``        — the candidate provably clears the minimum.
    ``below``        — a measured level under the minimum (the only KO).
    ``uncertain``    — the CV does not let us tell: ``unknown``, an unmodelled
                       level, or a lower bound (``university``) under a higher bar.
    """
    if not job_min or job_min == "none":
        return "not_required"
    need = EDU_RANK.get(job_min, 0)
    have = EDU_RANK.get(candidate_level or "")
    if have is None:
        return "uncertain"
    if have >= need:
        return "meets"
    if candidate_level in _LOWER_BOUND_LEVELS:
        return "uncertain"
    return "below"


def is_degree_unstated(candidate_level: str | None) -> bool:
    """True when the CV names a school but no degree (the ``eduDegreeUnstated`` code)."""
    return candidate_level in _LOWER_BOUND_LEVELS
