"""The scorer's edges, pinned from the PYTHON side.

``test_fit_threshold_sync.py`` binds the two floors to their TypeScript twins; what it
does not do is pin the arithmetic that produces the number being banded. Three edges
were true only by accident here:

  * the banding at 54/55 and 69/70 — asserted only through the constants, never as the
    literal integers a recruiter sees on a dial;
  * ``_weighted_total``'s rounding — Python's ``round`` is BANKER'S (round-half-even),
    so a raw x.5 does not go the way "round up" intuition says;
  * ``resolve_weights``' NaN safety and its docstring's idempotence claim — both
    emergent from ``max(floor, nan)`` and the projection loop, neither tested.

Nothing here changes behaviour: every assertion records TODAY's answer. Changing the
rounding in particular is a separate, measured decision (it moves every score sitting
on a tie) and must be made against the matching eval, not as a drive-by.
"""

from __future__ import annotations

import math
import unittest

from pipeline.jobfit import matching
from pipeline.jobfit.jobs import Job
from pipeline.jobfit.matching import MatchCandidate, fit_tier_for, match, resolve_weights

EQUAL_WEIGHTS = {"skills": 1.0, "career": 0.0, "personal": 0.0}


class FitTierBoundaryTest(unittest.TestCase):
    """The literal integers, not just the constants — a recruiter reads a number."""

    def test_the_promising_floor_is_55_and_54_is_partial(self) -> None:
        self.assertEqual(fit_tier_for(54), "partial")
        self.assertEqual(fit_tier_for(55), "promising")

    def test_the_strong_floor_is_70_and_69_is_promising(self) -> None:
        self.assertEqual(fit_tier_for(69), "promising")
        self.assertEqual(fit_tier_for(70), "strong")

    def test_the_ends_of_the_contract_band(self) -> None:
        self.assertEqual(fit_tier_for(0), "partial")
        self.assertEqual(fit_tier_for(100), "strong")

    def test_the_literals_still_match_the_exported_constants(self) -> None:
        # If someone MOVES a floor deliberately, this is the line that says the four
        # assertions above are now stale rather than letting them silently disagree.
        self.assertEqual(matching.FIT_PROMISING_THRESHOLD, 55)
        self.assertEqual(matching.FIT_STRONG_THRESHOLD, 70)


class HeadlineRoundingTest(unittest.TestCase):
    """``_weighted_total`` = ``round(100 * weighted_sum)``, clamped to 0-100."""

    def test_the_headline_is_the_clamped_rounded_percentage(self) -> None:
        self.assertEqual(matching._weighted_total(0.6, 0.0, 0.0, EQUAL_WEIGHTS), 60)
        self.assertEqual(matching._weighted_total(0.544, 0.0, 0.0, EQUAL_WEIGHTS), 54)
        self.assertEqual(matching._weighted_total(0.546, 0.0, 0.0, EQUAL_WEIGHTS), 55)

    def test_the_clamp_holds_an_out_of_contract_dimension(self) -> None:
        self.assertEqual(matching._weighted_total(2.0, 0.0, 0.0, EQUAL_WEIGHTS), 100)
        self.assertEqual(matching._weighted_total(-2.0, 0.0, 0.0, EQUAL_WEIGHTS), 0)

    def test_a_raw_545_scores_55_today_and_the_reason_is_float_not_policy(self) -> None:
        # PINNED AS TODAY'S BEHAVIOUR, and the two halves of it are worth separating.
        #
        # The POLICY is Python's `round`, which is round-half-EVEN: a true 54.5 would
        # become 54 and land in `partial`, one tier below what "round up" intuition
        # predicts. What actually happens is 55 / `promising` — because 0.545 has no
        # exact binary form and `100 * 0.545` is 54.50000000000001, a hair above the
        # tie, so the tie-break never runs.
        #
        # So the answer a recruiter sees at this boundary rests on a float artifact,
        # not on a decision anyone made. Recorded rather than corrected: changing the
        # rounding moves every score sitting on a tie and is a measured call against
        # the matching eval, not a drive-by.
        self.assertEqual(round(54.5), 54, "round() is banker's — half goes to the EVEN integer")
        self.assertNotEqual(100 * 0.545, 54.5, "0.545 has no exact binary form")
        self.assertEqual(matching._weighted_total(0.545, 0.0, 0.0, EQUAL_WEIGHTS), 55)
        self.assertEqual(fit_tier_for(55), "promising")

    def test_where_the_tie_IS_exactly_representable_bankers_rounding_is_live(self) -> None:
        # Not a theoretical concern: 0.695 and 0.705 ARE exactly representable at the
        # x.5 boundary, so the half-to-even rule really fires — and it fires in BOTH
        # directions around the `strong` floor. 69.5 goes UP to 70, 70.5 goes DOWN to
        # 70. Same rule, opposite movement; both land on `strong` here, so no tier
        # flips today, but a floor moved to 71 would make 70.5 -> 70 a demotion.
        self.assertEqual(100 * 0.695, 69.5)
        self.assertEqual(100 * 0.705, 70.5)
        self.assertEqual(matching._weighted_total(0.695, 0.0, 0.0, EQUAL_WEIGHTS), 70)
        self.assertEqual(matching._weighted_total(0.705, 0.0, 0.0, EQUAL_WEIGHTS), 70)
        self.assertEqual(fit_tier_for(70), "strong")


