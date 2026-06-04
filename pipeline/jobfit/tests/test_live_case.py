"""The live-case -> observed-provenance loop: a passed work sample becomes an
`observed` Evidence item that transform/matching credit at full trust and that
narrows the early-career confidence band. A weak performance adds nothing.
"""
from __future__ import annotations

import unittest

from pipeline.jobfit.devcase.models import CaseEvaluation, CaseScenario, RoleSpec, TransferAssessment
from pipeline.jobfit.jobs import normalize_job
from pipeline.jobfit.live_case import (
    CASE_CONSTRUCTS,
    apply_interview_case,
    apply_live_case,
    observed_evidence,
    observed_from_interview,
)
from pipeline.jobfit.matching import score_job
from pipeline.jobfit.profile import CandidateProfileV2, SkillClaim
from pipeline.jobfit.transform import build_match_candidate

JOB = normalize_job(
    {
        "title": "Junior Backend Developer",
        "seniority": "junior",
        "role_family": "software_engineering",
        "languages": ["English"],
        "description": "Graduates welcome; mentoring provided.",
        "requirements": [{"skill": "Python", "kind": "must_have", "hardness": "learnable"}],
    }
)


def _student() -> CandidateProfileV2:
    # A thin, all-low-provenance early-career profile — the case is its first hard evidence.
    return CandidateProfileV2(
        archetype="student",
        role_family="software_engineering",
        seniority="junior",
        languages=["English"],
        skill_claims=[
            SkillClaim(skill="Python", provenance="coursework"),
            SkillClaim(skill="SQL", provenance="coursework"),
            SkillClaim(skill="Git", provenance="self_declared"),
        ],
    )


class ObservedEvidenceTest(unittest.TestCase):
    def test_pass_emits_observed_evidence_for_transferred_must_haves(self):
        role = RoleSpec(title="Backend", role_family="software_engineering", seniority="junior",
                        must_haves=["Python", "SQL", "Docker"])
        transfer = TransferAssessment(transfer_score=78, transfers=["Python", "SQL"])  # Docker did NOT transfer
        ev = observed_evidence(role, CaseScenario(title="Mini API"), CaseEvaluation(summary="Handled it well."), transfer)
        self.assertIsNotNone(ev)
        self.assertEqual(ev.kind, "live_case")
        self.assertEqual(ev.provenance, "observed")
        self.assertEqual(ev.resolved_provenance(), "observed")
        self.assertEqual(ev.skills, ["Python", "SQL"])  # only the must-haves that transferred
        self.assertGreater(ev.confidence, 0.7)

    def test_weak_performance_adds_nothing(self):
        role = RoleSpec(must_haves=["Python"], role_family="software_engineering", seniority="junior")
        transfer = TransferAssessment(transfer_score=40, transfers=["Python"])
        self.assertIsNone(observed_evidence(role, CaseScenario(), CaseEvaluation(), transfer))
        prof = _student()
        before = len(prof.evidence)
        updated, credited = apply_live_case(prof, role, CaseScenario(), CaseEvaluation(), transfer)
        self.assertEqual(credited, [])
        self.assertEqual(len(updated.evidence), before)  # never fabricates unearned evidence

    def test_loop_closes_observed_narrows_early_career_band(self):
        role = RoleSpec(title="Backend", role_family="software_engineering", seniority="junior",
                        must_haves=["Python", "SQL"])
        transfer = TransferAssessment(transfer_score=82, transfers=["Python", "SQL"])

        base = score_job(build_match_candidate(_student()), JOB)

        enriched, credited = apply_live_case(_student(), role, CaseScenario(title="Mini API"),
                                             CaseEvaluation(summary="Good ambiguity handling."), transfer)
        self.assertEqual(set(credited), {"Python", "SQL"})
        cand = build_match_candidate(enriched)
        # transform consolidates the observed Evidence over the coursework claims.
        self.assertEqual(cand.skill_provenance.get("Python"), "observed")
        scored = score_job(cand, JOB)

        base_spread = base.confidence.high - base.confidence.low
        observed_spread = scored.confidence.high - scored.confidence.low
        self.assertLess(observed_spread, base_spread)  # the live case de-risks the thin CV
        self.assertTrue(any("observed" in d.lower() for d in scored.confidence.drivers))


def _case_scorecard(
    ratings_by_construct: dict[str, int] | None = None,
    *,
    level: str = "moderate",
    unassessed: tuple[str, ...] = (),
) -> dict:
    """A scorecard whose case-fed constructs default to 4/5 with quoted evidence."""
    ratings = []
    for construct in CASE_CONSTRUCTS:
        if construct in unassessed:
            ratings.append({"competency": construct, "rating": 3, "evidence": "Not assessed."})
        else:
            ratings.append(
                {
                    "competency": construct,
                    "rating": (ratings_by_construct or {}).get(construct, 4),
                    "evidence": f"“quoted answer about {construct}”",
                }
            )
    return {
        "ratings": ratings,
        "summary": "Strong case discussion.",
        "recommendation": "advance",
        "scoringModel": "early_career",
        "confidence": {"level": level, "reason": "test"},
    }


class ObservedFromInterviewTest(unittest.TestCase):
    role = RoleSpec(title="Backend", role_family="software_engineering", seniority="junior",
                    must_haves=["Python", "SQL"])
    case = CaseScenario(title="Order notifications")

    def test_case_constructs_come_from_the_shared_script(self):
        # The gate judges exactly what the case-grounded phases feed — nothing else.
        self.assertEqual(
            set(CASE_CONSTRUCTS),
            {"Conceptual depth", "Problem decomposition", "Coachability", "Learning agility"},
        )

    def test_strong_case_interview_mints_observed(self):
        ev = observed_from_interview(self.role, self.case, _case_scorecard())
        self.assertIsNotNone(ev)
        self.assertEqual(ev.provenance, "observed")
        self.assertEqual(ev.resolved_provenance(), "observed")
        self.assertEqual(ev.skills, ["Python", "SQL"])
        self.assertIn("Case-grounded interview", ev.title)
        self.assertLessEqual(ev.confidence, 0.9)  # capped below the take-home's 0.95

    def test_wide_confidence_never_mints(self):
        self.assertIsNone(observed_from_interview(self.role, self.case, _case_scorecard(level="wide")))

    def test_unassessed_construct_never_mints(self):
        sc = _case_scorecard(unassessed=("Coachability",))
        self.assertIsNone(observed_from_interview(self.role, self.case, sc))

    def test_below_bar_never_mints(self):
        sc = _case_scorecard({c: 3 for c in CASE_CONSTRUCTS})
        self.assertIsNone(observed_from_interview(self.role, self.case, sc))

    def test_apply_interview_case_closes_the_loop(self):
        enriched, credited = apply_interview_case(_student(), self.role, self.case, _case_scorecard())
        self.assertEqual(credited, ["Python", "SQL"])
        cand = build_match_candidate(enriched)
        self.assertEqual(cand.skill_provenance.get("Python"), "observed")
        scored = score_job(cand, JOB)
        self.assertTrue(any("observed" in d.lower() for d in scored.confidence.drivers))


if __name__ == "__main__":
    unittest.main()
