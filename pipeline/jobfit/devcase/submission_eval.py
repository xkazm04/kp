"""Submission scenario eval — the EVALUATION half of the Dev pipeline (Phase D7).

Runs trace -> reflect_commits -> assess_tooling -> evaluate_submission -> score_transfer
over a landscape of synthetic candidate behaviours (submission_scenarios.py) and gates:

  RELIABILITY — every output well-formed (scores in range, one outcome per probe, transfer in
                range, reflection hedged).
  FAIRNESS    — the heart of the Dev extension. Code is assumed LLM-generated, so the score must
                track VERIFICATION/JUDGMENT, never AI use: (1) no over-reliance flag is invented
                from tool use alone — tested on the LLM path that actually assigns flags (the
                deterministic fallback hardcodes none), (2) candidates who VERIFY lead non-verifiers
                on judgment by a meaningful margin (>= MIN_VERIFY_MARGIN, not just a tie),
                (3) using AI is not penalised — an AI-heavy verifier scores within a small noise
                band of (or above) a non-verifier on judgment.
  DISCRIMINATION — strong submissions out-score weak ones (and the AI-no-verify gamer) by a
                meaningful margin (>= MIN_DISCRIMINATION_MARGIN), not merely any positive gap.
  QUALITY     — with --judge, an LLM rates the evaluation AND answers whether it unfairly
                penalises AI use (it must not).

  When a compared group is too small the gates withhold a verdict in one of two distinct ways
  (never a silent pass): 'inconclusive' for a thin-but-present cohort (1..MIN_GROUP_N-1 rows —
  real data, just too little to trust) and 'not_evaluable' for an EMPTY cohort or no surviving
  rows (no data at all — e.g. a tiny --count below the 6 behaviours, or every scenario errored).
  --strict treats fail and inconclusive as a non-zero exit, but NOT not_evaluable: absence of
  data is not a fairness violation, so an empty run can't be misread as an unfair/non-
  discriminating evaluator. Thresholds are encoded as module constants below.

Complements lifecycle_eval.py (the design half).

    python -m pipeline.jobfit.devcase.submission_eval --count 48 --no-llm
    python -m pipeline.jobfit.devcase.submission_eval --count 24 --judge --workers 6 --json
"""

from __future__ import annotations

import argparse
import json
import sys
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass, field
from typing import Any

from .._cli import configure_stdio
from ..claude_cli import ClaudeCliProvider
from .evaluate import evaluate_submission, score_transfer
from .llm_judge import run_judge
from .models import RUBRIC_DIMENSIONS
from .provenance import SOURCE_DETERMINISTIC, collect_fallback_reasons, combine_source
from .reflect import assess_tooling, reflect_commits
from .submission_scenarios import SubScenario, generate_submissions

# Derived from the canonical rubric (models.RUBRIC_DIMENSIONS) — mirroring evaluate._DIMS —
# so the reliability validator's dimension set can never drift from the rubric it checks.
_DIMS = {d["name"] for d in RUBRIC_DIMENSIONS}
_PATTERNS = {"exploratory", "linear", "big-bang", "test-driven", "unclear"}


# --- gate thresholds (the defensible bar) ----------------------------------
# These turn a soft "looks fair" into a reproducible pass/fail. A gate reports
# pass/fail ONLY on a meaningful margin measured over a minimum per-group sample.
# Below the sample bar the sub-check can't conclude (None); the gate then reports
# "inconclusive" when the thin cohort still had >= 1 row on each compared side, or
# "not_evaluable" when a compared cohort was EMPTY / no rows survived (no data at
# all). --strict treats fail and inconclusive as non-zero exits (the gate certifies
# only what it measured) but lets not_evaluable pass — no data is not a violation.
#
# Margins are in points on the 0-100 score scale (judgment dimension for fairness,
# the 5-dim overall for discrimination). The deterministic landscape clears them
# comfortably (verify lead ~18.8, strong-vs-weak ~8.9, strong-vs-gamer ~7.5),
# leaving headroom for the noisier --judge/LLM path while still rejecting a tie.
MIN_GROUP_N = 3                  # each compared group needs >= this many rows, else inconclusive
MIN_VERIFY_MARGIN = 5.0          # verifiers must out-score non-verifiers by >= this many judgment pts
AI_PENALTY_TOLERANCE = 2.0       # "not penalised": AI-verifiers may sit at most this far below non-verifiers
MIN_DISCRIMINATION_MARGIN = 5.0  # strong must out-score weak AND the gamer by >= this many overall pts