class ResolveWeightsTest(unittest.TestCase):
    """Contract of the bounded simplex projection: in-bounds, sums to 1, no NaN."""

    def test_no_proposal_returns_the_archetype_baseline_unchanged(self) -> None:
        for archetype in matching.WEIGHTS:
            with self.subTest(archetype=archetype):
                self.assertEqual(resolve_weights(archetype), dict(matching.weights_for(archetype)))
                self.assertEqual(resolve_weights(archetype, {}), dict(matching.weights_for(archetype)))

    def test_a_nan_slot_clamps_to_its_floor_and_never_propagates(self) -> None:
        # `max(floor, nan)` returns the floor because every comparison with NaN is
        # False — true, but true by accident, and a NaN reaching the weighted total
        # would slip past the headline's min/max clamp as a NaN score.
        resolved = resolve_weights("bau", {"skills": float("nan"), "career": 0.3, "personal": 0.3})
        for slot, value in resolved.items():
            self.assertTrue(math.isfinite(value), f"{slot} is not finite: {value}")
        floor = matching.weight_bounds("bau")["skills"][0]
        self.assertGreaterEqual(resolved["skills"], floor)
        self.assertAlmostEqual(sum(resolved.values()), 1.0, places=3)

    def test_an_all_nan_proposal_still_yields_a_usable_vector(self) -> None:
        nan = float("nan")
        resolved = resolve_weights("bau", {"skills": nan, "career": nan, "personal": nan})
        self.assertTrue(all(math.isfinite(v) for v in resolved.values()))
        self.assertAlmostEqual(sum(resolved.values()), 1.0, places=3)

    def test_it_is_idempotent_on_an_already_resolved_vector(self) -> None:
        # The docstring claims idempotence; nothing checked it. It matters because the
        # fairness matrix resolves per candidate and a re-resolve must not drift the
        # vector, or the same candidate scores differently on a second pass.
        proposals = [
            {"skills": 0.9, "career": 0.05, "personal": 0.05},   # far outside the bounds
            {"skills": 0.0, "career": 0.0, "personal": 1.0},     # the other extreme
            {"skills": 0.52, "career": 0.33, "personal": 0.15},  # a plausible nudge
            {"skills": 0.5},                                     # partial vector
        ]
        for archetype in matching.WEIGHTS:
            for proposal in proposals:
                with self.subTest(archetype=archetype, proposal=proposal):
                    once = resolve_weights(archetype, proposal)
                    self.assertEqual(resolve_weights(archetype, once), once)

    def test_the_result_respects_the_bounds_and_sums_to_one(self) -> None:
        for archetype in matching.WEIGHTS:
            bounds = matching.weight_bounds(archetype)
            for proposal in ({"skills": 0.99}, {"personal": 0.99}, {"career": 0.0}):
                with self.subTest(archetype=archetype, proposal=proposal):
                    resolved = resolve_weights(archetype, proposal)
                    self.assertAlmostEqual(sum(resolved.values()), 1.0, places=3)
                    for slot, value in resolved.items():
                        lo, hi = bounds[slot]
                        # 1e-4 slack: the vector is rounded to 4dp on the way out.
                        self.assertGreaterEqual(value, lo - 1e-4, slot)
                        self.assertLessEqual(value, hi + 1e-4, slot)


