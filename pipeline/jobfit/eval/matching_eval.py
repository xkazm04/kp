"""Deterministic matching + fairness eval for the v2 pipeline (Phase 8).

Unlike the Gemini extraction eval (runner.py), this needs NO API key: it routes
synthetic candidate profiles, transforms them, and matches against the committed
job corpus, then scores the pipeline on:

  - archetype_accuracy     — router lands the right archetype from signals
  - entry_precision         — every returned early-career match is entry-eligible
                              (the KO remap guarantee)
  - role_relevance_at5      — top-5 matches sit in the candidate's target family

…and runs explicit FAIRNESS probes (the brief's "Rizika a trade-offy"):

  - pedigree_neutrality     — swapping a university NAME barely moves the score;
                              demonstrated skills move it far more
  - socioeconomic_inclusion — lacking an internship doesn't eliminate a candidate
  - language_neutrality     — Czech / diacritic skill surfaces resolve like English
  - potential_monotonicity  — richer evidence never scores below thinner evidence

Run:  python -m pipeline.jobfit.eval.matching_eval [--json] [--strict]
"""

from __future__ import annotations

import argparse
import json
import sys
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

from .._cli import configure_stdio
from ..archetype import detect_archetype
from ..matching import _DEFAULT_CORPUS, load_corpus, match
from ..profile import CandidateProfileV2, Evidence, SkillClaim
from ..taxonomy import resolve_term, skill_match_score
from ..transform import build_match_candidate
from ._style import _make_styler, should_color
from .runner import GLYPH_NA, glyph, verdict_banner
from .thresholds import MATCHING_THRESHOLDS as THRESHOLDS


# -- scenario builders ------------------------------------------------------


def _student_frontend(rich: bool = True) -> CandidateProfileV2:
    evidence = [
        Evidence(kind="thesis", title="Recommender web app", skills=["React", "TypeScript", "REST API"], link="http://x"),
    ]
    skills = [SkillClaim(skill="React"), SkillClaim(skill="JavaScript"), SkillClaim(skill="Git")]
    if rich:
        evidence.append(Evidence(kind="internship", title="FE intern", skills=["JavaScript", "CSS"]))
        skills.append(SkillClaim(skill="HTML"))
    return CandidateProfileV2(
        archetype="student",
        role_family="software_engineering",
        education_level="bachelor",
        education_detail="Computer Science, ČVUT FEL",
        languages=["Czech", "English"],
        aspirations=["Junior frontend developer"],
        skill_claims=skills,
        evidence=evidence,
    )


def _student_data() -> CandidateProfileV2:
    return CandidateProfileV2(
        archetype="student",
        role_family="data_ai",
        education_level="master",
        education_detail="Data Science, MUNI",
        languages=["Czech", "English"],
        aspirations=["Junior data analyst"],
        skill_claims=[SkillClaim(skill="Python"), SkillClaim(skill="SQL"), SkillClaim(skill="pandas")],
        evidence=[Evidence(kind="thesis", title="Churn model", skills=["Python", "machine learning"], link="http://y")],
    )


def _switcher_backend() -> CandidateProfileV2:
    return CandidateProfileV2(
        archetype="career_switcher",
        role_family="software_engineering",
        education_level="master",
        education_detail="Mathematics; self-study in software",
        languages=["Czech", "English"],
        aspirations=["Junior backend developer"],
        years_experience=9,
        skill_claims=[SkillClaim(skill="Python", provenance="coursework"), SkillClaim(skill="Git")],
        evidence=[
            Evidence(kind="job", title="High school teacher", text="Taught mathematics for 9 years"),
            Evidence(kind="project", title="Django tracker", skills=["Python", "Django", "PostgreSQL"], link="http://z"),
        ],
    )


def _senior_backend() -> CandidateProfileV2:
    return CandidateProfileV2(
        archetype="bau",
        role_family="software_engineering",
        education_level="master",
        languages=["English"],
        years_experience=8,
        seniority="senior",
        skill_claims=[SkillClaim(skill=s, provenance="professional") for s in ["Python", "Django", "PostgreSQL", "AWS"]],
        evidence=[Evidence(kind="job", title="Senior Backend Engineer", skills=["Python", "Django"])],
    )


