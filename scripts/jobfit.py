"""Job-fit scoring against a specific JD.

Mirrors the UI's Job fit tab: fit score, matching/missing skills,
seniority and role alignment, salary assessment, talking points,
must-prove evidence, recruiter risk flags, and recommended CV edits.

A job description is required (either a path via ``--jd`` or inline
text via ``--jd-text``).

Examples
--------
    python scripts/jobfit.py path/to/cv.pdf --jd path/to/jd.txt
    python scripts/jobfit.py path/to/cv.pdf --jd-text "Senior Python + AWS SRE"
"""

from __future__ import annotations

import argparse
import sys

from _common import (
    BOLD,
    CYAN,
    DIM,
    GREEN,
    RED,
    RESET,
    YELLOW,
    add_common_args,
    bullets,
    footer,
    header,
    join_short,
    kv,
    progress_bar,
    render_candidate_summary,
    run_analysis,
    section,
)


def main() -> int:
    parser = argparse.ArgumentParser(description="Score a CV against a specific job description and print talking points / risk flags.")
    add_common_args(parser, require_jd=False)
    args = parser.parse_args()

    if not args.jd and not args.jd_text:
        print("error: --jd or --jd-text is required for job-fit analysis", file=sys.stderr)
        return 2

    payload = run_analysis(args)

    fit = payload.get("jobFit")
    if not fit:
        print("error: pipeline did not return a job fit (missing or unparsable JD)", file=sys.stderr)
        return 1

    header("Candidate", color=CYAN)
    render_candidate_summary(payload)
    footer(color=CYAN)

    header("Job fit", color=GREEN)
    print(f"  Fit score   {progress_bar(int(fit.get('score', 0)))}")
    kv("Seniority", fit.get("seniorityAlignment"))
    kv("Role", fit.get("roleAlignment"))
    kv("Salary", fit.get("salaryAssessment"))
    if fit.get("summary"):
        section("Summary")
        print(f"  {fit['summary']}")
    if fit.get("negotiationAngle"):
        section("Negotiation angle")
        print(f"  {fit['negotiationAngle']}")
    footer(color=GREEN)

    matching = fit.get("matchingSkills") or []
    missing = fit.get("missingSkills") or []
    header("Skill alignment", color=CYAN)
    section(f"{GREEN}Matching ({len(matching)}){RESET}")
    bullets([join_short(matching, limit=20)] if matching else [], color=GREEN)
    section(f"{RED}Missing ({len(missing)}){RESET}")
    bullets([join_short(missing, limit=20)] if missing else [], color=RED)
    footer(color=CYAN)

    talking = fit.get("interviewTalkingPoints") or []
    if talking:
        header("Interview talking points", color=YELLOW)
        bullets(talking, color=YELLOW)
        footer(color=YELLOW)

    must_prove = fit.get("mustProveEvidence") or []
    if must_prove:
        header("Must-prove evidence", color=YELLOW)
        bullets(must_prove)
        footer(color=YELLOW)

    risks = fit.get("recruiterRiskFlags") or []
    if risks:
        header("Recruiter risk flags", color=RED)
        bullets(risks, color=RED)
        footer(color=RED)

    rewrites = fit.get("cvRewriteSuggestions") or []
    if rewrites:
        header("CV rewrite suggestions", color=CYAN)
        bullets(rewrites)
        footer(color=CYAN)

    recs = fit.get("recommendations") or []
    if recs:
        header("Recommendations", color=GREEN)
        bullets(recs, color=GREEN)
        footer(color=GREEN)

    coverage = payload.get("keywordCoverage") or {}
    hits = coverage.get("hits") or []
    if hits or coverage.get("missing") or coverage.get("overUsed"):
        header("Keyword coverage", color=CYAN)
        print(f"  Coverage    {progress_bar(int(coverage.get('coveragePercent', 0)))}  {DIM}keyword match{RESET}")
        matched = [h for h in hits if h.get("matched")]
        unmatched = [h for h in hits if not h.get("matched")]
        if matched:
            section(f"{GREEN}Matched ({len(matched)}){RESET}")
            for h in matched[:20]:
                print(
                    f"  {GREEN}+{RESET} {h.get('keyword'):<28} "
                    f"{DIM}jd*{h.get('inJd', 0)}  cv*{h.get('inCv', 0)}{RESET}"
                )
            if len(matched) > 20:
                print(f"  {DIM}... +{len(matched) - 20} more{RESET}")
        if unmatched:
            section(f"{RED}Not matched ({len(unmatched)}){RESET}")
            for h in unmatched[:20]:
                print(
                    f"  {RED}-{RESET} {h.get('keyword'):<28} "
                    f"{DIM}jd*{h.get('inJd', 0)}  cv*{h.get('inCv', 0)}{RESET}"
                )
            if len(unmatched) > 20:
                print(f"  {DIM}... +{len(unmatched) - 20} more{RESET}")
        if coverage.get("missing"):
            section(f"{RED}Missing keywords{RESET}")
            print(f"  {join_short(coverage['missing'], limit=30)}")
        if coverage.get("overUsed"):
            section(f"{YELLOW}Possibly over-used{RESET}")
            print(f"  {join_short(coverage['overUsed'], limit=20)}")
        footer(color=CYAN)

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
