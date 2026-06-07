"""CLI-level tests for matrix_cli: a profile whose CandidateProfileV2 fails to
validate/transform must not vanish from the fit grid without a trace — it is
collected into `missingCandidates` (id/label/error) so the UI can flag the gap,
symmetric with how unresolved `--job-ids` land in `missing`.
"""

from __future__ import annotations

import contextlib
import io
import json
import tempfile
import unittest
from pathlib import Path

from pipeline.jobfit.jobs import normalize_job
from pipeline.jobfit.matrix_cli import main

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

GOOD_PROFILE = {
    "id": "good-1",
    "label": "Valid Candidate",
    "archetype": "bau",
    "payload": {
        "roleFamily": "software_engineering",
        "languages": ["English"],
        "skillClaims": [{"skill": "Python"}],
    },
}

# SkillClaim.skill is required — a partially-extracted CV missing it fails validation.
BAD_PROFILE = {
    "id": "bad-1",
    "label": "Half-parsed CV",
    "archetype": "bau",
    "payload": {"skillClaims": [{"level": "working"}]},
}


def _run(profiles: list[dict]) -> dict:
    with tempfile.TemporaryDirectory() as tmp:
        profiles_path = Path(tmp) / "profiles.json"
        profiles_path.write_text(json.dumps(profiles), encoding="utf-8")
        jobs_path = Path(tmp) / "jobs.json"
        jobs_path.write_text(json.dumps([JOB.model_dump(mode="json")]), encoding="utf-8")

        out = io.StringIO()
        with contextlib.redirect_stdout(out):
            code = main(
                [
                    "--profiles-json",
                    str(profiles_path),
                    "--job-ids",
                    JOB.id,
                    "--jobs-json",
                    str(jobs_path),
                ]
            )
        return {"code": code, "payload": json.loads(out.getvalue() or "{}")}


class MatrixCliMissingCandidatesTest(unittest.TestCase):
    def test_invalid_profile_is_surfaced_not_dropped(self) -> None:
        # A malformed profile sits between/with a valid one. The bad row is recorded
        # in missingCandidates (not silently swallowed); the valid row still scores.
        result = _run([GOOD_PROFILE, BAD_PROFILE])
        self.assertEqual(result["code"], 0)
        payload = result["payload"]

        # The valid candidate produces exactly one scored row.
        self.assertEqual([c["id"] for c in payload["candidates"]], ["good-1"])
        self.assertEqual(len(payload["cells"]), 1)
        self.assertEqual(len(payload["cells"][0]), len(payload["positions"]))

        # The invalid candidate is surfaced with its id/label and a real error.
        self.assertEqual(len(payload["missingCandidates"]), 1)
        miss = payload["missingCandidates"][0]
        self.assertEqual(miss["id"], "bad-1")
        self.assertEqual(miss["label"], "Half-parsed CV")
        self.assertTrue(miss["error"])  # a recorded reason, not an empty note

    def test_all_valid_reports_no_missing_candidates(self) -> None:
        result = _run([GOOD_PROFILE])
        self.assertEqual(result["code"], 0)
        payload = result["payload"]
        self.assertEqual(payload["missingCandidates"], [])
        self.assertEqual(len(payload["candidates"]), 1)

    def test_missing_label_falls_back_to_id(self) -> None:
        # A dropped profile with no label is still nameable by its id, so the banner
        # never renders a blank entry.
        result = _run([{"id": "no-label", "payload": {"skillClaims": [{"level": "working"}]}}])
        self.assertEqual(result["code"], 0)
        miss = result["payload"]["missingCandidates"]
        self.assertEqual(len(miss), 1)
        self.assertEqual(miss[0]["id"], "no-label")
        self.assertEqual(miss[0]["label"], "no-label")


class MatrixCliDuplicatePositionTest(unittest.TestCase):
    def test_duplicate_job_ids_collapse_to_one_column(self) -> None:
        # listOpenPositions can repeat a job_id (a title edited between pipeline adds),
        # so --job-ids may arrive as "id,id". The grid keys columns by id, so a repeated
        # id must collapse to a single column instead of emitting duplicate React keys.
        with tempfile.TemporaryDirectory() as tmp:
            profiles_path = Path(tmp) / "profiles.json"
            profiles_path.write_text(json.dumps([GOOD_PROFILE]), encoding="utf-8")
            jobs_path = Path(tmp) / "jobs.json"
            jobs_path.write_text(json.dumps([JOB.model_dump(mode="json")]), encoding="utf-8")

            out = io.StringIO()
            with contextlib.redirect_stdout(out):
                code = main(
                    [
                        "--profiles-json",
                        str(profiles_path),
                        "--job-ids",
                        f"{JOB.id},{JOB.id}",
                        "--jobs-json",
                        str(jobs_path),
                    ]
                )
            payload = json.loads(out.getvalue() or "{}")

        self.assertEqual(code, 0)
        # Exactly one column, no duplicate id.
        self.assertEqual([p["id"] for p in payload["positions"]], [JOB.id])
        # The scored row has exactly one cell — one column, not two.
        self.assertEqual(len(payload["cells"][0]), 1)
        self.assertEqual(payload["missing"], [])


if __name__ == "__main__":
    unittest.main()
