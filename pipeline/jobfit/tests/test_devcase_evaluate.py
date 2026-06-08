"""Phase D6 — evaluate_submission + score_transfer + mint_followups (deterministic path)."""

import unittest

from pipeline.jobfit.devcase.evaluate import (
    CASE_EVAL_PROMPT_VERSION,
    FOLLOWUPS_PROMPT_VERSION,
    MAX_FOLLOWUPS,
    TRANSFER_PROMPT_VERSION,
    evaluate_submission,
    mint_followups,
    score_transfer,
)
from pipeline.jobfit.devcase.models import CaseEvaluation, TransferAssessment

_DIMS = {"framing", "tooling", "judgment", "architecture", "transfer"}


class TestEvaluate(unittest.TestCase):
    def setUp(self):
        self.reflection = {"readBeforeWrite": 0.7, "verificationHabits": ["adds tests", "iterates"], "narrative": "x"}
        self.tooling = {"fluency": 0.8, "probeOutcomes": [{"probeId": "p1", "handledWell": True}, {"probeId": "p2", "handledWell": False}]}
        self.case = {"rubricDimensions": [{"name": d, "weight": 0.2} for d in _DIMS]}
        self.role = {"title": "Backend", "seniority": "senior", "mustHaves": ["Go"], "responsibilities": ["APIs"]}

    def test_evaluation_has_all_five_dims_in_range(self):
        ev, source = evaluate_submission(self.reflection, self.tooling, self.case, self.role, provider=None)
        self.assertEqual(source, "deterministic")
        self.assertEqual(set(ev["dimensionScores"].keys()), _DIMS)
        for v in ev["dimensionScores"].values():
            self.assertTrue(0 <= v <= 100)
        self.assertEqual(ev["promptVersion"], CASE_EVAL_PROMPT_VERSION)

    def test_transfer_is_avg_of_dims(self):
        ev, _ = evaluate_submission(self.reflection, self.tooling, self.case, self.role, provider=None)
        t, _ = score_transfer(ev, self.role, provider=None)
        avg = round(sum(ev["dimensionScores"].values()) / 5)
        self.assertEqual(t["transferScore"], avg)
        self.assertTrue(0 <= t["transferScore"] <= 100)
        self.assertEqual(t["promptVersion"], TRANSFER_PROMPT_VERSION)

    def test_strong_tooling_lifts_tooling_dim(self):
        ev, _ = evaluate_submission(self.reflection, self.tooling, self.case, self.role, provider=None)
        self.assertEqual(ev["dimensionScores"]["tooling"], 80)  # fluency 0.8 -> 80

    def test_ordered_dimensions_breakdown(self):
        ev, _ = evaluate_submission(self.reflection, self.tooling, self.case, self.role, provider=None)
        dimensions = ev["dimensions"]
        # canonical order, one self-describing row per capability
        self.assertEqual([d["name"] for d in dimensions], ["framing", "tooling", "judgment", "architecture", "transfer"])
        for d in dimensions:
            self.assertTrue(d["label"])  # human label present
            self.assertTrue(d["description"])  # rubric description present (falls back to canonical)
            self.assertEqual(d["score"], ev["dimensionScores"][d["name"]])  # mirrors the score dict
            self.assertTrue(0.0 <= d["weight"] <= 1.0)

    def test_dimensions_fall_back_to_canonical_weights(self):
        # A case with no rubric still yields canonical, weight-annotated dimensions summing to 1.0.
        ev, _ = evaluate_submission(self.reflection, self.tooling, {"rubricDimensions": []}, self.role, provider=None)
        weights = {d["name"]: d["weight"] for d in ev["dimensions"]}
        self.assertAlmostEqual(sum(weights.values()), 1.0, places=2)
        self.assertEqual(weights["tooling"], 0.25)

    def test_evaluation_confidence_is_min_of_upstream(self):
        # idea-9281c8e9: the evaluation is fused ENTIRELY from the reflection + tooling signals,
        # so it can be no more trustworthy than its weakest input — it carries the MIN of their
        # confidences, NOT a mean. A high-confidence reflection must not mask a thin (e.g.
        # deterministic-fallback) tooling signal, or a degraded run would look authoritative.
        reflection = {**self.reflection, "confidence": 0.8}
        tooling = {**self.tooling, "confidence": 0.2}
        ev, _ = evaluate_submission(reflection, tooling, self.case, self.role, provider=None)
        self.assertEqual(ev["confidence"], 0.2)  # min(0.8, 0.2), not the mean 0.5
        # and it round-trips through the model as a declared, propagated field
        self.assertEqual(CaseEvaluation.model_validate(ev).confidence, 0.2)

    def test_transfer_inherits_evaluation_confidence(self):
        # Transfer is derived purely from the evaluation, so it inherits the evaluation's
        # propagated confidence — the transfer score is exactly as trustworthy as what it weights.
        reflection = {**self.reflection, "confidence": 0.6}
        tooling = {**self.tooling, "confidence": 0.5}
        ev, _ = evaluate_submission(reflection, tooling, self.case, self.role, provider=None)
        self.assertEqual(ev["confidence"], 0.5)  # min(0.6, 0.5)
        t, _ = score_transfer(ev, self.role, provider=None)
        self.assertEqual(t["confidence"], 0.5)  # inherited from the evaluation
        self.assertEqual(TransferAssessment.model_validate(t).confidence, 0.5)

    def test_missing_upstream_confidence_is_zero_not_silently_high(self):
        # When no upstream artifact carries a confidence, the propagated value is 0.0 — unknown
        # evidence strength is treated as untrustworthy, never optimistically high.
        ev, _ = evaluate_submission(self.reflection, self.tooling, self.case, self.role, provider=None)
        self.assertEqual(ev["confidence"], 0.0)

    def test_emitted_empty_state_flags_survive_model_validation(self):
        # The crux of the reconciliation: hasFindings / hasTransfers are emitted by evaluate.py
        # AND declared on the models, so validating the emitted dict through the model no longer
        # silently drops them — the model stays the source of truth for the real artifact shape.
        ev, _ = evaluate_submission(self.reflection, self.tooling, self.case, self.role, provider=None)
        self.assertIn("hasFindings", ev)
        self.assertEqual(CaseEvaluation.model_validate(ev).has_findings, ev["hasFindings"])

        t, _ = score_transfer(ev, self.role, provider=None)
        self.assertIn("hasTransfers", t)
        self.assertEqual(TransferAssessment.model_validate(t).has_transfers, t["hasTransfers"])


