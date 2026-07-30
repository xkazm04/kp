"""Calibration harness for the case-GENERATION half, on REAL office JDs (Part 1).

Drives the production case-design chain (need -> analyze -> role -> case) over the
real, broad cross-industry office-JD corpus built by ``real_corpus.py``, then
reports health + judged quality so the generation prompt can be hardened against
the bank/tech industry-lock. This is the design-half twin of ``submission_eval.py``
(the evaluation half), but on REAL jobs instead of synthetic scenarios.

It reuses the existing lifecycle machinery wholesale — the ``_check_*`` validators,
``signals()``, the LLM ``judge`` + ``quality_summary``, and the binary
``role_fit_verdicts`` — and differs from ``lifecycle_eval`` in only two ways:
  1. input = real JDs (no codebase snapshot), not planted synthetic scenarios;
  2. provider routing is PER devcase use-case via ``resolve_provider`` (mirroring
     ``devcase_cli``), so it calibrates the real production engine, not the raw CLI
     default ``lifecycle_eval`` uses.

The automated ``--judge`` now runs on the ``devcase_judge`` seat
(``llm_judge.resolve_judge_provider``), so ``KP_LLM_CONFIG`` can pin a different model
than the one that generated the case; the run reports ``judgeIndependence`` and, when
both seats resolve to the same engine, says so rather than passing the self-grade off
as a verdict. The calibration-grade judgment is still done by a HIGHER-vantage judge
(Claude Opus, out of band) reading the per-case JSON this writes; the automated scores
are a cheap breadth signal, not the gate's heart.

    python -m pipeline.jobfit.devcase.calibrate --count 12 --judge        # pilot
    python -m pipeline.jobfit.devcase.calibrate --count 100 --judge --strict --freeze
    python -m pipeline.jobfit.devcase.calibrate --count 8 --no-llm        # plumbing dry-run

Writes under data/seed_calibration/: cases/<id>.json, cases.json, judge_report.json,
JUDGE_REPORT.md, _calibration_report.json (+ FROZEN.json with --freeze).
"""

from __future__ import annotations

import argparse
import json
import sys
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from .._cli import configure_stdio
from ..llm import resolve_provider
from .analyze import ANALYZE_NEED_PROMPT_VERSION, analyze_need
from .design import CASE_DESIGN_PROMPT_VERSION, ROLE_DESIGN_PROMPT_VERSION, design_case, design_role
from .lifecycle_audits import judge as judge_artifacts, quality_summary, role_fit_verdicts
from .llm_judge import judge_independence, resolve_judge_provider
from .lifecycle_eval import Row, _check_analysis, _check_case, _check_role, signals
from .models import NeedAnalysis
from .provenance import collect_fallback_reasons, combine_source
from .real_corpus import JOBS_PATH, OUT_DIR, CorpusFrozenError, build_corpus, load_jobs, scenarios_from_jobs

CASES_DIR = OUT_DIR / "cases"

# The prompt versions a FRESH generation would stamp this run. A cached case file is only
# reusable under --resume when its stored promptVersions match these AND it was generated under
# the same model — otherwise re-calibrating a hardened prompt / a new model would serve stale
# cases the model-under-test never produced, and the gate/--freeze would certify them (#2).
EXPECTED_PROMPT_VERSIONS = {
    "analyze": ANALYZE_NEED_PROMPT_VERSION,
    "role": ROLE_DESIGN_PROMPT_VERSION,
    "case": CASE_DESIGN_PROMPT_VERSION,
}

# Model tag stamped into a case file when no explicit --model is pinned (each step resolves its
# own production provider). It still differs from an explicit "haiku"/"sonnet" tag, so pinning a
# model after a default run correctly invalidates the cache.
DEFAULT_MODEL_TAG = "default"

# Acceptance gate — what "the generation prompt is hardened" means, made measurable.
# Mirrors lifecycle_eval --strict (reliability + no error-fallbacks) plus the
# industry-lock metric (role-fit) and an anti-template-collapse check. The
# my-judge dimensions (probe quality, discrimination power) are applied out of band.
GATE = {
    "reliability": 1.0,        # every row passes the _check_* structural validators
    "max_error_fallbacks": 0,  # the LLM actually ran + returned parseable JSON (no silent deterministic)
    "role_fit_rate": 0.95,     # tasks match the role's function, not a drifted domain
    "judge_case": 4.0,         # automated 1-5 mean for the CASE artifact (the hardening target).
                               # We gate the CASE, not the combined overall: the analyze step is
                               # inherently "ungrounded" for repo-less office roles (no codebase to
                               # reflect against), so penalising its lower score would punish a
                               # structural fact, not a case defect. The automated judge also
                               # self-grades (same engine) — it's a breadth signal; the real bar is
                               # the higher-vantage (Opus) judge applied out of band.
    "title_uniqueness": 0.95,  # distinct case titles (catches template collapse)
}