def _lead_verdict(lead: float | None, base: float | None, lead_n: int, base_n: int, margin: float) -> bool | None:
    """Tri-state pass for a 'lead must clear a margin' check. Returns None
    (INCONCLUSIVE — too few samples to trust either way) when either compared
    group is below MIN_GROUP_N or unpopulated; otherwise whether ``lead`` leads
    ``base`` by at least ``margin`` points (a tie/near-tie is False)."""
    if lead is None or base is None or lead_n < MIN_GROUP_N or base_n < MIN_GROUP_N:
        return None
    return (lead - base) >= margin


def _not_below_verdict(test: float | None, base: float | None, test_n: int, base_n: int, tol: float) -> bool | None:
    """Tri-state NON-INFERIORITY: ``test`` must not fall more than ``tol`` below
    ``base``. A tie passes (that is the whole point of 'AI use is not penalised'),
    a real dip fails, too-few-samples is None. Unlike a lead check this does NOT
    require AI-verifiers to BEAT non-verifiers — only to not be punished for AI use."""
    if test is None or base is None or test_n < MIN_GROUP_N or base_n < MIN_GROUP_N:
        return None
    return (test - base) >= -tol


def _evaluable(*sizes: int) -> bool:
    """A comparison is evaluable only if EVERY cohort it touches has at least one row.
    An empty cohort (0 rows) means there is no data on that side, so the sub-check is
    'not evaluable' (no verdict possible) — distinct from a thin-but-present cohort
    (1..MIN_GROUP_N-1 rows) whose withheld verdict is merely 'inconclusive'."""
    return all(n >= 1 for n in sizes)


def _gate_status(checks: list[tuple[bool | None, bool]], *, hard_ok: bool = True) -> str:
    """Collapse a gate's sub-checks into 'pass' | 'fail' | 'inconclusive' | 'not_evaluable'.
    Each check is ``(verdict, evaluable)``: verdict is True/False/None (None == data on both
    sides but too thin to trust); evaluable is whether both compared cohorts were non-empty.

    Precedence — a real signal always wins over the absence of one:
      fail          a broken hard invariant or any False verdict (a MEASURED violation)
      inconclusive  a thin-but-present sample (a None verdict that WAS evaluable)
      not_evaluable every unresolved check was blocked by an empty cohort (NO data at all)
      pass          all checks True
    not_evaluable is deliberately distinct from fail: 'no data' must never read as 'unfair'."""
    if not hard_ok or any(v is False for v, _ in checks):
        return "fail"
    if any(v is None and ev for v, ev in checks):
        return "inconclusive"
    if any(v is None and not ev for v, ev in checks):
        return "not_evaluable"
    return "pass"


def _verdict_str(v: bool | None) -> str:
    return "inconclusive" if v is None else ("yes" if v else "no")


def _cohort_warnings(sample: dict[str, int]) -> list[str]:
    """Every cohort below MIN_GROUP_N, phrased for the report — the minimum-cohort-size
    warning. Surfaced whenever a cohort is thin/empty, even if the gate still resolves on
    its other checks, so a too-small run is always visibly flagged."""
    return [
        f"{name}: {n} row{'' if n == 1 else 's'} (< {MIN_GROUP_N} needed for a verdict)"
        for name, n in sample.items()
        if n < MIN_GROUP_N
    ]


