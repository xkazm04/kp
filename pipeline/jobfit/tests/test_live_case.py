"""The live-case -> observed-provenance loop: a passed work sample becomes an
`observed` Evidence item that transform/matching credit at full trust and that
narrows the early-career confidence band. A weak performance adds nothing, and
neither does a high score riding on degraded (low-confidence) evidence.
"""
from __future__ import annotations

import unittest

from pipeline.jobfit.devcase.models import LOW_CONFIDENCE, CaseEvaluation, CaseScenario, RoleSpec, TransferAssessment
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
        transfer = TransferAssessment(transfer_score=78, transfers=["Python", "SQL"], confidence=0.8)  # Docker did NOT transfer
        ev = observed_evidence(role, CaseScenario(title="Mini API"), CaseEvaluation(summary="Handled it well."), transfer)
        self.assertIsNotNone(ev)
        self.assertEqual(ev.kind, "live_case")
        self.assertEqual(ev.provenance, "observed")
        self.assertEqual(ev.resolved_provenance(), "observed")
        self.assertEqual(ev.skills, ["Python", "SQL"])  # only the must-haves that transferred
        self.assertGreater(ev.confidence, 0.7)

    def test_short_must_have_not_credited_off_substring_of_a_dimension_label(self):
        # live_case #1: "R" is a SUBSTRING of "Strong framing" but not a whole token.
        # The old bidirectional `in` test minted "R"/"Go" as OBSERVED (highest trust)
        # off deterministic transfer labels the candidate never demonstrated. Whole-
        # token matching must credit nothing here.
        role = RoleSpec(title="Analyst", role_family="software_engineering", seniority="junior",
                        must_haves=["R", "Go"])
        transfer = TransferAssessment(transfer_score=80, transfers=["Strong framing", "Clear communication"], confidence=0.8)
        self.assertIsNone(observed_evidence(role, CaseScenario(), CaseEvaluation(summary="Did well."), transfer))

    def test_short_must_have_still_credited_as_a_whole_token(self):
        # The fix does not over-correct: "Go"/"R" appearing as standalone tokens in a
        # transfer are legitimately credited.
        role = RoleSpec(title="Analyst", role_family="software_engineering", seniority="junior",
                        must_haves=["Go", "R"])
        transfer = TransferAssessment(transfer_score=80, transfers=["Used Go for the service", "Ran R for the analysis"], confidence=0.8)
        ev = observed_evidence(role, CaseScenario(), CaseEvaluation(summary="Did well."), transfer)
        self.assertIsNotNone(ev)
        self.assertEqual(sorted(ev.skills), ["Go", "R"])

    def test_weak_performance_adds_nothing(self):
        role = RoleSpec(must_haves=["Python"], role_family="software_engineering", seniority="junior")
        # Confidence is healthy on purpose — this pins the SCORE gate, not the confidence one.
        transfer = TransferAssessment(transfer_score=40, transfers=["Python"], confidence=0.8)
        self.assertIsNone(observed_evidence(role, CaseScenario(), CaseEvaluation(), transfer))
        prof = _student()
        before = len(prof.evidence)
        updated, credited = apply_live_case(prof, role, CaseScenario(), CaseEvaluation(), transfer)
        self.assertEqual(credited, [])
        self.assertEqual(len(updated.evidence), before)  # never fabricates unearned evidence

    def test_loop_closes_observed_narrows_early_career_band(self):
        role = RoleSpec(title="Backend", role_family="software_engineering", seniority="junior",
                        must_haves=["Python", "SQL"])
        transfer = TransferAssessment(transfer_score=82, transfers=["Python", "SQL"], confidence=0.8)

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


