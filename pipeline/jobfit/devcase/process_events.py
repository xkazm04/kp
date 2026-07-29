"""Live Work Surface (moonshot E) — derive tooling signals from an OBSERVED
process-event stream instead of inferring them from a private git log.

An event is a plain dict (free-form JSON, never a codegen'd model):
  {"t": <ms>, "kind": "open" | "edit" | "decision_log" | "submit" | "paste" | "prompt" | "perturbation", "path": <str?>}

"prompt" and "perturbation" are SERVER-recorded (the chat route / the mid-flight
reveal), so they can't be fabricated client-side: "prompt" marks one captured
assistant/stakeholder exchange (path = channel), "perturbation" marks the moment
the mid-flight requirement change was shown (LLM-era controls #5) — everything
after it is the candidate's observed ADAPTATION to a changed brief.

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


def derive_signals(events, seed_paths=None) -> dict:
    """The observed ground-truth process signals (the counterpart to reflect._context's
    inference from commit metadata). ``seed_paths`` (case-sim round 1 finding): the
    paths that EXISTED in the materialized seed — read-before-write only makes sense
    for files that had contents to read, so newly CREATED files (a candidate adding a
    test or a helper) are excluded from the ratio instead of silently counting as
    "edited without reading". Without seed_paths every edited path stays in (legacy)."""
    opens = _of_kind(events, "open")
    edits = _of_kind(events, "edit")
    decisions = _of_kind(events, "decision_log")
    edited_paths = [_path(e) for e in edits if _path(e)]
    opened_paths = [_path(e) for e in opens if _path(e)]
    distinct_edited = sorted(set(edited_paths))

    # read-before-write: fraction of PRE-EXISTING edited files that were OPENED before
    # their first edit (deterministic from event timestamps).
    known = {str(p) for p in seed_paths} if seed_paths else None
    rbw_pool = [p for p in distinct_edited if known is None or p in known]
    rbw_hits = 0
    for p in rbw_pool:
        ot, et = _first_t(opens, p), _first_t(edits, p)
        if ot is not None and et is not None and ot <= et:
            rbw_hits += 1
    read_before_write = _clamp01(rbw_hits / len(rbw_pool)) if rbw_pool else 0.0

    edited_test = any(_TEST_RE.search(p) for p in edited_paths)
    edited_decisions = bool(decisions) or any(_DECISIONS_RE.search(p) for p in edited_paths)

    # Mid-flight adaptation (LLM-era controls #5): the server recorded WHEN the
    # requirement change was revealed; edits/decision-log entries after that moment
    # are the observed adaptation. perturbationShown=False → adaptation keys are
    # no-signal (None), matching the handledWell=None convention below.
    perturbations = _of_kind(events, "perturbation")
    pert_t = min((e.get("t") for e in perturbations if isinstance(e.get("t"), (int, float))), default=None)
    edits_after = None
    decisions_after = None
    if pert_t is not None:
        edits_after = sum(1 for e in edits if isinstance(e.get("t"), (int, float)) and e["t"] >= pert_t)
        decisions_after = sum(1 for e in decisions if isinstance(e.get("t"), (int, float)) and e["t"] >= pert_t)

    return {
        "filesOpened": len(set(opened_paths)),
        "filesEdited": len(distinct_edited),
        "readBeforeWrite": round(read_before_write, 3),
        "decisionLogEntries": len(decisions),
        "editedTest": edited_test,
        "editedDecisions": edited_decisions,
        "iterationPattern": "iterative" if len(edits) >= 2 * max(1, len(distinct_edited)) else "single-pass",
        "perturbationShown": pert_t is not None,
        "editsAfterPerturbation": edits_after,
        "decisionsAfterPerturbation": decisions_after,
        "promptExchanges": len(_of_kind(events, "prompt")),
    }


def tooling_from_events(events, cover_probes=None, seed_paths=None) -> dict:
    """Deterministic tooling assessment from observed events. Returns the SAME shape
    as reflect.assess_tooling so it is a drop-in for the observed path (plus a raw
    ``signals`` block — case-sim round 1: the deterministic evaluator needs the
    observed verification indicators, or judgment reads 0 for every live session).
    Confidence is high (0.8) because the inputs are watched, not reconstructed."""
    sig = derive_signals(events, seed_paths)
    fluency = _clamp01(
        0.4 * sig["readBeforeWrite"]
        + 0.3 * (1.0 if sig["editedDecisions"] else 0.0)
        + 0.3 * (1.0 if sig["editedTest"] else 0.0)
    )

    probes = [
        {"id": str(p.get("id") or f"p{i + 1}"), "kind": str(p.get("kind") or ""), "where": str(p.get("where") or "")}
        for i, p in enumerate(cover_probes or [])
    ]
    # We can OBSERVE whether the candidate worked a probe's area (detected), but
    # cannot judge "handled well" from process alone. Emit handledWell=None (UNKNOWN)
    # rather than a definitive False: a hardcoded False made every in-product
    # candidate's probe handling look like a graded failure, which `evaluate` then
    # fed into `0.5*verif + 0.5*handled` and silently HALVED the fairness-critical
    # judgment dimension vs the no-probe branch. None is treated as no-signal there.
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
            "handledWell": None,  # unknown: observed detection only, handling not graded
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
    if sig["promptExchanges"]:
        evidence.append(f"Used the captured assistant/stakeholder channel {sig['promptExchanges']} time(s) (observed; never a penalty).")
    if sig["perturbationShown"]:
        if (sig["editsAfterPerturbation"] or 0) > 0:
            evidence.append(
                f"Adapted to the mid-flight requirement change: {sig['editsAfterPerturbation']} edit(s)"
                + (f" and {sig['decisionsAfterPerturbation']} decision-log entrie(s)" if sig["decisionsAfterPerturbation"] else "")
                + " after the reveal."
            )
        else:
            evidence.append("The mid-flight requirement change was shown but no edits followed it (submitted against the stale brief).")

    return {
        "fluency": round(fluency, 3),
        "probeOutcomes": outcomes,
        "overRelianceFlags": [],  # never inferred from process — fairness contract
        "evidence": evidence,
        # Raw observed signals, exposed for downstream deterministic consumers
        # (evaluate's fallback derives observed verification from these).
        "signals": sig,
        "confidence": 0.8,
    }