class TestMintFollowups(unittest.TestCase):
    """Per-candidate interview questions minted from the evaluated submission. The artifact
    is assumed wholly LLM-producible, so every question must anchor to an OBSERVED decision
    and be live-verifiable (why / rejected alternative / counterfactual)."""

    def setUp(self):
        self.case = {
            "coverProbes": [
                {
                    "id": "p1",
                    "kind": "underspecified",
                    "where": "Task 2 allocation",
                    "reveals": "Do they pin the allocation dimension or silently assume?",
                    "decisionSpace": ["Allocate by event count", "Allocate by bytes", "Allocate by processing cost"],
                },
                {"id": "p2", "kind": "legacy_trap", "where": "the consumer commit path", "reveals": "Read-first vs break it."},
            ]
        }
        self.role = {"title": "Backend", "seniority": "senior"}
        self.reflection = {"narrative": "n", "deadEnds": []}
        self.evaluation = {"strengths": [], "concerns": ["Probe handling unclear from the trace"], "summary": "s"}

    def test_missed_probe_yields_decision_walkthrough_question(self):
        tooling = {"probeOutcomes": [{"probeId": "p1", "handledWell": False}]}
        out, source = mint_followups(self.reflection, tooling, self.evaluation, self.case, self.role, provider=None)
        self.assertEqual(source, "deterministic")
        self.assertEqual(out["promptVersion"], FOLLOWUPS_PROMPT_VERSION)
        qs = out["questions"]
        self.assertTrue(qs)
        q1 = next(q for q in qs if q["probeId"] == "p1")
        self.assertIn("Task 2 allocation", q1["question"])
        self.assertIn("alternative you rejected", q1["question"])
        # the decision space rides in the internal listen-for so the interviewer can
        # classify which defensible option the candidate actually owns
        self.assertIn("Allocate by bytes", q1["listenFor"])
        self.assertTrue(q1["redFlag"])

    def test_handled_probe_yields_counterfactual_not_walkthrough(self):
        tooling = {"probeOutcomes": [{"probeId": "p1", "handledWell": True, "note": "pinned bytes-based allocation"}]}
        out, _ = mint_followups(self.reflection, tooling, self.evaluation, self.case, self.role, provider=None)
        q1 = next(q for q in out["questions"] if q["probeId"] == "p1")
        self.assertIn("choose differently", q1["question"])  # counterfactual
        self.assertEqual(q1["decision"], "pinned bytes-based allocation")

    def test_concerns_become_general_questions_and_cap_holds(self):
        tooling = {"probeOutcomes": []}
        evaluation = {"concerns": [f"concern {i}" for i in range(10)], "strengths": [], "summary": ""}
        out, _ = mint_followups(self.reflection, tooling, evaluation, self.case, self.role, provider=None)
        qs = out["questions"]
        self.assertLessEqual(len(qs), MAX_FOLLOWUPS)
        general = [q for q in qs if q["probeId"] == ""]
        self.assertTrue(general)
        self.assertIn("concern 0", general[0]["question"])

    def test_no_probes_no_concerns_still_returns_valid_shape(self):
        out, _ = mint_followups({}, {}, {"concerns": [], "strengths": []}, {"coverProbes": []}, self.role, provider=None)
        self.assertIsInstance(out["questions"], list)


if __name__ == "__main__":
    unittest.main()
