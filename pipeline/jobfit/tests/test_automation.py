from __future__ import annotations

import unittest

from pipeline.jobfit import automation
from pipeline.jobfit.matching import MatchCandidate, score_job

from pipeline.jobfit.tests._helpers import mkjob as _mkjob


def mkjob(**over):
    # This suite's canonical posting is a "Backend Engineer"; defer everything
    # else to the shared factory.
    base = {"title": "Backend Engineer", "description": "A backend team."}
    base.update(over)
    return _mkjob(**base)


BAU = MatchCandidate(
    skills=["Python", "Django"], seniority="senior", role_family="software_engineering",
    languages=["English"], archetype="bau",
)
STUDENT = MatchCandidate(
    skills=["HTML"], seniority="junior", role_family="software_engineering", languages=["English"],
    archetype="student", potential_score=0.6,
)


class PolicyTest(unittest.TestCase):
    def ev(self, **kw):
        base = {"stage": "AI-matched", "archetype": "bau", "matchScore": 60, "daysInStage": 0, "approvalKind": None}
        base.update(kw)
        return automation.evaluate_entry(base)

    def test_bau_high_advances(self):
        d = self.ev(matchScore=75)
        self.assertEqual((d["action"], d["toStage"]), ("advance", "Screening"))

    def test_bau_low_rejects(self):
        self.assertEqual(self.ev(matchScore=35)["action"], "reject")

    def test_bau_mid_holds(self):
        self.assertEqual(self.ev(matchScore=60)["action"], "hold")

    def test_early_career_never_advances_or_rejects(self):
        for score in (95, 20):
            d = self.ev(archetype="student", matchScore=score)
            self.assertEqual(d["action"], "hold", f"score {score}")

    def test_screening_auto_advance_when_aged_and_unblocked(self):
        d = self.ev(stage="Screening", daysInStage=3, approvalKind=None)
        self.assertEqual((d["action"], d["toStage"]), ("advance", "Interview"))

    def test_screening_with_pending_approval_holds(self):
        self.assertEqual(self.ev(stage="Screening", approvalKind="screening_review", daysInStage=9)["action"], "hold")

    def test_interview_always_manual(self):
        self.assertEqual(self.ev(stage="Interview", daysInStage=9)["action"], "hold")

    def test_aging_alerts(self):
        self.assertIn("stale_alert", self.ev(matchScore=60, daysInStage=25)["alerts"])
        self.assertIn("aging_alert", self.ev(matchScore=60, daysInStage=35)["alerts"])

    def test_recent_screening_skips(self):
        self.assertEqual(self.ev(matchScore=90, recentScreening=True)["action"], "none")


class ScreeningTest(unittest.TestCase):
    def test_bau_strong_advances(self):
        job = mkjob()
        m = score_job(BAU, job)
        result, source = automation.screen_candidate(BAU, job, m, provider=None)
        self.assertEqual(source, "deterministic")
        self.assertEqual(result["recommendation"], "advance")
        self.assertEqual(result["route"], "advance")

    def test_early_career_fairness_gate_forces_hold(self):
        # Student with learnable gaps + low score must never be rejected; routed to a human.
        job = mkjob(requirements=[{"skill": "Go", "kind": "must_have", "hardness": "prerequisite"}])
        m = score_job(STUDENT, job)
        self.assertLess(m.total, 55)
        result, _ = automation.screen_candidate(STUDENT, job, m, provider=None)
        self.assertEqual(result["recommendation"], "hold")
        self.assertEqual(result["route"], "hold")

    def test_early_career_never_rejected_even_without_gate(self):
        low = MatchCandidate(skills=["HTML"], seniority="junior", role_family="software_engineering",
                             languages=["English"], archetype="student", potential_score=0.2)
        job = mkjob(requirements=[{"skill": "Rust", "kind": "must_have", "hardness": "prerequisite"}])
        result, _ = automation.screen_candidate(low, job, score_job(low, job), provider=None)
        self.assertNotEqual(result["recommendation"], "reject")


