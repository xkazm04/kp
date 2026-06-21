"""Backfill calendar approvals so the Schedule tab's interview calendar is
populated for demos.

The seeded pipeline (seed_pipeline.py) only loads into an EMPTY table, and the
demo DB's Interview-stage entries have no `calendar` approval — so the calendar
shows nothing. This idempotent backfill puts a handful of Interview-stage
candidates onto the calendar (approval_kind='calendar' + a proposed slot),
without touching anything already awaiting a slot.

    python -m pipeline.jobfit.seed_interview_calendar [--count N] [--db PATH]

Keyless, deterministic, re-runnable (tops up to N; never duplicates).
"""

from __future__ import annotations

import argparse
import os
import sqlite3
import sys
from datetime import datetime, timezone

# Proposed slots cycled across the backfilled candidates (matches the Schedule
# calendar's business-hours grid).
SLOTS = ["Mon 10:00", "Mon 14:00", "Tue 10:00", "Tue 14:00", "Wed 10:00", "Wed 14:00", "Thu 10:00", "Thu 14:00"]


def main(argv: list[str] | None = None) -> int:
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")
        sys.stderr.reconfigure(encoding="utf-8", errors="replace")

    parser = argparse.ArgumentParser(description="Backfill interview-calendar entries for the demo.")
    parser.add_argument("--count", type=int, default=5, help="target number of candidates on the calendar")
    # Mirror app/_lib/db-path.ts: KP_DB_PATH wins (set it to an absolute path in deploy/
    # cron units), else <cwd>/data/kp.sqlite. Resolve to ABSOLUTE so a different launch
    # cwd can't silently point the Node and Python halves at two different files; the
    # os.path.exists check below then fails loudly on a real mismatch instead of seeding.
    parser.add_argument(
        "--db", default=os.path.abspath(os.environ.get("KP_DB_PATH") or os.path.join("data", "kp.sqlite"))
    )
    args = parser.parse_args(argv)

    if not os.path.exists(args.db):
        print(f"db not found: {args.db}", file=sys.stderr)
        return 1

    con = sqlite3.connect(args.db)
    try:
        existing = con.execute(
            "SELECT COUNT(*) FROM pipeline_entries WHERE approval_kind='calendar' AND status='active'"
        ).fetchone()[0]
        need = max(0, args.count - existing)
        if need == 0:
            print(f"calendar already has {existing} (>= {args.count}); nothing to do", file=sys.stderr)
            return 0

        # Interview-stage candidates not already awaiting any decision/slot.
        rows = con.execute(
            """SELECT id FROM pipeline_entries
               WHERE stage='Interview' AND status='active'
                 AND (approval_kind IS NULL OR approval_kind='')
               ORDER BY match_score DESC LIMIT ?""",
            (need,),
        ).fetchall()

        now = datetime.now(timezone.utc).isoformat()
        updated = 0
        for i, (entry_id,) in enumerate(rows):
            con.execute(
                "UPDATE pipeline_entries SET approval_kind='calendar', approval_detail=?, updated_at=? WHERE id=?",
                (SLOTS[i % len(SLOTS)], now, entry_id),
            )
            updated += 1
        con.commit()
        print(f"backfilled {updated} interview-calendar entries ({existing} -> {existing + updated})", file=sys.stderr)
        if updated < need:
            print(f"note: only {len(rows)} eligible Interview entries available", file=sys.stderr)
        return 0
    finally:
        con.close()


if __name__ == "__main__":
    raise SystemExit(main())
