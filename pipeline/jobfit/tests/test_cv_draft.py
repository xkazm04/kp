"""The keyless twin of profile_draft: a CV must become a (thin, honest) profile with no
model — an install without a provider can still import, and says what read it."""

from __future__ import annotations

import json
import os
import subprocess
import sys
import unittest
from pathlib import Path

from pipeline.jobfit.cv_draft import _ROLE_WORD_TERMS, dated_roles, deterministic_draft, is_role_word
from pipeline.jobfit.profile_draft_cli import build_draft

TAXONOMY_TERMS = json.loads(
    (Path(__file__).resolve().parents[3] / "data" / "taxonomy.json").read_text(encoding="utf-8")
)["terms"]

CV = """Jan Novák
Praha, Czech Republic · jan@example.com · +420 777 123 456

Senior backend engineer with 8 years of experience in Java, Spring and PostgreSQL,
running services on Kubernetes. Czech native, English C1.
Looking for a lead role, remote or hybrid.

Education
Ing., Czech Technical University in Prague, 2016
"""


SIDEBAR_CV = """JANA EXAMPLE
PLATFORM ENGINEER
jana@example.org
PROFILE
Engineer who builds reliable payment systems.
WORK EXPERIENCE
Acme Systems 03/2021 - present
Senior Platform Engineer
Built the billing platform used by forty teams.
Cut deploy time from forty minutes to six.
Globex, a.s. 01/2019 - 06/2021
Backend Engineer
Owned the payments integration.
Prior experience
2018 Initech, s.r.o.
QA Engineer (Selenium)
2015 - 2017: Hooli, a.s.
IT Analyst

CORE STACK
Kotlin
PostgreSQL
EDUCATION 2010 - 2015
Czech Technical University
"""


class DatedRolesTest(unittest.TestCase):
    """Roles split at their date lines, inside experience sections only; the total is
    the UNION of the dated intervals (registry technique tenure-and-date-range-reading).
    The keyless draft used to return one blob titled "Summary" (measured 2026-09-25)."""

    def test_every_dated_role_is_its_own_entry(self) -> None:
        roles, _ = dated_roles(SIDEBAR_CV, now=2026.5)
        titles = [r["title"] for r in roles]
        self.assertEqual(len(roles), 4, titles)
        self.assertEqual(titles[0], "Senior Platform Engineer — Acme Systems (03/2021 - present)")
        self.assertEqual(titles[2], "QA Engineer (Selenium) — Initech, s.r.o. (2018)")
        self.assertIn("forty teams", roles[0]["text"])

    def test_an_education_range_is_not_a_job_and_a_sidebar_does_not_join_the_last_role(self) -> None:
        roles, _ = dated_roles(SIDEBAR_CV, now=2026.5)
        self.assertFalse(any("Czech Technical" in r["title"] or "Czech Technical" in r["text"] for r in roles))
        self.assertNotIn("Kotlin", roles[-1]["text"], "the blank line and the CORE STACK label end the last role")

    def test_overlapping_roles_count_once(self) -> None:
        # 03/2019 - 12/2020 and 01/2020 - 12/2021 overlap for a year: 2.83 years, not 3.83.
        text = "EXPERIENCE\nA 03/2019 - 12/2020\nX\nB 01/2020 - 12/2021\nY\n"
        _, years = dated_roles(text, now=2026.0)
        self.assertAlmostEqual(years, 2.8, places=1)

    def test_a_backwards_range_is_dropped_not_subtracted(self) -> None:
        _, years = dated_roles("EXPERIENCE\nA 2020 - 2018\nX\n", now=2026.0)
        self.assertIsNone(years)

    def test_the_draft_reads_roles_and_years_and_no_heading_as_a_place(self) -> None:
        draft = deterministic_draft(SIDEBAR_CV)
        self.assertEqual(len(draft["experiences"]), 4)
        self.assertIsNotNone(draft["years_experience"])
        self.assertNotEqual(draft["location"], "PROFILE")


