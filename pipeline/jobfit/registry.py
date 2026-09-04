"""Archetype registry — loads the shared taxonomy (archetypes.json) that BOTH
this package and the TypeScript app (app/_lib/archetypes.ts) read.

Because Python and TS read the SAME file, the desync hazard the fairness gate
feared is structurally impossible. This module is the Python view of that data:
the archetype list, labels, fairness flags, scoring weights, dimension labels,
the completeness-checklist specs, and the data-driven detection engine. Keep it a
leaf module (stdlib only) so anything can import it without a cycle.

Adding an archetype is a data change in archetypes.json — provided it reuses an
existing `scoringModel`, known checklist `check` ids, and known detection
`signal` names (a 4th genuinely-new scoring shape still needs code in
transform.py/matching.py). tests/test_registry.py enforces those invariants.
"""

from __future__ import annotations

import json
from pathlib import Path
from string import Formatter
from typing import Any

_DATA: dict[str, Any] = json.loads(Path(__file__).with_name("archetypes.json").read_text(encoding="utf-8"))

_ARCHETYPES: list[dict[str, Any]] = _DATA["archetypes"]
_BY_ID: dict[str, dict[str, Any]] = {a["id"]: a for a in _ARCHETYPES}
_DETECTION: dict[str, Any] = _DATA["detection"]
_COMMON_CHECKLIST: list[dict[str, Any]] = _DATA["commonChecklist"]

# The headline score is a weighted average `100 * (w.skills*skills + w.career*career
# + w.personal*personal)` — it is only an *average* when the weights sum to 1.0. The
# archetypes.json comment states "must sum to 1.0" but nothing enforced it, so a
# one-digit typo in a hand-edited archetype (e.g. summing to 0.9) silently rescaled
# every score/tier/shortlist for that archetype with no error — each value still looked
# plausible in [0,100]. Fail fast at import (same pattern taxonomy.py uses for malformed
# data) so a bad weight vector can never ship a quietly-miscalibrated scorer.
_REQUIRED_WEIGHT_KEYS = frozenset({"skills", "career", "personal"})


def _validate_archetype_weights(archetypes: list[dict[str, Any]]) -> None:
    for a in archetypes:
        weights = a.get("weights", {})
        keys = frozenset(weights.keys())
        if keys != _REQUIRED_WEIGHT_KEYS:
            raise RuntimeError(
                f"archetype '{a.get('id', '?')}' weights must have exactly keys "
                f"{sorted(_REQUIRED_WEIGHT_KEYS)}, got {sorted(keys)}"
            )
        total = sum(float(v) for v in weights.values())
        if abs(total - 1.0) > 1e-6:
            raise RuntimeError(
                f"archetype '{a.get('id', '?')}' weights must sum to 1.0, got {total:.6g} "
                f"({weights}) — the headline score is a weighted average and silently "
                f"rescales otherwise"
            )


_validate_archetype_weights(_ARCHETYPES)


# Every routing reason is also emitted as a {kind, params} CODE (see detect_detailed):
# the rendered sentence is English, and the profile result panel used to join those
# sentences into its "Routing: …" line, so a cs/de/fr recruiter read the router's
# whole explanation in a language they had not chosen. A kind is one catalog entry in
# four locales; a reason with no kind would silently fall back to the English string,
# which is exactly the defect this closes — so declare it in the data or fail at import.
def _validate_reason_kinds(detection: dict[str, Any]) -> None:
    kinds: list[str] = []
    for field in ("defaultReasonKind", "selfDeclaredReasonKind"):
        kind = detection.get(field)
        if not kind:
            raise RuntimeError(f"detection.{field} must name a reason kind (a catalog code)")
        kinds.append(str(kind))
    for rule in detection.get("signals", []):
        if rule.get("reason") and not rule.get("reasonKind"):
            raise RuntimeError(
                f"detection signal '{rule.get('id', '?')}' renders a reason but declares no "
                f"reasonKind — its sentence could only ever be shown in English"
            )
        if rule.get("reasonKind"):
            kinds.append(str(rule["reasonKind"]))
    for declared, rules in detection.get("contradictions", {}).items():
        for rule in rules:
            if not rule.get("reasonKind"):
                raise RuntimeError(
                    f"a contradiction of '{declared}' declares no reasonKind — its sentence "
                    f"could only ever be shown in English"
                )
            kinds.append(str(rule["reasonKind"]))
    duplicates = sorted({k for k in kinds if kinds.count(k) > 1})
    if duplicates:
        raise RuntimeError(f"reason kinds must be unique (one code, one meaning); repeated: {duplicates}")


