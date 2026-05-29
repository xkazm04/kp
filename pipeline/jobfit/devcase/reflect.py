"""Phase D5 — the trace: infer 'where the candidate mentally went' from the git
history, and assess how they DROVE their tools against the case's covert probes.

LLM path (Claude CLI) + deterministic fallback. Two fairness invariants baked in:
the reflection is HEDGED (inferred from commits, never over-claiming intent), and
USING AN LLM/TOOLS IS NEVER A PENALTY — we judge judgment + verification, not whether
the candidate used AI.
"""

from __future__ import annotations

import json
from typing import Any

COMMIT_REFLECTION_PROMPT_VERSION = "commit-reflection-v1"
TOOLING_SIGNAL_PROMPT_VERSION = "tooling-signal-v1"

_SYSTEM = (
    "You analyze a candidate's git trace for a take-home assignment. Infer cautiously and HEDGE — "
    "you only see commits, not intent. Never penalize the use of LLMs or tools; judge judgment, "
    "verification, and how they drove the work. Output strict JSON only."
)

_ITERATION = ("exploratory", "linear", "big-bang", "test-driven", "unclear")


def _generate(provider: Any | None, prompt: str, deterministic, coerce) -> tuple[dict, str]:
    if provider is None:
        return deterministic(), "deterministic"
    try:
        payload = provider.complete_json(prompt, system=_SYSTEM)
        return coerce(payload), "llm"
    except Exception:
        return deterministic(), "deterministic"


def _str_list(value: Any) -> list[str]:
    if not isinstance(value, list):
        return []
    return [str(x).strip() for x in value if str(x).strip()]


def _clamp01(value: Any, default: float) -> float:
    try:
        return max(0.0, min(1.0, float(value)))
    except (TypeError, ValueError):
        return default


def _messages(commits: list[dict]) -> list[str]:
    out = []
    for c in commits:
        msg = str(c.get("message") or "").split("\n")[0].strip()
        if msg:
            out.append(msg[:140])
    return out


# --- reflect_commits --------------------------------------------------------


