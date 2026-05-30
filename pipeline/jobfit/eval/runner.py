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
from .thresholds import PASS_THRESHOLDS


FIXTURES_DIR = Path(__file__).resolve().parent / "fixtures"


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


def _safe_int(value: Any, default: int = 0) -> int:
    """Coerce a possibly-null/missing/garbage value to int without raising.

    A fixture key present but JSON-null made ``int(None)`` raise ``TypeError``
    and abort the *whole* run — this keeps one bad field from doing that.
    """
    try:
        return int(value)
    except (TypeError, ValueError):
        return default


def _run_fixture(cv_path: Path, expected: dict[str, Any]) -> FixtureResult:
    started = time.monotonic()

    def _error_result(exc: Exception) -> FixtureResult:
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

    # The ENTIRE body (analyze + scoring) is guarded: a crash while scoring one
    # fixture (e.g. a null salary or a malformed expected range) records that
    # fixture as a failure instead of aborting the run before later fixtures.
    try:
        payload = analyze(
            cv_path,
            grounding=False,
            job_description_text=expected.get("job_description"),
            company_text=expected.get("company_text"),
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
        actual_min = _safe_int(salary.get("minimum"))
        actual_max = _safe_int(salary.get("maximum"))

        expected_seniority_set = expected.get("expected_seniority")
        if isinstance(expected_seniority_set, str):
            expected_seniority_set = [expected_seniority_set]

        expected_role_set = expected.get("expected_role_family")
        if isinstance(expected_role_set, str):
            expected_role_set = [expected_role_set]

        expected_range = expected.get("expected_salary_range") or [0, 0]
        if not (isinstance(expected_range, (list, tuple)) and len(expected_range) >= 2):
            expected_range = [0, 0]
        overlap = _range_overlap((actual_min, actual_max), (_safe_int(expected_range[0]), _safe_int(expected_range[1])))

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
    except Exception as exc:
        return _error_result(exc)


# Keys every fixture .json must carry for scoring to be meaningful.
_REQUIRED_FIXTURE_KEYS = ("label", "expected_role_family", "expected_seniority", "expected_salary_range", "expected_skills_subset")


def _validate_fixture(json_path: Path, expected: Any) -> str | None:
    """Return a human-readable error if the fixture is malformed, else None."""
    if not isinstance(expected, dict):
        return f"{json_path.name}: top-level JSON must be an object"
    missing = [k for k in _REQUIRED_FIXTURE_KEYS if k not in expected]
    if missing:
        return f"{json_path.name}: missing required key(s): {', '.join(missing)}"
    rng = expected.get("expected_salary_range")
    if not (isinstance(rng, (list, tuple)) and len(rng) == 2 and all(isinstance(n, (int, float)) for n in rng)):
        return f"{json_path.name}: expected_salary_range must be a 2-number list, got {rng!r}"
    return None


def _load_fixtures(
    filter_keyword: str | None = None, fixtures_dir: Path | None = None
) -> tuple[list[tuple[Path, dict[str, Any]]], list[str]]:
    """Load fixtures, collecting (not raising on) per-file errors.

    A single fixture with a JSON syntax error or a bad schema used to abort the
    entire run with a traceback that never named the file. We now report each
    offending file by name and keep loading the rest; ``main`` fails the run at
    the end with the aggregated list.

    ``fixtures_dir`` defaults to the committed golden set but can point at a
    sibling set (e.g. the generated ČS candidate fixtures) so the same scorer
    runs over a different corpus without disturbing the curated CI gate.
    """
    out: list[tuple[Path, dict[str, Any]]] = []
    errors: list[str] = []
    for txt_path in sorted((fixtures_dir or FIXTURES_DIR).glob("*.txt")):
        json_path = txt_path.with_suffix(".json")
        if not json_path.exists():
            continue  # a .txt without a paired .json is not a fixture
        if filter_keyword and filter_keyword.lower() not in txt_path.stem.lower():
            continue
        try:
            expected = json.loads(json_path.read_text(encoding="utf-8"))
        except json.JSONDecodeError as exc:
            errors.append(f"{json_path.name}: invalid JSON — {exc}")
            continue
        problem = _validate_fixture(json_path, expected)
        if problem:
            errors.append(problem)
            continue
        out.append((txt_path, expected))
    return out, errors


_ANSI = {"green": "32", "red": "31", "yellow": "33", "bold": "1", "dim": "2"}


def _make_styler(enabled: bool):
    """Return a colorizer; a no-op when color is disabled (piped output / NO_COLOR)."""
    def style(text: str, *names: str) -> str:
        codes = ";".join(_ANSI[n] for n in names if n in _ANSI)
        return f"\033[{codes}m{text}\033[0m" if enabled and codes else text
    return style


def _format_markdown(report: Report, load_errors: list[str] | None = None, *, color: bool = False) -> str:
    s = _make_styler(color)
    verdict = lambda ok: s("PASS", "green") if ok else s("FAIL", "red")  # noqa: E731
    lines: list[str] = []
    agg = report.aggregate()
    lines.append(s("# Eval report", "bold") + "\n")
    lines.append(f"Fixtures: **{len(report.fixtures)}**\n")
    if load_errors:
        lines.append(s(f"## ⚠ Malformed fixtures: {len(load_errors)}", "yellow", "bold") + "\n")
        for err in load_errors:
            lines.append(f"- {err}")
        lines.append("")
    lines.append("## Aggregate\n")
    lines.append("| metric | score | threshold | pass |")
    lines.append("|---|---|---|---|")
    for k, v in agg.items():
        threshold = PASS_THRESHOLDS[k]
        lines.append(f"| {k} | {v:.0%} | {threshold:.0%} | {verdict(v >= threshold)} |")
    lines.append("")
    lines.append("## Per-fixture\n")
    lines.append(
        "| fixture | role | seniority | salary overlap | skill recall | edu | signals | t (s) |"
    )
    lines.append("|---|---|---|---|---|---|---|---|")
    for f in report.fixtures:
        rf = verdict(f.role_family_match)
        sn = verdict(f.seniority_match)
        edu = "n/a" if f.education_match is None else verdict(f.education_match)
        sig = "n/a" if f.signals_recall is None else f"{f.signals_recall:.0%}"
        lines.append(
            f"| {f.name} | {rf} | {sn} | {f.salary_overlap:.0%} | {f.skill_recall:.0%} | "
            f"{edu} | {sig} | {f.duration_s:.1f} |"
        )

    # Diff-style detail for each fixture that failed any axis: the failing axis,
    # the expected value, and what was actually produced — so a red row in the
    # table above is immediately explainable without re-running by hand.
    detail = _failure_detail(report, s)
    if detail:
        lines.append("\n## Failure detail\n")
        lines.extend(detail)

    failed = [f for f in report.fixtures if f.error]
    if failed:
        lines.append("\n## Errors\n")
        for f in failed:
            lines.append(f"- **{f.name}**: {s(f.error or '', 'red')}")
    return "\n".join(lines)


def _failure_detail(report: Report, s) -> list[str]:
    out: list[str] = []
    for f in report.fixtures:
        if f.error:
            continue  # already listed under Errors
        rows: list[str] = []
        if not f.role_family_match:
            rows.append(f"    role_family: expected {f.expected.get('expected_role_family')!r}, got {f.actual.get('roleFamily')!r}")
        if not f.seniority_match:
            rows.append(f"    seniority:   expected {f.expected.get('expected_seniority')!r}, got {f.actual.get('seniority')!r}")
        if f.salary_overlap < PASS_THRESHOLDS["salary_overlap"]:
            rows.append(f"    salary:      expected {f.expected.get('expected_salary_range')!r}, got {f.actual.get('salary')!r} (overlap {f.salary_overlap:.0%})")
        if f.skill_recall < PASS_THRESHOLDS["skill_recall"]:
            rows.append(f"    skills:      recall {f.skill_recall:.0%} of {f.expected.get('expected_skills_subset')!r}; got {f.actual.get('skills')!r}")
        if f.education_match is False:
            rows.append(f"    education:   expected {f.expected.get('expected_education')!r}, got {f.actual.get('education')!r}")
        if rows:
            out.append(f"- {s(f.name, 'bold')}")
            out.extend(s(r, "red") for r in rows)
    return out


def main(argv: list[str] | None = None) -> int:
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")
        sys.stderr.reconfigure(encoding="utf-8", errors="replace")

    parser = argparse.ArgumentParser(description="Run the jobfit eval harness against the golden fixtures.")
    parser.add_argument("--filter", help="Only run fixtures whose name contains this substring.")
    parser.add_argument(
        "--fixtures-dir",
        type=Path,
        default=None,
        help="Score a different fixtures directory (default: the committed golden set).",
    )
    parser.add_argument("--format", choices=["pretty", "json"], default=None, help="Output format (default: pretty).")
    parser.add_argument("--json", action="store_true", help="Alias for --format json (machine-readable).")
    parser.add_argument("--no-color", action="store_true", help="Disable ANSI color in the pretty report.")
    parser.add_argument("--strict", action="store_true", help="Exit non-zero if pass thresholds fail.")
    args = parser.parse_args(argv)
    want_json = args.json or args.format == "json"
    use_color = not args.no_color and sys.stdout.isatty() and os.getenv("NO_COLOR") is None

    load_local_env()
    if not (os.getenv("GEMINI_API_KEY") or os.getenv("GOOGLE_API_KEY")):
        sys.stderr.write("eval: GEMINI_API_KEY not set, skipping\n")
        return 0

    fixtures, load_errors = _load_fixtures(args.filter, args.fixtures_dir)
    for err in load_errors:
        sys.stderr.write(f"eval: malformed fixture — {err}\n")
    if not fixtures:
        if not load_errors:
            sys.stderr.write("eval: no fixtures matched\n")
        return 1 if load_errors else 0

    report = Report()
    for cv_path, expected in fixtures:
        result = _run_fixture(cv_path, expected)
        report.fixtures.append(result)

    if want_json:
        out = {
            "schemaVersion": 1,
            "aggregate": report.aggregate(),
            "thresholds": PASS_THRESHOLDS,
            "passes": report.passes(),
            "loadErrors": load_errors,
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
        print(_format_markdown(report, load_errors, color=use_color))

    # A malformed fixture is a data-integrity failure: fail the run regardless of
    # --strict (which only governs the soft pass-threshold gate).
    if load_errors:
        return 1
    if args.strict and not report.passes():
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