class DraftsTest(unittest.TestCase):
    def setUp(self):
        self.job = mkjob()
        self.m = score_job(BAU, self.job)

    def test_outreach_deterministic(self):
        r, src = automation.draft_outreach(BAU, self.job, ["Python"], provider=None)
        self.assertEqual(src, "deterministic")
        self.assertTrue(r["subject"] and r["body"])

    def test_rejection_deterministic(self):
        r, _ = automation.draft_rejection(BAU, self.job, self.m, "Screening", provider=None)
        self.assertTrue(r["body"])

    def test_prep_deterministic(self):
        r, _ = automation.interview_prep(BAU, self.job, self.m, provider=None)
        self.assertTrue(len(r["questions"]) >= 1)
        self.assertIn("question", r["questions"][0])

    def test_scorecard_deterministic(self):
        r, _ = automation.interview_scorecard(BAU, self.job, "Strong on Python, weak on system design.", provider=None)
        self.assertIn(r["recommendation"], ("advance", "hold", "reject"))
        self.assertTrue(r["ratings"])


class RematchTest(unittest.TestCase):
    def test_finds_best_alternative_excluding_current(self):
        cur = mkjob(title="Cur Python", requirements=[{"skill": "Python", "kind": "must_have", "hardness": "prerequisite"}])
        alt = mkjob(title="Alt Python/Django", requirements=[
            {"skill": "Python", "kind": "must_have", "hardness": "prerequisite"},
            {"skill": "Django", "kind": "must_have", "hardness": "prerequisite"},
        ])
        far = mkjob(title="PM role", role_family="product_project", requirements=[{"skill": "product management", "kind": "must_have", "hardness": "prerequisite"}])
        out = automation.rematch_candidate(BAU, cur.id, [cur, alt, far], provider=None)
        self.assertTrue(out["found"])
        self.assertEqual(out["jobId"], alt.id)
        self.assertNotEqual(out["jobId"], cur.id)

    def test_no_alternative_above_floor(self):
        weak = MatchCandidate(skills=["Figma"], seniority="junior", role_family="software_engineering", languages=["English"], archetype="bau")
        job = mkjob(requirements=[{"skill": "Rust", "kind": "must_have", "hardness": "prerequisite"}], seniority="senior", description="seasoned only")
        out = automation.rematch_candidate(weak, "other", [job], provider=None)
        self.assertFalse(out["found"])


class OfferTest(unittest.TestCase):
    def test_offer_stays_within_band(self):
        job = mkjob()
        out, _ = automation.draft_offer(BAU, job, score_job(BAU, job), provider=None)
        self.assertLessEqual(out["salaryMin"], out["recommended"])
        self.assertLessEqual(out["recommended"], out["salaryMax"])
        self.assertTrue(out["subject"] and out["body"])

    def test_offer_scales_with_match(self):
        job = mkjob()
        strong = MatchCandidate(skills=["Python", "Django", "PostgreSQL"], seniority="senior", role_family="software_engineering", languages=["English"], archetype="bau")
        weak = MatchCandidate(skills=["Python"], seniority="medior", role_family="software_engineering", languages=["English"], archetype="bau")
        hi, _ = automation.draft_offer(strong, job, score_job(strong, job), provider=None)
        lo, _ = automation.draft_offer(weak, job, score_job(weak, job), provider=None)
        self.assertGreaterEqual(hi["recommended"], lo["recommended"])

    def test_offer_falls_back_to_seniority_band_without_role_band(self):
        # a role_family/seniority with no role_band still yields a usable band
        out, _ = automation.draft_offer(BAU, mkjob(role_family="other", seniority="lead"), score_job(BAU, mkjob(role_family="other", seniority="lead")), provider=None)
        self.assertGreater(out["recommended"], 0)
        self.assertLessEqual(out["salaryMin"], out["recommended"])


if __name__ == "__main__":
    unittest.main()
