"""The demo funnel's SHAPE is a product decision, and until now nothing pinned it.

``seed_pipeline.build_pipeline`` decides what every visitor sees on the pipeline
board: how candidates spread across the funnel, which open req each one lands on,
and whether one malformed row in a regenerated corpus takes the whole seed down.
All three have been regressed by edits to this module before (every senior on one
req; a traceback that wrote no output). They are pinned here.

Matching itself is stubbed: these are the seeder's OWN decisions, and running the
real scorer over the real corpus would test matching.py instead (which has its own
suites) while making this one slow and coupled to score drift.
"""

from __future__ import annotations

import json
import unittest
from collections import Counter
from pathlib import Path
from unittest import mock

from pipeline.jobfit import seed_pipeline
from pipeline.jobfit.seed_pipeline import FUNNEL, build_pipeline, select_open_positions

CANDIDATES = Path(__file__).resolve().parents[3] / "data" / "seed_candidates" / "candidates.json"


class StubEntryProfile:
    def __init__(self, entry: bool) -> None:
        self.is_entry_eligible = entry


class StubJob:
    """Only the attributes select_open_positions / build_pipeline read."""

    def __init__(self, jid: str, family: str, *, entry: bool) -> None:
        self.id = jid
        self.title = f"{family} #{jid}"
        self.role_family = family
        self.entry_profile = StubEntryProfile(entry)


class StubResult:
    def __init__(self, total: int) -> None:
        self.total = total


MALFORMED = {"id": "cand-bad", "skillClaims": "not a list"}


def _real_records(n: int) -> list[dict]:
    """Real seeded candidates — the shapes CandidateProfileV2 must actually accept."""
    return json.loads(CANDIDATES.read_text(encoding="utf-8"))[:n]


def _jobs(n: int = 4, family: str = "software_engineering") -> list[StubJob]:
    return [StubJob(f"job-{i}", family, entry=False) for i in range(n)]


class SelectOpenPositionsTest(unittest.TestCase):
    def test_caps_are_per_family_not_global(self) -> None:
        jobs = [StubJob(f"e{i}", "software_engineering", entry=True) for i in range(5)]
        jobs += [StubJob(f"s{i}", "software_engineering", entry=False) for i in range(5)]
        jobs += [StubJob(f"d{i}", "data", entry=False) for i in range(5)]
        chosen = select_open_positions(jobs, entry_cap=3, senior_cap=2)
        by_family = Counter((j.role_family, j.entry_profile.is_entry_eligible) for j in chosen)
        self.assertEqual(by_family[("software_engineering", True)], 3)
        self.assertEqual(by_family[("software_engineering", False)], 2)
        self.assertEqual(by_family[("data", False)], 2)

    def test_max_n_bounds_the_set(self) -> None:
        jobs = [StubJob(f"j{i}", f"fam{i}", entry=False) for i in range(30)]
        self.assertEqual(len(select_open_positions(jobs, max_n=6)), 6)

    def test_no_open_positions_yields_no_entries(self) -> None:
        entries, skipped = build_pipeline(_real_records(3), [])
        self.assertEqual(entries, [])
        self.assertEqual(skipped, [])


class FunnelSpreadTest(unittest.TestCase):
    """More candidates early, fewer at offer/hired — and the spread is by index, so
    a regenerated corpus of the same size produces the same board."""

    def _entries(self, n: int, *, passed: bool = True) -> list[dict]:
        with mock.patch.object(seed_pipeline, "ko_filter", return_value=(passed, [])), mock.patch.object(
            seed_pipeline, "score_job", side_effect=lambda cand, job, **kw: StubResult(80)
        ):
            entries, skipped = build_pipeline(_real_records(n), _jobs())
        self.assertEqual(skipped, [])
        return entries

    def test_stage_follows_the_declared_funnel_by_index(self) -> None:
        entries = self._entries(len(FUNNEL))
        self.assertEqual([e["stage"] for e in entries], list(FUNNEL))

    def test_funnel_narrows_toward_hired(self) -> None:
        counts = Counter(e["stage"] for e in self._entries(len(FUNNEL) * 3))
        self.assertGreater(counts["Accepted"], counts["Interview"])
        self.assertGreater(counts["Interview"], counts["Offer"])
        self.assertGreaterEqual(counts["Offer"], counts["Hired"])

    def test_ko_failures_are_parked_at_accepted(self) -> None:
        """A candidate eligible for no open req is not "Interviewing" — the board
        would be lying about where the recruiter's attention is owed."""
        stages = {e["stage"] for e in self._entries(len(FUNNEL), passed=False)}
        self.assertEqual(stages, {"Accepted"})

    def test_hired_entries_never_await_a_decision_or_a_slot(self) -> None:
        for entry in self._entries(len(FUNNEL) * 2):
            if entry["stage"] == "Hired":
                self.assertIsNone(entry["approvalKind"])

    def test_some_entries_await_a_decision_and_some_a_slot(self) -> None:
        kinds = Counter(e["approvalKind"] for e in self._entries(len(FUNNEL) * 3))
        self.assertGreater(kinds["decision"], 0)
        self.assertGreater(kinds["calendar"], 0)
        for entry in self._entries(len(FUNNEL) * 3):
            if entry["approvalKind"] == "calendar":
                self.assertTrue(entry["approvalDetail"], "a calendar approval must carry a proposed slot")


