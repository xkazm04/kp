"""Shared, RNG-free scaffolding for the synthetic-scenario generators.

scenarios.py (the design half) and submission_scenarios.py (the eval half) both build
index-varied — deliberately no random — landscapes and round-robin over the same
seniority ladder with the same picker. Keeping that deterministic-rotation logic here
(rather than copy-pasting it into both) means the two generators can't drift in HOW they
rotate domains/seniorities. The domain key list (`list(DOMAINS)`) is derived in scenarios.py,
which owns the DOMAINS table, and imported from there by submission_scenarios.py.
"""

from __future__ import annotations

# The seniority ladder, round-robined by index across both generators.
SENIORITIES = ["junior", "medior", "senior", "lead"]


def pick(seq: list, i: int):
    """Deterministic round-robin: the i-th element of ``seq``, wrapping with modulo (no RNG)."""
    return seq[i % len(seq)]
