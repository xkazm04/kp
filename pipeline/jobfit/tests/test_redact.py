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


if __name__ == "__main__":
    unittest.main()
