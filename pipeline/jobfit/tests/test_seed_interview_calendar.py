"""The interview-calendar backfill is a ONE-SHOT seeder, and must record that it ran.

Why this suite exists: the backfill was the last seeder in the tree still gated on a
row count (``SELECT COUNT(*) ... approval_kind='calendar'``). A row count cannot tell
"never seeded" from "seeded, and the operator has since cleared the calendar" — so a
recruiter who deliberately purged the demo's calendar approvals got them injected back
on the next run of the seeder. That is exactly the failure `seed_marks` was introduced
for on the TypeScript side (app/_lib/db/seed-marks.ts); this seeder writes the SAME
table with the same row shape.
"""

from __future__ import annotations

import sqlite3
import tempfile
import unittest
from pathlib import Path

from pipeline.jobfit import seed_interview_calendar as seeder

# Only the columns the backfill reads or writes — the real table is far wider, and a
# narrow fixture keeps this test from re-encoding core.ts's schema.
PIPELINE_DDL = """
CREATE TABLE pipeline_entries (
  id TEXT PRIMARY KEY,
  stage TEXT NOT NULL,
  status TEXT NOT NULL,
  match_score INTEGER,
  approval_kind TEXT,
  approval_detail TEXT,
  updated_at TEXT
);
"""


def _fixture_db(path: Path, *, entries: int = 8, with_marks_table: bool = True) -> None:
    con = sqlite3.connect(str(path))
    try:
        con.execute(PIPELINE_DDL)
        if with_marks_table:
            con.execute("CREATE TABLE seed_marks (name TEXT PRIMARY KEY, applied_at TEXT NOT NULL)")
        for i in range(entries):
            con.execute(
                "INSERT INTO pipeline_entries (id, stage, status, match_score, approval_kind, approval_detail)"
                " VALUES (?, 'Interview', 'active', ?, NULL, '')",
                (f"pe-{i:03d}", 90 - i),
            )
        con.commit()
    finally:
        con.close()


def _calendar_count(path: Path) -> int:
    con = sqlite3.connect(str(path))
    try:
        return con.execute(
            "SELECT COUNT(*) FROM pipeline_entries WHERE approval_kind='calendar' AND status='active'"
        ).fetchone()[0]
    finally:
        con.close()


def _marks(path: Path) -> list[str]:
    con = sqlite3.connect(str(path))
    try:
        return [r[0] for r in con.execute("SELECT name FROM seed_marks").fetchall()]
    finally:
        con.close()


def _purge_calendar(path: Path) -> None:
    con = sqlite3.connect(str(path))
    try:
        con.execute("UPDATE pipeline_entries SET approval_kind=NULL, approval_detail=''")
        con.commit()
    finally:
        con.close()


class CalendarBackfillMarkTest(unittest.TestCase):
    def setUp(self) -> None:
        self._tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self._tmp.cleanup)
        self.db = Path(self._tmp.name) / "kp.sqlite"

    def test_first_run_backfills_and_records_the_mark(self) -> None:
        _fixture_db(self.db)
        self.assertEqual(seeder.main(["--db", str(self.db), "--count", "3"]), 0)
        self.assertEqual(_calendar_count(self.db), 3)
        self.assertIn(seeder.SEED_MARK, _marks(self.db))

    def test_a_purged_calendar_is_not_refilled(self) -> None:
        """THE regression: the operator clears the demo calendar, the seeder runs
        again (cron, boot script, `npm run seed`) — and the rows must stay gone."""
        _fixture_db(self.db)
        seeder.main(["--db", str(self.db), "--count", "3"])
        _purge_calendar(self.db)
        self.assertEqual(seeder.main(["--db", str(self.db), "--count", "3"]), 0)
        self.assertEqual(_calendar_count(self.db), 0)

    def test_force_reseeds_a_purged_calendar(self) -> None:
        """The deliberate escape hatch — a demo operator rebuilding the fixture."""
        _fixture_db(self.db)
        seeder.main(["--db", str(self.db), "--count", "3"])
        _purge_calendar(self.db)
        self.assertEqual(seeder.main(["--db", str(self.db), "--count", "3", "--force"]), 0)
        self.assertEqual(_calendar_count(self.db), 3)

    def test_a_db_seeded_before_the_mark_existed_adopts_instead_of_topping_up(self) -> None:
        """Back-compat, mirroring adoptedExistingSeed: an already-populated calendar
        stamps the mark and stops, so this boot's judgment matches the count gate it
        replaces (no surprise top-up on an upgrade)."""
        _fixture_db(self.db)
        con = sqlite3.connect(str(self.db))
        try:
            con.execute("UPDATE pipeline_entries SET approval_kind='calendar' WHERE id IN ('pe-000','pe-001','pe-002')")
            con.commit()
        finally:
            con.close()
        self.assertEqual(seeder.main(["--db", str(self.db), "--count", "5"]), 0)
        self.assertEqual(_calendar_count(self.db), 3)  # NOT topped up to 5
        self.assertIn(seeder.SEED_MARK, _marks(self.db))

    def test_missing_seed_marks_table_is_created(self) -> None:
        """The Python seeder can run against a DB the Node migrator has not opened
        yet (a cron unit ordering, a restored file) — it owns the same DDL."""
        _fixture_db(self.db, with_marks_table=False)
        self.assertEqual(seeder.main(["--db", str(self.db), "--count", "2"]), 0)
        self.assertIn(seeder.SEED_MARK, _marks(self.db))

    def test_missing_db_is_a_loud_failure(self) -> None:
        self.assertEqual(seeder.main(["--db", str(self.db / "nope.sqlite")]), 1)


if __name__ == "__main__":
    unittest.main()