def _not_evaluable_reason(sample: dict[str, int], done_n: int) -> str:
    """Why a gate could not be evaluated at all: no rows survived (every scenario errored)
    or a compared cohort is empty. Only meaningful when the gate status is 'not_evaluable'."""
    if done_n == 0:
        return "no evaluable rows — every scenario errored or produced no evaluation"
    empty = [name for name, n in sample.items() if n == 0]
    if empty:
        return "empty cohort(s): " + ", ".join(empty)
    return "no comparison had data on both sides"


# --- reliability validators -------------------------------------------------


def _check(reflection: dict, tooling: dict, evaluation: dict, transfer: dict, scn: SubScenario) -> list[str]:
    issues = []
    if reflection.get("iterationPattern") not in _PATTERNS:
        issues.append("reflection: bad iterationPattern")
    if not (0.0 <= float(reflection.get("confidence", -1)) <= 1.0):
        issues.append("reflection: confidence out of range")
    outcomes = tooling.get("probeOutcomes") or []
    if len(outcomes) != len(scn.case["coverProbes"]):
        issues.append("tooling: probe-outcome count != probe count")
    dims = evaluation.get("dimensionScores") or {}
    if set(dims) != _DIMS:
        issues.append("eval: dimension set off")
    elif any(not (0 <= v <= 100) for v in dims.values()):
        issues.append("eval: dimension score out of range")
    ts = transfer.get("transferScore")
    if not isinstance(ts, int) or not (0 <= ts <= 100):
        issues.append("transfer: score out of range")
    return issues


@dataclass
class Row:
    id: str
    label: str
    planted: dict
    source: str = "deterministic"
    issues: list[str] = field(default_factory=list)
    reflection: dict = field(default_factory=dict)
    tooling: dict = field(default_factory=dict)
    evaluation: dict = field(default_factory=dict)
    transfer: dict = field(default_factory=dict)
    quality: dict = field(default_factory=dict)
    # Per-step reasons the LLM path fell back to deterministic — provenance stashes
    # these ONLY when a call RAISED (empty for a clean LLM run or an intentional
    # --no-llm run). A non-empty map = the LLM path was degraded for this row.
    fallback_reasons: dict = field(default_factory=dict)

    @property
    def reliable(self) -> bool:
        return not self.issues

    @property
    def judgment(self) -> int:
        return int((self.evaluation.get("dimensionScores") or {}).get("judgment", 0))

    @property
    def overall(self) -> float:
        dims = self.evaluation.get("dimensionScores") or {}
        vals = [v for v in dims.values() if isinstance(v, (int, float))]
        return round(sum(vals) / len(vals), 1) if vals else 0.0


def run_one(scn: SubScenario, provider: Any | None) -> Row:
    try:
        refl, s1 = reflect_commits(scn.commits, provider=provider)
        tool, s2 = assess_tooling(refl, scn.commits, scn.case["coverProbes"], provider=provider)
        ev, s3 = evaluate_submission(refl, tool, scn.case, scn.role, provider=provider)
        tr, s4 = score_transfer(ev, scn.role, provider=provider)
    except Exception as exc:  # pragma: no cover
        return Row(id=scn.id, label=scn.label, planted=scn.planted, source="error", issues=[f"raised: {type(exc).__name__}: {exc}"])
    # One shared tri-state collapse (provenance.combine_source): a mixed run reads as
    # "partial", so llm_rows + the --strict gate count only fully-LLM runs as LLM.
    src = combine_source(s1, s2, s3, s4)
    # Capture WHY any step fell back: provenance stashes FALLBACK_REASON_KEY on the
    # artifact ONLY when the LLM RAISED (a --no-llm / provider-unavailable run never
    # carries it). Without this the harness can't tell an intentional deterministic
    # run from one where the provider was down/garbage — so an all-error-fallback run
    # reads as a healthy 100%-reliable green (the deterministic templates pass _check).
    fallback_reasons = collect_fallback_reasons(
        (("reflect", refl), ("tooling", tool), ("evaluate", ev), ("transfer", tr))
    )
    issues = _check(refl, tool, ev, tr, scn)
    return Row(id=scn.id, label=scn.label, planted=scn.planted, source=src, issues=issues, reflection=refl, tooling=tool, evaluation=ev, transfer=tr, fallback_reasons=fallback_reasons)


