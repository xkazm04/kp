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

from pipeline.jobfit import automation, automation_cli
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


    def test_scorecard_file_reaches_the_rejection_prompt(self):
        # A1 — the interview the letter follows from arrives as scorecard.json and
        # must reach draft_rejection, not be parsed and dropped.
        with _fixture() as (cand, jobs):
            sc = jobs.parent / "scorecard.json"
            sc.write_text(
                json.dumps({
                    "recommendation": "hold",
                    "ratings": [{"competency": "Technical depth", "rating": 2, "evidence": "e"}],
                }),
                encoding="utf-8",
            )
            seen = {}
            real = automation.draft_rejection

            def spy(*a, **kw):
                seen.update(kw)
                return real(*a, **kw)

            with mock.patch.object(automation, "draft_rejection", spy):
                code, out, _err = _run(
                    ["rejection", "--no-llm", "--candidate-json", str(cand), "--job-id", _JOB_ID,
                     "--jobs", str(jobs), "--stage", "Interview", "--scorecard-file", str(sc)]
                )
        self.assertEqual(code, 0)
        self.assertIn("result", _last_json(out))
        self.assertEqual(seen["scorecard"]["recommendation"], "hold")

    def test_malformed_scorecard_file_is_400_invalid_input(self):
        # Same honest-400 contract as --github-evidence: a corrupt scorecard.json is
        # a bad request, never a letter drafted blind to the interview.
        with _fixture() as (cand, jobs):
            sc = jobs.parent / "scorecard.json"
            sc.write_text("{not json", encoding="utf-8")
            code, _out, err = _run(
                ["offer", "--no-llm", "--candidate-json", str(cand), "--job-id", _JOB_ID,
                 "--jobs", str(jobs), "--scorecard-file", str(sc)]
            )
        self.assertEqual(code, 2)
        payload = _last_json(err)
        self.assertEqual(payload["status"], 400)
        self.assertEqual(payload["code"], "invalid_input")


class TestAutomationCliAdverseActionBoundary(unittest.TestCase):
    """The CLI is the ONLY surface a non-TypeScript integration has, and the
    "no adverse action runs unattended" guarantee lives in the TS pass
    (app/_lib/automation-pass.ts), not here. What such a caller does get is
    `screen_candidate`'s route narrowing — so it is pinned at the CLI boundary
    too, on a candidate whose screening verdict genuinely IS a reject.
    """

    # 33-point match against the Backend Engineer posting -> the deterministic
    # screener's own recommendation is "reject".
    _WEAK = {
        "skills": ["HTML"],
        "seniority": "junior",
        "role_family": "software_engineering",
        "languages": ["English"],
        "archetype": "bau",
    }

    def test_screen_over_a_reject_scoring_candidate_routes_to_hold(self):
        with _fixture(candidate=self._WEAK) as (cand, jobs):
            code, out, _err = _run(
                ["screen", "--no-llm", "--candidate-json", str(cand), "--job-id", _JOB_ID, "--jobs", str(jobs)]
            )
        self.assertEqual(code, 0)
        result = _last_json(out)["result"]
        # The verdict is honest about what the scorer thinks...
        self.assertEqual(result["recommendation"], "reject")
        # ...and the ROUTE the caller acts on is the human gate, never a reject.
        self.assertEqual(result["route"], "hold")
        self.assertIn(result["route"], automation.SCREEN_ROUTES)

    def test_screen_route_is_never_reject_for_any_archetype(self):
        for archetype in ("bau", "student", "career_switcher"):
            with _fixture(candidate={**self._WEAK, "archetype": archetype}) as (cand, jobs):
                code, out, _err = _run(
                    ["screen", "--no-llm", "--candidate-json", str(cand), "--job-id", _JOB_ID, "--jobs", str(jobs)]
                )
            self.assertEqual(code, 0, archetype)
            self.assertIn(_last_json(out)["result"]["route"], automation.SCREEN_ROUTES, archetype)


class TestRematchReadsLang(unittest.TestCase):
    """A7 — `rematch` is a narrative command and now receives --lang like the others.

    Its branch returns before the screen/prep/scorecard dispatch below it, and the
    locale was simply never forwarded: on a cs/de/fr install the one sentence saying
    why a named person is being moved to another role came back in English, unstamped.
    Keyless here (`--no-llm`), so the assertion is on the CONTRACT — the honest
    `narrativeLang`, which must say "en" for the English-only template whatever was
    asked — plus the fact that the flag is accepted at all on this command."""

    def _rematch(self, *extra: str) -> dict:
        with _fixture() as (cand, jobs):
            code, out, err = _run(
                ["rematch", "--no-llm", "--candidate-json", str(cand), "--jobs", str(jobs), *extra]
            )
        self.assertEqual(code, 0, err)
        return _last_json(out)

    def test_the_lang_flag_is_accepted_and_the_stamp_is_honest(self):
        for lang in ("en", "cs", "de", "fr"):
            with self.subTest(lang=lang):
                payload = self._rematch("--lang", lang)
                self.assertEqual(payload["source"], "deterministic")
                # The template is English-only; the stamp reports the TEXT, not the ask.
                self.assertEqual(payload["result"]["narrativeLang"], "en")

    def test_a_caller_that_names_no_language_is_unchanged(self):
        payload = self._rematch()
        self.assertEqual(payload["result"]["narrativeLang"], "en")

    def test_a_mid_flight_descent_reaches_the_ledger_with_a_reason(self):
        # AL4 — `--no-llm` descents are named by the availability gate ("disabled");
        # a provider that WAS available and then failed used to record nothing at all
        # for rematch, because this branch never drained the mid-call reason.
        class _Exploding:
            def complete_json(self, prompt, system=None, expected_keys=None):
                raise RuntimeError("provider exploded")

        seen: dict = {}

        def _emit(use_case, reason=None):
            seen["use_case"], seen["reason"] = use_case, reason

        with _fixture() as (cand, jobs):
            with mock.patch.object(automation_cli, "resolve_provider", return_value=_Exploding()), \
                 mock.patch.object(automation_cli, "provider_availability", return_value=(True, None)), \
                 mock.patch.object(automation_cli, "emit_deterministic", _emit):
                code, out, err = _run(["rematch", "--candidate-json", str(cand), "--jobs", str(jobs)])
        self.assertEqual(code, 0, err)
        self.assertEqual(_last_json(out)["source"], "deterministic")
        self.assertIsNotNone(seen.get("reason"), "a deterministic serve with no reason at all")
        self.assertIn("provider exploded", seen["reason"])


if __name__ == "__main__":
    unittest.main()
