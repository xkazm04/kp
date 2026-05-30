"""Phase D5/D8 — the trace: infer 'where the candidate mentally went' and how they DROVE
their tools, from DURABLE repository signals.

Design principle (so this keeps its value as tooling trends churn): the CODE collects only
durable structural facts whose meaning does not change — commit sizes + cadence, the file
tree, messages — and the LLM, which updates over time, does the trend-aware INTERPRETATION
(including spotting agent/AI tooling artifacts with its own current knowledge). The prompt
asks for first-principles reasoning about the SHAPE of the work, not a fixed keyword checklist,
so it does not need recalibrating every time a new tool or convention appears.

Two fairness invariants hold throughout: the reflection is HEDGED (artifacts, not intent),
and USING AN LLM/TOOLS IS NEVER A PENALTY — we judge judgment, verification, and deliberate
tooling, not which tools were used.
"""

from __future__ import annotations

import json
from statistics import median
from typing import Any

COMMIT_REFLECTION_PROMPT_VERSION = "commit-reflection-v2"
TOOLING_SIGNAL_PROMPT_VERSION = "tooling-signal-v2"

_SYSTEM = (
    "You read a code repository's DURABLE signals — the shape of its history and structure — to infer "
    "engineering capability. The specific tools, frameworks and conventions a developer uses change "
    "constantly and are NOT the point; judge what outlasts trends: decomposition, validation, recovery "
    "from mistakes, and deliberate tooling. Never penalize using LLMs/tools. Hedge — you see artifacts, "
    "not intent. Output strict JSON only."
)

_ITERATION = ("exploratory", "linear", "big-bang", "test-driven", "unclear")

_AGNOSTIC = (
    "Reason from FIRST PRINCIPLES about the evidence below — do NOT apply a fixed checklist of keywords "
    "or today's tool names. Identify for yourself any agent/AI or automation configuration present (use "
    "your own current knowledge of the ecosystem) and read its PRESENCE as deliberate tooling, never its "
    "brand. Absence of a signal is not failure. The durable question is the SHAPE of the work: how change "
    "was decomposed and sized, the rhythm of the history, what was validated, and how mistakes were recovered."
)


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


def _size_summary(commits: list[dict]) -> dict:
    """Durable, tool-agnostic shape of the change set (only where stats are present)."""
    adds = [int(c["additions"]) for c in commits if isinstance(c.get("additions"), (int, float))]
    files = [int(c["files"]) for c in commits if isinstance(c.get("files"), (int, float))]
    if not adds:
        return {"withStats": 0}
    total = sum(adds)
    return {
        "withStats": len(adds),
        "totalAdditions": total,
        "maxCommitAdditions": max(adds),
        "medianAdditions": int(median(adds)),
        "biggestShareOfChange": round(max(adds) / total, 2) if total else 0.0,
        "medianFilesPerCommit": int(median(files)) if files else None,
    }


def _context(commits: list[dict], repo: dict | None) -> dict:
    repo = repo or {}
    return {
        "commitCount": len(commits),
        "messages": _messages(commits)[:60],
        "changeShape": _size_summary(commits),
        "cadence": repo.get("cadence"),  # {count, spanHours, bursty} — durable rhythm
        "topLevel": repo.get("topLevel"),  # [{name,type}] — let the model spot tests/CI/agent files itself
    }


# --- reflect_commits --------------------------------------------------------