def run(scenarios: list[SubScenario], provider: Any | None, workers: int = 4) -> list[Row]:
    w = max(1, workers) if provider is not None else 1
    with ThreadPoolExecutor(max_workers=w) as pool:
        return list(pool.map(lambda s: run_one(s, provider), scenarios))


# --- fairness invariants (the gate) ----------------------------------------


def _overreliance_from_tool_use(done: list[Row]) -> list[Row]:
    """Rows whose over-reliance flag was invented FROM TOOL USE ALONE — the flag-assigning
    path's fairness violation. Returns the offending rows (empty == invariant holds).

    Over-reliance flags are only ever assigned on the LLM path: the deterministic
    assess_tooling fallback hardcodes overRelianceFlags=[], so an invariant guarded by
    source=="deterministic" can never fire (it was vacuously True). reflect.py's prompt is
    explicit — flag over-reliance ONLY from concrete evidence (a large unverified dump),
    NEVER from tool use itself. So a flag is "from tool use alone" when it lands on an AI
    user while a behaviour-matched non-AI peer (same `verifies` habit, who would show the
    same dump/verification evidence) is NOT flagged: there, the only thing that differs is
    that AI was used. If both the AI user and its non-AI peer are flagged, the justification
    is the shared behaviour (the dump / missing verification), not the AI — and that is fair.
    """
    flag_rows = [r for r in done if r.source != SOURCE_DETERMINISTIC]

    def _flagged(r: Row) -> bool:
        return bool(r.tooling.get("overRelianceFlags") or [])

    def _peer_flagged(r: Row) -> bool:
        verifies = bool(r.planted.get("verifies"))
        return any(
            _flagged(p)
            for p in flag_rows
            if not p.planted.get("usesAI") and bool(p.planted.get("verifies")) == verifies
        )

    return [r for r in flag_rows if r.planted.get("usesAI") and _flagged(r) and not _peer_flagged(r)]


def fairness(rows: list[Row]) -> dict[str, Any]:
    done = [r for r in rows if r.source != "error" and r.evaluation]
    verifiers = [r for r in done if r.planted.get("verifies")]
    non_verifiers = [r for r in done if not r.planted.get("verifies")]
    ai_verifiers = [r for r in done if r.planted.get("verifies") and r.planted.get("usesAI")]

    def mean_j(rs):
        return round(sum(r.judgment for r in rs) / len(rs), 1) if rs else None

    overreliance_violations = _overreliance_from_tool_use(done)
    no_invented_overreliance = not overreliance_violations
    v_mean, nv_mean, aiv_mean = mean_j(verifiers), mean_j(non_verifiers), mean_j(ai_verifiers)

    # verify_rewarded: a STRICT lead (rejects the meaningless tie). ai_not_penalised:
    # non-inferiority within a small noise band (a tie is the desired outcome, not a fail).
    verify_rewarded = _lead_verdict(v_mean, nv_mean, len(verifiers), len(non_verifiers), MIN_VERIFY_MARGIN)
    ai_not_penalised = _not_below_verdict(aiv_mean, nv_mean, len(ai_verifiers), len(non_verifiers), AI_PENALTY_TOLERANCE)
    status = _gate_status(
        [
            (verify_rewarded, _evaluable(len(verifiers), len(non_verifiers))),
            (ai_not_penalised, _evaluable(len(ai_verifiers), len(non_verifiers))),
        ],
        hard_ok=no_invented_overreliance,
    )
    sample = {"verifiers": len(verifiers), "non_verifiers": len(non_verifiers), "ai_verifiers": len(ai_verifiers)}

    return {
        "no_invented_overreliance": no_invented_overreliance,
        "overreliance_violations": [r.id for r in overreliance_violations],
        "verify_rewarded": verify_rewarded,
        "ai_not_penalised": ai_not_penalised,
        "judgment_mean": {"verifiers": v_mean, "non_verifiers": nv_mean, "ai_verifiers": aiv_mean},
        "margins": {
            "verify_lead": round(v_mean - nv_mean, 1) if (v_mean is not None and nv_mean is not None) else None,
            "ai_gap": round(aiv_mean - nv_mean, 1) if (aiv_mean is not None and nv_mean is not None) else None,
        },
        "sample": sample,
        "thresholds": {"min_group_n": MIN_GROUP_N, "verify_margin": MIN_VERIFY_MARGIN, "ai_penalty_tolerance": AI_PENALTY_TOLERANCE},
        "cohort_warnings": _cohort_warnings(sample),
        "not_evaluable_reason": _not_evaluable_reason(sample, len(done)) if status == "not_evaluable" else None,
        "status": status,
        "passed": status == "pass",
    }


