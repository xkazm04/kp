"""Synthetic candidate submissions to exercise the EVALUATION half of the Dev pipeline.

Each scenario is a synthetic work/git trace representing a candidate BEHAVIOUR + a case
(covert probes + rubric) + a role. Two axes are tagged:
  - verifies / usesAI  -> the FAIRNESS gate (score must track verification, never AI use).
  - expected strong/weak -> the DISCRIMINATION metric (strong submissions out-score weak ones,
    and the AI-no-verify "gamer" is caught).
Domain-aware: IT traces (git log) vs non-IT (work/process log); `domain="mixed"` spans all.

Deterministic (varied by index, no RNG). Complements scenarios.py (the design half).

COVERAGE: the synthetic commits below carry messages ONLY (no additions/files counts) and
run with repo=None, so this landscape exercises reflect_commits' MESSAGE-KEYWORD path only.
The structural branches — size-driven big-bang (biggestShareOfChange >= 0.6), file-tree test
detection, and the burstiness branch — are NOT reached here; they are covered directly by
tests/test_devcase_reflect.py::TestReflectStructuralSignals. Keep this note honest if the
synthetic traces are ever enriched with structural signals.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any

from ._synth import SENIORITIES, pick as _pick
from .models import RUBRIC_DIMENSIONS
from .scenarios import DOMAINS, _DOMAIN_KEYS

# Traces are newest-first (matches how the GitHub fetch + reflect_commits read them).
# `trace` = software flavour (the deterministic reflect heuristic keys off "test"/"explore");
# `general` = non-IT work/process flavour (the LLM path reads it the same way).
BEHAVIORS: dict[str, dict[str, Any]] = {
    "careful_verifier": {
        "verifies": True, "usesAI": False, "expected": "strong",
        "trace": ["fix based on failing test", "add tests for edge cases", "implement feature incrementally", "read existing module then scaffold"],
        "general": ["fix based on the review", "fact-check the key numbers/claims against the source", "draft the deliverable section by section", "review and understand the existing materials first"],
    },
    "ai_then_verify": {
        "verifies": True, "usesAI": True, "expected": "strong",
        "trace": ["fix edge case the test caught", "add tests for the generated module", "generate full feature with assistant", "read brief and explore the codebase"],
        "general": ["fix the issue the review caught", "validate the AI draft against the source", "draft the full piece with an assistant", "read the brief and review existing materials"],
    },
    "tdd": {
        "verifies": True, "usesAI": False, "expected": "strong",
        "trace": ["refactor while green", "make the test pass", "add a failing test first", "read the spec"],
        "general": ["refine after checking against the spec", "check it meets the acceptance bar", "define the acceptance bar first", "read and understand the spec"],
    },
    "exploratory_reverts": {
        "verifies": True, "usesAI": False, "expected": "strong",
        "trace": ["refactor after rethinking", "revert the wrong approach", "wip try approach B", "wip try approach A", "explore and read host handling"],
        "general": ["refine after rethinking", "scrap the wrong approach", "try angle B", "try angle A", "review and understand the existing materials"],
    },
    "big_bang_no_verify": {
        "verifies": False, "usesAI": False, "expected": "weak",
        "trace": ["implement everything in one pass", "initial commit"],
        "general": ["produce the whole deliverable in one pass", "first draft"],
    },
    "ai_no_verify": {
        "verifies": False, "usesAI": True, "expected": "weak",
        "trace": ["add the complete feature", "scaffold the whole solution with assistant"],
        "general": ["add the complete deliverable", "generate the whole thing with an assistant"],
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


def _case() -> dict:
    return {
        "title": "Take-home case",
        "coverProbes": [
            {"id": "p1", "kind": "verification_trap", "where": "the thin test suite", "reveals": "real tests vs trust one-shot"},
            {"id": "p2", "kind": "legacy_trap", "where": "the legacy module", "reveals": "read before generating?"},
            {"id": "p3", "kind": "underspecified", "where": "the brief", "reveals": "clarify or silently assume?"},
        ],
        # Names + weights sourced from the canonical rubric (models.RUBRIC_DIMENSIONS) so the
        # synthetic fixture can't silently test stale weights if the rubric is reweighted.
        "rubricDimensions": [{"name": d["name"], "weight": d["weight"]} for d in RUBRIC_DIMENSIONS],
    }


def generate_submissions(n: int = 60, domain: str = "it") -> list[SubScenario]:
    """n submissions. domain='it' (default) keeps the original IT landscape; a non-IT domain
    or 'mixed' uses the work/process traces (best read on the LLM path)."""
    out: list[SubScenario] = []
    for i in range(n):
        dom = _DOMAIN_KEYS[i % len(_DOMAIN_KEYS)] if domain == "mixed" else domain
        fams = DOMAINS[dom]["families"]
        fam_keys = list(fams)
        behavior = _pick(_BEHAVIOR_KEYS, i)
        spec_b = BEHAVIORS[behavior]
        fam = _pick(fam_keys, i)
        spec = fams[fam]
        stack = _pick(spec["stacks"], i // len(fam_keys))
        seniority = _pick(SENIORITIES, i)
        title = _pick(spec["titles"], i)
        role = {
            "title": title,
            "seniority": seniority,
            "roleFamily": fam,
            "mustHaves": stack,
            "responsibilities": spec["resp"][: 2 + (i % 3)],
        }
        trace = spec_b["trace"] if dom == "it" else spec_b["general"]
        out.append(
            SubScenario(
                id=f"sub-{i:03d}",
                label=f"{behavior} · {seniority} {title} · {dom}/{fam}",
                commits=[{"message": m} for m in trace],
                case=_case(),
                role=role,
                planted={
                    "behavior": behavior,
                    "verifies": spec_b["verifies"],
                    "usesAI": spec_b["usesAI"],
                    "expected": spec_b["expected"],
                    "domain": dom,
                    "family": fam,
                },
            )
        )
    return out
