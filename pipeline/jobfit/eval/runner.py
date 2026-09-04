"""Golden-set evaluation harness.

Runs the analysis pipeline against every fixture under
``pipeline/jobfit/eval/fixtures/`` and scores each on four axes:

- ``role_family``: exact match
- ``seniority``: candidate seniority is in the fixture's expected set
- ``salary_overlap``: 0..1 overlap of [min, max] with the expected range,
  averaged *only over fixtures that emitted a salary* — an accuracy axis
- ``salary_coverage``: fraction of (non-error) fixtures for which a salary band
  was emitted at all — a coverage axis kept separate so a missing salary is
  never folded into a 0.0 overlap that reads identically to a confidently-wrong
  band (which would hide an extraction-coverage regression behind accuracy)
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
import difflib
import json
import os
import sys
import time
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

from .._cli import configure_stdio
from ..gemini import load_local_env
from ..service import analyze
from ._style import _ANSI, _make_styler, should_color  # noqa: F401  (_ANSI re-exported for back-compat)
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
    # Whether Gemini emitted a usable salary band at all. ``salary_overlap`` is
    # 0.0 both for a missing salary and for a confidently-wrong one; this flag is
    # what tells the two apart (coverage miss vs accuracy miss) downstream.
    salary_present: bool
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
        sk = sum(f.skill_recall for f in self.fixtures) / total
        # Salary is scored on two axes so a *coverage* miss (no band emitted) is
        # never silently averaged in as a 0.0 *accuracy* score:
        #   • salary_coverage — fraction of scored (non-error) fixtures that
        #     emitted a band at all
        #   • salary_overlap  — mean band overlap *among only those that emitted
        #     one*, so the accuracy number reflects predictions actually made
        # Folding a missing salary into salary_overlap=0.0 (its old behaviour)
        # made a drop in emission look like a modest accuracy dip; splitting them
        # keeps each number diagnostic. Error fixtures (analysis crashed, no
        # payload) are excluded from both — they're surfaced under Errors.
        scored = [f for f in self.fixtures if not f.error]
        emitted = [f for f in scored if f.salary_present]
        salary_coverage = len(emitted) / len(scored) if scored else 0.0
        salary_overlap = sum(f.salary_overlap for f in emitted) / len(emitted) if emitted else 0.0
        return {
            "role_family": rf,
            "seniority": sn,
            "salary_overlap": salary_overlap,
            "salary_coverage": salary_coverage,
            "skill_recall": sk,
        }

    def passes(self) -> bool:
        agg = self.aggregate()
        return all(agg.get(k, 0.0) >= v for k, v in PASS_THRESHOLDS.items())


def range_overlap(actual: tuple[int, int], expected: tuple[int, int]) -> float:
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


def salary_band(salary: Any) -> tuple[int, int, bool]:
    """Pull ``(minimum, maximum, present)`` out of a payload's ``salary`` block.

    ``present`` is what separates a *coverage* miss — Gemini emitted no usable
    salary figure at all (block missing/``None``, both bounds null/garbage, or a
    degenerate ``0``) — from an *accuracy* miss, where it emitted a real band
    that simply doesn't overlap the expected one. Both previously collapsed to
    ``range_overlap((0, 0), expected) == 0.0`` and were indistinguishable; the
    flag keeps them apart so a fall in emission isn't read as an accuracy dip.

    A band counts as present when either bound coerces to a positive int — the
    same :func:`safe_int` coercion the overlap uses, so the two never disagree.
    """
    if not isinstance(salary, dict):
        return 0, 0, False
    a_min = safe_int(salary.get("minimum"))
    a_max = safe_int(salary.get("maximum"))
    return a_min, a_max, (a_min > 0 or a_max > 0)


def _normalize_skill(skill: str) -> str:
    return skill.strip().lower().replace(".", "").replace("-", " ").replace("_", " ")


def skill_recall(actual_skills: list[str], expected_subset: list[str]) -> float:
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


def safe_int(value: Any, default: int = 0) -> int:
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
            salary_present=False,
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
        actual_min, actual_max, salary_present = salary_band(salary)

        expected_seniority_set = expected.get("expected_seniority")
        if isinstance(expected_seniority_set, str):
            expected_seniority_set = [expected_seniority_set]

        expected_role_set = expected.get("expected_role_family")
        if isinstance(expected_role_set, str):
            expected_role_set = [expected_role_set]

        expected_range = expected.get("expected_salary_range") or [0, 0]
        if not (isinstance(expected_range, (list, tuple)) and len(expected_range) >= 2):
            expected_range = [0, 0]
        overlap = range_overlap((actual_min, actual_max), (safe_int(expected_range[0]), safe_int(expected_range[1])))

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
            salary_present=salary_present,
            skill_recall=skill_recall(actual_skills, expected.get("expected_skills_subset", [])),
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


def _fixture_stems(fixtures_dir: Path | None = None) -> list[str]:
    """Every fixture stem (a ``<name>.txt`` with a paired ``<name>.json``) in the
    directory — the universe a ``--filter`` selects from. Used to size the corpus
    in the empty-state line and to suggest near-misses for a typo'd filter."""
    base = fixtures_dir or FIXTURES_DIR
    return [p.stem for p in sorted(base.glob("*.txt")) if p.with_suffix(".json").exists()]


