"""Shared test factories + named thresholds for the unittest suite.

This is a plain importable module, NOT a pytest ``conftest.py`` — the suite runs
under ``python -m unittest discover`` (see package.json ``test:python``), where
conftest fixtures would never fire. Import the factories explicitly.
"""
from __future__ import annotations

from pipeline.jobfit.jobs import normalize_job
from pipeline.jobfit.matching import MatchCandidate

# Named thresholds, replacing inline magic numbers across the suite.
STRONG_SKILL_SCORE = 0.6  # a confident must-have skill match
PARTIAL_SKILL_SCORE = 0.5  # a transferable/adjacent skill match
MIN_CONFIDENCE_SPREAD = 8  # min total spread between confidence_high/low
MIN_LINKEDIN_TEXT_LEN = 5000  # a real LinkedIn export is at least this long


def mkjob(**over):
    """A normalized job with sensible defaults; override any field via kwargs."""
    base = {
        "title": "Role",
        "seniority": "senior",
        "role_family": "software_engineering",
        "languages": ["English"],
        "description": "A team building things.",
        "requirements": [{"skill": "Python", "kind": "must_have", "hardness": "prerequisite"}],
    }
    base.update(over)
    return normalize_job(base)


def mk_candidate(**over) -> MatchCandidate:
    """A MatchCandidate with sensible defaults; override any field via kwargs."""
    base: dict = {
        "skills": ["Python"],
        "seniority": "senior",
        "role_family": "software_engineering",
        "education_level": "master",
        "languages": ["Czech", "English"],
        "years_experience": 8,
    }
    base.update(over)
    return MatchCandidate(**base)