class NearTieDeclusteringTest(unittest.TestCase):
    """13 similar seniors all landing on the ONE top req was the bug: the match was
    honest but the board was useless. Near-equal reqs (same KO status, within 6
    points) are spread by candidate index — and a req that is NOT near-equal is
    still never chosen, so the spread cannot buy variety with a worse match."""

    def _entries(self, scores: dict[str, int], n: int = 6) -> list[dict]:
        with mock.patch.object(seed_pipeline, "ko_filter", return_value=(True, [])), mock.patch.object(
            seed_pipeline, "score_job", side_effect=lambda cand, job, **kw: StubResult(scores[job.id])
        ):
            entries, _ = build_pipeline(_real_records(n), _jobs())
        return entries

    def test_near_equal_reqs_are_spread_across_candidates(self) -> None:
        entries = self._entries({"job-0": 80, "job-1": 78, "job-2": 75, "job-3": 40})
        self.assertGreater(len({e["jobId"] for e in entries}), 1)

    def test_a_far_worse_req_is_never_chosen(self) -> None:
        entries = self._entries({"job-0": 80, "job-1": 78, "job-2": 75, "job-3": 40})
        self.assertNotIn("job-3", {e["jobId"] for e in entries})
        for entry in entries:
            self.assertGreaterEqual(entry["matchScore"], 74)  # within 6 of the best

    def test_one_clear_winner_is_not_diluted(self) -> None:
        entries = self._entries({"job-0": 90, "job-1": 40, "job-2": 30, "job-3": 20})
        self.assertEqual({e["jobId"] for e in entries}, {"job-0"})


class SkipAndContinueTest(unittest.TestCase):
    """One malformed row in a regenerated corpus must cost that row, not the seed."""

    def _run(self, records: list) -> tuple[list[dict], list[str]]:
        with mock.patch.object(seed_pipeline, "ko_filter", return_value=(True, [])), mock.patch.object(
            seed_pipeline, "score_job", side_effect=lambda cand, job, **kw: StubResult(80)
        ):
            return build_pipeline(records, _jobs())

    def test_a_malformed_record_is_reported_and_the_rest_survive(self) -> None:
        good = _real_records(3)
        entries, skipped = self._run([good[0], MALFORMED, good[1], good[2]])
        self.assertEqual(len(entries), 3)
        self.assertEqual(len(skipped), 1)
        self.assertIn("cand-bad", skipped[0])

    def test_a_non_dict_row_names_its_index(self) -> None:
        entries, skipped = self._run([_real_records(1)[0], "not a candidate"])
        self.assertEqual(len(entries), 1)
        self.assertIn("index 1", skipped[0])

    def test_the_enumerate_index_is_stable_across_a_skip(self) -> None:
        """A surviving record keeps the stage it would have had anyway — a skipped
        row leaves a gap rather than shifting everyone's stage by one."""
        good = _real_records(4)
        clean, _ = self._run(good)
        with_gap, _ = self._run([good[0], MALFORMED, good[2], good[3]])
        self.assertEqual([e["stage"] for e in with_gap], [clean[0]["stage"], clean[2]["stage"], clean[3]["stage"]])
        self.assertEqual([e["id"] for e in with_gap], ["pe-000", "pe-002", "pe-003"])


if __name__ == "__main__":
    unittest.main()