def _did_you_mean(query: str, stems: list[str], *, n: int = 3, cutoff: float = 0.5) -> list[str]:
    """The ``n`` fixture stems closest to ``query``, ranked by the best similarity
    of the query to the whole stem OR any of its underscore tokens — so a short
    filter (``senoir``) still finds a long stem (``senior_python_ai``) on the
    token the user was aiming at. Returns ``[]`` when nothing clears ``cutoff``.

    difflib's :func:`get_close_matches` alone compares whole strings, so a 6-char
    typo against a 16-char stem scores below any usable cutoff; matching against
    tokens too is what makes the suggestion land."""
    q = query.lower()
    scored: list[tuple[float, str]] = []
    for stem in stems:
        candidates = [stem, *stem.split("_")]
        ratio = max(difflib.SequenceMatcher(None, q, c).ratio() for c in candidates)
        scored.append((ratio, stem))
    scored.sort(key=lambda rs: (-rs[0], rs[1]))  # best ratio first, then name for stable ties
    return [stem for ratio, stem in scored if ratio >= cutoff][:n]


def _no_fixtures_message(filter_keyword: str | None, fixtures_dir: Path | None = None) -> str:
    """Helpful empty state for a run with nothing to score: how many fixtures
    exist and where, plus a did-you-mean for a typo'd ``--filter`` so the miss is
    one keystroke from recovery instead of a dead end."""
    base = fixtures_dir or FIXTURES_DIR
    where = f"{base.name}/"
    stems = _fixture_stems(fixtures_dir)
    if not filter_keyword:
        return (
            f"eval: no fixtures found (0 in {where}) — is --fixtures-dir correct, "
            "and has the fixture set been generated?"
        )
    lines = [f'eval: no fixtures matched --filter "{filter_keyword}" (0 of {len(stems)} in {where})']
    suggestions = _did_you_mean(filter_keyword, stems)
    if suggestions:
        lines.append(f"      did you mean: {', '.join(suggestions)}")
    return "\n".join(lines)


# --- Shared verdict vocabulary -------------------------------------------
# ONE glyph set across every eval/pilot report so a cell means the same thing
# everywhere: ✓ pass · ✗ fail · – not-applicable. Previously the suite spelled
# verdicts three ways (PASS/FAIL text, OK/XX, "n/a" strings); this is the single
# source of truth, reused by runner, matching_eval, and seed_cv_fixtures.
GLYPH_PASS = "✓"
GLYPH_FAIL = "✗"
GLYPH_NA = "–"


def glyph(ok: bool | None, s=None) -> str:
    """Render a verdict cell: ✓ / ✗ / – (``None`` → not-applicable).

    When a styler ``s`` is supplied, the pass/fail glyphs are colored
    green/red; the n/a glyph is always left neutral.
    """
    if ok is None:
        return GLYPH_NA
    g = GLYPH_PASS if ok else GLYPH_FAIL
    return s(g, "green" if ok else "red") if s else g


def _salary_cell(f: FixtureResult) -> str:
    """Per-fixture salary cell for the report table: a percentage when a band was
    emitted, or a distinct ``– none`` marker when none was — so a coverage miss
    never renders as a ``0%`` that reads identically to a wrong band."""
    if not f.salary_present:
        return f"{GLYPH_NA} none"
    return f"{f.salary_overlap:.0%}"


def verdict_banner(parts: list[str], *, passed: bool, s) -> str:
    """One-line headline that leads a report.

    Joins ``parts`` with ' · ' after a color-coded bar, e.g.::

        ▌ 7/8 fixtures PASS · role 100% · salary 88% · 1 FAIL

    The whole line is green when ``passed`` else red (the report's overall
    ``pass()``), so the run outcome is graspable before reading the table.
    """
    line = "▌ " + " · ".join(p for p in parts if p)
    return s(line, "green" if passed else "red", "bold")