_validate_reason_kinds(_DETECTION)


# ---- Accessors -------------------------------------------------------------

def archetype_ids() -> tuple[str, ...]:
    """Ids in declaration order — the order also breaks detection score ties."""
    return tuple(a["id"] for a in _ARCHETYPES)


def python_labels() -> dict[str, str]:
    return {a["id"]: a["pythonLabel"] for a in _ARCHETYPES}


def early_career_archetypes() -> tuple[str, ...]:
    return tuple(a["id"] for a in _ARCHETYPES if a["scoringModel"] == "early_career")


def fairness_protected_archetypes() -> frozenset[str]:
    return frozenset(a["id"] for a in _ARCHETYPES if a.get("fairnessProtected"))


def archived_ids() -> frozenset[str]:
    """Ids of RETIRED (archived) archetypes. The recruiter UI adds an ``archived``
    flag to a custom archetype to hide it from the pickers, but the entry STAYS in
    the registry so a profile routed to it still routes and scores. This reader only
    tolerates the additive flag (``.get`` — absent on active archetypes); nothing in
    this module excludes archived archetypes from routing/scoring, which is exactly
    the "retire, don't trap" contract — a retired archetype keeps working."""
    return frozenset(a["id"] for a in _ARCHETYPES if a.get("archived"))


def low_confidence_threshold() -> float:
    """Archetype-routing confidence below which the routing is an unsettled guess a
    human should verify, not a decision to trust. The unguided default
    (``defaultConfidence``) sits below it by construction, so a silent fallback
    always trips it."""
    return float(_DETECTION["lowConfidenceThreshold"])


def signals_absent(reasons: list[str]) -> bool:
    """True when :func:`detect` fired NO signal and fell back to the registry
    default. ``detect`` appends ``defaultReason`` only on that no-signal branch, so
    its presence in the returned reasons is the precise marker of an unguided
    default — distinguishing a defaulted routing from one a low score merely made
    uncertain."""
    return _DETECTION["defaultReason"] in reasons


def weights_map() -> dict[str, dict[str, float]]:
    return {a["id"]: dict(a["weights"]) for a in _ARCHETYPES}


def dimension_labels_map() -> dict[str, dict[str, str]]:
    return {a["id"]: dict(a["dimensionLabels"]) for a in _ARCHETYPES}


def checklist_specs(archetype: str) -> list[tuple[str, float, str]]:
    """(check id, weight, label) — common items first, then this archetype's.

    Mirrors the old hand-written branch order so completeness scores and the
    biggest-gap-first ``missing`` ordering are byte-for-byte unchanged.
    """
    entry = _BY_ID.get(archetype, _BY_ID[_DETECTION["defaultArchetype"]])
    specs = _COMMON_CHECKLIST + entry["checklist"]
    return [(s["check"], float(s["weight"]), s["label"]) for s in specs]


# ---- Detection engine (data-driven) ---------------------------------------

def _truthy(val: Any) -> bool:
    return bool(val)


def _eval(cond: dict[str, Any], ctx: dict[str, Any]) -> bool:
    if "all" in cond:
        return all(_eval(c, ctx) for c in cond["all"])
    if "any" in cond:
        return any(_eval(c, ctx) for c in cond["any"])
    val = ctx.get(cond["signal"])
    if "truthy" in cond:
        return _truthy(val) == cond["truthy"]
    if "not" in cond:
        return (not _truthy(val)) == cond["not"]
    if "lt" in cond:
        return val is not None and val < cond["lt"]
    if "gte" in cond:
        return val is not None and val >= cond["gte"]
    return False


def _render(reason: str, ctx: dict[str, Any]) -> str:
    # Only the templated reasons (e.g. "{years_relevant_experience:g} years…")
    # touch ctx; literals pass through untouched.
    return reason.format(**ctx) if "{" in reason else reason


def _params(reason: str, ctx: dict[str, Any]) -> dict[str, Any]:
    """The ctx values the reason's own template interpolates, keyed by placeholder.

    Derived FROM the template rather than declared beside it, so the params a code
    carries can never drift from the sentence the four catalogs translate: add
    `{expected_graduation}` to a reason and the code starts carrying it.
    """
    names = {field for _, field, _, _ in Formatter().parse(reason) if field}
    return {name: ctx.get(name) for name in sorted(names)}


