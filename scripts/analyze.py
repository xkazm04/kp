"""Headless overview of a CV analysis.

Renders the same high-signal fields the UI's Extraction tab shows:
profile identity, score breakdown, salary, strengths/gaps,
recommendations, and the deterministic-evidence pre-pass.

Examples
--------
    python scripts/analyze.py samples/sample-cv.txt
    python scripts/analyze.py path/to/cv.pdf --jd path/to/jd.txt
    python scripts/analyze.py path/to/cv.pdf --jd-text "Senior SRE in Prague"
"""

from __future__ import annotations

import argparse

from _common import (
    BOLD,
    CYAN,
    DIM,
    GRAY,
    GREEN,
    RED,
    RESET,
    YELLOW,
    add_common_args,
    bullets,
    footer,
    format_money,
    get,
    header,
    join_short,
    kv,
    progress_bar,
    render_candidate_summary,
    run_analysis,
    score_color,
    section,
    truncate,
)


def main() -> int:
    parser = argparse.ArgumentParser(description="Run the full CV analysis pipeline and print a terminal-friendly overview.")
    add_common_args(parser)
    args = parser.parse_args()

    payload = run_analysis(args)

    header("Candidate", color=CYAN)
    render_candidate_summary(payload)
    candidate = payload.get("candidate", {})
    kv("Education", candidate.get("educationLevel"))
    kv("Languages", join_short(candidate.get("languages", []), limit=8))
    traits = candidate.get("traits", [])
    if traits:
        kv("Traits", join_short(traits, limit=8))
    skills = candidate.get("skills", [])
    kv("Skills", f"{len(skills)} detected")
    if skills:
        bullets([join_short(skills, limit=20)], prefix=" ", color=DIM)
    footer(color=CYAN)

    score = payload.get("score") or {}
    if score:
        header("Score", color=GREEN)
        total = int(score.get("total", 0))
        print(f"  {progress_bar(total)}  {DIM}overall{RESET}")
        print()
        for label, key in [
            ("Experience", "experience"),
            ("Skills", "skills"),
            ("Role / seniority", "roleSeniority"),
            ("Education", "education"),
            ("Traits", "traits"),
        ]:
            value = int(score.get(key, 0))
            print(f"  {label.ljust(18)} {progress_bar(value)}")
        footer(color=GREEN)

    salary = payload.get("salary") or {}
    if salary:
        header("Salary estimate", color=YELLOW)
        currency = salary.get("currency", "CZK")
        period = salary.get("period", "month")
        kv("Range", f"{format_money(salary.get('minimum'), currency=currency)} – "
                    f"{format_money(salary.get('maximum'), currency=currency)} / {period}")
        kv("Midpoint", f"{format_money(salary.get('midpoint'), currency=currency)} / {period}")
        kv("Confidence", salary.get("confidence", "—"))
        rationale = salary.get("rationale") or []
        if rationale:
            section("Rationale")
            bullets(rationale)
        footer(color=YELLOW)

    company = payload.get("companyContext") or {}
    if company:
        header("Company context", color=CYAN)
        kv("Type", company.get("companyType"))
        kv("Salary effect", company.get("salaryEffect"))
        kv("Multiplier", f"{company.get('adjustmentFactor', 1.0):.2f}×")
        rationale = company.get("rationale") or []
        if rationale:
            section("Why")
            bullets(rationale)
        footer(color=CYAN)

    strengths = payload.get("strengths") or []
    gaps = payload.get("gaps") or []
    if strengths or gaps:
        header("Strengths & gaps", color=GREEN)
        section(f"{GREEN}Strengths{RESET}")
        bullets(strengths, color=GREEN)
        section(f"{RED}Gaps{RESET}")
        bullets(gaps, color=RED)
        footer(color=GREEN)

    recs = payload.get("recommendations") or []
    if recs:
        header("Recommendations", color=YELLOW)
        bullets(recs)
        footer(color=YELLOW)

    explanation = payload.get("explanation")
    if explanation:
        header("Summary", color=CYAN)
        for line in explanation.split("\n"):
            if line.strip():
                print(f"  {line.strip()}")
        footer(color=CYAN)

    job_fit = payload.get("jobFit")
    if job_fit:
        header("Job fit (preview)", color=GREEN)
        score_val = int(job_fit.get("score", 0))
        print(f"  Fit score   {progress_bar(score_val)}")
        kv("Seniority", job_fit.get("seniorityAlignment"))
        kv("Role", job_fit.get("roleAlignment"))
        kv("Salary", job_fit.get("salaryAssessment"))
        summary = truncate(job_fit.get("summary") or "", limit=400)
        if summary:
            section("Summary")
            print(f"  {summary}")
        footer(color=GREEN)

    metadata = payload.get("metadata") or {}
    evidence = metadata.get("deterministicEvidence")
    if evidence:
        header("Deterministic pre-pass", color=GRAY)
        kv("Role family", evidence.get("detectedRoleFamily"))
        kv("Seniority", evidence.get("detectedSeniority"))
        band = evidence.get("anchorBand") or []
        if band:
            kv("Anchor band", " – ".join(format_money(b) for b in band))
        kv("Signals", join_short(evidence.get("detectedSignals", []), limit=10))
        kv("Skills (rule)", join_short(evidence.get("detectedSkills", []), limit=15))
        if evidence.get("detectedCompanyType"):
            kv("Company type", evidence.get("detectedCompanyType"))
        footer(color=GRAY)

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
