"""Tests for shared CLI job resolution via resolve_job_arg.
Pins acceptance cases 1, 2, 3, 4, 5, and 8 from pipeline-core/A card.
"""

import contextlib
import io
import json
import re
import tempfile
import unittest
from pathlib import Path

from pipeline.jobfit import _cli, automation_cli
from pipeline.jobfit.tests._helpers import mkjob

_CANDIDATE = {
    "skills": ["Python"],
    "seniority": "senior",
    "role_family": "software_engineering",
    "languages": ["English"],
    "archetype": "bau",
}


def _run_automation(argv: list[str]) -> tuple[int, str, str]:
    out, err = io.StringIO(), io.StringIO()
    with contextlib.redirect_stdout(out), contextlib.redirect_stderr(err):
        code = automation_cli.main(argv)
    return code, out.getvalue(), err.getvalue()


def _last_json(stream: str) -> dict:
    lines = [ln for ln in stream.splitlines() if ln.strip()]
    return json.loads(lines[-1])


class TestCliJobResolution(unittest.TestCase):
    def test_case_1_prep_with_in_app_job_json_succeeds(self):
        # Case 1: automation_cli prep --no-llm --candidate-json C --job-id jd-33ydgirz --job-json J,
        # where J holds that in-app role's record and id is absent from seed -> exit 0 with a result
        with tempfile.TemporaryDirectory() as d:
            cand_path = Path(d) / "candidate.json"
            cand_path.write_text(json.dumps(_CANDIDATE), encoding="utf-8")
            job_path = Path(d) / "job.json"
            job = mkjob(id="jd-33ydgirz", title="Staff Platform Engineer")
            job_path.write_text(json.dumps(job.model_dump(mode="json")), encoding="utf-8")

            code, out, err = _run_automation(
                [
                    "prep",
                    "--no-llm",
                    "--candidate-json",
                    str(cand_path),
                    "--job-id",
                    "jd-33ydgirz",
                    "--job-json",
                    str(job_path),
                ]
            )
            self.assertEqual(code, 0, f"Expected exit 0, got {code}. err: {err}")
            payload = _last_json(out)
            self.assertIn("result", payload)

    def test_case_2_offer_with_custom_salary_band_in_job_json(self):
        # Case 2: automation_cli offer --no-llm --job-id job-000 --job-json J where J carries DB band
        with tempfile.TemporaryDirectory() as d:
            cand_path = Path(d) / "candidate.json"
            cand_path.write_text(json.dumps(_CANDIDATE), encoding="utf-8")
            job_path = Path(d) / "job.json"
            job = mkjob(id="job-000", title="Engineering Lead", salary_min=110000, salary_max=165000)
            job_path.write_text(json.dumps(job.model_dump(mode="json")), encoding="utf-8")

            code, out, err = _run_automation(
                [
                    "offer",
                    "--no-llm",
                    "--candidate-json",
                    str(cand_path),
                    "--job-id",
                    "job-000",
                    "--job-json",
                    str(job_path),
                ]
            )
            self.assertEqual(code, 0, f"Expected exit 0, got {code}. err: {err}")
            payload = _last_json(out)
            result = payload.get("result", {})
            self.assertEqual(result.get("salaryMin"), 110000)
            self.assertEqual(result.get("salaryMax"), 165000)
            rec = result.get("recommended")
            self.assertIsNotNone(rec)
            self.assertTrue(110000 <= rec <= 165000, f"Recommended {rec} outside band [110000, 165000]")

    def test_case_3_mismatched_job_id_and_job_json_id_is_400(self):
        # Case 3: --job-json whose record id differs from --job-id -> exit 2, {status:400, code:invalid_input}
        with tempfile.TemporaryDirectory() as d:
            cand_path = Path(d) / "candidate.json"
            cand_path.write_text(json.dumps(_CANDIDATE), encoding="utf-8")
            job_path = Path(d) / "job.json"
            job = mkjob(id="different-job-id", title="Engineering Lead")
            job_path.write_text(json.dumps(job.model_dump(mode="json")), encoding="utf-8")

            code, _out, err = _run_automation(
                [
                    "prep",
                    "--no-llm",
                    "--candidate-json",
                    str(cand_path),
                    "--job-id",
                    "jd-33ydgirz",
                    "--job-json",
                    str(job_path),
                ]
            )
            self.assertEqual(code, 2)
            payload = _last_json(err)
            self.assertEqual(payload["status"], 400)
            self.assertEqual(payload["code"], "invalid_input")

    def test_case_4_malformed_job_json_is_400(self):
        # Case 4: --job-json holding non-object or failing Job validation -> exit 2, invalid_input
        with tempfile.TemporaryDirectory() as d:
            cand_path = Path(d) / "candidate.json"
            cand_path.write_text(json.dumps(_CANDIDATE), encoding="utf-8")
            job_path = Path(d) / "job.json"
            job_path.write_text("123", encoding="utf-8")  # non-object

            code, _out, err = _run_automation(
                [
                    "prep",
                    "--no-llm",
                    "--candidate-json",
                    str(cand_path),
                    "--job-id",
                    "jd-33ydgirz",
                    "--job-json",
                    str(job_path),
                ]
            )
            self.assertEqual(code, 2)
            payload = _last_json(err)
            self.assertEqual(payload["status"], 400)
            self.assertEqual(payload["code"], "invalid_input")

    def test_case_5_direct_cli_seed_resolves_and_unknown_is_404(self):
        # Case 5: No --job-json: seed id resolves, unknown id is 404
        with tempfile.TemporaryDirectory() as d:
            cand_path = Path(d) / "candidate.json"
            cand_path.write_text(json.dumps(_CANDIDATE), encoding="utf-8")

            # Unknown id -> exit 1, 404 not_found
            code, _out, err = _run_automation(
                [
                    "prep",
                    "--no-llm",
                    "--candidate-json",
                    str(cand_path),
                    "--job-id",
                    "completely-unknown-job-id",
                ]
            )
            self.assertEqual(code, 1)
            payload = _last_json(err)
            self.assertEqual(payload["status"], 404)
            self.assertEqual(payload["code"], "not_found")

            # resolve_job_arg also pinned directly for recruiter_cli & winnability_cli
            self.assertTrue(hasattr(_cli, "resolve_job_arg"))
            resolved = _cli.resolve_job_arg("job-000", None)
            self.assertEqual(resolved.id, "job-000")

    def test_case_8_source_pin_no_inline_next_lookup(self):
        # Case 8: no pipeline/jobfit/*_cli.py among the three per-job CLIs performs inline next lookup
        pattern = re.compile(r"next\s*\(\s*\(\s*j\s+for\s+j\s+in\s+jobs\s+if\s+j\.id\s*==")
        repo_root = Path(__file__).resolve().parents[3]
        cli_dir = repo_root / "pipeline" / "jobfit"
        for cli_name in ("automation_cli.py", "recruiter_cli.py", "winnability_cli.py"):
            cli_file = cli_dir / cli_name
            text = cli_file.read_text(encoding="utf-8")
            match = pattern.search(text)
            self.assertIsNone(match, f"Found inline jobs lookup in {cli_file.name}: {match}")


if __name__ == "__main__":
    unittest.main()
