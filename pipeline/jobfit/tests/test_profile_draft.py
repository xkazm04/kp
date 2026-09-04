"""Tests for the pure assembly in profile_draft_cli (no network / no API key).

The Gemini call is isolated in _extract; build_draft is pure, so the mapping,
enum-sanitization, and deterministic routing are all testable here.
"""

from __future__ import annotations

import contextlib
import io
import json
import tempfile
import unittest
from unittest import mock
from pathlib import Path

from pipeline.jobfit import _cli, profile_draft_cli
from pipeline.jobfit.profile_draft_cli import build_draft


class BuildDraftTest(unittest.TestCase):
    def test_student_notes_route_to_student(self) -> None:
        draft = build_draft(
            {
                "display_name": "Jana N",
                "role_family": "software_engineering",
                "education_level": "bachelor",
                "education_detail": "CS, ČVUT FEL",
                "languages": ["Czech", "English"],
                "aspirations": ["Junior frontend developer"],
                "skill_claims": [{"skill": "React", "level": "working", "provenance": "coursework"}],
                "experiences": [{"kind": "thesis", "title": "BSc thesis", "text": "web app", "skills": ["React"], "link": "http://x"}],
                "is_enrolled": True,
                "expected_graduation": "2026",
            }
        )
        self.assertEqual(draft["archetype"], "student")
        self.assertEqual(draft["profile"]["displayName"], "Jana N")
        self.assertEqual(draft["profile"]["skillClaims"][0]["provenance"], "coursework")
        self.assertEqual(draft["profile"]["evidence"][0]["kind"], "thesis")
        self.assertEqual(draft["profile"]["evidence"][0]["link"], "http://x")
        self.assertTrue(draft["signals"]["isEnrolled"])

    def test_experienced_notes_route_to_bau(self) -> None:
        draft = build_draft(
            {
                "role_family": "data_ai",
                "years_experience": 6,
                "has_substantial_experience": True,
                "skill_claims": [{"skill": "Python", "level": "strong", "provenance": "professional"}],
            }
        )
        self.assertEqual(draft["archetype"], "bau")
        self.assertEqual(draft["profile"]["yearsExperience"], 6)
        self.assertEqual(draft["profile"]["roleFamily"], "data_ai")

    def test_bad_enums_are_sanitized(self) -> None:
        draft = build_draft(
            {
                "role_family": "rocket_science",
                "education_level": "wizard",
                "skill_claims": [{"skill": "Go", "level": "expert", "provenance": "telepathy"}],
                "experiences": [{"kind": "spELL", "title": "x"}],
            }
        )
        self.assertEqual(draft["profile"]["roleFamily"], "software_engineering")
        self.assertEqual(draft["profile"]["educationLevel"], "unknown")
        self.assertEqual(draft["profile"]["skillClaims"][0]["level"], "working")
        self.assertEqual(draft["profile"]["skillClaims"][0]["provenance"], "self_declared")
        self.assertEqual(draft["profile"]["evidence"][0]["kind"], "other")

    def test_empty_and_blank_entries_dropped(self) -> None:
        draft = build_draft(
            {
                "skill_claims": [{"skill": "  "}, {"level": "working"}],
                "experiences": [{"kind": "project", "title": "", "text": ""}],
                "languages": ["", "Czech"],
            }
        )
        self.assertEqual(draft["profile"]["skillClaims"], [])
        self.assertEqual(draft["profile"]["evidence"], [])
        self.assertEqual(draft["profile"]["languages"], ["Czech"])

    def test_years_bool_is_not_treated_as_number(self) -> None:
        # JSON true must not slip through as years_experience=1.
        draft = build_draft({"years_experience": True})
        self.assertNotIn("yearsExperience", draft["profile"])


class DraftCliErrorTaxonomyTest(unittest.TestCase):
    """bug-ui-scan-2026-07-09 (pipeline-clis-script-bridges #5): user-correctable bad
    input must surface as 400/invalid_input (exit 2), not a scary 500 engine_error —
    mirroring profile_cli. Neither path reaches the Gemini call (both fail earlier), so
    the test needs no network/key."""

    def _run(self, raw_text: str) -> tuple[int, dict]:
        with tempfile.TemporaryDirectory() as d:
            inp = Path(d) / "in.json"
            inp.write_text(raw_text, encoding="utf-8")
            out_buf, err_buf = io.StringIO(), io.StringIO()
            # Redirect BOTH streams to StringIO (no .reconfigure) so main() skips its
            # stdio reconfigure guard — it checks sys.stdout but reconfigures stderr too.
            with contextlib.redirect_stdout(out_buf), contextlib.redirect_stderr(err_buf):
                rc = profile_draft_cli.main(["--input-json", str(inp)])
            return rc, json.loads(err_buf.getvalue().strip().splitlines()[-1])

    def test_malformed_input_json_is_400_invalid_input_not_500(self) -> None:
        # json.JSONDecodeError is a ValueError → the new except-ValueError branch.
        # Pre-fix: the blanket `except Exception` stamped status 500, no `code`, exit 1.
        rc, env = self._run("{ this is not valid json")
        self.assertEqual(rc, 2)
        self.assertEqual(env["status"], 400)
        self.assertEqual(env["code"], "invalid_input")

    def test_empty_notes_is_400_with_exit_2_and_code(self) -> None:
        # Pre-fix: empty notes returned exit 1 with status 400 (an exit/status mismatch)
        # and no `code`; parseStderrError read exit 1 as a 500.
        rc, env = self._run(json.dumps({"text": "   "}))
        self.assertEqual(rc, 2)
        self.assertEqual(env["status"], 400)
        self.assertEqual(env["code"], "invalid_input")

    def test_an_ai_fault_is_still_a_500_with_a_code(self) -> None:
        # The other half of the taxonomy, previously untested here: an empty structured
        # draft (or a provider outage) is NOT the recruiter's notes — retry/escalate.
        with mock.patch.object(profile_draft_cli, "_extract", side_effect=RuntimeError("gemini down")):
            rc, env = self._run(json.dumps({"text": "Ten years of Python in Brno."}))
        self.assertEqual(rc, 1)
        self.assertEqual((env["status"], env["code"]), (500, "engine_error"))

    def test_every_code_it_emits_is_in_the_shared_vocabulary(self) -> None:
        # profile_draft_cli used to spell its own ERR_* literals; it now imports them,
        # which is what let it leave the LOCAL_ERR_HOLDOUTS ratchet. A word outside the
        # closed set resolves to no errors.<CODE> catalog key in any of the 4 locales.
        _rc, bad_json = self._run("{ not json")
        with mock.patch.object(profile_draft_cli, "_extract", side_effect=RuntimeError("x")):
            _rc2, fault = self._run(json.dumps({"text": "notes"}))
        for env in (bad_json, fault):
            self.assertIn(env["code"], _cli.ERROR_CODES)

    def test_it_declares_no_local_error_words_of_its_own(self) -> None:
        source = Path(profile_draft_cli.__file__).read_text(encoding="utf-8")
        self.assertNotRegex(source, r'(?m)^ERR_[A-Z_]+\s*=\s*"')

    def test_one_replaced_stream_does_not_crash_the_cli(self) -> None:
        # The open-coded pair this CLI carried reconfigured sys.stderr unconditionally
        # after testing sys.stdout, so capturing one stream killed it before line one.
        buf = io.StringIO()
        with contextlib.redirect_stderr(buf):  # stdout real, stderr replaced
            profile_draft_cli.configure_stdio()
        self.assertEqual(buf.getvalue(), "")


if __name__ == "__main__":
    unittest.main()
