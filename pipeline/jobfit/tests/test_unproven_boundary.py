"""Direction 3: the partial-vs-unproven honesty boundary in skill scoring.

score_skills used to conflate two different below-threshold states — an ADJACENT
skill (real partial: a taxonomy specialization/generalization/sibling) and a
skill CLAIMED with weak provenance — into one invisible limbo. The additive
``unproven_*`` fields now separate them so a recruiter can tell a near-miss
specialist from an unsubstantiated claim.

Boundary matrix: {exact, specialization, generalization, sibling} x {strong, weak}.
"""

from __future__ import annotations

import unittest

from pipeline.jobfit.matching import MatchCandidate, score_job, score_skills
from pipeline.jobfit.tests._helpers import mkjob

STRONG = "professional"  # provenance_weight 1.0
WEAK = "self_declared"   # provenance_weight 0.4


def _cand(skill: str, provenance: str) -> MatchCandidate:
    return MatchCandidate(
        skills=[skill], seniority="senior", role_family="software_engineering",
        languages=["English"], years_experience=6,
        skill_provenance={skill: provenance},
    )


def _job(required: str) -> object:
    return mkjob(requirements=[{"skill": required, "kind": "must_have", "hardness": "prerequisite"}])


def _run(cand_skill, provenance, required):
    return score_skills(_cand(cand_skill, provenance), _job(required))


class UnprovenBoundaryMatrixTest(unittest.TestCase):
    # --- exact -------------------------------------------------------------
    def test_exact_strong_is_matched_not_unproven(self) -> None:
        _s, matched, missing, strength, unproven = _run("python", STRONG, "python")
        self.assertIn("python", matched)
        self.assertEqual(unproven, {})
        self.assertNotIn("python", missing)

    def test_exact_weak_is_unproven_by_provenance(self) -> None:
        _s, matched, missing, _st, unproven = _run("python", WEAK, "python")
        self.assertNotIn("python", matched)
        self.assertNotIn("python", missing)  # claimed, so NOT a true miss
        self.assertIn("python", unproven)
        self.assertEqual(unproven["python"]["reason"], "provenance")
        self.assertLess(unproven["python"]["score"], 0.5)
        self.assertGreater(unproven["python"]["score"], 0.0)

    # --- specialization ----------------------------------------------------
    def test_specialization_strong_is_matched(self) -> None:
        _s, matched, _m, strength, unproven = _run("swiftui", STRONG, "swift")
        self.assertIn("swift", matched)
        self.assertLess(strength["swift"], 1.0)  # partial (0.9), but proven enough
        self.assertEqual(unproven, {})

    def test_specialization_weak_is_unproven_by_both(self) -> None:
        # A related (non-exact) skill AND weak evidence together sink it.
        _s, matched, _m, _st, unproven = _run("swiftui", WEAK, "swift")
        self.assertNotIn("swift", matched)
        self.assertEqual(unproven["swift"]["reason"], "both")

    # --- generalization ----------------------------------------------------
    def test_generalization_strong_is_matched_partial(self) -> None:
        # Foundation present (0.55) clears the 0.5 bar at strong provenance.
        _s, matched, _m, strength, unproven = _run("swift", STRONG, "swiftui")
        self.assertIn("swiftui", matched)
        self.assertAlmostEqual(strength["swiftui"], 0.55)
        self.assertEqual(unproven, {})

    def test_generalization_weak_is_unproven_by_both(self) -> None:
        _s, matched, _m, _st, unproven = _run("swift", WEAK, "swiftui")
        self.assertNotIn("swiftui", matched)
        self.assertEqual(unproven["swiftui"]["reason"], "both")

    # --- sibling -----------------------------------------------------------
    def test_sibling_strong_is_unproven_by_adjacency(self) -> None:
        # A pure adjacency miss: full provenance, but only a sibling of the need.
        _s, matched, missing, _st, unproven = _run("seo", STRONG, "ppc")
        self.assertNotIn("ppc", matched)
        self.assertNotIn("ppc", missing)
        self.assertEqual(unproven["ppc"]["reason"], "adjacency")
        self.assertAlmostEqual(unproven["ppc"]["score"], 0.4)

    def test_sibling_weak_is_unproven_by_both(self) -> None:
        _s, _m, _mi, _st, unproven = _run("seo", WEAK, "ppc")
        self.assertEqual(unproven["ppc"]["reason"], "both")

    # --- true miss stays a miss -------------------------------------------
    def test_no_claim_is_a_true_miss_not_unproven(self) -> None:
        _s, _m, missing, _st, unproven = _run("react", STRONG, "python")
        self.assertIn("python", missing)
        self.assertEqual(unproven, {})


class UnprovenPayloadTest(unittest.TestCase):
    """The MatchResult exposes the distinction additively and disjointly."""

    def test_matchresult_carries_unproven_fields(self) -> None:
        res = score_job(_cand("python", WEAK), _job("python"))
        self.assertEqual(res.unproven_skills, ["python"])
        self.assertEqual(res.unproven_skill_reason["python"], "provenance")
        self.assertLess(res.unproven_skill_strength["python"], 0.5)
        # Disjoint from matched + missing — the three buckets never overlap.
        self.assertNotIn("python", res.matched_skills)
        self.assertNotIn("python", res.missing_skills)

    def test_unproven_still_contributes_to_the_subscore(self) -> None:
        # Exposing the bucket changes no total: the skill already added best*weight.
        res = score_job(_cand("seo", STRONG), _job("ppc"))
        self.assertGreater(res.skills_score, 0.0)  # sibling nudged the sub-score
        self.assertEqual(res.unproven_skills, ["ppc"])

    def test_camel_case_serialization(self) -> None:
        res = score_job(_cand("python", WEAK), _job("python"))
        dumped = res.model_dump(by_alias=True)
        self.assertIn("unprovenSkills", dumped)
        self.assertIn("unprovenSkillReason", dumped)
        self.assertIn("unprovenSkillStrength", dumped)


if __name__ == "__main__":
    unittest.main()
