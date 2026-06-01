"""CLI-level tests for recruiter_cli: one malformed candidate must not abort the
whole ranking (per-entry skip-and-note), mirroring matrix_cli's row-level isolation.
"""

from __future__ import annotations

import contextlib
import io
import json
import tempfile
import unittest
from pathlib import Path

from pipeline.jobfit.jobs import normalize_job
from pipeline.jobfit.matching import MatchCandidate
from pipeline.jobfit.recruiter_cli import main

JOB = normalize_job(
    {
        "title": "Python Engineer",
        "seniority": "medior",
        "role_family": "software_engineering",
        "languages": ["English"],
        "description": "Build things.",
        "requirements": [{"skill": "Python", "kind": "must_have", "hardness": "learnable"}],
    }
)

GOOD = MatchCandidate(
    skills=["Python"],
    seniority="medior",
    role_family="software_engineering",
    languages=["English"],
    archetype="bau",
    label="Good Candidate",
)


def _run(input_obj: dict) -> dict:
    with tempfile.TemporaryDirectory() as tmp:
        job_path = Path(tmp) / "job.json"
        job_path.write_text(json.dumps(JOB.model_dump(mode="json")), encoding="utf-8")
        input_path = Path(tmp) / "input.json"
        input_path.write_text(json.dumps(input_obj), encoding="utf-8")

        out = io.StringIO()
        with contextlib.redirect_stdout(out):
            code = main(["--input-json", str(input_path), "--job-json", str(job_path)])
        return {"code": code, "payload": json.loads(out.getvalue() or "{}")}


class RecruiterCliIsolationTest(unittest.TestCase):
    def test_malformed_entry_does_not_abort_ranking(self) -> None:
        # A partially-extracted profile (SkillClaim.skill missing) sits between two
        # valid candidates. The bad one is skipped-and-noted; the rest still rank.
        result = _run(
            {
                "jobId": JOB.id,
                "candidates": [
                    {"id": "good-1", "candidate": GOOD.model_dump()},
                    {"id": "bad-1", "label": "Half-parsed CV", "profile": {"skillClaims": [{"level": "working"}]}},
                ],
            }
        )
        self.assertEqual(result["code"], 0)  # exit 0, not the 1/500 the bug produced
        payload = result["payload"]
        self.assertEqual([r["candidateId"] for r in payload["candidates"]], ["good-1"])
        self.assertEqual(len(payload["skipped"]), 1)
        skip = payload["skipped"][0]
        self.assertEqual(skip["id"], "bad-1")
        self.assertEqual(skip["label"], "Half-parsed CV")
        self.assertTrue(skip["reason"])  # a recorded reason, not an empty note

    def test_all_valid_reports_no_skips(self) -> None:
        result = _run(
            {
                "jobId": JOB.id,
                "candidates": [{"id": "good-1", "candidate": GOOD.model_dump()}],
            }
        )
        self.assertEqual(result["code"], 0)
        self.assertEqual(result["payload"]["skipped"], [])
        self.assertEqual(len(result["payload"]["candidates"]), 1)


if __name__ == "__main__":
    unittest.main()
