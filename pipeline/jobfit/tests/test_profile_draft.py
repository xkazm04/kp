"""Tests for the pure assembly in profile_draft_cli (no network / no API key).

The Gemini call is isolated in _extract; build_draft is pure, so the mapping,
enum-sanitization, and deterministic routing are all testable here.
"""

from __future__ import annotations

import unittest

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


if __name__ == "__main__":
    unittest.main()
