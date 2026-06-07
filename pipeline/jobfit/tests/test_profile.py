from __future__ import annotations

import unittest

from pipeline.jobfit.archetype import detect_archetype
from pipeline.jobfit.profile import (
    CandidateProfileV2,
    Evidence,
    SkillClaim,
    completeness,
    completeness_gaps,
    normalize_profile,
)


class ArchetypeTest(unittest.TestCase):
    def test_self_declaration_is_trusted(self) -> None:
        a, conf, reasons = detect_archetype(self_declared="student")
        self.assertEqual(a, "student")
        self.assertGreaterEqual(conf, 0.85)
        self.assertTrue(any("self-declared" in r for r in reasons))

    def test_declaration_contradiction_lowers_confidence(self) -> None:
        a, conf, reasons = detect_archetype(self_declared="bau", is_enrolled=True)
        self.assertEqual(a, "bau")
        self.assertLess(conf, 0.8)
        self.assertTrue(any("contradiction" in r for r in reasons))

    def test_heuristic_student(self) -> None:
        a, _conf, _ = detect_archetype(is_enrolled=True, years_relevant_experience=0.5)
        self.assertEqual(a, "student")

    def test_heuristic_career_switcher(self) -> None:
        a, _conf, _ = detect_archetype(wants_domain_change=True, has_substantial_experience=True)
        self.assertEqual(a, "career_switcher")

    def test_heuristic_experienced(self) -> None:
        a, _conf, _ = detect_archetype(years_relevant_experience=6, has_substantial_experience=True)
        self.assertEqual(a, "bau")

    def test_no_signal_defaults_bau(self) -> None:
        a, conf, _ = detect_archetype()
        self.assertEqual(a, "bau")
        self.assertLess(conf, 0.6)


def _full_student() -> CandidateProfileV2:
    return CandidateProfileV2(
        archetype="student",
        education_level="bachelor",
        education_detail="Computer Science, ČVUT, expected 2026",
        languages=["Czech", "English"],
        aspirations=["Junior frontend developer"],
        skill_claims=[SkillClaim(skill="React"), SkillClaim(skill="TypeScript"), SkillClaim(skill="Git")],
        evidence=[
            Evidence(kind="thesis", title="Bachelor thesis", skills=["React"]),
            Evidence(kind="internship", title="Summer internship"),
        ],
    )


class CompletenessTest(unittest.TestCase):
    def test_empty_student_is_incomplete(self) -> None:
        score, missing = completeness(CandidateProfileV2(archetype="student"))
        self.assertLess(score, 0.2)
        self.assertTrue(any("project or thesis" in m for m in missing))
        # biggest-weight gap should be surfaced first
        self.assertIn("project or thesis", missing[0])

    def test_full_student_is_complete(self) -> None:
        score, missing = completeness(_full_student())
        self.assertGreaterEqual(score, 0.9)
        self.assertEqual(missing, [])

    def test_bau_uses_experience_checklist(self) -> None:
        _score, missing = completeness(CandidateProfileV2(archetype="bau"))
        self.assertTrue(any("seniority" in m for m in missing))
        self.assertTrue(any("work-experience" in m for m in missing))

    def test_gaps_are_the_structured_twin_of_missing(self) -> None:
        # completeness_gaps carries the CHECK ID a follow-up form keys its field
        # on; its labels (and their biggest-weight-first order) must be exactly
        # the human list completeness() reports — one source, two shapes.
        profile = CandidateProfileV2(archetype="student")
        _score, missing = completeness(profile)
        gaps = completeness_gaps(profile)
        self.assertEqual([g["label"] for g in gaps], missing)
        self.assertIn("has_project_or_thesis", [g["check"] for g in gaps])
        # the highest-weight student gap leads
        self.assertEqual(gaps[0]["check"], "has_project_or_thesis")

    def test_full_student_has_no_gaps(self) -> None:
        self.assertEqual(completeness_gaps(_full_student()), [])

    def test_normalize_resolves_provenance_and_stamps_completeness(self) -> None:
        profile = _full_student()
        # thesis evidence left at default 'unknown' provenance -> resolved to 'thesis'
        score, missing = normalize_profile(profile)
        thesis = next(e for e in profile.evidence if e.kind == "thesis")
        self.assertEqual(thesis.provenance, "thesis")
        self.assertGreater(profile.completeness, 0.0)
        # normalize returns the SAME (score, missing) it stamped — callers reuse it
        # instead of re-running the checklist.
        self.assertEqual(score, profile.completeness)
        self.assertEqual((score, missing), completeness(profile))


if __name__ == "__main__":
    unittest.main()
