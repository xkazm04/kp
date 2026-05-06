"""Golden-set evaluation harness.

Runs the analysis pipeline against every fixture under
``pipeline/jobfit/eval/fixtures/`` and scores each on four axes:

- ``role_family``: exact match
- ``seniority``: candidate seniority is in the fixture's expected set
- ``salary_overlap``: 0..1 overlap of [min, max] with the expected range
- ``skill_recall``: fraction of expected skills present in extracted skills

Each fixture is a pair: ``<name>.txt`` (CV body) plus ``<name>.json``
(expectations). Optional fixture keys: ``expected_education``,
``expected_signals_subset``.

Run:

    python -m pipeline.jobfit.eval                  # full report
    python -m pipeline.jobfit.eval --filter senior  # subset
    python -m pipeline.jobfit.eval --json           # machine-readable

Requires GEMINI_API_KEY. Skips with exit 0 if the key is missing.
"""
from __future__ import annotations

import argparse
import json
import os
import sys
import time
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

from ..gemini import load_local_env
from ..service import analyze


FIXTURES_DIR = Path(__file__).resolve().parent / "fixtures"
PASS_THRESHOLDS = {
    "role_family": 0.85,
    "seniority": 0.70,
    "salary_overlap": 0.60,
    "skill_recall": 0.75,
}


@dataclass
class FixtureResult:
    name: str
    label: str
    duration_s: float
    role_family_match: bool
    seniority_match: bool
    salary_overlap: float
    skill_recall: float
    education_match: bool | None
    signals_recall: float | None
    actual: dict[str, Any]
    expected: dict[str, Any]
    error: str | None = None


@dataclass
class Report:
    fixtures: list[FixtureResult] = field(default_factory=list)

    def aggregate(self) -> dict[str, float]:
        total = len(self.fixtures)
        if total == 0:
            return {}
        rf = sum(f.role_family_match for f in self.fixtures) / total
        sn = sum(f.seniority_match for f in self.fixtures) / total
        so = sum(f.salary_overlap for f in self.fixtures) / total
        sk = sum(f.skill_recall for f in self.fixtures) / total
        return {
            "role_family": rf,
            "seniority": sn,
            "salary_overlap": so,
            "skill_recall": sk,
        }

    def passes(self) -> bool:
        agg = self.aggregate()
        return all(agg.get(k, 0.0) >= v for k, v in PASS_THRESHOLDS.items())


def _range_overlap(actual: tuple[int, int], expected: tuple[int, int]) -> float:
    """Containment-aware salary band score in [0, 1].

    - Returns 1.0 when ``actual`` is fully inside ``expected`` (Gemini being
      more precise than the expected range is good, not bad).
    - Returns IoU when ranges overlap partially.
    - Returns 0.0 when disjoint.
    """
    a_lo, a_hi = actual
    e_lo, e_hi = expected
    if a_hi <= a_lo or e_hi <= e_lo:
        return 0.0
    inter_lo = max(a_lo, e_lo)
    inter_hi = min(a_hi, e_hi)
    if inter_hi <= inter_lo:
        return 0.0
    if a_lo >= e_lo and a_hi <= e_hi:
        return 1.0
    union_lo = min(a_lo, e_lo)
    union_hi = max(a_hi, e_hi)
    return (inter_hi - inter_lo) / (union_hi - union_lo)


def _normalize_skill(skill: str) -> str:
    return skill.strip().lower().replace(".", "").replace("-", " ").replace("_", " ")


def _skill_recall(actual_skills: list[str], expected_subset: list[str]) -> float:
    if not expected_subset:
        return 1.0
    actual_norm = {_normalize_skill(s) for s in actual_skills}
    matched = 0
    for expected in expected_subset:
        e = _normalize_skill(expected)
        if any(e in a or a in e for a in actual_norm):
            matched += 1
    return matched / len(expected_subset)


def _signals_recall(actual_signals: list[str], expected_subset: list[str] | None) -> float | None:
    if expected_subset is None:
        return None
    if not expected_subset:
        return 1.0
    actual_set = set(actual_signals)
    matched = sum(1 for s in expected_subset if s in actual_set)
    return matched / len(expected_subset)


