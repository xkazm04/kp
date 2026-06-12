"""Honest CLI error-status mapping for automation_cli (idea-af143fd3).

automation_cli used to hardcode status 500 for EVERY exception, so a client
mistake (an unknown job, a malformed profile, a missing argument) reached the TS
seam (python-runner.parseStderrError) as a 500 server error — indistinguishable
from a real outage. These tests pin the honest contract:

  * a missing job        -> exit 1, status 404, code "not_found"
  * a missing argument   -> exit 2, status 400, code "invalid_input"
  * a malformed profile  -> exit 2, status 400, code "invalid_input"
  * an unexpected fault  -> exit 1, status 500, code "engine_error"
"""

import contextlib
import io
import json
import tempfile
import unittest
from pathlib import Path
from unittest import mock

from pipeline.jobfit import automation_cli
from pipeline.jobfit.tests._helpers import mkjob

# A MatchCandidate validates from snake_case (populate_by_name) — only the
# defaults matter for these error-path tests.
_CANDIDATE = {
    "skills": ["Python"],
    "seniority": "senior",
    "role_family": "software_engineering",
    "languages": ["English"],
    "archetype": "bau",
}
_JOB_ID = "backend-engineer"


def _run(argv: list[str]) -> tuple[int, str, str]:
    out, err = io.StringIO(), io.StringIO()
    with contextlib.redirect_stdout(out), contextlib.redirect_stderr(err):
        code = automation_cli.main(argv)
    return code, out.getvalue(), err.getvalue()


def _last_json(stream: str) -> dict:
    """The CLI emits one json.dumps line; parse the last non-empty line."""
    lines = [ln for ln in stream.splitlines() if ln.strip()]
    return json.loads(lines[-1])


@contextlib.contextmanager
def _fixture(candidate=_CANDIDATE):
    """Yield (candidate_path, jobs_path) for a one-job corpus. candidate=None skips it."""
    with tempfile.TemporaryDirectory() as d:
        jobs = Path(d) / "jobs.json"
        job = mkjob(id=_JOB_ID, title="Backend Engineer")
        jobs.write_text(json.dumps([job.model_dump(mode="json")]), encoding="utf-8")
        cand_path = None
        if candidate is not None:
            cand_path = Path(d) / "candidate.json"
            content = candidate if isinstance(candidate, str) else json.dumps(candidate)
            cand_path.write_text(content, encoding="utf-8")
        yield cand_path, jobs


class TestAutomationCliErrorStatus(unittest.TestCase):
    def test_missing_job_is_404_not_found(self):
        # A present-but-unknown --job-id is a missing resource, not a server fault.
        with _fixture() as (cand, jobs):
            code, _out, err = _run(
                ["screen", "--no-llm", "--candidate-json", str(cand), "--job-id", "does-not-exist", "--jobs", str(jobs)]
            )
        self.assertEqual(code, 1)
        payload = _last_json(err)
        self.assertEqual(payload["status"], 404)
        self.assertEqual(payload["code"], "not_found")
        self.assertIn("job not found", payload["error"])

    def test_missing_job_id_arg_is_400_not_404(self):
        # The 400-vs-404 distinction: a missing --job-id ARGUMENT is invalid input,
        # not a missing job (which would be 404).
        with _fixture() as (cand, jobs):
            code, _out, err = _run(["screen", "--no-llm", "--candidate-json", str(cand), "--jobs", str(jobs)])
        self.assertEqual(code, 2)
        payload = _last_json(err)
        self.assertEqual(payload["status"], 400)
        self.assertEqual(payload["code"], "invalid_input")
        self.assertIn("--job-id", payload["error"])

    def test_missing_candidate_arg_is_400_invalid_input(self):
        # Neither --candidate-json nor --profile-json -> our explicit ValueError guard.
        code, _out, err = _run(["screen", "--no-llm", "--job-id", _JOB_ID])
        self.assertEqual(code, 2)
        payload = _last_json(err)
        self.assertEqual(payload["status"], 400)
        self.assertEqual(payload["code"], "invalid_input")

    def test_malformed_candidate_is_400_invalid_input(self):
        # A profile that parses but isn't a valid MatchCandidate raises pydantic
        # ValidationError — a ValueError subclass, so it maps to 400 too.
        with _fixture(candidate="123") as (cand, jobs):  # not an object
            code, _out, err = _run(
                ["screen", "--no-llm", "--candidate-json", str(cand), "--job-id", _JOB_ID, "--jobs", str(jobs)]
            )
        self.assertEqual(code, 2)
        payload = _last_json(err)
        self.assertEqual(payload["status"], 400)
        self.assertEqual(payload["code"], "invalid_input")

    def test_engine_failure_is_500_engine_error(self):
        # Valid input, but scoring blows up mid-run -> retry/escalate, not editable.
        with _fixture() as (cand, jobs):
            with mock.patch("pipeline.jobfit.automation_cli.score_job", side_effect=RuntimeError("boom")):
                code, _out, err = _run(
                    ["screen", "--no-llm", "--candidate-json", str(cand), "--job-id", _JOB_ID, "--jobs", str(jobs)]
                )
        self.assertEqual(code, 1)
        payload = _last_json(err)
        self.assertEqual(payload["status"], 500)
        self.assertEqual(payload["code"], "engine_error")
        self.assertIn("boom", payload["error"])

    def test_success_returns_zero_with_result(self):
        with _fixture() as (cand, jobs):
            code, out, _err = _run(
                ["screen", "--no-llm", "--candidate-json", str(cand), "--job-id", _JOB_ID, "--jobs", str(jobs)]
            )
        self.assertEqual(code, 0)
        payload = _last_json(out)
        self.assertIn("result", payload)
        self.assertEqual(payload["source"], "deterministic")

    def test_github_evidence_arg_is_accepted(self):
        # GH7 — the optional evidence summary file rides into screen/prep/scorecard.
        with _fixture() as (cand, jobs):
            gh = jobs.parent / "github.json"
            gh.write_text(json.dumps({"username": "ada-dev", "confirmedSkills": ["Python"]}), encoding="utf-8")
            code, out, _err = _run(
                ["screen", "--no-llm", "--candidate-json", str(cand), "--job-id", _JOB_ID,
                 "--jobs", str(jobs), "--github-evidence", str(gh)]
            )
        self.assertEqual(code, 0)
        self.assertIn("result", _last_json(out))

    def test_malformed_github_evidence_is_400_invalid_input(self):
        # GH7 — a corrupt github.json raises json.JSONDecodeError (a ValueError)
        # and maps to the honest 400, not a 500.
        with _fixture() as (cand, jobs):
            gh = jobs.parent / "github.json"
            gh.write_text("{not json", encoding="utf-8")
            code, _out, err = _run(
                ["screen", "--no-llm", "--candidate-json", str(cand), "--job-id", _JOB_ID,
                 "--jobs", str(jobs), "--github-evidence", str(gh)]
            )
        self.assertEqual(code, 2)
        payload = _last_json(err)
        self.assertEqual(payload["status"], 400)
        self.assertEqual(payload["code"], "invalid_input")


if __name__ == "__main__":
    unittest.main()