def _fixture_passed(f: FixtureResult) -> bool:
    """Whether a single fixture cleared every measured axis: no error, role and
    seniority matched, salary overlap and skill recall at/above threshold, and
    education not contradicted. Drives the ``N/M fixtures`` count in the banner
    (mirrors what :func:`_failure_detail` flags as a per-fixture miss)."""
    if f.error:
        return False
    if not (f.role_family_match and f.seniority_match):
        return False
    # No salary emitted is a coverage miss (a fail); a band that *was* emitted
    # must clear the overlap threshold. Both still fail the fixture, but the
    # reason is now distinguishable in the report rather than a bare 0% overlap.
    if not f.salary_present:
        return False
    if f.salary_overlap < PASS_THRESHOLDS["salary_overlap"]:
        return False
    if f.skill_recall < PASS_THRESHOLDS["skill_recall"]:
        return False
    return f.education_match is not False


def _eval_banner(report: Report, s) -> str:
    """Lead the eval report with the aggregate verdict, e.g.
    ``▌ 7/8 fixtures PASS · role 100% · salary 88% · 1 FAIL``."""
    total = len(report.fixtures)
    n_pass = sum(_fixture_passed(f) for f in report.fixtures)
    n_fail = total - n_pass
    agg = report.aggregate()
    parts = [
        f"{n_pass}/{total} fixtures {'PASS' if report.passes() else 'FAIL'}",
        f"role {agg.get('role_family', 0.0):.0%}",
        # salary as accuracy + coverage so a coverage drop is visible in the
        # headline, not masked by an overlap averaged only over what was emitted.
        f"salary {agg.get('salary_overlap', 0.0):.0%} (cov {agg.get('salary_coverage', 0.0):.0%})",
    ]
    if n_fail:
        parts.append(f"{n_fail} FAIL")
    return verdict_banner(parts, passed=report.passes(), s=s)