def reflect_commits(commits: list[dict], *, provider: Any | None = None) -> tuple[dict, str]:
    msgs = _messages(commits)
    ctx = {"commitCount": len(commits), "messages": msgs[:60]}
    prompt = (
        "Here is a candidate's commit trace from a take-home assignment (chronological as given).\n"
        f"{json.dumps(ctx, ensure_ascii=False, indent=2)}\n\n"
        "Infer WHERE THE CANDIDATE MENTALLY WENT: their approach, iteration pattern, any dead-ends or "
        "reverts, whether they appear to have read/explored before writing, and their verification habits "
        "(tests, validation). You are inferring from commit messages only — HEDGE; do not over-claim intent.\n"
        'Return JSON: { "narrative": str, "iterationPattern": "exploratory|linear|big-bang|test-driven|unclear", '
        '"deadEnds": [str], "readBeforeWrite": number 0..1, "verificationHabits": [str], "confidence": number 0..1 }. JSON only.'
    )

    def deterministic() -> dict:
        blob = " ".join(msgs).casefold()
        dead = [m for m in msgs if any(k in m.casefold() for k in ("revert", "rollback", "undo", "scrap"))]
        verif = []
        if "test" in blob:
            verif.append("Adds/updates tests")
        if blob.count("fix") >= 2:
            verif.append("Iterates with fixes")
        early = " ".join(msgs[-3:] if len(msgs) >= 3 else msgs).casefold()  # earliest commits (trace newest-first)
        read = 0.6 if any(k in early for k in ("explore", "read", "understand", "scaffold", "setup", "investigate")) else 0.35
        n = len(commits)
        if "test" in early:
            pattern = "test-driven"
        elif n <= 2:
            pattern = "big-bang"
        elif blob.count("wip") + blob.count("fix") >= max(3, n // 2):
            pattern = "exploratory"
        elif n >= 3:
            pattern = "linear"
        else:
            pattern = "unclear"
        narrative = (
            f"From {n} commits: a broadly {pattern} approach"
            + (f", with {len(dead)} apparent dead-end(s)" if dead else "")
            + (". Some verification signal (tests/fixes)." if verif else ". Limited verification signal in messages.")
            + " (Inferred from messages only — low confidence.)"
        )
        return {
            "narrative": narrative,
            "iterationPattern": pattern,
            "deadEnds": dead[:4],
            "readBeforeWrite": read,
            "verificationHabits": verif,
            "confidence": 0.3,
        }

    def coerce(payload: Any) -> dict:
        det = deterministic()
        if not isinstance(payload, dict):
            return det
        pat = str(payload.get("iterationPattern") or "").strip().lower()
        if pat not in _ITERATION:
            pat = det["iterationPattern"]
        return {
            "narrative": str(payload.get("narrative") or det["narrative"]),
            "iterationPattern": pat,
            "deadEnds": _str_list(payload.get("deadEnds")),
            "readBeforeWrite": _clamp01(payload.get("readBeforeWrite"), det["readBeforeWrite"]),
            "verificationHabits": _str_list(payload.get("verificationHabits")),
            "confidence": _clamp01(payload.get("confidence"), det["confidence"]),
        }

    result, source = _generate(provider, prompt, deterministic, coerce)
    result["promptVersion"] = COMMIT_REFLECTION_PROMPT_VERSION
    return result, source


# --- assess_tooling ---------------------------------------------------------


def assess_tooling(reflection: dict, commits: list[dict], cover_probes: list[dict], *, provider: Any | None = None) -> tuple[dict, str]:
    probes = [
        {"id": str(p.get("id") or f"p{i + 1}"), "kind": p.get("kind"), "where": p.get("where"), "reveals": p.get("reveals")}
        for i, p in enumerate(cover_probes or [])
    ]
    ctx = {
        "reflection": {k: reflection.get(k) for k in ("narrative", "iterationPattern", "readBeforeWrite", "verificationHabits", "deadEnds")},
        "commitCount": len(commits),
        "messages": _messages(commits)[:40],
        "coverProbes": probes,
    }
    prompt = (
        "Given this commit reflection and the case's COVERT probes (each probe's 'reveals' tells you what a good "
        "vs naive response implies), assess how the candidate DROVE their tools.\n"
        f"{json.dumps(ctx, ensure_ascii=False, indent=2)}\n\n"
        "For each probe, judge from the trace evidence whether they DETECTED it and HANDLED it well. Rate overall "
        "tooling fluency and note any over-reliance signals. CRITICAL: using an LLM/tools is NEVER a penalty — judge "
        "judgment + verification, not whether they used AI. Absence of evidence is NOT failure; hedge.\n"
        'Return JSON: { "fluency": number 0..1, "probeOutcomes": [ { "probeId": str, "detected": bool, "handledWell": bool, '
        '"note": str } ], "overRelianceFlags": [str], "evidence": [str], "confidence": number 0..1 }. JSON only.'
    )

    def deterministic() -> dict:
        return {
            "fluency": 0.5,
            "probeOutcomes": [
                {"probeId": p["id"], "detected": False, "handledWell": False, "note": "insufficient trace evidence (deterministic)"}
                for p in probes
            ],
            "overRelianceFlags": [],
            "evidence": [],
            "confidence": 0.2,
        }

    def coerce(payload: Any) -> dict:
        det = deterministic()
        if not isinstance(payload, dict):
            return det
        by_id = {str(p.get("probeId")): p for p in payload.get("probeOutcomes") or [] if isinstance(p, dict)}
        outcomes = []
        for p in probes:
            o = by_id.get(p["id"], {})
            outcomes.append(
                {
                    "probeId": p["id"],
                    "detected": bool(o.get("detected", False)),
                    "handledWell": bool(o.get("handledWell", False)),
                    "note": str(o.get("note") or ""),
                }
            )
        return {
            "fluency": _clamp01(payload.get("fluency"), det["fluency"]),
            "probeOutcomes": outcomes or det["probeOutcomes"],
            "overRelianceFlags": _str_list(payload.get("overRelianceFlags")),
            "evidence": _str_list(payload.get("evidence")),
            "confidence": _clamp01(payload.get("confidence"), det["confidence"]),
        }

    result, source = _generate(provider, prompt, deterministic, coerce)
    result["promptVersion"] = TOOLING_SIGNAL_PROMPT_VERSION
    return result, source