class MatchDeterminismTest(unittest.TestCase):
    """Repeat-call determinism, asserted rather than inferred from purity.

    ``match`` reads lru_cache'd helpers (``_description_words``, ``term_match_score``,
    ``skill_match_score``). Caches are exactly where a "pure by inspection" function
    stops being pure — a mutable value cached and later mutated in place would show up
    on the SECOND call and nowhere else, and the whole product rests on the same CV
    scoring the same way twice.
    """

    def setUp(self) -> None:
        self.candidate = MatchCandidate(
            skills=["Python", "SQL", "Docker"],
            seniority="medior",
            role_family="software_engineering",
            languages=["English"],
            years_experience=4.0,
            summary="Backend engineer building data services.",
        )
        self.jobs = [
            Job.model_validate(
                {
                    "id": f"det-{i}",
                    "title": title,
                    "company": "Acme",
                    "location": "Prague",
                    "workMode": "hybrid",
                    "seniority": "medior",
                    "roleFamily": "software_engineering",
                    "requiredSkills": skills,
                    "description": desc,
                }
            )
            for i, (title, skills, desc) in enumerate(
                [
                    ("Backend Engineer", ["Python", "SQL"], "Build and run data services in Python."),
                    ("Platform Engineer", ["Docker", "Kubernetes"], "Container platform work."),
                    ("Analyst", ["Excel"], "Reporting and dashboards."),
                ]
            )
        ]

    def _dump(self, response: object) -> str:
        return response.model_dump_json(by_alias=True)  # type: ignore[attr-defined]

    def test_the_same_inputs_score_identically_on_a_repeat_call(self) -> None:
        first = self._dump(match(self.candidate, self.jobs, limit=10))
        for _ in range(3):
            self.assertEqual(self._dump(match(self.candidate, self.jobs, limit=10)), first)

    def test_a_fresh_but_equal_candidate_scores_identically(self) -> None:
        # Not just the same object twice: an equal candidate built separately must land
        # on the same numbers, so nothing is memoized on object identity.
        first = self._dump(match(self.candidate, self.jobs, limit=10))
        twin = MatchCandidate.model_validate(self.candidate.model_dump())
        self.assertEqual(self._dump(match(twin, self.jobs, limit=10)), first)

    def test_scoring_does_not_mutate_the_candidate_or_the_jobs(self) -> None:
        before_candidate = self.candidate.model_dump()
        before_jobs = [j.model_dump() for j in self.jobs]
        match(self.candidate, self.jobs, limit=10)
        self.assertEqual(self.candidate.model_dump(), before_candidate)
        self.assertEqual([j.model_dump() for j in self.jobs], before_jobs)

    def test_a_resolved_weight_vector_scores_deterministically_too(self) -> None:
        weights = resolve_weights("bau", {"skills": 0.6, "career": 0.25, "personal": 0.15})
        first = self._dump(match(self.candidate, self.jobs, limit=10, weights=weights))
        self.assertEqual(self._dump(match(self.candidate, self.jobs, limit=10, weights=weights)), first)


if __name__ == "__main__":
    unittest.main()
