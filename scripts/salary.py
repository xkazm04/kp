"""Salary-focused view of the analysis.

Renders the same fields the UI's Salary tab shows: anchor band from the
deterministic pre-pass, Gemini's final range, the company-type multiplier
chain, and (with ``--grounding``) the live market evidence Gemini cites.

Examples
--------
    python scripts/salary.py samples/profile-fixtures/technical-cv.pdf
    python scripts/salary.py path/to/cv.pdf --company-text "Multinational bank in Prague"
    python scripts/salary.py path/to/cv.pdf --grounding
"""

from __future__ import annotations

import argparse

from _common import (
    BOLD,
    CYAN,
    DIM,
    GRAY,
    GREEN,
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
    render_candidate_summary,
    run_analysis,
    section,
)


def main() -> int:
    parser = argparse.ArgumentParser(description="Print just the salary estimate, anchor band, company multiplier, and grounded market evidence.")
    add_common_args(parser)
    args = parser.parse_args()

    payload = run_analysis(args)

    header("Candidate", color=CYAN)
    render_candidate_summary(payload)
    footer(color=CYAN)

    salary = payload.get("salary") or {}
    if salary:
        currency = salary.get("currency", "CZK")
        period = salary.get("period", "month")
        header("Final salary estimate", color=YELLOW)
        low = format_money(salary.get("minimum"), currency=currency)
        high = format_money(salary.get("maximum"), currency=currency)
        mid = format_money(salary.get("midpoint"), currency=currency)
        print(f"  {BOLD}{low}  →  {high}{RESET} / {period}")
        print(f"  {DIM}midpoint{RESET}     {mid} / {period}")
        kv("Confidence", salary.get("confidence"))
        rationale = salary.get("rationale") or []
        if rationale:
            section("Rationale")
            bullets(rationale)
        footer(color=YELLOW)

    evidence = get(payload, "metadata", "deterministicEvidence", default={}) or {}
    if evidence:
        header("Anchor band (rule-based)", color=GRAY)
        kv("Role family", evidence.get("detectedRoleFamily"))
        kv("Seniority", evidence.get("detectedSeniority"))
        band = evidence.get("anchorBand") or []
        if band and len(band) >= 2:
            kv("Band", f"{format_money(band[0])} – {format_money(band[-1])} / month")
        signals = evidence.get("detectedSignals") or []
        if signals:
            kv("Signals", join_short(signals, limit=10))
        footer(color=GRAY)

    company = payload.get("companyContext") or {}
    if company:
        header("Company multiplier", color=CYAN)
        kv("Type", company.get("companyType"))
        kv("Effect", company.get("salaryEffect"))
        factor = company.get("adjustmentFactor")
        if factor is not None:
            kv("Multiplier", f"{factor:.2f}×")
        rationale = company.get("rationale") or []
        if rationale:
            section("Why")
            bullets(rationale)
        footer(color=CYAN)

    market = payload.get("marketEvidence") or {}
    if market:
        header("Market evidence", color=GREEN)
        summary = market.get("summary")
        if summary:
            print(f"  {summary}")
        suggested_min = market.get("suggestedMinimum")
        suggested_max = market.get("suggestedMaximum")
        if suggested_min or suggested_max:
            kv(
                "Suggested band",
                f"{format_money(suggested_min)} – {format_money(suggested_max)} / month",
            )
        kv("Confidence", market.get("confidence"))
        sources = market.get("sources") or []
        if sources:
            section("Sources")
            bullets(sources)
        notes = market.get("notes") or []
        if notes:
            section("Notes")
            bullets(notes)
        footer(color=GREEN)
    elif args.grounding:
        print(f"\n  {DIM}grounding flag set but no market evidence returned.{RESET}")

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