def discrimination(rows: list[Row]) -> dict[str, Any]:
    """Does the evaluator separate strong submissions from weak ones, and catch the
    'productive-looking but never verifies' AI-no-verify gamer? (overall = mean of the 5 dims)."""
    done = [r for r in rows if r.source != "error" and r.evaluation]
    strong = [r for r in done if r.planted.get("expected") == "strong"]
    weak = [r for r in done if r.planted.get("expected") == "weak"]
    gamer = [r for r in done if r.planted.get("behavior") == "ai_no_verify"]

    def mean_o(rs):
        return round(sum(r.overall for r in rs) / len(rs), 1) if rs else None

    s_mean, w_mean, g_mean = mean_o(strong), mean_o(weak), mean_o(gamer)
    # Both directions require a meaningful margin (was: ANY positive gap) and a
    # minimum sample, so a near-tie or a tiny run is inconclusive, not a pass.
    strong_beats_weak = _lead_verdict(s_mean, w_mean, len(strong), len(weak), MIN_DISCRIMINATION_MARGIN)
    gamer_below_strong = _lead_verdict(s_mean, g_mean, len(strong), len(gamer), MIN_DISCRIMINATION_MARGIN)
    status = _gate_status(
        [
            (strong_beats_weak, _evaluable(len(strong), len(weak))),
            (gamer_below_strong, _evaluable(len(strong), len(gamer))),
        ]
    )
    sample = {"strong": len(strong), "weak": len(weak), "gamer": len(gamer)}
    return {
        "strong_mean": s_mean,
        "weak_mean": w_mean,
        "margin": round(s_mean - w_mean, 1) if (s_mean is not None and w_mean is not None) else None,
        "gamer_mean": g_mean,
        "gamer_margin": round(s_mean - g_mean, 1) if (s_mean is not None and g_mean is not None) else None,
        "sample": sample,
        "thresholds": {"min_group_n": MIN_GROUP_N, "discrimination_margin": MIN_DISCRIMINATION_MARGIN},
        "cohort_warnings": _cohort_warnings(sample),
        "not_evaluable_reason": _not_evaluable_reason(sample, len(done)) if status == "not_evaluable" else None,
        "strong_beats_weak": strong_beats_weak,
        "gamer_below_strong": gamer_below_strong,
        "status": status,
        "passed": status == "pass",
    }


def signals(rows: list[Row]) -> dict[str, Any]:
    return {
        "scenarios": len(rows),
        "reliable": sum(1 for r in rows if r.reliable),
        "reliability": round(sum(1 for r in rows if r.reliable) / len(rows), 3) if rows else 0,
        "llm_rows": sum(1 for r in rows if r.source == "llm"),
        "error_fallbacks": sum(1 for r in rows if r.fallback_reasons),
        "fairness": fairness(rows),
        "discrimination": discrimination(rows),
    }


# --- LLM-as-judge -----------------------------------------------------------


