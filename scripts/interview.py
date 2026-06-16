"""Interview preparation kit.

Mirrors the UI's Interview tab: question pack grouped by bucket, each
with the evidence gap it probes and a STAR scaffold the candidate can
fill in before the interview.

Examples
--------
    python scripts/interview.py path/to/cv.pdf --jd path/to/jd.txt
    python scripts/interview.py path/to/cv.pdf --jd-text "Senior Python role"
    python scripts/interview.py path/to/cv.pdf --bucket behavioral
"""

from __future__ import annotations

import argparse
from collections import defaultdict

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
    header,
    kv,
    render_candidate_summary,
    run_analysis,
    section,
)


def main() -> int:
    parser = argparse.ArgumentParser(description="Print the interview question pack and STAR scaffolds derived from gaps.")
    add_common_args(parser)
    parser.add_argument("--bucket", help="Only print questions for this bucket (behavioral, technical, red-flag-defense).")
    parser.add_argument(
        "--no-star",
        action="store_true",
        help="Suppress STAR scaffolds — print only questions and evidence gaps.",
    )
    args = parser.parse_args()

    payload = run_analysis(args)

    kit = payload.get("interviewKit")
    if not kit:
        print("error: pipeline did not return an interview kit")
        return 1

    header("Candidate", color=CYAN)
    render_candidate_summary(payload)
    footer(color=CYAN)

    if kit.get("summary"):
        header("Interview summary", color=CYAN)
        print(f"  {kit['summary']}")
        footer(color=CYAN)

    questions = kit.get("questions") or []
    if not questions:
        print(f"  {DIM}(no questions generated){RESET}")
        return 0

    grouped: dict[str, list[dict]] = defaultdict(list)
    for q in questions:
        grouped[q.get("bucket") or "general"].append(q)

    bucket_filter = (args.bucket or "").strip().lower() or None

    for bucket, items in grouped.items():
        if bucket_filter and bucket.lower() != bucket_filter:
            continue
        header(f"{bucket.upper()}  ({len(items)})", color=YELLOW)
        for idx, q in enumerate(items, start=1):
            print(f"  {BOLD}Q{idx}.{RESET} {q.get('question', '').strip()}")
            gap = q.get("evidenceGap")
            if gap:
                print(f"     {DIM}gap:{RESET} {GRAY}{gap}{RESET}")
            star = q.get("starScaffold") or {}
            if star and not args.no_star and any(star.get(k) for k in ("situation", "task", "action", "result")):
                for label, key in [
                    ("S", "situation"),
                    ("T", "task"),
                    ("A", "action"),
                    ("R", "result"),
                ]:
                    value = (star.get(key) or "").strip()
                    if value:
                        print(f"     {GREEN}{label}{RESET}  {value}")
            print()
        footer(color=YELLOW)

    if bucket_filter and not any(b.lower() == bucket_filter for b in grouped):
        available = ", ".join(sorted(grouped))
        print(f"\n{DIM}No questions in bucket '{bucket_filter}'. Available: {available}{RESET}")

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
