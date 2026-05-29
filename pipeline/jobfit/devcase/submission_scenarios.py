"""Synthetic candidate submissions to exercise the EVALUATION half of the Dev pipeline.

Each scenario is a synthetic git trace representing a candidate BEHAVIOUR (does
verification or not; uses AI heavily or not) + a case (covert probes + rubric) + a role.
The point is to gate the fairness invariant: code is assumed LLM-generated, so the score
must track VERIFICATION/JUDGMENT — never whether the candidate used AI.

Deterministic (varied by index, no RNG). Complements scenarios.py (the design half).
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any

from .scenarios import FAMILIES, SENIORITIES

_FAMILY_KEYS = list(FAMILIES)

# Traces are newest-first (matches how the GitHub fetch + reflect_commits read them).
BEHAVIORS: dict[str, dict[str, Any]] = {
    "careful_verifier": {
        "verifies": True,
        "usesAI": False,
        "trace": ["fix based on failing test", "add tests for edge cases", "implement feature incrementally", "read existing module then scaffold"],
    },
    "ai_then_verify": {
        "verifies": True,
        "usesAI": True,
        "trace": ["fix edge case the test caught", "add tests for the generated module", "generate full feature with assistant", "read brief and explore the codebase"],
    },
    "tdd": {
        "verifies": True,
        "usesAI": False,
        "trace": ["refactor while green", "make the test pass", "add a failing test first", "read the spec"],
    },
    "exploratory_reverts": {
        "verifies": True,
        "usesAI": False,
        "trace": ["refactor after rethinking", "revert the wrong approach", "wip try approach B", "wip try approach A", "explore and read host handling"],
    },
    "big_bang_no_verify": {
        "verifies": False,
        "usesAI": False,
        "trace": ["implement everything in one pass", "initial commit"],
    },
    "ai_no_verify": {
        "verifies": False,
        "usesAI": True,
        "trace": ["add the complete feature", "scaffold the whole solution with assistant"],
    },
}
_BEHAVIOR_KEYS = list(BEHAVIORS)


@dataclass
class SubScenario:
    id: str
    label: str
    commits: list[dict]
    case: dict
    role: dict
    planted: dict[str, Any] = field(default_factory=dict)


def _pick(seq: list, i: int):
    return seq[i % len(seq)]


def _case() -> dict:
    return {
        "title": "Take-home case",
        "coverProbes": [
            {"id": "p1", "kind": "verification_trap", "where": "the thin test suite", "reveals": "real tests vs trust one-shot"},
            {"id": "p2", "kind": "legacy_trap", "where": "the legacy module", "reveals": "read before generating?"},
            {"id": "p3", "kind": "underspecified", "where": "the brief", "reveals": "clarify or silently assume?"},
        ],
        "rubricDimensions": [
            {"name": n, "weight": w}
            for n, w in [("framing", 0.2), ("tooling", 0.25), ("judgment", 0.25), ("architecture", 0.15), ("transfer", 0.15)]
        ],
    }


def generate_submissions(n: int = 60) -> list[SubScenario]:
    out: list[SubScenario] = []
    for i in range(n):
        behavior = _pick(_BEHAVIOR_KEYS, i)
        spec_b = BEHAVIORS[behavior]
        fam = _pick(_FAMILY_KEYS, i)
        spec = FAMILIES[fam]
        stack = _pick(spec["stacks"], i // len(_FAMILY_KEYS))
        seniority = _pick(SENIORITIES, i)
        title = _pick(spec["titles"], i)
        role = {
            "title": title,
            "seniority": seniority,
            "roleFamily": fam,
            "mustHaves": stack,
            "responsibilities": spec["resp"][: 2 + (i % 3)],
        }
        out.append(
            SubScenario(
                id=f"sub-{i:03d}",
                label=f"{behavior} · {seniority} {title} · {fam}",
                commits=[{"message": m} for m in spec_b["trace"]],
                case=_case(),
                role=role,
                planted={"behavior": behavior, "verifies": spec_b["verifies"], "usesAI": spec_b["usesAI"], "family": fam},
            )
        )
    return out