def _run_fixture(cv_path: Path, expected: dict[str, Any]) -> FixtureResult:
    started = time.monotonic()
    try:
        payload = analyze(
            cv_path,
            grounding=False,
            job_description_text=expected.get("job_description"),
            company_text=expected.get("company_text"),
        )
    except Exception as exc:
        return FixtureResult(
            name=cv_path.stem,
            label=str(expected.get("label", cv_path.stem)),
            duration_s=time.monotonic() - started,
            role_family_match=False,
            seniority_match=False,
            salary_overlap=0.0,
            skill_recall=0.0,
            education_match=None,
            signals_recall=None,
            actual={},
            expected=expected,
            error=str(exc),
        )

    candidate = payload.get("candidate", {})
    salary = payload.get("salary", {})
    metadata = payload.get("metadata", {})
    evidence = metadata.get("deterministicEvidence", {}) or {}

    actual_role = candidate.get("roleFamily")
    actual_seniority = candidate.get("currentSeniority")
    actual_skills = candidate.get("skills", [])
    actual_education = candidate.get("educationLevel")
    actual_signals = evidence.get("detectedSignals", [])
    actual_min = int(salary.get("minimum", 0))
    actual_max = int(salary.get("maximum", 0))

    expected_seniority_set = expected.get("expected_seniority")
    if isinstance(expected_seniority_set, str):
        expected_seniority_set = [expected_seniority_set]

    expected_role_set = expected.get("expected_role_family")
    if isinstance(expected_role_set, str):
        expected_role_set = [expected_role_set]

    expected_range = expected.get("expected_salary_range") or [0, 0]
    overlap = _range_overlap((actual_min, actual_max), (int(expected_range[0]), int(expected_range[1])))

    education_match: bool | None
    if expected.get("expected_education"):
        education_match = actual_education == expected["expected_education"]
    else:
        education_match = None

    return FixtureResult(
        name=cv_path.stem,
        label=str(expected.get("label", cv_path.stem)),
        duration_s=time.monotonic() - started,
        role_family_match=actual_role in (expected_role_set or []),
        seniority_match=actual_seniority in (expected_seniority_set or []),
        salary_overlap=overlap,
        skill_recall=_skill_recall(actual_skills, expected.get("expected_skills_subset", [])),
        education_match=education_match,
        signals_recall=_signals_recall(actual_signals, expected.get("expected_signals_subset")),
        actual={
            "roleFamily": actual_role,
            "seniority": actual_seniority,
            "salary": [actual_min, actual_max],
            "skills": actual_skills,
            "education": actual_education,
            "signals": actual_signals,
        },
        expected=expected,
    )


def _load_fixtures(filter_keyword: str | None = None) -> list[tuple[Path, dict[str, Any]]]:
    out: list[tuple[Path, dict[str, Any]]] = []
    for txt_path in sorted(FIXTURES_DIR.glob("*.txt")):
        json_path = txt_path.with_suffix(".json")
        if not json_path.exists():
            continue
        if filter_keyword and filter_keyword.lower() not in txt_path.stem.lower():
            continue
        expected = json.loads(json_path.read_text(encoding="utf-8"))
        out.append((txt_path, expected))
    return out


def _format_markdown(report: Report) -> str:
    lines: list[str] = []
    agg = report.aggregate()
    lines.append("# Eval report\n")
    lines.append(f"Fixtures: **{len(report.fixtures)}**\n")
    lines.append("## Aggregate\n")
    lines.append("| metric | score | threshold | pass |")
    lines.append("|---|---|---|---|")
    for k, v in agg.items():
        threshold = PASS_THRESHOLDS[k]
        ok = "PASS" if v >= threshold else "FAIL"
        lines.append(f"| {k} | {v:.0%} | {threshold:.0%} | {ok} |")
    lines.append("")
    lines.append("## Per-fixture\n")
    lines.append(
        "| fixture | role | seniority | salary overlap | skill recall | edu | signals | t (s) |"
    )
    lines.append("|---|---|---|---|---|---|---|---|")
    for f in report.fixtures:
        rf = "PASS" if f.role_family_match else "FAIL"
        sn = "PASS" if f.seniority_match else "FAIL"
        edu = "n/a" if f.education_match is None else ("PASS" if f.education_match else "FAIL")
        sig = "n/a" if f.signals_recall is None else f"{f.signals_recall:.0%}"
        lines.append(
            f"| {f.name} | {rf} | {sn} | {f.salary_overlap:.0%} | {f.skill_recall:.0%} | "
            f"{edu} | {sig} | {f.duration_s:.1f} |"
        )
    failed = [f for f in report.fixtures if f.error]
    if failed:
        lines.append("\n## Errors\n")
        for f in failed:
            lines.append(f"- **{f.name}**: {f.error}")
    return "\n".join(lines)


def main(argv: list[str] | None = None) -> int:
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")
        sys.stderr.reconfigure(encoding="utf-8", errors="replace")

    parser = argparse.ArgumentParser(description="Run the jobfit eval harness against the golden fixtures.")
    parser.add_argument("--filter", help="Only run fixtures whose name contains this substring.")
    parser.add_argument("--json", action="store_true", help="Emit JSON instead of markdown.")
    parser.add_argument("--strict", action="store_true", help="Exit non-zero if pass thresholds fail.")
    args = parser.parse_args(argv)

    load_local_env()
    if not (os.getenv("GEMINI_API_KEY") or os.getenv("GOOGLE_API_KEY")):
        sys.stderr.write("eval: GEMINI_API_KEY not set, skipping\n")
        return 0

    fixtures = _load_fixtures(args.filter)
    if not fixtures:
        sys.stderr.write("eval: no fixtures matched\n")
        return 0

    report = Report()
    for cv_path, expected in fixtures:
        result = _run_fixture(cv_path, expected)
        report.fixtures.append(result)

    if args.json:
        out = {
            "aggregate": report.aggregate(),
            "thresholds": PASS_THRESHOLDS,
            "passes": report.passes(),
            "fixtures": [
                {
                    "name": f.name,
                    "label": f.label,
                    "role_family_match": f.role_family_match,
                    "seniority_match": f.seniority_match,
                    "salary_overlap": f.salary_overlap,
                    "skill_recall": f.skill_recall,
                    "education_match": f.education_match,
                    "signals_recall": f.signals_recall,
                    "duration_s": f.duration_s,
                    "error": f.error,
                    "actual": f.actual,
                    "expected": f.expected,
                }
                for f in report.fixtures
            ],
        }
        print(json.dumps(out, indent=2, ensure_ascii=False))
    else:
        print(_format_markdown(report))

    if args.strict and not report.passes():
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
