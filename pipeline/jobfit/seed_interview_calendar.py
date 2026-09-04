"""Backfill calendar approvals so the Schedule tab's interview calendar is
populated for demos.

The seeded pipeline (seed_pipeline.py) only loads into an EMPTY table, and the
demo DB's Interview-stage entries have no `calendar` approval — so the calendar
shows nothing. This idempotent backfill puts a handful of Interview-stage
candidates onto the calendar (approval_kind='calendar' + a proposed slot),
without touching anything already awaiting a slot.

    python -m pipeline.jobfit.seed_interview_calendar [--count N] [--db PATH]

Keyless, deterministic, and ONE-SHOT: whether it has run is recorded in the same
`seed_marks` table the TypeScript loaders use (app/_lib/db/seed-marks.ts), never
inferred from a row count. A count cannot tell "never seeded" from "seeded, and
the operator has since cleared the calendar" — and this seeder used to read the
second as the first, injecting demo approvals back into a calendar somebody had
deliberately purged. `--force` is the deliberate escape hatch for rebuilding the
demo fixture.
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

# The seed_marks key for this backfill. Namespaced so it cannot collide with a TS
# seeder's plain name ("jobs", "candidates", …) in the shared table.
SEED_MARK = "python:interview-calendar"


def _ensure_seed_marks(con: sqlite3.Connection) -> None:
    """Same DDL as core.ts's migrator. Owned here too because this seeder can run
    against a database the Node side has not opened yet (a cron unit that starts
    before the app, a restored file) — creating it is idempotent and never
    diverges: name is the primary key, applied_at an ISO string."""
    con.execute("CREATE TABLE IF NOT EXISTS seed_marks (name TEXT PRIMARY KEY, applied_at TEXT NOT NULL)")


def seed_already_ran(con: sqlite3.Connection, name: str = SEED_MARK) -> bool:
    return con.execute("SELECT 1 FROM seed_marks WHERE name = ?", (name,)).fetchone() is not None


def mark_seed_ran(con: sqlite3.Connection, name: str = SEED_MARK) -> None:
    """INSERT OR IGNORE, like markSeedRan: bookkeeping must never turn a double
    run into a failure."""
    con.execute(
        "INSERT OR IGNORE INTO seed_marks (name, applied_at) VALUES (?, ?)",
        (name, datetime.now(timezone.utc).isoformat()),
    )


def main(argv: list[str] | None = None) -> int:
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")
        sys.stderr.reconfigure(encoding="utf-8", errors="replace")

    parser = argparse.ArgumentParser(description="Backfill interview-calendar entries for the demo.")
    parser.add_argument("--count", type=int, default=5, help="target number of candidates on the calendar")
    parser.add_argument(
        "--force",
        action="store_true",
        help="re-run even though the seed mark is recorded (rebuilding the demo fixture)",
    )
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
        _ensure_seed_marks(con)
        if not args.force and seed_already_ran(con):
            print("interview-calendar seed already recorded in seed_marks; nothing to do", file=sys.stderr)
            return 0

        existing = con.execute(
            "SELECT COUNT(*) FROM pipeline_entries WHERE approval_kind='calendar' AND status='active'"
        ).fetchone()[0]
        # Back-compat adoption (adoptedExistingSeed): a database seeded before the mark
        # existed already carries calendar approvals. Stamp the mark and stop rather than
        # topping up — the count is consulted exactly once, on the upgrade boot, and never
        # again. `--force` is the way to rebuild a fixture deliberately.
        if not args.force and existing > 0:
            mark_seed_ran(con)
            con.commit()
            print(f"calendar already has {existing} entr(ies); adopted as seeded, nothing to do", file=sys.stderr)
            return 0
        need = max(0, args.count - existing)
        if need == 0:
            mark_seed_ran(con)
            con.commit()
            print(f"calendar already has {existing} (>= {args.count}); mark recorded, nothing to do", file=sys.stderr)
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
        # The mark records that THIS SEEDER RAN — not that it filled every slot. A run
        # that found only two eligible Interview entries has still run; re-running it
        # later against a corpus that grew is a `--force` decision, not an automatic
        # top-up (which is how a purged calendar used to refill itself).
        mark_seed_ran(con)
        con.commit()
        print(f"backfilled {updated} interview-calendar entries ({existing} -> {existing + updated})", file=sys.stderr)
        if updated < need:
            print(f"note: only {len(rows)} eligible Interview entries available", file=sys.stderr)
        return 0
    finally:
        con.close()


if __name__ == "__main__":
    raise SystemExit(main())