# Per-step timeouts: case design (sonnet-class, long JDs) gets the larger budget.
# A complex senior case (e.g. an Account Delivery Manager with a rich context) can take
# >200s; a timeout falls back to the deterministic template, so the budget is generous
# to keep the corpus on the LLM path. (Production routes at 120s — see the follow-up note
# in docs/CASE_CALIBRATION.md: the prod timeout + fallback is a separate robustness gap.)
_ANALYZE_TIMEOUT = 150
_CASE_TIMEOUT = 360


def _providers(no_llm: bool, model: str | None) -> tuple[Any | None, Any | None]:
    """(analyze_provider, case_provider), routed per devcase use-case like devcase_cli.

    ``--model`` pins a single ClaudeCliProvider model for both steps (e.g. to match a
    deployment that runs sonnet); otherwise each step resolves its production provider
    (the CLI on local dev). Unavailable providers degrade to None -> deterministic."""
    if no_llm:
        return None, None
    if model:
        from ..claude_cli import ClaudeCliProvider

        ana = ClaudeCliProvider(model=model, timeout=_ANALYZE_TIMEOUT)
        case = ClaudeCliProvider(model=model, timeout=_CASE_TIMEOUT)
    else:
        ana = resolve_provider("devcase_analyze", timeout=_ANALYZE_TIMEOUT)
        case = resolve_provider("devcase_case_design", timeout=_CASE_TIMEOUT)
    ana = ana if (ana is not None and ana.available()) else None
    case = case if (case is not None and case.available()) else None
    return ana, case


def run_one(scn: Any, analyze_provider: Any | None, case_provider: Any | None) -> Row:
    """One real JD through analyze -> role -> case, validated. Mirrors
    lifecycle_eval.run_one but routes providers per devcase use-case (production
    faithfulness) and reuses the same validators + provenance helpers."""
    try:
        a, asrc = analyze_need(scn.need, scn.snapshot, provider=analyze_provider)
        na = NeedAnalysis.model_validate(a)
        r, rsrc = design_role(scn.need, na, provider=case_provider, lang="en")
        c, csrc = design_case(scn.need, na, r, provider=case_provider, lang="en")
    except Exception as exc:  # pragma: no cover — defensive; one bad row can't sink the run
        return Row(id=scn.id, label=scn.label, planted=scn.planted, source="error", issues=[f"raised: {type(exc).__name__}: {exc}"])
    src = combine_source(asrc, rsrc, csrc)
    fallback_reasons = collect_fallback_reasons((("analyze", a), ("role", r), ("case", c)))
    issues = _check_analysis(a, scn) + _check_role(r, scn) + _check_case(c, scn)
    return Row(id=scn.id, label=scn.label, planted=scn.planted, source=src, issues=issues, analysis=a, role=r, case=c, fallback_reasons=fallback_reasons)


def run(
    scenarios: list[Any],
    analyze_provider: Any | None,
    case_provider: Any | None,
    jobs_by_id: dict[str, dict],
    workers: int = 6,
    resume: bool = True,
    model_tag: str = DEFAULT_MODEL_TAG,
) -> list[Row]:
    """Generate every case, WRITING each one as it completes so a timeout/kill mid-run
    preserves progress (the full 100-case run is ~hundreds of CLI calls). With
    ``resume`` it skips any JD whose clean LLM case is already on disk AND was generated under
    the SAME model + prompt versions as this run (``model_tag`` / EXPECTED_PROMPT_VERSIONS), so a
    re-run after an interrupted sweep is cheap but a re-calibration on a new model/prompt is a
    cache MISS that regenerates rather than certifying stale cases (#2). Returns rows in order."""
    CASES_DIR.mkdir(parents=True, exist_ok=True)

    def _process(scn: Any) -> Row:
        if resume:
            cached = _row_from_file(scn, CASES_DIR / f"{scn.id}.json", model_tag)
            if cached is not None and cached.source == "llm" and cached.reliable:
                return cached  # a clean prior result for THIS model/prompt — don't pay to regenerate it
        row = run_one(scn, analyze_provider, case_provider)
        _write_case(row, jobs_by_id, model_tag)  # incremental: survive a timeout/kill
        return row

    w = max(1, workers) if case_provider is not None else 1
    with ThreadPoolExecutor(max_workers=w) as pool:
        return list(pool.map(_process, scenarios))


