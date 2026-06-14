"""Live Work Surface (moonshot E) — derive tooling signals from an OBSERVED
process-event stream instead of inferring them from a private git log.

An event is a plain dict (free-form JSON, never a codegen'd model):
  {"t": <ms>, "kind": "open" | "edit" | "decision_log" | "submit", "path": <str?>}

Pure + deterministic, so it is cheap (no LLM) and unit-testable. The observed path
is preferred over the inferred commit-metadata path precisely because it is ground
truth, not a reconstruction. FAIRNESS CONTRACT: over-reliance is NEVER inferred
from tool use; we observe process *artifacts* (opens/edits/decision-log), never
keystrokes or screens.
"""
from __future__ import annotations

import re

_TEST_RE = re.compile(r"(test|spec)", re.IGNORECASE)
_DECISIONS_RE = re.compile(r"DECISIONS\.md$", re.IGNORECASE)


def _clamp01(x: float) -> float:
    if x != x:  # NaN
        return 0.0
    return 0.0 if x < 0 else 1.0 if x > 1 else x


def _of_kind(events, kind):
    return [e for e in (events or []) if isinstance(e, dict) and e.get("kind") == kind]


def _path(e) -> str:
    return str(e.get("path") or "")


def _first_t(evs, path):
    ts = [e.get("t") for e in evs if _path(e) == path and isinstance(e.get("t"), (int, float))]
    return min(ts) if ts else None


def derive_signals(events) -> dict:
    """The observed ground-truth process signals (the counterpart to reflect._context's
    inference from commit metadata)."""
    opens = _of_kind(events, "open")
    edits = _of_kind(events, "edit")
    decisions = _of_kind(events, "decision_log")
    edited_paths = [_path(e) for e in edits if _path(e)]
    opened_paths = [_path(e) for e in opens if _path(e)]
    distinct_edited = sorted(set(edited_paths))

    # read-before-write: fraction of edited files that were OPENED before their first
    # edit (deterministic from event timestamps).
    rbw_hits = 0
    for p in distinct_edited:
        ot, et = _first_t(opens, p), _first_t(edits, p)
        if ot is not None and et is not None and ot <= et:
            rbw_hits += 1
    read_before_write = _clamp01(rbw_hits / len(distinct_edited)) if distinct_edited else 0.0

    edited_test = any(_TEST_RE.search(p) for p in edited_paths)
    edited_decisions = bool(decisions) or any(_DECISIONS_RE.search(p) for p in edited_paths)

    return {
        "filesOpened": len(set(opened_paths)),
        "filesEdited": len(distinct_edited),
        "readBeforeWrite": round(read_before_write, 3),
        "decisionLogEntries": len(decisions),
        "editedTest": edited_test,
        "editedDecisions": edited_decisions,
        "iterationPattern": "iterative" if len(edits) >= 2 * max(1, len(distinct_edited)) else "single-pass",
    }


def tooling_from_events(events, cover_probes=None) -> dict:
    """Deterministic tooling assessment from observed events. Returns the SAME shape
    as reflect.assess_tooling so it is a drop-in for the observed path. Confidence is
    high (0.8) because the inputs are watched, not reconstructed."""
    sig = derive_signals(events)
    fluency = _clamp01(
        0.4 * sig["readBeforeWrite"]
        + 0.3 * (1.0 if sig["editedDecisions"] else 0.0)
        + 0.3 * (1.0 if sig["editedTest"] else 0.0)
    )

    probes = [
        {"id": str(p.get("id") or f"p{i + 1}"), "kind": str(p.get("kind") or ""), "where": str(p.get("where") or "")}
        for i, p in enumerate(cover_probes or [])
    ]
    # We can OBSERVE whether the candidate worked a probe's area, but cannot judge
    # "handled well" deterministically — keep handledWell conservative + label honestly.
    touched_paths = [_path(e) for e in (events or []) if isinstance(e, dict) and e.get("kind") in ("open", "edit") and _path(e)]
    outcomes = []
    for p in probes:
        where = p["where"]
        touched = bool(where) and any((where in tp) or (tp in where) for tp in touched_paths)
        outcomes.append({
            "probeId": p["id"],
            "kind": p["kind"],
            "where": where,
            "detected": touched,
            "handledWell": False,
            "note": "observed: candidate worked the probe area" if touched else "observed: probe area not opened/edited",
        })

    evidence = [
        f"Opened {sig['filesOpened']} file(s), edited {sig['filesEdited']} (observed).",
        f"Read-before-write ratio {sig['readBeforeWrite']} from event order.",
    ]
    if sig["editedDecisions"]:
        evidence.append(f"Recorded {sig['decisionLogEntries']} decision-log edit(s).")
    if sig["editedTest"]:
        evidence.append("Edited a test/spec file (observed verification).")

    return {
        "fluency": round(fluency, 3),
        "probeOutcomes": outcomes,
        "overRelianceFlags": [],  # never inferred from process — fairness contract
        "evidence": evidence,
        "confidence": 0.8,
    }
