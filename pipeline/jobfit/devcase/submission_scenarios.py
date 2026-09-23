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

OBSERVED PATH (``path="observed"``): the same BEHAVIOR tags, each rendered as ONE fixed Live
Work Surface template — an event stream, a captured chat, a submitted tree, a frozen seed with
two planted canaries and a one-shot baseline — replicated to n. This is what in-product
candidates are scored on (devcase-run.ts passes --events/--chat/--files/--seed/--baseline-json),
so the fairness/discrimination gate certifies the observed chain too. The templates are
deliberately canonical (verifiers read first, edit a test, keep DECISIONS warm, fix or flag the
canaries; non-verifiers edit unread and ship the flaws): they pin that the observed scorer
separates the archetypes, not how well it reads an adversary — case-sim rounds do that.
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

# --- the observed (Live Work Surface) family: ONE fixed template per BEHAVIOR ---------------
_LEGACY, _CONFIG, _TEST, _DECISIONS = "src/legacy.py", "src/config.py", "tests/test_legacy.py", "DECISIONS.md"
_BRIEF = "Make the export rate configurable per market and keep the existing rounding behaviour."
_LEGACY_SEED = (
    '"""Legacy rate module."""\nimport math\n\nRATE = 0.19\n\n\ndef rate(amount):\n'
    "    return round(amount * RATE, 2)\n\n\ndef ceil_rate(amount):\n    return math.ceil(amount * RATE)\n"
)
_CONFIG_SEED = "TIMEOUT = 30\nretries = 0\nNAME = 'exports'\n"
_TEST_SEED = "def test_rate():\n    assert True\n"
_SEED = {
    "files": [
        {"path": _LEGACY, "contents": _LEGACY_SEED},
        {"path": _CONFIG, "contents": _CONFIG_SEED},
        {"path": _TEST, "contents": _TEST_SEED},
        {"path": _DECISIONS, "contents": "# Decisions\n"},
    ],
    "canaries": [
        {"id": "c1", "kind": "subtle_bug", "path": _LEGACY, "flaw": "the rate is hardcoded as 'RATE = 0.19' for every market", "reveals": "read the legacy module before generating?"},
        {"id": "c2", "kind": "subtle_bug", "path": _CONFIG, "flaw": "the client config sets 'retries = 0'", "reveals": "notice the config the change depends on?"},
    ],
}
# Submitted file bodies. Fixes keep the seed's structure (they descend from it, so the
# canary verdict is gradable); the one-shot bodies append to an unread file.
_LEGACY_FIXED = _LEGACY_SEED.replace("RATE = 0.19\n", "RATES = {'default': 0.19}\n").replace("* RATE", "* RATES['default']")
_LEGACY_ONESHOT = _LEGACY_SEED + "\n\ndef export_rate(amount, market):\n    return rate(amount)\n"
_FILES = {
    "legacy_fixed": {"path": _LEGACY, "contents": _LEGACY_FIXED},
    "legacy_oneshot": {"path": _LEGACY, "contents": _LEGACY_ONESHOT},
    "config_fixed": {"path": _CONFIG, "contents": _CONFIG_SEED.replace("retries = 0", "retries = 3")},
    "config_seed": {"path": _CONFIG, "contents": _CONFIG_SEED},
    "test": {"path": _TEST, "contents": "def test_rate():\n    assert rate(100) == 19.0\n"},
    "decisions": {"path": _DECISIONS, "contents": "# Decisions\n- rates keyed per market\n"},
    "decisions_flag": {"path": _DECISIONS, "contents": "# Decisions\n- rates keyed per market\n- src/config.py sets retries = 0, which looks wrong; left for the owner\n"},
}
_ASK = {"channel": "stakeholder", "role": "user", "text": "Which markets need their own rate first?"}
# behavior -> (events as (kind, path), submitted files, chat)
_OBSERVED: dict[str, tuple[list[tuple[str, str]], list[str], list[dict]]] = {
    "careful_verifier": (
        [("open", _LEGACY), ("open", _TEST), ("open", _CONFIG), ("edit", _TEST), ("edit", _LEGACY), ("decision_log", _DECISIONS), ("decision_log", _DECISIONS)],
        ["legacy_fixed", "config_seed", "test", "decisions_flag"],
        [_ASK],
    ),
    "ai_then_verify": (
        [("open", _LEGACY), ("open", _CONFIG), ("prompt", "assistant"), ("edit", _LEGACY), ("edit", _CONFIG), ("open", _TEST), ("prompt", "assistant"), ("edit", _TEST), ("decision_log", _DECISIONS), ("decision_log", _DECISIONS)],
        ["legacy_fixed", "config_fixed", "test", "decisions"],
        [
            {"channel": "assistant", "role": "user", "text": "Draft a per-market rate table for rate() and ceil_rate()"},
            {"channel": "assistant", "role": "model", "text": "Here is a draft."},
            {"channel": "assistant", "role": "user", "text": "Now verify it against the existing test and check the rounding edge cases"},
            _ASK,
        ],
    ),
    "tdd": (
        [("open", _TEST), ("edit", _TEST), ("open", _LEGACY), ("edit", _LEGACY), ("decision_log", _DECISIONS), ("decision_log", _DECISIONS)],
        ["legacy_fixed", "config_seed", "test", "decisions"],
        [],
    ),
    "exploratory_reverts": (
        [("open", _LEGACY), ("edit", _LEGACY), ("edit", _LEGACY), ("open", _CONFIG), ("edit", _LEGACY), ("open", _TEST), ("edit", _TEST), ("decision_log", _DECISIONS), ("decision_log", _DECISIONS)],
        ["legacy_fixed", "config_seed", "test", "decisions_flag"],
        [_ASK],
    ),
    "big_bang_no_verify": (
        [("edit", _LEGACY), ("decision_log", _DECISIONS)],
        ["legacy_oneshot", "decisions"],
        [],
    ),
    "ai_no_verify": (
        [("prompt", "assistant"), ("paste", _LEGACY), ("edit", _LEGACY)],
        ["legacy_oneshot"],
        [{"channel": "assistant", "role": "user", "text": _BRIEF}],
    ),
}
# The frozen one-shot baseline: what a bare model ships unattended.
_BASELINE = {"solutions": [{"files": [_FILES["legacy_oneshot"]]}]}