# --- persistence ------------------------------------------------------------


def _prompt_versions(row: Row) -> dict[str, str]:
    return {
        "analyze": str(row.analysis.get("promptVersion") or ""),
        "role": str(row.role.get("promptVersion") or ""),
        "case": str(row.case.get("promptVersion") or ""),
    }


def _case_payload(row: Row, jobs_by_id: dict[str, dict], model_tag: str = DEFAULT_MODEL_TAG) -> dict:
    job = jobs_by_id.get(row.id, {})
    return {
        "job": {k: job.get(k) for k in ("id", "title", "company", "role_family", "seniority", "source")},
        "analysis": row.analysis,
        "role": row.role,
        "case": row.case,
        "source": row.source,
        "issues": row.issues,
        "fallbackReason": row.fallback_reasons,
        # Stamp the model + prompt versions this case was generated under so --resume can tell
        # whether a cached case still matches the model/prompt being calibrated now (#2).
        "model": model_tag,
        "promptVersions": _prompt_versions(row),
    }


def _write_case(row: Row, jobs_by_id: dict[str, dict], model_tag: str = DEFAULT_MODEL_TAG) -> None:
    """Write ONE case file (called as each row completes — see run())."""
    CASES_DIR.mkdir(parents=True, exist_ok=True)
    (CASES_DIR / f"{row.id}.json").write_text(
        json.dumps(_case_payload(row, jobs_by_id, model_tag), ensure_ascii=False, indent=2), encoding="utf-8"
    )


def _cache_is_current(d: dict, model_tag: str) -> bool:
    """A cached case file is reusable under --resume ONLY if it was generated under the same
    model AND the same prompt versions as the current run. Otherwise re-calibrating a hardened
    prompt / a newly-pinned model would silently serve the OLD cases, and the gate + --freeze
    would certify a corpus the model/prompt under test never produced (bug-hunter #2)."""
    if str(d.get("model") or "") != model_tag:
        return False
    stored = d.get("promptVersions") or {}
    return all(str(stored.get(k) or "") == v for k, v in EXPECTED_PROMPT_VERSIONS.items())


def _row_from_file(scn: Any, path: Path, model_tag: str = DEFAULT_MODEL_TAG) -> Row | None:
    """Reconstruct a Row from a previously written case file (for --resume).
    Returns None if absent/unreadable, or if the cached case was generated under a DIFFERENT
    model/prompt than this run (a cache MISS forces regeneration — see _cache_is_current, #2)."""
    if not path.exists():
        return None
    try:
        d = json.loads(path.read_text(encoding="utf-8"))
        if not _cache_is_current(d, model_tag):
            return None  # stale for THIS model/prompt — regenerate rather than certify it
        return Row(
            id=scn.id,
            label=scn.label,
            planted=scn.planted,
            source=str(d.get("source") or ""),
            issues=list(d.get("issues") or []),
            analysis=d.get("analysis") or {},
            role=d.get("role") or {},
            case=d.get("case") or {},
            fallback_reasons=d.get("fallbackReason") or {},
        )
    except Exception:
        return None


def write_manifest(rows: list[Row], jobs_by_id: dict[str, dict]) -> None:
    manifest = [
        {
            "id": r.id,
            "title": jobs_by_id.get(r.id, {}).get("title"),
            "roleFamily": jobs_by_id.get(r.id, {}).get("role_family"),
            "seniority": jobs_by_id.get(r.id, {}).get("seniority"),
            "caseTitle": r.case.get("title"),
            "source": r.source,
            "reliable": r.reliable,
        }
        for r in rows
    ]
    (OUT_DIR / "cases.json").write_text(json.dumps(manifest, ensure_ascii=False, indent=2), encoding="utf-8")


def evaluate_gate(sig: dict, role_fit_rate: float | None, qual: dict | None, judged: bool) -> tuple[bool, list[str]]:
    """Return (passed, failure_reasons). My-judge dimensions are out of band."""
    reasons: list[str] = []
    if sig["reliability"] < GATE["reliability"]:
        reasons.append(f"reliability {sig['reliability']:.0%} < {GATE['reliability']:.0%}")
    if sig["error_fallbacks"] > GATE["max_error_fallbacks"]:
        reasons.append(f"{sig['error_fallbacks']} error-fallback(s) from the LLM path (> {GATE['max_error_fallbacks']})")
    tu = sig.get("case_title_uniqueness")
    if tu is not None and tu < GATE["title_uniqueness"]:
        reasons.append(f"case-title uniqueness {tu:.0%} < {GATE['title_uniqueness']:.0%} (template collapse)")
    if role_fit_rate is not None and role_fit_rate < GATE["role_fit_rate"]:
        reasons.append(f"role-fit rate {role_fit_rate:.0%} < {GATE['role_fit_rate']:.0%}")
    case_mean = (qual.get("mean_by_task") or {}).get("case") if qual else None
    if judged and case_mean is not None and case_mean < GATE["judge_case"]:
        reasons.append(f"automated judge case-mean {case_mean} < {GATE['judge_case']}")
    return (not reasons), reasons