def reason_kinds() -> tuple[str, ...]:
    """Every routing-reason code this registry can emit, in declaration order.

    The catalogs owe one entry per kind (`profile.result.reasons.<kind>`); a test
    on the TS side reads this list, so a kind added here is a visible gap there
    rather than a silent English fallback in three locales.
    """
    kinds = [str(_DETECTION["defaultReasonKind"]), str(_DETECTION["selfDeclaredReasonKind"])]
    kinds += [str(r["reasonKind"]) for r in _DETECTION["signals"] if r.get("reasonKind")]
    for rules in _DETECTION["contradictions"].values():
        kinds += [str(r["reasonKind"]) for r in rules]
    return tuple(kinds)


def detect(
    *,
    self_declared: str | None = None,
    years_relevant_experience: float | None = None,
    is_enrolled: bool | None = None,
    expected_graduation: str | None = None,
    education_is_dominant: bool | None = None,
    wants_domain_change: bool | None = None,
    has_substantial_experience: bool | None = None,
) -> tuple[str, float, list[str]]:
    """Return (archetype, confidence in [0,1], reasons) from the registry rules.

    A self-declaration is trusted (the archetype is returned as declared) but
    auto-signals still run as *contradictions* that lower confidence and append a
    reason. With no declaration, weighted signals decide and fall back to the
    registry default when nothing is conclusive.

    The back-compatible face of :func:`detect_detailed` — same computation, the
    rendered English sentences only. Every existing consumer (soft_signals' prefix
    scan, :func:`signals_absent`, stored analyses) keeps reading exactly these.
    """
    archetype, confidence, reasons, _codes = detect_detailed(
        self_declared=self_declared,
        years_relevant_experience=years_relevant_experience,
        is_enrolled=is_enrolled,
        expected_graduation=expected_graduation,
        education_is_dominant=education_is_dominant,
        wants_domain_change=wants_domain_change,
        has_substantial_experience=has_substantial_experience,
    )
    return archetype, confidence, reasons


def detect_detailed(
    *,
    self_declared: str | None = None,
    years_relevant_experience: float | None = None,
    is_enrolled: bool | None = None,
    expected_graduation: str | None = None,
    education_is_dominant: bool | None = None,
    wants_domain_change: bool | None = None,
    has_substantial_experience: bool | None = None,
) -> tuple[str, float, list[str], list[dict[str, Any]]]:
    """:func:`detect` plus the LOCALIZABLE twin of its reasons.

    The 4th element is one ``{"kind", "params"}`` code per rendered reason, in the
    same order — the sentence a catalog can translate instead of the English one the
    router happens to render. Additive, exactly like profile_cli's ``missingGaps``
    beside ``missing``: nothing that reads the strings has to change, and a result
    built before this existed still renders through the string fallback.
    """
    ids = archetype_ids()
    labels = python_labels()
    ctx = {
        "years_relevant_experience": years_relevant_experience,
        "is_enrolled": is_enrolled,
        "expected_graduation": expected_graduation,
        "education_is_dominant": education_is_dominant,
        "wants_domain_change": wants_domain_change,
        "has_substantial_experience": has_substantial_experience,
    }
    reasons: list[str] = []
    codes: list[dict[str, Any]] = []

    if self_declared in ids:
        reasons.append(f"self-declared: {labels[self_declared]}")
        # The declared archetype travels as a PARAM, not baked into the sentence:
        # the reader's side already localizes an archetype id (useEnumLabel), so the
        # catalog entry stays one sentence for all three (and any custom) archetypes.
        codes.append({"kind": _DETECTION["selfDeclaredReasonKind"], "params": {"archetype": self_declared}})
        confidence = _DETECTION["selfDeclaredConfidence"]
        for contradiction in _DETECTION["contradictions"].get(self_declared, []):
            if _eval(contradiction["when"], ctx):
                reasons.append(_render(contradiction["reason"], ctx))
                codes.append({"kind": contradiction["reasonKind"], "params": _params(contradiction["reason"], ctx)})
                confidence = contradiction["confidence"]
        return self_declared, confidence, reasons, codes

    scores = {a: 0.0 for a in ids}
    for rule in _DETECTION["signals"]:
        if _eval(rule["when"], ctx):
            for archetype, delta in rule["scores"].items():
                scores[archetype] += delta
            if rule.get("reason"):
                reasons.append(_render(rule["reason"], ctx))
                codes.append({"kind": rule["reasonKind"], "params": _params(rule["reason"], ctx)})

    total = sum(scores.values())
    if total <= 0:
        reasons.append(_DETECTION["defaultReason"])
        codes.append({"kind": _DETECTION["defaultReasonKind"], "params": {}})
        return _DETECTION["defaultArchetype"], _DETECTION["defaultConfidence"], reasons, codes

    best = max(ids, key=lambda a: scores[a])
    return best, round(scores[best] / total, 2), reasons, codes