def judge(rows: list[Row], provider: ClaudeCliProvider, workers: int = 4) -> None:
    def _prompt(r: Row) -> str:
        return (
            f"You QA an AI hiring evaluation. Code is assumed LLM-generated, so it must grade judgment/verification/"
            f"transfer, NOT AI use, and must not penalise using tools.\nScenario: {r.label}\n"
            f"Evaluation: {json.dumps(r.evaluation, ensure_ascii=False)[:1200]}\nTransfer: {json.dumps(r.transfer, ensure_ascii=False)[:800]}\n\n"
            'Return JSON: { "score": int 1-5, "fairToAiUse": bool, "note": str }. JSON only.'
        )

    def _shape(r: Row, payload: dict) -> None:
        r.quality = {
            "score": max(1, min(5, int(payload.get("score", 0)))),
            "fairToAiUse": bool(payload.get("fairToAiUse", True)),
            "note": str(payload.get("note") or "")[:200],
        }

    run_judge([r for r in rows if r.source != "error"], _prompt, _shape, provider, workers)


def _quality_summary(rows: list[Row]) -> dict[str, Any]:
    scored = [r.quality for r in rows if r.quality]
    if not scored:
        return {}
    return {
        "mean": round(sum(q["score"] for q in scored) / len(scored), 2),
        "fair_to_ai_use_rate": round(sum(1 for q in scored if q["fairToAiUse"]) / len(scored), 3),
        "unfair_notes": [q["note"] for q in scored if not q["fairToAiUse"] and q["note"]][:8],
    }


def _report_md(rows: list[Row], sig: dict, qual: dict | None) -> str:
    f = sig["fairness"]
    d = sig["discrimination"]
    L = [
        "# Dev pipeline — submission evaluation eval\n",
        f"Scenarios: {sig['scenarios']} · reliable: {sig['reliable']}/{sig['scenarios']} ({sig['reliability']:.0%}) · LLM rows: {sig['llm_rows']} · error-fallbacks: {sig['error_fallbacks']}\n",
    ]
    if sig["error_fallbacks"]:
        L.append(
            f"> **WARNING: {sig['error_fallbacks']} row(s) ran in LLM mode but ERROR-fell-back to deterministic** — "
            "the LLM path is degraded (provider down / unparseable / rate-limited), so the reliability and gates "
            "below reflect the DETERMINISTIC baseline, not the LLM path being certified. Treat as NOT green.\n"
        )
    L += [
        "## Fairness gate (the heart)\n",
        f"- **status: {f['status'].upper()}** (passed: {f['passed']})",
    ]
    if f.get("not_evaluable_reason"):
        L.append(f"- not evaluable (no data — does NOT fail --strict): {f['not_evaluable_reason']}")
    L += [
        f"- no invented over-reliance from tool use: {f['no_invented_overreliance']}"
        + (f" — VIOLATED by {f['overreliance_violations']}" if f["overreliance_violations"] else ""),
        f"- verification rewarded (verifiers lead non by >= {MIN_VERIFY_MARGIN:g} judgment pts): "
        f"{_verdict_str(f['verify_rewarded'])} · lead {f['margins']['verify_lead']}",
        f"- AI use not penalised (ai-verifiers within {AI_PENALTY_TOLERANCE:g} pts of non-verifiers): "
        f"{_verdict_str(f['ai_not_penalised'])} · gap {f['margins']['ai_gap']}",
        f"- judgment means: {f['judgment_mean']} · samples {f['sample']}",
    ]
    if f.get("cohort_warnings"):
        L.append(f"- minimum-cohort-size warning: {'; '.join(f['cohort_warnings'])}")
    L.append("\n## Discrimination\n")
    L.append(
        f"- **status: {d['status'].upper()}** (passed: {d['passed']}) · strong {d['strong_mean']} vs weak "
        f"{d['weak_mean']} (margin {d['margin']}, bar >= {MIN_DISCRIMINATION_MARGIN:g})"
    )
    if d.get("not_evaluable_reason"):
        L.append(f"- not evaluable (no data — does NOT fail --strict): {d['not_evaluable_reason']}")
    L.append(
        f"- strong beats weak: {_verdict_str(d['strong_beats_weak'])} · gamer (AI-no-verify) {d['gamer_mean']} "
        f"below strong by {d['gamer_margin']}: {_verdict_str(d['gamer_below_strong'])} · samples {d['sample']}"
    )
    if d.get("cohort_warnings"):
        L.append(f"- minimum-cohort-size warning: {'; '.join(d['cohort_warnings'])}")
    fails = [r for r in rows if not r.reliable]
    if fails:
        L.append("\n## Reliability failures\n")
        for r in fails[:20]:
            L.append(f"- **{r.id}** ({r.source}): {'; '.join(r.issues)}")
    if qual:
        L.append("\n## LLM-judge\n")
        L.append(f"- mean quality: {qual.get('mean')} · fair-to-AI-use rate: {qual.get('fair_to_ai_use_rate')}")
        for n in qual.get("unfair_notes", []):
            L.append(f"- UNFAIR: {n}")
    return "\n".join(L)