def _report_md(rows: list[Row], sig: dict, role_fit: dict, qual: dict | None, passed: bool, reasons: list[str]) -> str:
    banner = "✓ PASS" if passed else "✗ FAIL"
    L = [
        f"# Case-generation calibration — real-JD corpus\n",
        f"## {banner}\n",
    ]
    if reasons:
        L.append("Gate failures: " + "; ".join(reasons) + "\n")
    L += [
        f"Jobs: {sig['scenarios']} · reliable: {sig['reliable']}/{sig['scenarios']} ({sig['reliability']:.0%}) · "
        f"LLM rows: {sig['llm_rows']} · error-fallbacks: {sig['error_fallbacks']}\n",
        "## Health signals\n",
        f"- role-fit rate (tasks match the role's function): **{role_fit.get('rate')}** "
        f"({role_fit.get('judged')}/{role_fit.get('total')} judged)",
        f"- probe-kind diversity: {sig['probe_kind_diversity']} · counts {sig['probe_kind_counts']}",
        f"- probe-count distribution: {sig['probe_count_dist']}",
        f"- case-title uniqueness: {sig['case_title_uniqueness']}",
    ]
    if qual:
        L.append("\n## Automated judge (self-grading — a breadth signal only)\n")
        L.append(f"- mean by task: {qual['mean_by_task']} · overall {qual['overall']}")
        L.append(f"- most-requested app-data levers: {qual['top_levers']}")
        if qual["low_score_notes"]:
            L.append("\n### Low-score notes\n")
            L += [f"- {n}" for n in qual["low_score_notes"]]
    drift = [v for v in role_fit.get("verdicts", []) if v["matchesRole"] is False]
    if drift:
        L.append("\n## Role-fit DRIFT (case left the role's domain)\n")
        L += [f"- **{v['id']}** {v['label']}: {v['note']}" for v in drift[:25]]
    fails = [r for r in rows if not r.reliable]
    if fails:
        L.append("\n## Reliability failures\n")
        L += [f"- **{r.id}** ({r.source}): {'; '.join(r.issues)}" for r in fails[:25]]
    return "\n".join(L)