class DeterministicDraftTest(unittest.TestCase):
    def test_degree_beats_institution_on_czech_and_english_cv_headers(self) -> None:
        cases = (
            ("Jane Doe\nEducation\nMaster of Science, University of Prague", "master"),
            ("Jane Doe\nEducation\nUniversity of Prague", "university"),
            ("Jana Nováková\nVzdělání\nIng., České vysoké učení technické", "master"),
            ("Jana Nováková\nVzdělání\nVysoká škola ekonomická", "university"),
        )
        for cv, expected in cases:
            with self.subTest(expected=expected, cv=cv):
                self.assertEqual(deterministic_draft(cv)["education_level"], expected)

    def test_reads_the_header_and_the_summary(self) -> None:
        d = deterministic_draft(CV)
        self.assertEqual(d["display_name"], "Jan Novák")
        self.assertEqual(d["location"], "Praha")
        self.assertEqual(d["years_experience"], 8)
        self.assertIn("java", [c["skill"] for c in d["skill_claims"]])
        self.assertTrue({"Czech", "English"} <= set(d["languages"]))
        self.assertEqual(d["education_level"], "master")
        self.assertTrue(any("lead role" in a for a in d["aspirations"]))
        self.assertTrue(d["has_substantial_experience"])

    def test_every_claim_is_self_declared_and_nothing_is_invented(self) -> None:
        d = deterministic_draft("Some prose with no name, no years and no skills at all.")
        self.assertIsNone(d["years_experience"])
        self.assertEqual(d["skill_claims"], [])
        self.assertIsNone(d["location"])
        for claim in deterministic_draft(CV)["skill_claims"]:
            self.assertEqual(claim["provenance"], "self_declared")

    def test_role_words_inform_the_family_but_are_never_skill_claims(self) -> None:
        """"Senior backend engineer" is a job title. The taxonomy files backend /
        engineer / developer under ``skill``, so they used to land as self-declared
        SKILL claims beside java and postgresql — telling a reviewer nothing and
        diluting every real claim. They still vote on the role family."""
        d = deterministic_draft(CV)
        claimed = [c["skill"].strip().lower() for c in d["skill_claims"]]
        for role_word in ("backend", "engineer", "developer"):
            self.assertNotIn(role_word, claimed, "a role word is not a skill claim")
        for real in ("java", "spring", "postgresql"):
            self.assertIn(real, claimed, "…while every real skill survives")
        self.assertEqual(d["role_family"], "software_engineering", "the family still hears the role words")
        # The Summary experience carries the same filtered list, not the raw detection.
        self.assertFalse([s for s in d["experiences"][0]["skills"] if is_role_word(s)])

    def test_the_role_word_set_still_names_real_taxonomy_terms(self) -> None:
        """A renamed or re-categorised term would silently switch the filter off."""
        by_id = {t["id"]: t for t in TAXONOMY_TERMS}
        for term_id in _ROLE_WORD_TERMS:
            self.assertIn(term_id, by_id, "role word no longer in the taxonomy")
            self.assertIn("skill", by_id[term_id].get("categories") or [],
                          "term left the skill category — the filter is now dead weight")
            self.assertTrue(any(is_role_word(s) for s in by_id[term_id]["match"]),
                            "no surface of the term resolves back to it")
        self.assertFalse(is_role_word("java"), "a real skill is never filtered")
        self.assertFalse(is_role_word("devops"), "a named specialty is a skill, not a role word")

    def test_build_draft_routes_the_twin_like_a_model_payload(self) -> None:
        draft = build_draft(deterministic_draft(CV))
        self.assertIn("profile", draft)
        self.assertIn("archetype", draft)
        self.assertEqual(draft["profile"]["roleFamily"], "software_engineering")

    def test_cli_degrades_to_the_twin_when_no_provider_can_serve(self) -> None:
        env = {**os.environ, "KP_OFFLINE": "1", "PYTHONUTF8": "1", "PYTHONIOENCODING": "utf-8"}
        proc = subprocess.run(
            [sys.executable, "-m", "pipeline.jobfit.profile_draft_cli", "--lang", "en"],
            input=json.dumps({"text": CV}),
            capture_output=True,
            text=True,
            encoding="utf-8",
            env=env,
            cwd=str(Path(__file__).resolve().parents[3]),
            check=False,
        )
        self.assertEqual(proc.returncode, 0, proc.stderr[-400:])
        out = json.loads(proc.stdout)
        self.assertEqual(out["source"], "deterministic")
        self.assertEqual(out["profile"]["displayName"], "Jan Novák")
        self.assertIn("deterministic twin", proc.stderr)


if __name__ == "__main__":
    unittest.main()