@dataclass
class Scenario:
    name: str
    profile: CandidateProfileV2
    signals: dict[str, Any]
    expected_archetype: str
    early_career: bool


SCENARIOS: list[Scenario] = [
    Scenario("student_frontend", _student_frontend(), {"is_enrolled": True, "years_relevant_experience": 0.3}, "student", True),
    Scenario("student_data", _student_data(), {"is_enrolled": True, "years_relevant_experience": 0.0}, "student", True),
    Scenario(
        "switcher_backend",
        _switcher_backend(),
        {"wants_domain_change": True, "has_substantial_experience": True},
        "career_switcher",
        True,
    ),
    Scenario(
        "senior_backend",
        _senior_backend(),
        {"years_relevant_experience": 8, "has_substantial_experience": True},
        "bau",
        False,
    ),
]


# -- metrics ----------------------------------------------------------------


@dataclass
class ScenarioResult:
    name: str
    detected_archetype: str
    archetype_ok: bool
    entry_precision: float | None
    role_relevance_at5: float
    top_total: int


def _eval_scenario(scenario: Scenario, jobs: list[Any]) -> ScenarioResult:
    detected, _conf, _reasons = detect_archetype(**scenario.signals)
    profile = scenario.profile
    profile.archetype = detected  # route, then score under the detected profile
    candidate = build_match_candidate(profile)
    resp = match(candidate, jobs, limit=25)
    matches = resp.matches
    top5 = matches[:5]
    relevance = (sum(1 for m in top5 if m.role_family == profile.role_family) / len(top5)) if top5 else 0.0
    entry_precision: float | None = None
    if scenario.early_career:
        # An early-career scenario that surfaced ZERO matches is a hard failure
        # (a broken matcher), not "N/A" — score it 0.0 so an all-empty run can't
        # leave every entry_precision None and default the aggregate to 1.0 PASS.
        entry_precision = (sum(1 for m in matches if m.is_entry_eligible) / len(matches)) if matches else 0.0
    return ScenarioResult(
        name=scenario.name,
        detected_archetype=detected,
        archetype_ok=detected == scenario.expected_archetype,
        entry_precision=entry_precision,
        role_relevance_at5=round(relevance, 3),
        top_total=matches[0].total if matches else 0,
    )


# -- fairness probes --------------------------------------------------------


@dataclass
class Probe:
    name: str
    passed: bool
    detail: str


def _probe_pedigree(jobs: list[Any]) -> Probe:
    """Swapping the university NAME (field words kept) must barely move the score."""
    base = _student_frontend()
    base.education_detail = "Computer Science, Charles University"
    other = _student_frontend()
    other.education_detail = "Computer Science, Local Community College"
    t1 = match(build_match_candidate(base), jobs, limit=5).matches
    t2 = match(build_match_candidate(other), jobs, limit=5).matches
    s1 = t1[0].total if t1 else 0
    s2 = t2[0].total if t2 else 0
    delta = abs(s1 - s2)
    return Probe("pedigree_neutrality", delta <= 3, f"top-score delta {delta} (<=3) between prestigious vs lesser-known uni")


def _probe_socioeconomic(jobs: list[Any]) -> Probe:
    """Lacking an internship must not eliminate the candidate."""
    without = _student_frontend(rich=False)  # no internship
    matches = match(build_match_candidate(without), jobs, limit=25).matches
    return Probe(
        "socioeconomic_inclusion",
        len(matches) > 0,
        f"{len(matches)} matches without an internship (must be >0; not a KO gate)",
    )


def _probe_language() -> Probe:
    """Czech / diacritic skill surfaces resolve like their English equivalents."""
    cases = [
        ("strojové učení", "machine learning"),
        ("kubernetes", "Kubernetes"),
    ]
    ok = all(resolve_term(a) is not None and resolve_term(a) == resolve_term(b) for a, b in cases)
    # and the match score is full for the Czech surface against the English requirement
    ok = ok and skill_match_score("strojové učení", "machine learning") == 1.0
    return Probe("language_neutrality", ok, "Czech/diacritic surfaces resolve and score like English")