def main(argv: list[str] | None = None) -> int:
    configure_stdio(errors="replace")
    p = argparse.ArgumentParser(description="Calibrate case generation on a real office-JD corpus.")
    p.add_argument("--count", type=int, default=12, help="Corpus size (pilot default 12; 100 for the full run).")
    p.add_argument("--workers", type=int, default=6)
    p.add_argument("--judge", action="store_true", help="Run the automated 1-5 LLM judge + role-fit (needs the CLI).")
    p.add_argument("--model", type=str, default=None, help="Pin a Claude CLI model for all steps (e.g. 'sonnet').")
    p.add_argument("--no-llm", action="store_true", help="Deterministic fallback only — plumbing dry-run.")
    p.add_argument("--no-resume", action="store_true", help="Re-fetch the raw dataset instead of reusing the cache.")
    p.add_argument("--rebuild", action="store_true", help="(Re)build the JD corpus even if data/seed_calibration/jobs.json exists (default: reuse it — a pilot must not truncate a frozen corpus).")
    p.add_argument("--force", action="store_true", help="With --rebuild, allow overwriting/shrinking a FROZEN corpus (destroys the blessed fixture).")
    p.add_argument("--strict", action="store_true", help="Exit non-zero if the acceptance gate fails.")
    p.add_argument("--freeze", action="store_true", help="Mark this run as the canonical Part 2 fixture (writes FROZEN.json).")
    args = p.parse_args(argv)

    # Corpus: REUSE the existing (possibly frozen) jobs.json by default — a --count pilot then
    # runs on a SLICE of it and never rewrites the file, so it can't truncate the blessed 100-JD
    # corpus that --freeze certified and Part 2 consumes (bug-hunter #1). Only (re)build when the
    # corpus is absent or --rebuild is given; a shrinking rebuild over a frozen corpus is refused
    # unless --force.
    if JOBS_PATH.exists() and not args.rebuild:
        jobs = load_jobs()
        if len(jobs) < args.count:
            sys.stderr.write(
                f"calibrate: existing corpus has {len(jobs)} JDs (< --count {args.count}); "
                f"running on all {len(jobs)}. Pass --rebuild to grow it.\n"
            )
    else:
        try:
            jobs = build_corpus(args.count, resume=not args.no_resume, force=args.force)
        except CorpusFrozenError as exc:
            sys.stderr.write(f"calibrate: {exc}\n")
            return 1
    jobs = jobs[: args.count]
    jobs_by_id = {j["id"]: j for j in jobs}
    scenarios = scenarios_from_jobs(jobs)
    model_tag = args.model or DEFAULT_MODEL_TAG

    analyze_provider, case_provider = _providers(args.no_llm, args.model)
    if not args.no_llm and case_provider is None:
        sys.stderr.write("calibrate: Claude CLI unavailable → deterministic mode (use --no-llm to silence)\n")

    print(f"Generating cases for {len(scenarios)} real JDs (workers={args.workers})…", file=sys.stderr)
    rows = run(scenarios, analyze_provider, case_provider, jobs_by_id, workers=args.workers, resume=not args.no_resume, model_tag=model_tag)
    write_manifest(rows, jobs_by_id)

    sig = signals(rows)

    qual = None
    independence = None
    role_fit = {"rate": None, "judged": 0, "total": 0, "verdicts": []}
    if args.judge:
        if case_provider is None:
            sys.stderr.write("calibrate: --judge needs the Claude CLI; skipping judged metrics\n")
        else:
            done = [r for r in rows if r.source != "error" and r.case]
            # Judge seat resolved separately from the case generator — see llm_judge.py.
            judge_provider = resolve_judge_provider()
            if not judge_provider.available():
                sys.stderr.write("calibrate: devcase_judge provider unavailable -> judging with the generator (NOT independent)\n")
                judge_provider = case_provider
            independence = judge_independence(case_provider, judge_provider)
            if not independence["independent"]:
                sys.stderr.write(
                    f"calibrate: SELF-GRADING — judge {independence['judge']} == generator {independence['generator']}; "
                    "the judged metrics below share the generator's blind spots\n"
                )
            judge_artifacts(rows, judge_provider, workers=args.workers)
            qual = quality_summary(rows)
            verdicts = role_fit_verdicts(done, judge_provider, workers=args.workers)
            judged = [v for v in verdicts if v["matchesRole"] is not None]
            rate = round(sum(1 for v in judged if v["matchesRole"]) / len(judged), 3) if judged else None
            role_fit = {"rate": rate, "judged": len(judged), "total": len(done), "verdicts": verdicts}

    passed, reasons = evaluate_gate(sig, role_fit["rate"], qual, judged=args.judge and case_provider is not None)

    (OUT_DIR / "judge_report.json").write_text(
        json.dumps({"signals": sig, "quality": qual, "roleFit": role_fit, "judgeIndependence": independence}, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    report_md = _report_md(rows, sig, role_fit, qual, passed, reasons)
    (OUT_DIR / "JUDGE_REPORT.md").write_text(report_md, encoding="utf-8")
    (OUT_DIR / "_calibration_report.json").write_text(
        json.dumps(
            {
                "count": len(rows),
                "passed": passed,
                "failures": reasons,
                "gate": GATE,
                "reliability": sig["reliability"],
                "errorFallbacks": sig["error_fallbacks"],
                "roleFitRate": role_fit["rate"],
                "judgeCaseMean": (qual.get("mean_by_task") or {}).get("case") if qual else None,
                "judgeOverall": qual["overall"] if qual else None,
                "titleUniqueness": sig["case_title_uniqueness"],
            },
            ensure_ascii=False,
            indent=2,
        ),
        encoding="utf-8",
    )

    if args.freeze:
        versions = {pv for r in rows if r.case for pv in [r.case.get("promptVersion")] if pv}
        (OUT_DIR / "FROZEN.json").write_text(
            json.dumps(
                {
                    "frozenAt": datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
                    "count": len(rows),
                    "casePromptVersions": sorted(versions),
                    "passed": passed,
                    "note": "Canonical case corpus for Part 2 (candidate simulation + evaluation-prompt hardening).",
                },
                ensure_ascii=False,
                indent=2,
            ),
            encoding="utf-8",
        )

    print("\n" + report_md)
    print(f"\nWrote cases/ + reports to {OUT_DIR.as_posix()}", file=sys.stderr)

    if args.strict and not passed:
        sys.stderr.write("calibrate --strict failed: " + "; ".join(reasons) + "\n")
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
