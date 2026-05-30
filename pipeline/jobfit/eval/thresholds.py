"""Single source of truth for every eval pass/fail threshold.

Centralised so a gate can't silently drift per-module, and validated at import
so a typo'd threshold (negative, >1, non-numeric) fails fast instead of making a
run trivially pass or fail. Each eval module re-exports the table it consumes.
"""
from __future__ import annotations

# runner.py — golden-set extraction eval (fractions in [0, 1]).
PASS_THRESHOLDS = {
    "role_family": 0.85,
    "seniority": 0.70,
    "salary_overlap": 0.60,
    "skill_recall": 0.75,
}

# matching_eval.py — archetype routing + entry precision + relevance@5.
MATCHING_THRESHOLDS = {
    "archetype_accuracy": 1.0,
    "entry_precision": 0.99,
    "role_relevance_at5": 0.60,
}

# automation_eval.py — HR-automation reliability + judge quality (1-5 scale).
RELIABILITY_THRESHOLD = 1.0
QUALITY_THRESHOLD = 3.5


def _validate() -> None:
    for name, table in (("PASS_THRESHOLDS", PASS_THRESHOLDS), ("MATCHING_THRESHOLDS", MATCHING_THRESHOLDS)):
        for key, value in table.items():
            if not isinstance(value, (int, float)) or isinstance(value, bool) or not (0.0 <= value <= 1.0):
                raise ValueError(f"{name}[{key!r}] must be a number in [0, 1], got {value!r}")
    if not (0.0 <= RELIABILITY_THRESHOLD <= 1.0):
        raise ValueError(f"RELIABILITY_THRESHOLD must be in [0, 1], got {RELIABILITY_THRESHOLD!r}")
    if not (1.0 <= QUALITY_THRESHOLD <= 5.0):
        raise ValueError(f"QUALITY_THRESHOLD must be in [1, 5], got {QUALITY_THRESHOLD!r}")


_validate()