def _probe_monotonicity(jobs: list[Any]) -> Probe:
    """Richer evidence must never score below thinner evidence (same candidate)."""
    rich = match(build_match_candidate(_student_frontend(rich=True)), jobs, limit=5).matches
    thin = match(build_match_candidate(_student_frontend(rich=False)), jobs, limit=5).matches
    rs = rich[0].total if rich else 0
    ts = thin[0].total if thin else 0
    return Probe("potential_monotonicity", rs >= ts, f"rich top {rs} >= thin top {ts}")


# -- runner -----------------------------------------------------------------


@dataclass
class Report:
    scenarios: list[ScenarioResult] = field(default_factory=list)
    probes: list[Probe] = field(default_factory=list)

    def aggregate(self) -> dict[str, float]:
        n = len(self.scenarios)
        if not n:
            return {}
        arche = sum(s.archetype_ok for s in self.scenarios) / n
        entry_vals = [s.entry_precision for s in self.scenarios if s.entry_precision is not None]
        entry = sum(entry_vals) / len(entry_vals) if entry_vals else 1.0
        rel = sum(s.role_relevance_at5 for s in self.scenarios) / n
        return {
            "archetype_accuracy": round(arche, 3),
            "entry_precision": round(entry, 3),
            "role_relevance_at5": round(rel, 3),
        }

    def passes(self) -> bool:
        agg = self.aggregate()
        metrics_ok = all(agg.get(k, 0.0) >= v for k, v in THRESHOLDS.items())
        return metrics_ok and all(p.passed for p in self.probes)


def run(jobs: list[Any] | None = None) -> Report:
    if jobs is None:
        jobs = load_corpus()
    report = Report()
    for scenario in SCENARIOS:
        report.scenarios.append(_eval_scenario(scenario, jobs))
    report.probes = [
        _probe_pedigree(jobs),
        _probe_socioeconomic(jobs),
        _probe_language(),
        _probe_monotonicity(jobs),
    ]
    return report


def _scenario_passed(s: ScenarioResult) -> bool:
    """Whether a scenario cleared the per-scenario axes (archetype routed, entry
    precision — when applicable — and role@5 at/above threshold). Drives the
    ``N/M scenarios`` count in the banner."""
    if not s.archetype_ok:
        return False
    if s.entry_precision is not None and s.entry_precision < THRESHOLDS["entry_precision"]:
        return False
    return s.role_relevance_at5 >= THRESHOLDS["role_relevance_at5"]


def _matching_banner(report: Report, st) -> str:
    """Lead the matching report with the aggregate verdict, e.g.
    ``▌ 8/8 checks PASS · archetype 100% · role@5 95%``.

    Scenarios and fairness probes both gate the run, so they fold into one
    ``checks`` count — the verdict word can never contradict the count (e.g. all
    scenarios green but a probe red)."""
    agg = report.aggregate()
    total = len(report.scenarios) + len(report.probes)
    n_pass = sum(_scenario_passed(s) for s in report.scenarios) + sum(p.passed for p in report.probes)
    n_fail = total - n_pass
    parts = [
        f"{n_pass}/{total} checks {'PASS' if report.passes() else 'FAIL'}",
        f"archetype {agg.get('archetype_accuracy', 0.0):.0%}",
        f"role@5 {agg.get('role_relevance_at5', 0.0):.0%}",
    ]
    if n_fail:
        parts.append(f"{n_fail} FAIL")
    return verdict_banner(parts, passed=report.passes(), s=st)


