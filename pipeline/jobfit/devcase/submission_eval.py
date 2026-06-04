"""Submission scenario eval — the EVALUATION half of the Dev pipeline (Phase D7).

Runs trace -> reflect_commits -> assess_tooling -> evaluate_submission -> score_transfer
over a landscape of synthetic candidate behaviours (submission_scenarios.py) and gates:

  RELIABILITY — every output well-formed (scores in range, one outcome per probe, transfer in
                range, reflection hedged).
  FAIRNESS    — the heart of the Dev extension. Code is assumed LLM-generated, so the score must
                track VERIFICATION/JUDGMENT, never AI use: (1) no over-reliance flag is invented
                from tool use alone (deterministic), (2) candidates who VERIFY score judgment >=
                those who don't, (3) using AI is not penalised — an AI-heavy verifier scores at
                least as well on judgment as a non-verifier.
  QUALITY     — with --judge, an LLM rates the evaluation AND answers whether it unfairly
                penalises AI use (it must not).

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

from ..claude_cli import ClaudeCliProvider
from .evaluate import evaluate_submission, score_transfer
from .llm_judge import run_judge
from .models import RUBRIC_DIMENSIONS
from .provenance import combine_source
from .reflect import assess_tooling, reflect_commits
from .submission_scenarios import SubScenario, generate_submissions

# Derived from the canonical rubric (models.RUBRIC_DIMENSIONS) — mirroring evaluate._DIMS —
# so the reliability validator's dimension set can never drift from the rubric it checks.
_DIMS = {d["name"] for d in RUBRIC_DIMENSIONS}
_PATTERNS = {"exploratory", "linear", "big-bang", "test-driven", "unclear"}


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
    issues = _check(refl, tool, ev, tr, scn)
    return Row(id=scn.id, label=scn.label, planted=scn.planted, source=src, issues=issues, reflection=refl, tooling=tool, evaluation=ev, transfer=tr)


def run(scenarios: list[SubScenario], provider: Any | None, workers: int = 4) -> list[Row]:
    w = max(1, workers) if provider is not None else 1
    with ThreadPoolExecutor(max_workers=w) as pool:
        return list(pool.map(lambda s: run_one(s, provider), scenarios))


# --- fairness invariants (the gate) ----------------------------------------


def fairness(rows: list[Row]) -> dict[str, Any]:
    done = [r for r in rows if r.source != "error" and r.evaluation]
    verifiers = [r for r in done if r.planted.get("verifies")]
    non_verifiers = [r for r in done if not r.planted.get("verifies")]
    ai_verifiers = [r for r in done if r.planted.get("verifies") and r.planted.get("usesAI")]

    def mean_j(rs):
        return round(sum(r.judgment for r in rs) / len(rs), 1) if rs else None

    no_invented_overreliance = all(not (r.source == "deterministic" and (r.tooling.get("overRelianceFlags") or [])) for r in done)
    v_mean, nv_mean = mean_j(verifiers), mean_j(non_verifiers)
    verify_rewarded = (v_mean is not None and nv_mean is not None and v_mean >= nv_mean)
    aiv_mean = mean_j(ai_verifiers)
    ai_not_penalised = (aiv_mean is not None and nv_mean is not None and aiv_mean >= nv_mean)

    passed = no_invented_overreliance and verify_rewarded and ai_not_penalised
    return {
        "no_invented_overreliance": no_invented_overreliance,
        "verify_rewarded": verify_rewarded,
        "ai_not_penalised": ai_not_penalised,
        "judgment_mean": {"verifiers": v_mean, "non_verifiers": nv_mean, "ai_verifiers": aiv_mean},
        "passed": passed,
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
    strong_beats_weak = s_mean is not None and w_mean is not None and s_mean > w_mean
    gamer_below_strong = g_mean is not None and s_mean is not None and g_mean < s_mean
    return {
        "strong_mean": s_mean,
        "weak_mean": w_mean,
        "margin": round(s_mean - w_mean, 1) if (s_mean is not None and w_mean is not None) else None,
        "gamer_mean": g_mean,
        "strong_beats_weak": strong_beats_weak,
        "gamer_below_strong": gamer_below_strong,
        "passed": strong_beats_weak and gamer_below_strong,
    }


def signals(rows: list[Row]) -> dict[str, Any]:
    return {
        "scenarios": len(rows),
        "reliable": sum(1 for r in rows if r.reliable),
        "reliability": round(sum(1 for r in rows if r.reliable) / len(rows), 3) if rows else 0,
        "llm_rows": sum(1 for r in rows if r.source == "llm"),
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
        f"Scenarios: {sig['scenarios']} · reliable: {sig['reliable']}/{sig['scenarios']} ({sig['reliability']:.0%}) · LLM rows: {sig['llm_rows']}\n",
        "## Fairness gate (the heart)\n",
        f"- **passed: {f['passed']}**",
        f"- no invented over-reliance from tool use: {f['no_invented_overreliance']}",
        f"- verification rewarded (verifiers judgment >= non): {f['verify_rewarded']}",
        f"- AI use not penalised (ai-verifiers >= non-verifiers): {f['ai_not_penalised']}",
        f"- judgment means: {f['judgment_mean']}",
        "\n## Discrimination\n",
        f"- **passed: {d['passed']}** · strong {d['strong_mean']} vs weak {d['weak_mean']} (margin {d['margin']})",
        f"- gamer (AI-no-verify) {d['gamer_mean']} below strong: {d['gamer_below_strong']}",
    ]
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
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    p = argparse.ArgumentParser(description="Submission evaluation eval (Dev pipeline, eval half).")
    p.add_argument("--count", type=int, default=48)
    p.add_argument("--domain", default="it", help="it | marketing | finance | sales | design | mixed")
    p.add_argument("--no-llm", action="store_true")
    p.add_argument("--judge", action="store_true")
    p.add_argument("--strict", action="store_true", help="exit non-zero if reliability < 100% or the fairness/discrimination gates fail")
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

    if args.strict and (sig["reliability"] < 1.0 or not sig["fairness"]["passed"] or not sig["discrimination"]["passed"]):
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
