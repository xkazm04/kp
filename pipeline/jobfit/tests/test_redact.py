from __future__ import annotations

import unittest

from pipeline.jobfit.redact import redact_pii


CV = """Jane Doe
Senior Backend Engineer
jane.doe@example.com | +420 123 456 789
linkedin.com/in/janedoe
Born 1990 in Prague

She led the payments team for 5 years. Her work shipped to millions.
Skills: Python, Django, PostgreSQL.
"""


class RedactPiiTest(unittest.TestCase):
    def test_masks_name_email_phone_links(self) -> None:
        r = redact_pii(CV)
        self.assertEqual(r.detected_name, "Jane Doe")
        self.assertIn("name", r.categories)
        self.assertNotIn("Jane", r.text)
        self.assertNotIn("Doe", r.text)
        self.assertNotIn("jane.doe@example.com", r.text)
        self.assertIn("[EMAIL]", r.text)
        self.assertIn("[PHONE]", r.text)
        self.assertNotIn("linkedin.com/in/janedoe", r.text)
        self.assertIn("email", r.categories)
        self.assertIn("phone", r.categories)
        self.assertIn("profile links", r.categories)

    def test_masks_gendered_terms_and_age(self) -> None:
        r = redact_pii(CV)
        self.assertIn("gendered terms", r.categories)
        # "She"/"Her" gone; the substantive content (payments team, 5 years) stays.
        self.assertNotIn("She led", r.text)
        self.assertIn("payments team", r.text)
        self.assertIn("5 years", r.text)
        self.assertIn("age / birth year", r.categories)
        self.assertNotIn("Born 1990", r.text)

    def test_keeps_skills_and_substance(self) -> None:
        r = redact_pii(CV)
        for skill in ("Python", "Django", "PostgreSQL"):
            self.assertIn(skill, r.text)

    def test_no_pii_is_a_clean_passthrough(self) -> None:
        plain = "Senior engineer with 8 years building distributed systems in Go."
        r = redact_pii(plain)
        self.assertEqual(r.categories, [])
        self.assertIsNone(r.detected_name)
        self.assertEqual(r.text, plain)

    def test_name_detected_flag_tracks_the_name_category(self) -> None:
        # cv-extraction-pipeline #1: an explicit fail-open signal. When a name is
        # found, name_detected is True and "name" is in categories; when it isn't
        # (so the real name would still reach the model), name_detected is False so
        # the caller can refuse to claim "identity redacted".
        with_name = redact_pii(CV)
        self.assertTrue(with_name.name_detected)
        self.assertIn("name", with_name.categories)

        # A single-token name slips past _guess_name_line's 2-4-token heuristic.
        no_name = redact_pii("Madonna\nSenior engineer with 8 years in Go.\nmadonna@example.com")
        self.assertFalse(no_name.name_detected, "an undetected name must flag name_detected=False")
        self.assertNotIn("name", no_name.categories)
        self.assertIsNone(no_name.detected_name)

    def test_english_preposition_on_is_not_redacted(self) -> None:
        # Czech "on" (he) used to be in the pronoun list, so \bon\b shredded every
        # English "on" — corrupting the blind-scored text. It must survive verbatim.
        text = "Deployed on AWS and focused on reliability."
        r = redact_pii(text)
        self.assertEqual(r.text, text)
        self.assertEqual(r.categories, [])

    def test_name_followed_by_inline_title_is_detected(self) -> None:
        # The header isn't a clean 2-4-word line — the name is followed by a role on
        # the same line. The leading segment before the separator must still be masked.
        cv = "Jan Novák — Senior Backend Engineer\nhi@example.com\nBuilt scalable systems.\n"
        r = redact_pii(cv)
        self.assertEqual(r.detected_name, "Jan Novák")
        self.assertIn("[NAME]", r.text)
        self.assertNotIn("Jan", r.text)
        self.assertNotIn("Novák", r.text)
        # The title shares the line but isn't part of the name segment — it stays.
        self.assertIn("Senior Backend Engineer", r.text)


