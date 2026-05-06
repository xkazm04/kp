"""Side-by-side comparison of multiple CV variants.

Mirrors the UI's Compare tab. Runs the pipeline once per CV against a
shared (optional) job description and prints a compact comparison
table: score breakdown, salary midpoint, fit score, top matching and
missing skills.

Examples
--------
    python scripts/compare.py cv-a.pdf cv-b.pdf --jd path/to/jd.txt
    python scripts/compare.py cv-a.pdf cv-b.pdf cv-c.pdf --jd-text "..."
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path
from types import SimpleNamespace

from _common import (
    BOLD,
    CYAN,
    DIM,
    GRAY,
    GREEN,
    RED,
    RESET,
    YELLOW,
    bullets,
    footer,
    format_money,
    get,
    header,
    join_short,
    progress_bar,
    run_analysis,
    score_color,
    section,
)


def _cell(text: str, width: int) -> str:
    if len(text) > width:
        return text[: width - 1] + "…"
    return text.ljust(width)


def _row(label: str, values: list[str], *, label_width: int = 20, col_width: int = 22) -> str:
    parts = [f"{DIM}{label.ljust(label_width)}{RESET}"]
    for v in values:
        parts.append(_cell(v, col_width))
    return "  ".join(parts)


def main() -> int:
    parser = argparse.ArgumentParser(description="Score 2-N CV variants against the same job description and print a comparison table.")
    parser.add_argument("cvs", type=Path, nargs="+", help="Two or more CV / profile files.")
    parser.add_argument("--jd", type=Path, help="Path to a job description file (shared across all CVs).")
    parser.add_argument("--jd-text", help="Inline job description text.")
    parser.add_argument("--company", type=Path, help="Path to a company-overview file.")
    parser.add_argument("--company-text", help="Inline company-overview text.")
    parser.add_argument("--grounding", action="store_true", help="Enable Google Search grounding.")
    parser.add_argument("--quiet", action="store_true", help="Suppress per-CV progress logging.")
    args = parser.parse_args()

    if len(args.cvs) < 2:
        print("error: provide at least two CVs to compare", file=sys.stderr)
        return 2

    results: list[tuple[Path, dict]] = []
    for cv in args.cvs:
        if not args.quiet:
            print(f"\n{CYAN}━━━ {cv.name} ━━━{RESET}", file=sys.stderr)
        per = SimpleNamespace(
            cv=cv,
            jd=args.jd,
            jd_text=args.jd_text,
            company=args.company,
            company_text=args.company_text,
            grounding=args.grounding,
            quiet=args.quiet,
        )
        results.append((cv, run_analysis(per)))

    header("Comparison", color=CYAN)

    names = []
    for cv, payload in results:
        candidate_name = get(payload, "candidate", "name") or cv.stem
        names.append(candidate_name)

    label_width = 20
    col_width = max(20, min(28, max(len(n) for n in names) + 2))

    print(_row("", [_cell(BOLD + n + RESET, col_width + len(BOLD) + len(RESET)) for n in names], label_width=label_width, col_width=col_width))
    print(f"  {GRAY}{'─' * (label_width + (col_width + 2) * len(names))}{RESET}")

    def cell_for(payload: dict, *path: str, fmt=lambda x: str(x)) -> str:
        value = get(payload, *path)
        if value is None:
            return f"{DIM}—{RESET}"
        return fmt(value)

    print(_row("Role family", [cell_for(p, "candidate", "roleFamily") for _, p in results], label_width=label_width, col_width=col_width))
    print(_row("Seniority", [cell_for(p, "candidate", "currentSeniority") for _, p in results], label_width=label_width, col_width=col_width))
    print(_row("Experience", [cell_for(p, "candidate", "yearsExperience", fmt=lambda y: f"{y:g} yrs") for _, p in results], label_width=label_width, col_width=col_width))
    print(_row("Skills (count)", [str(len(get(p, "candidate", "skills", default=[]) or [])) for _, p in results], label_width=label_width, col_width=col_width))

    print()
    for label, *path in [
        ("Score (total)", "score", "total"),
        ("  experience", "score", "experience"),
        ("  skills", "score", "skills"),
        ("  role/seniority", "score", "roleSeniority"),
        ("  education", "score", "education"),
        ("  traits", "score", "traits"),
    ]:
        cells = []
        for _, p in results:
            value = get(p, *path)
            if value is None:
                cells.append(f"{DIM}—{RESET}")
            else:
                color = score_color(int(value))
                cells.append(f"{color}{int(value):>3}{RESET}/100")
        print(_row(label, cells, label_width=label_width, col_width=col_width))

    print()
    salary_cells = []
    for _, p in results:
        salary = p.get("salary") or {}
        currency = salary.get("currency", "CZK")
        if salary.get("minimum") and salary.get("maximum"):
            salary_cells.append(
                f"{format_money(salary['minimum'], currency=currency)}–{format_money(salary['maximum'], currency=currency)}"
            )
        else:
            salary_cells.append(f"{DIM}—{RESET}")
    print(_row("Salary range", salary_cells, label_width=label_width, col_width=col_width))
    print(_row(
        "Salary midpoint",
        [cell_for(p, "salary", "midpoint", fmt=lambda v: format_money(v)) for _, p in results],
        label_width=label_width,
        col_width=col_width,
    ))
    print(_row(
        "Confidence",
        [cell_for(p, "salary", "confidence") for _, p in results],
        label_width=label_width,
        col_width=col_width,
    ))

    if any(p.get("jobFit") for _, p in results):
        print()
        fit_cells = []
        for _, p in results:
            value = get(p, "jobFit", "score")
            if value is None:
                fit_cells.append(f"{DIM}—{RESET}")
            else:
                color = score_color(int(value))
                fit_cells.append(f"{color}{int(value):>3}{RESET}/100")
        print(_row("Job-fit score", fit_cells, label_width=label_width, col_width=col_width))
        print(_row(
            "Seniority align.",
            [cell_for(p, "jobFit", "seniorityAlignment") for _, p in results],
            label_width=label_width,
            col_width=col_width,
        ))
        print(_row(
            "Role align.",
            [cell_for(p, "jobFit", "roleAlignment") for _, p in results],
            label_width=label_width,
            col_width=col_width,
        ))

    footer(color=CYAN)

    for (cv, payload), name in zip(results, names):
        header(name, color=GREEN)
        print(f"  {DIM}{cv}{RESET}")
        score = int(get(payload, "score", "total", default=0))
        print(f"  Overall   {progress_bar(score)}")
        salary = payload.get("salary") or {}
        if salary.get("midpoint"):
            print(
                f"  Midpoint  {format_money(salary['midpoint'], currency=salary.get('currency', 'CZK'))} / {salary.get('period', 'month')}"
            )
        fit = payload.get("jobFit") or {}
        if fit:
            print(f"  Job-fit   {progress_bar(int(fit.get('score', 0)))}")
            matching = fit.get("matchingSkills") or []
            missing = fit.get("missingSkills") or []
            section(f"{GREEN}Matching{RESET}")
            print(f"  {join_short(matching, limit=12)}")
            section(f"{RED}Missing{RESET}")
            print(f"  {join_short(missing, limit=12)}")
        else:
            strengths = payload.get("strengths") or []
            if strengths:
                section("Strengths")
                bullets(strengths[:5], color=GREEN)
        footer(color=GREEN)

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
