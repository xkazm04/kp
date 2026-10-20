"""A filtered-out posting names its gate and what it would score (include_blocked).

The seeker feed stores the KO verdict per posting instead of a bare count: match()
returns, ONLY when asked, every job the hard filter removed with its KO keys, the
clauses, and the MatchResult scored as if the gate were lifted. The recruiter path
(/api/match, no flag) must stay byte-identical, and the survivors' ranking must not
move whether the flag is set or not.
"""

from __future__ import annotations

import json
import unittest

from pipeline.jobfit.jobs import normalize_job
from pipeline.jobfit.match_cli import main as match_main
from pipeline.jobfit.matching import MatchCandidate, match
from pipeline.jobfit.tests._helpers import run_cli


def _job(job_id: str, work_mode: str):
    return normalize_job(
        {
            "title": f"Python Developer {job_id}",
            "seniority": "medior",
            "role_family": "software_engineering",
            "languages": ["English"],
            "work_mode": work_mode,
            "description": "Build services.",
            "requirements": [{"skill": "Python", "kind": "must_have", "hardness": "prerequisite"}],
        },
        job_id=job_id,
    )


def _remote_only() -> MatchCandidate:
    return MatchCandidate(skills=["python"], seniority="medior", languages=["English"], preferred_work_modes=["remote"])


def _dump(response) -> str:
    # Exactly the serialization match_cli prints.
    return json.dumps(response.model_dump(by_alias=True, exclude_none=True), ensure_ascii=False)


class IncludeBlockedTest(unittest.TestCase):
    def test_blocked_job_carries_gate_details_and_as_if_result(self):
        response = match(_remote_only(), [_job("j2", "onsite")], include_blocked=True)
        self.assertEqual(response.matches, [])
        self.assertEqual(response.meta["koFiltered"], 1)
        self.assertEqual(len(response.blocked or []), 1)
        blocked = response.blocked[0]
        self.assertEqual(blocked.job_id, "j2")
        self.assertEqual(blocked.ko_keys, ["work_mode"])
        self.assertEqual(blocked.ko_details, ["work mode onsite not preferred"])
        self.assertEqual(blocked.result.job_id, "j2")
        self.assertGreater(blocked.result.total, 0)
        flags = {f.key: f.state for f in blocked.result.eligibility}
        # The KO-mirrored chip can finally light up: the as-if result carries the flag.
        self.assertEqual(flags.get("work_mode"), "flag")

    def test_without_the_flag_the_dump_is_unchanged(self):
        jobs = [_job("j1", "remote"), _job("j2", "onsite")]
        plain = match(_remote_only(), jobs)
        self.assertIsNone(plain.blocked)
        self.assertNotIn('"blocked"', _dump(plain))
        with_flag = match(_remote_only(), jobs, include_blocked=True)
        # The flag adds a key and nothing else: survivors, meta and the candidate block
        # are identical, so the recruiter path is byte-identical without it.
        as_dict = json.loads(_dump(with_flag))
        self.assertIn("blocked", as_dict)
        del as_dict["blocked"]
        self.assertEqual(json.dumps(as_dict, ensure_ascii=False), _dump(plain))

    def test_nothing_blocked_is_an_empty_list_when_asked(self):
        response = match(_remote_only(), [_job("j1", "remote")], include_blocked=True)
        self.assertEqual(response.blocked, [])
        self.assertEqual(len(response.matches), 1)


class MatchCliIncludeBlockedTest(unittest.TestCase):
    def _run(self, *extra: str):
        return run_cli(
            match_main,
            ["--candidate-json", "@cand.json", "--jobs", "@corpus.json", "--jobs-json", "@jobs.json", *extra],
            files={
                "cand.json": _remote_only().model_dump(),
                "corpus.json": [],
                "jobs.json": [_job("j2", "onsite").model_dump(by_alias=True)],
            },
        )

    def test_flag_prints_blocked_in_camel_case(self):
        run = self._run("--include-blocked")
        self.assertEqual(run.code, 0, run.stderr)
        blocked = run.payload["blocked"]
        self.assertEqual(len(blocked), 1)
        self.assertEqual(blocked[0]["jobId"], "j2")
        self.assertEqual(blocked[0]["koKeys"], ["work_mode"])
        self.assertEqual(blocked[0]["koDetails"], ["work mode onsite not preferred"])
        self.assertGreater(blocked[0]["result"]["total"], 0)

    def test_no_flag_no_blocked_key(self):
        run = self._run()
        self.assertEqual(run.code, 0, run.stderr)
        self.assertNotIn("blocked", run.payload)

    def test_preferences_help_no_longer_claims_they_never_reach_the_ko_filter(self):
        import contextlib
        import io

        out = io.StringIO()
        with contextlib.redirect_stdout(out), self.assertRaises(SystemExit):
            match_main(["--help"])
        text = " ".join(out.getvalue().split())
        self.assertNotIn("never the score or the KO filter", text)
        self.assertIn("--include-blocked", text)


if __name__ == "__main__":
    unittest.main()
