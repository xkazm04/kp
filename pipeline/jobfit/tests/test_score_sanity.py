from __future__ import annotations

import unittest

from pipeline.jobfit.models import ScoreBreakdown
from pipeline.jobfit.pipeline import (
    SCORE_TOTAL_TOLERANCE,
    _reported_score_total,
    _score_from_payload,
    _score_sanity_checks,
)


def _score(
    total: int,
    experience: int = 0,
    skills: int = 0,
    role_seniority: int = 0,
    education: int = 0,
    traits: int = 0,
) -> ScoreBreakdown:
    return ScoreBreakdown(
        total=total,
        experience=experience,
        skills=skills,
        role_seniority=role_seniority,
        education=education,
        traits=traits,
    )


class ScoreConsistencyCheckTest(unittest.TestCase):
    """The headline total and its five-component breakdown must agree — a 95 dial
    sitting over bars that add to 40 is a silent data-integrity defect that erodes
    recruiter trust, so any meaningful divergence is flagged for manual review."""

    def test_total_matching_breakdown_is_ok(self) -> None:
        # 20+25+20+10+8 == 83
        checks = _score_sanity_checks(
            _score(83, experience=20, skills=25, role_seniority=20, education=10, traits=8)
        )
        self.assertIn("Score is inside 0-100", checks)
        self.assertIn("Score total matches its breakdown", checks)
        self.assertFalse(any("disagrees with its breakdown" in c for c in checks))

    def test_total_far_above_breakdown_is_flagged(self) -> None:
        # The motivating case: a 95 total above components that sum to 40.
        checks = _score_sanity_checks(
            _score(95, experience=10, skills=12, role_seniority=10, education=5, traits=3)
        )
        flag = next((c for c in checks if "disagrees with its breakdown" in c), None)
        self.assertIsNotNone(flag, checks)
        # The flag names both numbers and the gap so a reviewer can see it by eye.
        self.assertIn("95", flag)
        self.assertIn("40", flag)
        self.assertIn("off by 55", flag)
        self.assertNotIn("Score total matches its breakdown", checks)

    def test_small_rounding_drift_is_tolerated(self) -> None:
        # A drift within tolerance is trivial model rounding, not a contradiction.
        component_sum = 50
        within = component_sum + SCORE_TOTAL_TOLERANCE
        checks = _score_sanity_checks(_score(within, skills=30, experience=20))
        self.assertIn("Score total matches its breakdown", checks)

    def test_drift_just_past_tolerance_is_flagged(self) -> None:
        component_sum = 50
        beyond = component_sum + SCORE_TOTAL_TOLERANCE + 1
        checks = _score_sanity_checks(_score(beyond, skills=30, experience=20))
        self.assertTrue(any("disagrees with its breakdown" in c for c in checks))

    def test_range_check_is_preserved(self) -> None:
        # A total outside 0-100 still reports the legacy range string unchanged.
        checks = _score_sanity_checks(_score(-5))
        self.assertIn("Score outside expected range", checks)

    def test_rederived_total_never_trips_the_flag(self) -> None:
        # When the model omits `total`, _score_from_payload re-derives it from the
        # clamped parts, so the sum is exact and the consistency line stays OK.
        score = _score_from_payload(
            {"experience": 20, "skills": 25, "role_seniority": 20, "education": 10, "traits": 8}
        )
        self.assertEqual(score.total, 83)
        checks = _score_sanity_checks(score)
        self.assertIn("Score total matches its breakdown", checks)


class ServerAuthoritativeTotalTest(unittest.TestCase):
    """Direction 2: the persisted total is ALWAYS the component sum; a divergent LLM
    total is a sanity SIGNAL only, still flagged for observability."""

    _DIVERGENT = {
        "total": 95,  # the model's inflated claim
        "experience": 10,
        "skills": 12,
        "role_seniority": 10,
        "education": 5,
        "traits": 3,  # components sum to 40
    }

    def test_persisted_total_is_the_component_sum_not_the_llm_total(self) -> None:
        score = _score_from_payload(dict(self._DIVERGENT))
        # The LLM said 95; the server overrides it with the deterministic sum (40).
        self.assertEqual(score.total, 40)

    def test_divergent_llm_total_still_flags_for_observability(self) -> None:
        # The reported total is captured separately and threaded into the sanity check
        # (same flag string/shape dashboards already scan).
        raw = dict(self._DIVERGENT)
        score = _score_from_payload(raw)
        reported = _reported_score_total(raw)
        self.assertEqual(reported, 95)
        checks = _score_sanity_checks(score, reported)
        flag = next((c for c in checks if "disagrees with its breakdown" in c), None)
        self.assertIsNotNone(flag, checks)
        self.assertIn("95", flag)  # names the model's claim
        self.assertIn("40", flag)
        self.assertIn("off by 55", flag)

    def test_omitted_total_yields_no_signal_and_no_flag(self) -> None:
        raw = {"experience": 20, "skills": 25, "role_seniority": 20, "education": 10, "traits": 8}
        self.assertIsNone(_reported_score_total(raw))
        score = _score_from_payload(raw)
        self.assertEqual(score.total, 83)
        checks = _score_sanity_checks(score, _reported_score_total(raw))
        self.assertIn("Score total matches its breakdown", checks)

    def test_agreeing_llm_total_is_not_flagged(self) -> None:
        raw = {
            "total": 83,
            "experience": 20,
            "skills": 25,
            "role_seniority": 20,
            "education": 10,
            "traits": 8,
        }
        score = _score_from_payload(raw)
        self.assertEqual(score.total, 83)
        checks = _score_sanity_checks(score, _reported_score_total(raw))
        self.assertIn("Score total matches its breakdown", checks)


if __name__ == "__main__":
    unittest.main()