class MintingHonestyGatesTest(unittest.TestCase):
    """biz-ui-scan-2026-06-12 #2 — the take-home path's honesty gates: a degraded
    (low-confidence) assessment never mints however high its score, a gap-listed
    must-have is never credited, and transfers that match no must-have credit
    NOTHING instead of everything."""

    role = RoleSpec(title="Backend", role_family="software_engineering", seniority="junior",
                    must_haves=["Python", "SQL", "Docker"])
    case = CaseScenario(title="Mini API")

    def test_low_confidence_assessment_never_mints(self):
        # Propagated confidence 0.2 = the deterministic tooling fallback — models.py
        # says "treat as a weak hint only"; a passing 68 on top of it proves nothing.
        transfer = TransferAssessment(transfer_score=68, transfers=["Python", "SQL"], confidence=0.2)
        self.assertIsNone(observed_evidence(self.role, self.case, CaseEvaluation(), transfer))
        updated, credited = apply_live_case(_student(), self.role, self.case, CaseEvaluation(), transfer)
        self.assertEqual(credited, [])
        self.assertFalse(any(e.provenance == "observed" for e in updated.evidence))
        self.assertEqual(updated.archetype_reasons, [])  # no routing lift either

    def test_confidence_gate_uses_the_exported_threshold(self):
        # LOW_CONFIDENCE is "at or below this ... thin" — exactly at it stays blocked.
        transfer = TransferAssessment(transfer_score=80, transfers=["Python"], confidence=LOW_CONFIDENCE)
        self.assertIsNone(observed_evidence(self.role, self.case, CaseEvaluation(), transfer))
        transfer.confidence = LOW_CONFIDENCE + 0.01
        self.assertIsNotNone(observed_evidence(self.role, self.case, CaseEvaluation(), transfer))

    def test_gap_listed_must_have_is_never_credited(self):
        # The assessor explicitly said Docker did NOT transfer; even with a
        # contradictory transfers entry, gaps win — credit is earned, not inferred.
        transfer = TransferAssessment(transfer_score=80, transfers=["Python", "Docker"],
                                      gaps=["Docker"], confidence=0.8)
        ev = observed_evidence(self.role, self.case, CaseEvaluation(), transfer)
        self.assertIsNotNone(ev)
        self.assertEqual(ev.skills, ["Python"])

    def test_unmatched_transfers_credit_nothing_not_everything(self):
        # The deterministic transfer path emits dimension labels, never skills —
        # the old `matched or musts` fallback credited EVERY must-have here.
        transfer = TransferAssessment(transfer_score=68, transfers=["Strong framing", "Strong judgment"],
                                      confidence=0.8)
        self.assertIsNone(observed_evidence(self.role, self.case, CaseEvaluation(), transfer))
        updated, credited = apply_live_case(_student(), self.role, self.case, CaseEvaluation(), transfer)
        self.assertEqual(credited, [])
        self.assertFalse(any(e.provenance == "observed" for e in updated.evidence))

    def test_outcome_reason_reports_why(self):
        # The MintOutcome 2-tuple still unpacks as before; .reason adds the narrative.
        eval_ = CaseEvaluation()
        ok = TransferAssessment(transfer_score=80, transfers=["Python"], confidence=0.8)
        self.assertEqual(apply_live_case(_student(), self.role, self.case, eval_, ok).reason, "minted")
        low = TransferAssessment(transfer_score=80, transfers=["Python"], confidence=0.2)
        self.assertEqual(apply_live_case(_student(), self.role, self.case, eval_, low).reason, "low_confidence")
        weak = TransferAssessment(transfer_score=40, transfers=["Python"], confidence=0.8)
        self.assertEqual(apply_live_case(_student(), self.role, self.case, eval_, weak).reason, "below_bar")
        unmatched = TransferAssessment(transfer_score=80, transfers=["Strong framing"], confidence=0.8)
        self.assertEqual(apply_live_case(_student(), self.role, self.case, eval_, unmatched).reason,
                         "no_transferred_must_haves")


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


class RoutingCorroborationTest(unittest.TestCase):
    """A passed work sample is routing evidence too: it nudges an unsettled
    archetype confidence up (bounded, never past the ceiling — performing well is
    corroboration, not identity), while a failed one touches nothing."""

    role = RoleSpec(title="Backend", role_family="software_engineering", seniority="junior",
                    must_haves=["Python", "SQL"])
    case = CaseScenario(title="Order notifications")

    def _unsettled_student(self) -> CandidateProfileV2:
        prof = _student()
        prof.archetype_confidence = 0.5  # heuristic routing, below the manual-review line
        return prof

    def test_minting_lifts_unsettled_confidence_and_records_why(self):
        transfer = TransferAssessment(transfer_score=82, transfers=["Python", "SQL"], confidence=0.8)
        enriched, credited = apply_live_case(self._unsettled_student(), self.role, self.case,
                                             CaseEvaluation(summary="Solid."), transfer)
        self.assertTrue(credited)
        self.assertEqual(enriched.archetype_confidence, 0.65)  # 0.5 + 0.15, inside the ceiling
        self.assertTrue(any("routing corroborated" in r for r in enriched.archetype_reasons))

    def test_lift_never_exceeds_the_ceiling(self):
        prof = self._unsettled_student()
        prof.archetype_confidence = 0.7
        transfer = TransferAssessment(transfer_score=82, transfers=["Python", "SQL"], confidence=0.8)
        enriched, _ = apply_live_case(prof, self.role, self.case, CaseEvaluation(), transfer)
        self.assertEqual(enriched.archetype_confidence, 0.75)

    def test_settled_confidence_is_left_alone(self):
        prof = self._unsettled_student()
        prof.archetype_confidence = 0.9  # a real self-declaration outranks corroboration
        transfer = TransferAssessment(transfer_score=82, transfers=["Python", "SQL"], confidence=0.8)
        enriched, _ = apply_live_case(prof, self.role, self.case, CaseEvaluation(), transfer)
        self.assertEqual(enriched.archetype_confidence, 0.9)

    def test_failed_case_touches_nothing(self):
        prof = self._unsettled_student()
        transfer = TransferAssessment(transfer_score=40, transfers=["Python"], confidence=0.8)
        enriched, credited = apply_live_case(prof, self.role, self.case, CaseEvaluation(), transfer)
        self.assertEqual(credited, [])
        self.assertEqual(enriched.archetype_confidence, 0.5)
        self.assertFalse(any("routing corroborated" in r for r in enriched.archetype_reasons))

    def test_interview_minting_corroborates_too(self):
        enriched, credited = apply_interview_case(self._unsettled_student(), self.role, self.case,
                                                  _case_scorecard())
        self.assertTrue(credited)
        self.assertTrue(any("routing corroborated" in r for r in enriched.archetype_reasons))
        self.assertEqual(enriched.archetype_confidence, 0.65)


if __name__ == "__main__":
    unittest.main()