def main(argv: list[str] | None = None) -> int:
    configure_stdio(errors="replace")
    p = argparse.ArgumentParser(description="Submission evaluation eval (Dev pipeline, eval half).")
    p.add_argument("--count", type=int, default=48)
    p.add_argument("--domain", default="it", help="it | marketing | finance | sales | design | mixed")
    p.add_argument("--no-llm", action="store_true")
    p.add_argument("--judge", action="store_true")
    p.add_argument("--strict", action="store_true", help="exit non-zero if reliability < 100%%, a gate is fail/inconclusive (a measured violation, or a thin-but-present sample the gate may not certify), OR any row error-fell-back from the LLM path (a degraded provider masquerading as a clean deterministic run). A not_evaluable gate (an empty cohort / no surviving rows — e.g. a tiny --count, or every scenario errored) does NOT exit non-zero: absence of data is not a violation.")
    p.add_argument("--workers", type=int, default=4)
    p.add_argument("--json", action="store_true")
    args = p.parse_args(argv)

    provider = None
    if not args.no_llm:
        provider = ClaudeCliProvider(timeout=150)
        if not provider.available():
            sys.stderr.write("submission_eval: Claude CLI unavailable -> deterministic mode\n")
            provider = None

    rows = run(generate_submissions(args.count, args.domain), provider, workers=args.workers)
    sig = signals(rows)
    qual = None
    if args.judge and provider is not None:
        judge(rows, provider, workers=args.workers)
        qual = _quality_summary(rows)

    if args.json:
        print(json.dumps({"signals": sig, "quality": qual, "rows": [{"id": r.id, "source": r.source, "reliable": r.reliable, "issues": r.issues, "judgment": r.judgment} for r in rows]}, indent=2, ensure_ascii=False))
    else:
        print(_report_md(rows, sig, qual))

    if args.strict:
        reasons = []
        if sig["reliability"] < 1.0:
            reasons.append(f"reliability {sig['reliability']:.0%} < 100%")
        # An all-error-fallback run is the dangerous false-green: reliability stays
        # 100% (deterministic templates pass _check) but the LLM path under test never
        # actually ran. Fail strict so a degraded provider can't certify a prompt/model.
        if sig["error_fallbacks"]:
            reasons.append(f"{sig['error_fallbacks']} row(s) error-fell-back from the LLM path (degraded provider, not a clean --no-llm run)")
        # A 'fail' (measured violation) or 'inconclusive' (thin sample) exits non-zero; a
        # 'not_evaluable' gate (empty cohort / no data) does NOT — distinguishing a gate
        # that was VIOLATED from one that simply couldn't be evaluated.
        for name in ("fairness", "discrimination"):
            if sig[name]["status"] in ("fail", "inconclusive"):
                reasons.append(f"{name} gate {sig[name]['status']}")
        if reasons:
            sys.stderr.write("submission_eval --strict failed: " + "; ".join(reasons) + "\n")
            return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
