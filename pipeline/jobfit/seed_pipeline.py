"""Build the hiring-pipeline seed from the candidate population (Phase 10/11).

Deterministic, no LLM. Picks a small set of OPEN POSITIONS from the job corpus,
then routes every synthetic candidate to its best-matching open position via the
real matching engine, assigns a pipeline stage, and flags some entries as needing
a human decision (accept/reject) or an interview-slot approval. Frozen to
``data/seed_pipeline/pipeline.json`` and seeded into the DB.

    python -m pipeline.jobfit.seed_pipeline
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path
from typing import Any

from .jobs import Job
from .matching import ko_filter, load_corpus, score_job
from .profile import CandidateProfileV2
from .transform import build_match_candidate

ROOT = Path(__file__).resolve().parents[2]
CANDIDATES_PATH = ROOT / "data" / "seed_candidates" / "candidates.json"
DEFAULT_OUT = ROOT / "data" / "seed_pipeline" / "pipeline.json"

STAGES = ("Sourced", "AI-matched", "Screening", "Interview", "Offer", "Hired")
# Funnel-shaped spread (more candidates early, fewer at offer/hired), deterministic by index.
FUNNEL = (
    "Sourced", "Sourced", "Sourced",
    "AI-matched", "AI-matched",
    "Screening", "Screening",
    "Interview", "Interview",
    "Offer", "Hired",
)
SLOTS = ("Tue 14:00", "Wed 10:30", "Thu 09:00", "Mon 15:30", "Fri 11:00")


def select_open_positions(jobs: list[Job], *, max_n: int = 15, entry_cap: int = 3, senior_cap: int = 2) -> list[Job]:
    """A curated, VARIED set of reqs: up to ``entry_cap`` entry-eligible + ``senior_cap``
    senior per family. More reqs per family so similar candidates don't all funnel to a
    single position (the old 1-senior-per-family cap put every senior on one req)."""
    entry_per_fam: dict[str, int] = {}
    senior_per_fam: dict[str, int] = {}
    chosen: list[Job] = []
    for job in jobs:
        fam = job.role_family
        entry_ok = bool(job.entry_profile and job.entry_profile.is_entry_eligible)
        if entry_ok and entry_per_fam.get(fam, 0) < entry_cap:
            chosen.append(job)
            entry_per_fam[fam] = entry_per_fam.get(fam, 0) + 1
        elif not entry_ok and senior_per_fam.get(fam, 0) < senior_cap:
            chosen.append(job)
            senior_per_fam[fam] = senior_per_fam.get(fam, 0) + 1
        if len(chosen) >= max_n:
            break
    return chosen[:max_n]


def build_pipeline(
    candidate_records: list[dict[str, Any]], jobs: list[Job]
) -> tuple[list[dict[str, Any]], list[str]]:
    """Route every candidate to its best-matching open req and assign a stage.

    Per-record processing is guarded: a single malformed or old-schema row in
    ``candidates.json`` is skipped and reported instead of aborting the whole
    seed with a traceback that writes no output (mirroring
    :func:`runner._load_fixtures`'s collect-errors-and-continue convention).
    Returns ``(entries, skipped)`` where ``skipped`` is a list of
    human-readable per-record errors for ``main`` to surface.

    The enumerate index drives stage/approval spread and entry ids, so it is
    kept stable across skips: a surviving record keeps the same stage whether or
    not an earlier row was malformed (skipped rows simply leave a gap).
    """
    open_positions = select_open_positions(jobs)
    if not open_positions:
        return [], []
    entries: list[dict[str, Any]] = []
    skipped: list[str] = []
    for i, rec in enumerate(candidate_records):
        ident = rec.get("id", f"index {i}") if isinstance(rec, dict) else f"index {i}"
        # The ENTIRE per-record body is guarded: a crash while validating,
        # transforming, or scoring one candidate records that row as skipped
        # instead of aborting the seed before later candidates are processed.
        try:
            profile = CandidateProfileV2.model_validate(rec)
            candidate = build_match_candidate(profile)

            scored = []
            for job in open_positions:
                passed, _reasons = ko_filter(candidate, job)
                result = score_job(candidate, job)
                scored.append((passed, result.total, job, result))
            # prefer KO-passing, then highest score
            scored.sort(key=lambda x: (x[0], x[1]), reverse=True)
            # Spread across NEAR-EQUAL best matches (same KO status, within 6 pts) by
            # candidate index, so 13 similar seniors don't all land on the one top req —
            # the match stays honest (within 6 pts of their best), just less clustered.
            best_pass, best_total = scored[0][0], scored[0][1]
            near = [s for s in scored if s[0] == best_pass and best_total - s[1] <= 6]
            passed, _total, job, result = near[i % len(near)]

            stage = FUNNEL[i % len(FUNNEL)]
            if not passed:
                stage = "Sourced"  # not eligible for any open req yet

            entry: dict[str, Any] = {
                "id": f"pe-{i:03d}",
                "candidateId": rec.get("id", f"cand-{i:03d}"),
                "candidateLabel": profile.display_name or rec.get("id", "Candidate"),
                "archetype": profile.archetype,
                "roleFamily": profile.role_family,
                "jobId": job.id,
                "jobTitle": job.title,
                "stage": stage,
                "matchScore": result.total,
                "status": "active",
                "approvalKind": None,
                "approvalDetail": "",
            }
            if stage != "Hired":
                if i % 6 == 0:
                    entry["approvalKind"] = "decision"
                elif i % 9 == 0:
                    entry["approvalKind"] = "calendar"
                    entry["approvalDetail"] = SLOTS[i % len(SLOTS)]
            entries.append(entry)
        except Exception as exc:  # validation / schema / scoring — skip, don't abort
            skipped.append(f"candidate {ident}: {type(exc).__name__}: {exc}")
            continue
    return entries, skipped


def main(argv: list[str] | None = None) -> int:
    # Skip messages can carry non-ASCII (em-dash separators, pydantic error
    # text echoing a Czech name) — keep them printable on a legacy-codepage
    # Windows console instead of raising UnicodeEncodeError (mirrors runner.main).
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")
        sys.stderr.reconfigure(encoding="utf-8", errors="replace")

    parser = argparse.ArgumentParser(description="Build the hiring-pipeline seed.")
    parser.add_argument("--candidates", type=Path, default=CANDIDATES_PATH)
    parser.add_argument("--jobs", type=Path, default=None)
    parser.add_argument("--out", type=Path, default=DEFAULT_OUT)
    args = parser.parse_args(argv)

    if not args.candidates.exists():
        print(f"No candidate seed at {args.candidates} — run seed_candidates first.", file=sys.stderr)
        return 1
    records = json.loads(args.candidates.read_text(encoding="utf-8"))
    jobs = load_corpus(args.jobs)
    entries, skipped = build_pipeline(records, jobs)

    # Report (don't raise on) any malformed/old-schema rows: the seed still
    # writes the records it could process so one bad row can't take down the
    # whole regeneration.
    for err in skipped:
        print(f"seed_pipeline: skipped malformed candidate — {err}", file=sys.stderr)

    args.out.parent.mkdir(parents=True, exist_ok=True)
    args.out.write_text(json.dumps(entries, ensure_ascii=False, indent=2), encoding="utf-8")

    from collections import Counter

    positions = {(e["jobId"], e["jobTitle"]) for e in entries}
    print(f"Wrote {len(entries)} pipeline entries across {len(positions)} open positions -> {args.out.name}", file=sys.stderr)
    print(f"stages: {dict(Counter(e['stage'] for e in entries))}", file=sys.stderr)
    print(f"awaiting approval: {sum(1 for e in entries if e['approvalKind'])}", file=sys.stderr)
    if skipped:
        print(f"skipped {len(skipped)} malformed candidate record(s)", file=sys.stderr)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
