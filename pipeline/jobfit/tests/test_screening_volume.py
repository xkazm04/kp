"""AI screening strictness scales with pipeline VOLUME — the tiers and the gate.

The product rule, from the owner: at Accepted -> Screened the AI screener must not
hard-reject a candidate for coming from a neighbouring area while the role holds a
handful of candidates. A person from the same high-level area but a different role
is worth a human look then (`hold`); once the role has dozens to hundreds of
applicants the screener may be strict and recommend `reject` for a clear area
mismatch.

Three properties are pinned here, because each can regress independently:

  * the THRESHOLDS (``screening_volume_tier``) — including the fail-safe that an
    unknown count is the LENIENT tier, never 0-and-strict;
  * the GATE (``volume_allows_reject``) — the one predicate both the LLM path and
    the deterministic keyless path run, so they cannot disagree;
  * the deterministic FALLBACK verdict at each tier, and that the model's own
    "reject" is rewritten by the same gate afterwards.

The early-career fairness gate is untouched by all of this and is re-asserted here
at every tier: it is absolute, and a volume rule must never be able to loosen it.
"""

from __future__ import annotations

import unittest

from pipeline.jobfit import automation
from pipeline.jobfit.matching import MatchCandidate, score_job

from pipeline.jobfit.tests._helpers import mkjob

# A weak candidate in the role's OWN family: the "same high-level area, different
# role" case the rule is written for. 33-point match — below every advance/hold
# floor, so the deterministic builder's unconstrained verdict is "reject".
RELATED_WEAK = MatchCandidate(
    skills=["HTML"], seniority="junior", role_family="software_engineering",
    languages=["English"], archetype="bau",
)
# The clear area mismatch: a different family, no career-switcher bridge.
UNRELATED_WEAK = MatchCandidate(
    skills=["HTML"], seniority="junior", role_family="healthcare_clinical",
    languages=["English"], archetype="bau",
)
# A career switcher whose prior domain is graded ADJACENT — a neighbouring field, so
# "related area" even though the family differs.
ADJACENT_SWITCHER = MatchCandidate(
    skills=["HTML"], seniority="junior", role_family="healthcare_clinical",
    languages=["English"], archetype="bau", domain_distance="adjacent",
)
EARLY_WEAK = MatchCandidate(
    skills=["HTML"], seniority="junior", role_family="healthcare_clinical",
    languages=["English"], archetype="student", potential_score=0.2,
)


class _CaptureProvider:
    """Fake provider: records the prompt and returns a canned payload."""

    def __init__(self, payload):
        self.payload = payload
        self.prompt = None

    def complete_json(self, prompt, system=None, expected_keys=None):
        self.prompt = prompt
        return self.payload


class ScreeningVolumeTierTest(unittest.TestCase):
    def test_thresholds(self) -> None:
        sparse_max = automation.POLICY["screen_volume_sparse_max"]
        moderate_max = automation.POLICY["screen_volume_moderate_max"]
        # The boundaries themselves, from the policy rather than from literals, so a
        # deliberate retune moves the test with the rule instead of reddening it.
        self.assertEqual(automation.screening_volume_tier(0), "sparse")
        self.assertEqual(automation.screening_volume_tier(sparse_max), "sparse")
        self.assertEqual(automation.screening_volume_tier(sparse_max + 1), "moderate")
        self.assertEqual(automation.screening_volume_tier(moderate_max), "moderate")
        self.assertEqual(automation.screening_volume_tier(moderate_max + 1), "dense")
        self.assertEqual(automation.screening_volume_tier(10_000), "dense")
        # …and the shipped numbers, so a silent retune is a visible diff.
        self.assertEqual((sparse_max, moderate_max), (5, 30))

    def test_every_tier_is_declared(self) -> None:
        tiers = {automation.screening_volume_tier(n) for n in (0, 3, 5, 6, 30, 31, 900)}
        self.assertEqual(tiers, set(automation.SCREENING_VOLUME_TIERS))

    def test_unknown_count_is_the_lenient_tier_not_zero(self) -> None:
        # The fail-safe direction: a caller that cannot count must never get the
        # strict rule, and must not be silently reported as "0 candidates" either.
        for unknown in (None, "", "many", object()):
            with self.subTest(value=unknown):
                self.assertEqual(automation.screening_volume_tier(unknown), automation.SCREENING_VOLUME_FALLBACK)
                self.assertIsNone(automation.normalize_pipeline_size(unknown))
        self.assertEqual(automation.SCREENING_VOLUME_FALLBACK, "sparse")
        # A negative count is nonsense, not density.
        self.assertEqual(automation.screening_volume_tier(-4), "sparse")

    def test_normalize_keeps_a_real_count(self) -> None:
        self.assertEqual(automation.normalize_pipeline_size(0), 0)
        self.assertEqual(automation.normalize_pipeline_size(47), 47)
        self.assertEqual(automation.normalize_pipeline_size("12"), 12)