def _format_markdown(report: Report, *, color: bool = False) -> str:
    st = _make_styler(color)
    agg = report.aggregate()
    lines = [
        st("# v2 matching + fairness eval", "bold") + "\n",
        # Lead with the verdict so the run outcome reads before the tables.
        _matching_banner(report, st) + "\n",
        "## Aggregate metrics\n",
        "| metric | score | threshold | pass |",
        "|---|---|---|---|",
    ]
    for k, threshold in THRESHOLDS.items():
        v = agg.get(k, 0.0)
        lines.append(f"| {k} | {v:.0%} | {threshold:.0%} | {glyph(v >= threshold, st)} |")
    lines += ["", "## Per-scenario\n", "| scenario | archetype | ok | entry precision | role@5 | top |", "|---|---|---|---|---|---|"]
    for s in report.scenarios:
        ep = GLYPH_NA if s.entry_precision is None else f"{s.entry_precision:.0%}"
        lines.append(
            f"| {s.name} | {s.detected_archetype} | {glyph(s.archetype_ok, st)} | {ep} | "
            f"{s.role_relevance_at5:.0%} | {s.top_total} |"
        )
    # Fairness probes — the brief's centrepiece ("Rizika a trade-offy"). Set it
    # apart with a rule and a lead verdict so it reads as the hero of the report,
    # not an equal-weight third table.
    n_probes = len(report.probes)
    n_fair = sum(p.passed for p in report.probes)
    fair_ok = n_fair == n_probes
    fair_line = verdict_banner(
        [f"Fairness: {n_fair}/{n_probes} {'PASS' if fair_ok else 'FAIL'}"],
        passed=fair_ok,
        s=st,
    )
    lines += [
        "",
        "---",
        "",
        "## Fairness probes\n",
        f"{fair_line} {glyph(fair_ok, st)}\n",
        "| probe | result | detail |",
        "|---|---|---|",
    ]
    for p in report.probes:
        # Pretty (color) render: collapse PASS detail so the eye lands on any
        # FAIL. Plain markdown keeps every detail for the written record.
        detail = "" if (color and p.passed) else p.detail
        lines.append(f"| {p.name} | {glyph(p.passed, st)} | {detail} |")
    return "\n".join(lines)


def _empty_corpus_message(corpus: Path) -> str:
    """Helpful empty state when the job corpus has no jobs to match against:
    every scenario would surface zero matches and the report would be a mute,
    misleading FAIL. Name the corpus file and how to regenerate it."""
    where = Path(*corpus.parts[-3:]).as_posix()  # e.g. data/seed_jobs/jobs.normalized.json
    return (
        f"matching_eval: job corpus is empty (0 jobs in {where}) — nothing to match against.\n"
        "  regenerate it with:  python -m pipeline.jobfit.seed_jobs_csas\n"
    )


def main(argv: list[str] | None = None) -> int:
    configure_stdio(errors="replace")

    parser = argparse.ArgumentParser(description="Deterministic v2 matching + fairness eval.")
    parser.add_argument("--json", action="store_true")
    parser.add_argument("--no-color", action="store_true", help="Disable ANSI color in the pretty report.")
    parser.add_argument("--strict", action="store_true", help="Exit non-zero if a metric or probe fails.")
    args = parser.parse_args(argv)
    use_color = should_color(args)

    # Load the corpus first: with zero jobs, every scenario scores 0 matches and
    # the report is a confusing all-FAIL with no cause. Say the corpus is empty
    # and how to rebuild it, then exit non-zero instead.
    try:
        jobs = load_corpus(_DEFAULT_CORPUS)
    except (FileNotFoundError, json.JSONDecodeError):
        jobs = []
    if not jobs:
        sys.stderr.write(_empty_corpus_message(_DEFAULT_CORPUS))
        return 1

    report = run(jobs)
    if args.json:
        print(
            json.dumps(
                {
                    "aggregate": report.aggregate(),
                    "thresholds": THRESHOLDS,
                    "passes": report.passes(),
                    "scenarios": [vars(s) for s in report.scenarios],
                    "probes": [vars(p) for p in report.probes],
                },
                indent=2,
                ensure_ascii=False,
            )
        )
    else:
        print(_format_markdown(report, color=use_color))

    if args.strict and not report.passes():
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