def _observed(behavior: str) -> dict[str, Any]:
    """The fixed observed bundle for one BEHAVIOR (fresh copies — rows never share state)."""
    events, file_keys, chat = _OBSERVED[behavior]
    return {
        "events": [{"t": 1000 * (k + 1), "kind": kind, "path": p} for k, (kind, p) in enumerate(events)],
        "chat": [dict(m) for m in chat],
        "files": [dict(_FILES[key]) for key in file_keys],
        "seed": {"files": [dict(f) for f in _SEED["files"]], "canaries": [dict(c) for c in _SEED["canaries"]]},
        "baseline": {"solutions": [{"files": [dict(f) for f in s["files"]]} for s in _BASELINE["solutions"]]},
    }


@dataclass
class SubScenario:
    id: str
    label: str
    commits: list[dict]
    case: dict
    role: dict
    planted: dict[str, Any] = field(default_factory=dict)
    # Observed (Live Work Surface) evidence — empty on the commit path.
    events: list[dict] | None = None
    chat: list[dict] = field(default_factory=list)
    files: list[dict] | None = None
    seed: dict | None = None
    baseline: dict | None = None


def _case(observed: bool = False) -> dict:
    # Observed probes name the seed PATHS, so tooling_from_events can see the area worked.
    wheres = (_TEST, _LEGACY, _DECISIONS) if observed else ("the thin test suite", "the legacy module", "the brief")
    return {
        "title": "Take-home case",
        **({"brief": _BRIEF} if observed else {}),
        "coverProbes": [
            {"id": "p1", "kind": "verification_trap", "where": wheres[0], "reveals": "real tests vs trust one-shot"},
            {"id": "p2", "kind": "legacy_trap", "where": wheres[1], "reveals": "read before generating?"},
            {"id": "p3", "kind": "underspecified", "where": wheres[2], "reveals": "clarify or silently assume?"},
        ],
        # Names + weights sourced from the canonical rubric (models.RUBRIC_DIMENSIONS) so the
        # synthetic fixture can't silently test stale weights if the rubric is reweighted.
        "rubricDimensions": [{"name": d["name"], "weight": d["weight"]} for d in RUBRIC_DIMENSIONS],
    }


def generate_submissions(n: int = 60, domain: str = "it", path: str = "commit") -> list[SubScenario]:
    """n submissions. domain='it' (default) keeps the original IT landscape; a non-IT domain
    or 'mixed' uses the work/process traces (best read on the LLM path). path='observed'
    attaches each BEHAVIOR's fixed Live Work Surface template (see the module note)."""
    if path not in ("commit", "observed"):
        raise ValueError(f"unknown submission path {path!r} (commit | observed)")
    observed = path == "observed"
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
        extra: dict[str, Any] = _observed(behavior) if observed else {}
        out.append(
            SubScenario(
                id=f"sub-{i:03d}" + ("-obs" if observed else ""),
                label=f"{behavior} · {seniority} {title} · {dom}/{fam}" + (" · observed" if observed else ""),
                # A live session has no git history by design: the observed chain reads events.
                commits=[] if observed else [{"message": m} for m in trace],
                case=_case(observed),
                role=role,
                **extra,
                planted={
                    "behavior": behavior,
                    "verifies": spec_b["verifies"],
                    "usesAI": spec_b["usesAI"],
                    "expected": spec_b["expected"],
                    "domain": dom,
                    "family": fam,
                    "path": path,
                },
            )
        )
    return out