class VolumeGateTest(unittest.TestCase):
    def test_related_area_is_rejectable_only_when_dense(self) -> None:
        self.assertFalse(automation.volume_allows_reject("sparse", True))
        self.assertFalse(automation.volume_allows_reject("moderate", True))
        self.assertTrue(automation.volume_allows_reject("dense", True))

    def test_a_clear_area_mismatch_is_rejectable_at_every_volume(self) -> None:
        for tier in automation.SCREENING_VOLUME_TIERS:
            with self.subTest(tier=tier):
                self.assertTrue(automation.volume_allows_reject(tier, False))


class RelatedAreaSignalTest(unittest.TestCase):
    """The area signal is READ OFF the matcher's existing fields — role_family and
    the career-switcher domain_distance grade — never re-derived here."""

    def test_same_role_family_is_related(self) -> None:
        self.assertTrue(automation.related_area(RELATED_WEAK, mkjob()))

    def test_different_family_is_not(self) -> None:
        self.assertFalse(automation.related_area(UNRELATED_WEAK, mkjob()))

    def test_adjacent_domain_distance_is_related(self) -> None:
        self.assertTrue(automation.related_area(ADJACENT_SWITCHER, mkjob()))

    def test_a_far_or_moderate_bridge_is_not(self) -> None:
        for distance in ("moderate", "far", None):
            with self.subTest(distance=distance):
                cand = UNRELATED_WEAK.model_copy(update={"domain_distance": distance})
                self.assertFalse(automation.related_area(cand, mkjob()))


