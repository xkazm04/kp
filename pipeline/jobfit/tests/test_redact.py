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


class SectionHeaderIsNotTheNameTest(unittest.TestCase):
    """A CV whose FIRST line is a section header must not have that header taken as
    the candidate's name — the worst shape in this module, because it fails silently
    in three directions at once.

    Pre-fix, ``_TITLE_WORDS`` held only {curriculum, vitae, cv, résumé, resume,
    profile, contact, životopis}, so "Osobní údaje" (the standard Czech "personal
    details" header) / "Personal Details" / "Professional Summary" / "Persönliche
    Daten" / "Informations Personnelles" all passed the 2-4 title-cased-token test
    and were returned as ``detected_name``. Measured on the Czech case:
    ``detected_name='Osobní údaje'``, ``name_detected=True``, and the redacted text
    still read ``"Jan Novák"`` on line 2 — so pipeline.analyze_cv appended
    "Blind screening active — identity redacted before scoring (name, email, phone)."
    over a CV whose identity had NOT been redacted (the honest "PARTIAL" branch never
    fired), the header words were masked as ``[NAME]`` wherever else they appeared,
    and the header was re-attached to the result as the candidate's name.

    Every assertion below fails against the pre-fix code."""

    CASES = {
        "cs": ("Osobní údaje", "Jan Novák"),
        "cs-titlecase": ("Osobní Údaje", "Jan Novák"),
        "cs-contact": ("Kontaktní údaje", "Petr Svoboda"),
        "en": ("Personal Details", "Alex Carter"),
        "en-summary": ("Professional Summary", "Alex Carter"),
        "de": ("Persönliche Daten", "Max Mustermann"),
        "fr": ("Informations Personnelles", "Jean Dupont"),
    }

    def test_header_is_skipped_and_the_real_name_below_is_redacted(self) -> None:
        for label, (header, name) in self.CASES.items():
            with self.subTest(locale=label):
                r = redact_pii(f"{header}\n{name}\ncontact@example.com\n")
                self.assertEqual(r.detected_name, name)
                self.assertTrue(r.name_detected)
                # The real name is gone from the text the model reads…
                for token in name.split():
                    self.assertNotIn(token, r.text)
                # …and the header survives verbatim (it is not identity).
                self.assertIn(header, r.text)


class AcademicTitleTest(unittest.TestCase):
    """Academic / professional titles bracket the name line on most Czech CVs and
    on many English ones. Both ends used to break redaction, in opposite ways."""

    def test_leading_czech_title_no_longer_blocks_detection(self) -> None:
        # "Ing." carries a dot, so _NAME_TOKEN rejected it and the WHOLE line failed:
        # pre-fix detected_name was None, name_detected False, and "Ing. Jan Novák"
        # rode into the blind text intact (flagged only as "PARTIAL").
        for header, expected in (
            ("Ing. Jan Novák", "Jan Novák"),
            ("Mgr. Jana Nováková", "Jana Nováková"),
            ("Bc. Petr Svoboda", "Petr Svoboda"),
            ("MUDr. Eva Horáková", "Eva Horáková"),
            ("Dr. John Smith", "John Smith"),
        ):
            with self.subTest(header=header):
                r = redact_pii(f"{header}\nBackend Engineer\nhi@example.com\n")
                self.assertEqual(r.detected_name, expected)
                self.assertTrue(r.name_detected)
                for token in expected.split():
                    self.assertNotIn(token, r.text)
                # The qualification itself is not identity and stays for the scorer.
                self.assertIn(header.split()[0], r.text)

    def test_trailing_degree_is_not_swallowed_into_the_name(self) -> None:
        # Pre-fix "Jan Novák MBA" was detected WHOLE, so every later "MBA" — the
        # candidate's most valuable education signal — was masked as [NAME].
        cv = "Jan Novák MBA\nProduct Lead\njan@example.com\n\nMBA from INSEAD, 2019.\n"
        r = redact_pii(cv)
        self.assertEqual(r.detected_name, "Jan Novák")
        self.assertNotIn("Novák", r.text)
        self.assertIn("MBA from INSEAD", r.text)

    def test_trailing_phd_without_a_comma_is_detected(self) -> None:
        # "Jane Doe Ph.D." — no comma, so the separator split never applied and
        # pre-fix nothing was detected at all.
        r = redact_pii("Jane Doe Ph.D.\nResearcher\njane@example.com\n")
        self.assertEqual(r.detected_name, "Jane Doe")
        self.assertNotIn("Jane", r.text)
        self.assertIn("Ph.D.", r.text)

    def test_a_plain_name_line_is_returned_byte_for_byte(self) -> None:
        # Guard against over-stripping: nothing to strip => unchanged behaviour.
        self.assertEqual(redact_pii("Jane Doe\nProduct designer.\n").detected_name, "Jane Doe")