class NameHeadlineRejectionTest(unittest.TestCase):
    """#2: a role/skill HEADLINE on the first line must NOT be taken as the name.

    Pre-fix, ``_guess_name_line`` accepted the first title-cased 2-4-word line
    unconditionally, so "Machine Learning Engineer" became the detected name — then
    ``redact_pii`` masked "Machine"/"Learning"/"Engineer" as ``[NAME]`` throughout the
    blind-scored text and the headline was re-attached as the candidate's name.
    Each assertion below FAILS against the pre-fix code (detected_name would equal the
    headline and the headline words would be masked)."""

    def test_skill_headline_first_line_is_skipped_for_the_real_name(self) -> None:
        cv = (
            "Machine Learning Engineer\n"
            "Alex Carter\n"
            "alex@example.com\n"
            "Built recommendation systems; machine learning pipelines in Python.\n"
        )
        r = redact_pii(cv)
        self.assertEqual(r.detected_name, "Alex Carter")  # not the headline
        # The headline words survive verbatim so the model scores the real content.
        self.assertIn("Machine Learning Engineer", r.text)
        self.assertIn("machine learning pipelines", r.text)
        # The real name IS masked.
        self.assertIn("[NAME]", r.text)
        self.assertNotIn("Alex", r.text)
        self.assertNotIn("Carter", r.text)

    def test_seniority_headline_first_line_is_skipped(self) -> None:
        cv = "Senior Software Developer\nDana Kim\nLed a team and scaled the platform.\n"
        r = redact_pii(cv)
        self.assertEqual(r.detected_name, "Dana Kim")
        self.assertIn("Senior Software Developer", r.text)
        self.assertNotIn("Dana", r.text)

    def test_ordinary_two_word_name_is_still_detected(self) -> None:
        # Guard against over-rejection: a plain personal name must still be caught.
        r = redact_pii("Jane Doe\nProduct designer.\n")
        self.assertEqual(r.detected_name, "Jane Doe")


class HonorificPrecisionTest(unittest.TestCase):
    """#3: 'MS' the degree / Microsoft-stack prefix must survive; 'Ms' the title
    (before a capitalized name) is still redacted."""

    def test_ms_degree_and_microsoft_stack_are_not_redacted(self) -> None:
        # Pre-fix, \bms\b (IGNORECASE) in the pronoun list masked every "MS", so each
        # assertIn below FAILS against the old code and "[REDACTED]" appears.
        cv = (
            "Skills: MS SQL Server, MS Office, MS Excel, MS Azure, MS 365.\n"
            "Education: MSc in Statistics; M.S. equivalent; Master of Science (MS).\n"
        )
        r = redact_pii(cv)
        for token in (
            "MS SQL Server", "MS Office", "MS Excel", "MS Azure",
            "MSc", "M.S.", "Master of Science",
        ):
            self.assertIn(token, r.text)
        self.assertNotIn("[REDACTED]", r.text)
        self.assertNotIn("gendered terms", r.categories)

    def test_lowercase_ms_unit_is_not_redacted(self) -> None:
        # "150 ms latency" — the unit, not a title. Pre-fix \bms\b would mask it.
        cv = "Cut p99 latency from 150 ms to 40 ms under load.\n"
        r = redact_pii(cv)
        self.assertIn("150 ms", r.text)
        self.assertIn("40 ms", r.text)
        self.assertNotIn("[REDACTED]", r.text)

    def test_title_before_a_name_is_still_redacted(self) -> None:
        # The genuine gender-revealing usage — a title before a capitalized name —
        # must still be masked (regression guard against over-correcting #3).
        cv = "Reference: Ms. Nováková supervised the project; contact Mr Smith too.\n"
        r = redact_pii(cv)
        self.assertIn("gendered terms", r.categories)
        self.assertNotIn("Ms. Nováková", r.text)
        self.assertNotIn("Mr Smith", r.text)
        self.assertIn("supervised the project", r.text)


if __name__ == "__main__":
    unittest.main()