class DeterministicVerdictByVolumeTest(unittest.TestCase):
    """The keyless fallback at each tier — the path a self-hosted install with no
    API key actually runs, so it carries the rule, not just the prompt."""

    def setUp(self) -> None:
        self.job = mkjob()

    def screen(self, cand, size):
        m = score_job(cand, self.job)
        self.assertLess(m.total, 55, "fixture must sit below the screening floor")
        return automation.screen_candidate(cand, self.job, m, provider=None, pipeline_size=size)

    def test_related_area_is_held_when_sparse_or_moderate(self) -> None:
        for size, tier in ((0, "sparse"), (4, "sparse"), (6, "moderate"), (30, "moderate")):
            with self.subTest(size=size):
                result, source = self.screen(RELATED_WEAK, size)
                self.assertEqual(source, "deterministic")
                self.assertEqual(result["recommendation"], "hold")
                self.assertEqual(result["screeningVolume"], tier)
                self.assertEqual(result["pipelineSize"], size)
                self.assertTrue(result["relatedArea"])

    def test_related_area_may_be_rejected_when_dense(self) -> None:
        result, _ = self.screen(RELATED_WEAK, 80)
        self.assertEqual(result["recommendation"], "reject")
        self.assertEqual(result["screeningVolume"], "dense")
        # …and it is STILL never an automated reject route (SCREEN_ROUTES).
        self.assertEqual(result["route"], "hold")

    def test_a_clear_mismatch_is_rejected_at_every_volume(self) -> None:
        for size in (0, 4, 20, 500):
            with self.subTest(size=size):
                result, _ = self.screen(UNRELATED_WEAK, size)
                self.assertEqual(result["recommendation"], "reject")

    def test_an_adjacent_switcher_is_held_when_sparse(self) -> None:
        result, _ = self.screen(ADJACENT_SWITCHER, 3)
        self.assertEqual(result["recommendation"], "hold")

    def test_an_unknown_count_holds_a_related_candidate(self) -> None:
        result, _ = self.screen(RELATED_WEAK, None)
        self.assertEqual(result["recommendation"], "hold")
        self.assertEqual(result["screeningVolume"], "sparse")
        self.assertIsNone(result["pipelineSize"])

    def test_the_early_career_gate_is_unchanged_at_every_volume(self) -> None:
        # EARLY_WEAK is a clear area mismatch, so ONLY the early-career gate stands
        # between them and a reject — at every volume, including dense.
        for size in (0, 4, 20, 5_000):
            with self.subTest(size=size):
                result, _ = self.screen(EARLY_WEAK, size)
                self.assertNotEqual(result["recommendation"], "reject")
                self.assertEqual(result["route"], "hold")


class VolumeGateAfterTheModelTest(unittest.TestCase):
    """The model cannot talk past the gate — same shape as the early-career rewrite."""

    def setUp(self) -> None:
        self.job = mkjob()
        self.m = score_job(RELATED_WEAK, self.job)

    def test_a_model_reject_is_rewritten_to_hold_when_sparse(self) -> None:
        cap = _CaptureProvider({"recommendation": "reject", "confidence": 99, "rationale": "no"})
        result, _ = automation.screen_candidate(
            RELATED_WEAK, self.job, self.m, provider=cap, pipeline_size=2
        )
        self.assertEqual(result["recommendation"], "hold")
        self.assertEqual(result["route"], "hold")

    def test_a_model_reject_survives_when_dense(self) -> None:
        cap = _CaptureProvider({"recommendation": "reject", "confidence": 99, "rationale": "no"})
        result, _ = automation.screen_candidate(
            RELATED_WEAK, self.job, self.m, provider=cap, pipeline_size=400
        )
        self.assertEqual(result["recommendation"], "reject")
        self.assertEqual(result["route"], "hold")

    def test_the_prompt_states_the_count_and_the_rule(self) -> None:
        # The prompt and the gate must say the same thing: a model held to an
        # unstated rule writes a rationale that contradicts the verdict it gets.
        cap = _CaptureProvider({"recommendation": "hold", "confidence": 50})
        automation.screen_candidate(RELATED_WEAK, self.job, self.m, provider=cap, pipeline_size=3)
        self.assertIn("3 active candidate(s)", cap.prompt)
        self.assertIn("SPARSE", cap.prompt)
        self.assertIn("RELATED area", cap.prompt)

        cap = _CaptureProvider({"recommendation": "hold", "confidence": 50})
        automation.screen_candidate(UNRELATED_WEAK, self.job, score_job(UNRELATED_WEAK, self.job), provider=cap, pipeline_size=90)
        self.assertIn("90 active candidate(s)", cap.prompt)
        self.assertIn("DENSE", cap.prompt)
        self.assertIn("DIFFERENT area", cap.prompt)

    def test_the_prompt_is_honest_about_an_unknown_count(self) -> None:
        cap = _CaptureProvider({"recommendation": "hold", "confidence": 50})
        automation.screen_candidate(RELATED_WEAK, self.job, self.m, provider=cap, pipeline_size=None)
        self.assertIn("not known", cap.prompt)
        self.assertNotIn("0 active candidate(s)", cap.prompt)


if __name__ == "__main__":
    unittest.main()
