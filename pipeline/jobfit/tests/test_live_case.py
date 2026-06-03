"""The live-case -> observed-provenance loop: a passed work sample becomes an
`observed` Evidence item that transform/matching credit at full trust and that
narrows the early-career confidence band. A weak performance adds nothing.
"""
from __future__ import annotations

import unittest

from pipeline.jobfit.devcase.models import CaseEvaluation, CaseScenario, RoleSpec, TransferAssessment
from pipeline.jobfit.jobs import normalize_job
from pipeline.jobfit.live_case import apply_live_case, observed_evidence
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


if __name__ == "__main__":
    unittest.main()