def reflect_commits(commits: list[dict], repo: dict | None = None, *, provider: Any | None = None) -> tuple[dict, str]:
    ctx = _context(commits, repo)
    prompt = (
        "Infer WHERE THE CANDIDATE MENTALLY WENT from this repository's durable signals.\n"
        f"{json.dumps(ctx, ensure_ascii=False, indent=2)}\n\n"
        f"{_AGNOSTIC}\n\n"
        'Return JSON: { "narrative": str, "iterationPattern": "exploratory|linear|big-bang|test-driven|unclear", '
        '"deadEnds": [str], "readBeforeWrite": number 0..1, "verificationHabits": [str], "confidence": number 0..1 }. '
        "JSON only."
    )

    def deterministic() -> dict:
        # structural-first (durable) with messages as a weak secondary signal
        shape = ctx["changeShape"]
        top = [str(e.get("name", "")).lower() for e in (ctx["topLevel"] or []) if isinstance(e, dict)]
        msgs = ctx["messages"]
        blob = " ".join(msgs).casefold()
        n = ctx["commitCount"]

        has_tests = any(("test" in name or "spec" in name) for name in top) or "test" in blob
        big_dump = (n <= 2) or (shape.get("withStats") and shape.get("biggestShareOfChange", 0) >= 0.6)
        reverts = [m for m in msgs if any(k in m.casefold() for k in ("revert", "rollback", "undo"))]
        bursty = bool((ctx["cadence"] or {}).get("bursty"))

        if has_tests and not big_dump:
            pattern = "test-driven"
        elif big_dump:
            pattern = "big-bang"
        elif n >= 5:
            pattern = "exploratory" if (reverts or bursty) else "linear"
        elif n >= 3:
            pattern = "linear"
        else:
            pattern = "unclear"

        verif = []
        if has_tests:
            verif.append("Tests present in the tree/history")
        if blob.count("fix") >= 2:
            verif.append("Iterates on fixes")
        # read-before-write: a small first step + steady rhythm reads as exploring before dumping
        read = 0.55 if (not big_dump and not bursty) else 0.35
        if any(k in blob for k in ("explore", "read", "understand", "scaffold", "investigate")):
            read = max(read, 0.6)

        narrative = (
            f"From {n} commits"
            + (f" (~{shape['totalAdditions']:,} additions; biggest commit = {int(shape.get('biggestShareOfChange', 0) * 100)}% of the change)" if shape.get("withStats") else "")
            + f": a broadly {pattern} shape"
            + (f", with {len(reverts)} apparent recovery/revert(s)" if reverts else "")
            + (". Verification signal present." if verif else ". Limited verification signal.")
            + " (Structural inference — low confidence.)"
        )
        return {
            "narrative": narrative,
            "iterationPattern": pattern,
            "deadEnds": reverts[:4],
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


def assess_tooling(reflection: dict, commits: list[dict], cover_probes: list[dict], repo: dict | None = None, *, provider: Any | None = None) -> tuple[dict, str]:
    ctx = _context(commits, repo)
    probes = [
        {"id": str(p.get("id") or f"p{i + 1}"), "kind": p.get("kind"), "where": p.get("where"), "reveals": p.get("reveals")}
        for i, p in enumerate(cover_probes or [])
    ]
    body = {
        "reflection": {k: reflection.get(k) for k in ("narrative", "iterationPattern", "readBeforeWrite", "verificationHabits", "deadEnds")},
        "signals": ctx,
        "coverProbes": probes,
    }
    prompt = (
        "Assess how the candidate DROVE their tools, durably. The repository's signals and the case's COVERT "
        "probes follow (each probe's 'reveals' says what a good vs naive response implies).\n"
        f"{json.dumps(body, ensure_ascii=False, indent=2)}\n\n"
        f"{_AGNOSTIC}\n\n"
        "For each probe, judge from the evidence whether it was DETECTED and HANDLED well. Rate overall tooling "
        "fluency from the SHAPE of the work + any deliberate tooling setup. CRITICAL: using an LLM/tools is NEVER "
        "a penalty — judge judgment + verification, not which tools were used. Only flag over-reliance with concrete "
        "evidence (e.g. large unverified dumps), never from tool use itself; absence of evidence is not failure.\n"
        'Return JSON: { "fluency": number 0..1, "probeOutcomes": [ { "probeId": str, "detected": bool, "handledWell": bool, '
        '"note": str } ], "overRelianceFlags": [str], "evidence": [str], "confidence": number 0..1 }. JSON only.'
    )

    def deterministic() -> dict:
        return {
            "fluency": 0.5,
            "probeOutcomes": [
                {"probeId": p["id"], "detected": False, "handledWell": False, "note": "insufficient signal (deterministic)"}
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