def format_markdown(report: Report, load_errors: list[str] | None = None, *, color: bool = False) -> str:
    s = _make_styler(color)
    lines: list[str] = []
    agg = report.aggregate()
    lines.append(s("# Eval report", "bold") + "\n")
    # Lead with the verdict so the run outcome reads before the tables.
    lines.append(_eval_banner(report, s) + "\n")
    lines.append(f"Fixtures: **{len(report.fixtures)}**\n")
    if load_errors:
        lines.append(s(f"## ⚠ Malformed fixtures: {len(load_errors)}", "yellow", "bold") + "\n")
        for err in load_errors:
            lines.append(f"- {err}")
        lines.append("")
    if not report.fixtures:
        # Empty report (e.g. an all-skipped pilot, or every analysis failed): the
        # aggregate/per-fixture tables would be blank and the banner alone reads as
        # a mute failure, so say what happened instead of rendering empty tables.
        lines.append(
            s("> No fixtures were scored.", "yellow", "bold")
            + " Every candidate was skipped or failed to render/analyze — there is"
            " nothing to report. Re-run without `--skip-existing`, or check the"
            " render/analysis errors above."
        )
        return "\n".join(lines)
    lines.append("## Aggregate\n")
    lines.append("| metric | score | threshold | pass |")
    lines.append("|---|---|---|---|")
    for k, v in agg.items():
        threshold = PASS_THRESHOLDS[k]
        lines.append(f"| {k} | {v:.0%} | {threshold:.0%} | {glyph(v >= threshold, s)} |")
    lines.append("")
    lines.append("## Per-fixture\n")
    lines.append(
        "| fixture | role | seniority | salary overlap | skill recall | edu | signals | t (s) |"
    )
    lines.append("|---|---|---|---|---|---|---|---|")
    for f in report.fixtures:
        rf = glyph(f.role_family_match, s)
        sn = glyph(f.seniority_match, s)
        edu = glyph(f.education_match, s)  # None → – (n/a)
        sig = GLYPH_NA if f.signals_recall is None else f"{f.signals_recall:.0%}"
        lines.append(
            f"| {f.name} | {rf} | {sn} | {_salary_cell(f)} | {f.skill_recall:.0%} | "
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
            rows.append(f"role_family: expected {f.expected.get('expected_role_family')!r}, got {f.actual.get('roleFamily')!r}")
        if not f.seniority_match:
            rows.append(f"seniority:   expected {f.expected.get('expected_seniority')!r}, got {f.actual.get('seniority')!r}")
        if not f.salary_present:
            rows.append(f"salary:      expected {f.expected.get('expected_salary_range')!r}, but no salary band was emitted (coverage miss, not a wrong band)")
        elif f.salary_overlap < PASS_THRESHOLDS["salary_overlap"]:
            rows.append(f"salary:      expected {f.expected.get('expected_salary_range')!r}, got {f.actual.get('salary')!r} (overlap {f.salary_overlap:.0%})")
        if f.skill_recall < PASS_THRESHOLDS["skill_recall"]:
            rows.append(f"skills:      recall {f.skill_recall:.0%} of {f.expected.get('expected_skills_subset')!r}; got {f.actual.get('skills')!r}")
        if f.education_match is False:
            rows.append(f"education:   expected {f.expected.get('expected_education')!r}, got {f.actual.get('education')!r}")
        if rows:
            out.append(f"- {s(f.name, 'bold')}")
            # Lead every failing axis with the ✗ glyph so the miss reads
            # structurally — in a pipe, on a projector, for a colorblind
            # reviewer — instead of by red alone. The marker always prints; the
            # red is supplementary and falls away when the styler is a no-op
            # (NO_COLOR / non-TTY / CI), so color carries no meaning of its own.
            out.extend(s(f"    {GLYPH_FAIL} {r}", "red") for r in rows)
    return out


def main(argv: list[str] | None = None) -> int:
    configure_stdio(errors="replace")

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
    use_color = should_color(args)

    load_local_env()
    if not (os.getenv("GEMINI_API_KEY") or os.getenv("GOOGLE_API_KEY")):
        # Nothing was measured. Exit-code contract (eval/__main__.py): that is a 0
        # for a plain run — keyless is a supported state — but --strict asked for a
        # verdict this run cannot give, so it must not answer "pass".
        sys.stderr.write(
            "eval: GEMINI_API_KEY not set, skipping"
            + (" — --strict cannot certify an unmeasured run" if args.strict else "")
            + "\n"
        )
        return 1 if args.strict else 0

    fixtures, load_errors = _load_fixtures(args.filter, args.fixtures_dir)
    for err in load_errors:
        sys.stderr.write(f"eval: malformed fixture — {err}\n")
    if not fixtures:
        # A run with nothing to score is otherwise a silent dead end. Say why —
        # corpus size, directory, and (for a typo'd --filter) the closest stems —
        # and exit non-zero so a bad filter surfaces in scripts instead of
        # masquerading as a clean pass. (A malformed-fixture run already failed.)
        if not load_errors:
            sys.stderr.write(_no_fixtures_message(args.filter, args.fixtures_dir) + "\n")
        return 1

    report = Report()
    for cv_path, expected in fixtures:
        result = _run_fixture(cv_path, expected)
        report.fixtures.append(result)

    if want_json:
        out = {
            # v2: salary scoring split into salary_overlap (accuracy, among
            # emitted) + salary_coverage (aggregate) + per-fixture salary_present.
            "schemaVersion": 2,
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
                    "salary_present": f.salary_present,
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
        print(format_markdown(report, load_errors, color=use_color))

    # A malformed fixture is a data-integrity failure: fail the run regardless of
    # --strict (which only governs the soft pass-threshold gate).
    if load_errors:
        return 1
    if args.strict and not report.passes():
        return 1
    return 0


# The five helpers the fixture seeder needs. They were private for years, so
# seed_cv_fixtures reached into `runner._salary_band` & co — five imports across a
# module boundary that no signature promised and any refactor here would have
# broken silently. They are the module's public API now; the underscore names
# remain as aliases so an older caller keeps working.
_range_overlap = range_overlap
_salary_band = salary_band
_skill_recall = skill_recall
_safe_int = safe_int
_format_markdown = format_markdown


def write_text_lf(path: Path, text: str) -> None:
    """Write UTF-8 with LF line endings, whatever the platform's default is.

    Every fixture and report this suite emits goes through here. `write_text(...,
    encoding="utf-8")` uses os.linesep on Windows, so the committed corpus flipped
    to CRLF the moment it was regenerated there and back to LF on a Linux
    regeneration — a whole-file diff that says nothing about the data.
    """
    path.write_text(text, encoding="utf-8", newline="\n")


if __name__ == "__main__":
    raise SystemExit(main())