class CzechBirthMarkerGenderParityTest(unittest.TestCase):
    """The Czech "born" participle inflects for gender, and the age filter must catch
    every form — otherwise the redaction itself becomes gender-dependent.

    Measured pre-fix on two CVs identical except for the writer's gender:
      "Narozený 1990 v Praze" -> "[REDACTED] v Praze", categories include
        "age / birth year";
      "Narozená 1990 v Praze" -> "Narozená 1990 v Praze" UNCHANGED, no age category.
    So the man's birth year was masked and the woman's reached the model — under a
    feminine-marked participle that leaks her gender too."""

    FORMS = ("Narozen", "Narozený", "Narozena", "Narozená")

    def test_every_gender_form_redacts_the_birth_year(self) -> None:
        for form in self.FORMS:
            with self.subTest(form=form):
                r = redact_pii(f"Jan Novák\nEngineer\n{form} 1990 v Praze\n")
                self.assertIn("age / birth year", r.categories)
                self.assertNotIn("1990", r.text)
                self.assertNotIn(form, r.text)


class MonthNameOverRedactionTest(unittest.TestCase):
    """A candidate whose given name is also a month abbreviation must not lose the
    employment dates an otherwise identical CV keeps.

    "Jan" is the most common Czech male first name AND the English abbreviation for
    January. Pre-fix the per-token mask turned "Jan 2020 - Jan 2023" into
    "[NAME] 2020 - [NAME] 2023", deleting the tenure/recency evidence the scorer
    reads — for this candidate only."""

    CV = (
        "Jan Novak\nBackend Engineer\njan@example.com\n\n"
        "Jan 2020 - Dec 2022: Backend Engineer at Acme\n"
        "Jan 2018 - Jan 2020: Junior Developer\n"
        "Dear Jan, thanks for the referral.\n"
    )

    def test_date_occurrences_survive(self) -> None:
        r = redact_pii(self.CV)
        self.assertEqual(r.detected_name, "Jan Novak")
        self.assertIn("Jan 2020 - Dec 2022", r.text)
        self.assertIn("Jan 2018 - Jan 2020", r.text)

    def test_the_name_itself_is_still_masked(self) -> None:
        # Non-vacuity in the other direction: sparing the DATE must not spare the
        # person — the header line and a prose mention are still redacted.
        r = redact_pii(self.CV)
        self.assertNotIn("Jan Novak", r.text)
        self.assertNotIn("Novak", r.text)
        self.assertIn("Dear [NAME], thanks", r.text)

    def test_a_non_month_name_is_unaffected(self) -> None:
        cv = self.CV.replace("Jan Novak", "Petr Novak").replace("Dear Jan,", "Dear Petr,")
        r = redact_pii(cv)
        self.assertNotIn("Petr", r.text)
        self.assertIn("Jan 2020 - Dec 2022", r.text)  # never his name, never masked


if __name__ == "__main__":
    unittest.main()
