"""CLI-level tests for the --jobs-json corpus augment shared by match_cli and
reasoning_cli (_cli.load_jobs_arg): a recruiter-ingested DB job absent from the
static seed corpus must be rankable by the Match tab and resolvable by Explain
fit. Without the augment such a job was scored by the Fit Matrix yet never
appeared in /api/match's ranking at any rank, and reasoning_cli raised
"job not found". Overrides win on id collision, mirroring matrix_cli's
--jobs-json contract (test_matrix_cli).
"""

from __future__ import annotations

import contextlib
import io
import json
import tempfile
import unittest
from pathlib import Path

from pipeline.jobfit.jobs import normalize_job
from pipeline.jobfit.match_cli import main as match_main
from pipeline.jobfit.matching import load_corpus
from pipeline.jobfit.reasoning_cli import main as reasoning_main

# A "DB-ingested" job under a hand-namespaced id that can never collide with the
# committed seed corpus (seed ids are title slugs).
DB_JOB = normalize_job(
    {
        "title": "Recruiter Ingested Engineer",
        "seniority": "medior",
        "role_family": "software_engineering",
        "languages": ["English"],
        "description": "Build things.",
        "requirements": [{"skill": "Python", "kind": "must_have", "hardness": "learnable"}],
    },
    job_id="job-db-only-cli-test",
)

# A MatchCandidate that survives DB_JOB's KO gates (language, seniority).
CANDIDATE = {
    "skills": ["Python"],
    "seniority": "medior",
    "role_family": "software_engineering",
    "education_level": "bachelor",
    "languages": ["English"],
}


def _run_match(jobs_json: list[dict] | None) -> dict:
    """Run match_cli over the seed corpus, optionally augmented by --jobs-json."""
    with tempfile.TemporaryDirectory() as tmp:
        candidate_path = Path(tmp) / "candidate.json"
        candidate_path.write_text(json.dumps(CANDIDATE), encoding="utf-8")
        # The CLI does not clamp --limit (the route does); rank the whole corpus
        # so an augmented job can't be missed merely by falling below a cutoff.
        argv = ["--candidate-json", str(candidate_path), "--limit", "1000"]
        if jobs_json is not None:
            jobs_path = Path(tmp) / "jobs.json"
            jobs_path.write_text(json.dumps(jobs_json), encoding="utf-8")
            argv += ["--jobs-json", str(jobs_path)]

        out = io.StringIO()
        with contextlib.redirect_stdout(out):
            code = match_main(argv)
        return {"code": code, "payload": json.loads(out.getvalue() or "{}")}


def _run_reasoning(jobs_json: list[dict] | None, job_id: str) -> dict:
    """Run reasoning_cli (--no-llm: deterministic template) for one job id."""
    with tempfile.TemporaryDirectory() as tmp:
        candidate_path = Path(tmp) / "candidate.json"
        candidate_path.write_text(json.dumps(CANDIDATE), encoding="utf-8")
        argv = ["--candidate-json", str(candidate_path), "--job-id", job_id, "--no-llm"]
        if jobs_json is not None:
            jobs_path = Path(tmp) / "jobs.json"
            jobs_path.write_text(json.dumps(jobs_json), encoding="utf-8")
            argv += ["--jobs-json", str(jobs_path)]

        out, err = io.StringIO(), io.StringIO()
        with contextlib.redirect_stdout(out), contextlib.redirect_stderr(err):
            code = reasoning_main(argv)
        return {
            "code": code,
            "payload": json.loads(out.getvalue() or "{}"),
            "error": json.loads(err.getvalue() or "{}"),
        }


class MatchCliJobsJsonTest(unittest.TestCase):
    def test_db_only_job_ranks_with_jobs_json(self) -> None:
        # The augmented job appears in the ranking alongside the seed corpus…
        result = _run_match([DB_JOB.model_dump(mode="json")])
        self.assertEqual(result["code"], 0)
        ranked = [m["jobId"] for m in result["payload"]["matches"]]
        self.assertIn(DB_JOB.id, ranked)
        # …and the seed corpus itself still ranks (augment, not replace).
        self.assertGreater(len(ranked), 1)

    def test_db_only_job_is_absent_without_jobs_json(self) -> None:
        # Pins the contrast: the seed corpus alone cannot surface the DB job.
        result = _run_match(None)
        self.assertEqual(result["code"], 0)
        self.assertNotIn(DB_JOB.id, [m["jobId"] for m in result["payload"]["matches"]])

    def test_override_wins_on_id_collision(self) -> None:
        # A DB record sharing a seed id replaces the seed entry (DB wins), exactly
        # like matrix_cli's augment — the ranking reflects the edited record.
        seed_id = load_corpus()[0].id
        override = normalize_job(
            {
                "title": "Override Title Wins",
                "seniority": "medior",
                "role_family": "software_engineering",
                "languages": ["English"],
                "description": "Edited in the DB.",
                "requirements": [{"skill": "Python", "kind": "must_have", "hardness": "learnable"}],
            },
            job_id=seed_id,
        )
        result = _run_match([override.model_dump(mode="json")])
        self.assertEqual(result["code"], 0)
        by_id = {m["jobId"]: m for m in result["payload"]["matches"]}
        self.assertIn(seed_id, by_id)
        self.assertEqual(by_id[seed_id]["title"], "Override Title Wins")


class ReasoningCliJobsJsonTest(unittest.TestCase):
    def test_db_ingested_job_id_resolves(self) -> None:
        result = _run_reasoning([DB_JOB.model_dump(mode="json")], DB_JOB.id)
        self.assertEqual(result["code"], 0)
        self.assertEqual(result["payload"]["jobId"], DB_JOB.id)
        self.assertTrue(result["payload"]["reasoning"])  # a real verdict, not an empty shell

    def test_without_jobs_json_db_job_is_not_found(self) -> None:
        # Pins the pre-fix failure mode this augment closes.
        result = _run_reasoning(None, DB_JOB.id)
        self.assertEqual(result["code"], 1)
        self.assertIn("job not found", result["error"]["error"])


if __name__ == "__main__":
    unittest.main()
