"""Phase D1 — sanity for the Dev case-scenario domain model."""

import unittest

from pipeline.jobfit.devcase.models import (
    RUBRIC_DIMENSIONS,
    CaseEvaluation,
    CaseScenario,
    CodebaseRef,
    CommitReflection,
    CoverProbe,
    DevNeed,
    DimensionScore,
    ProbeOutcome,
    RubricDimension,
    ToolingSignal,
    TransferAssessment,
)


class TestDevCaseModels(unittest.TestCase):
    def test_devneed_camel_alias(self):
        need = DevNeed(
            id="need-1",
            title="Backend dev",
            stack=["Python", "PostgreSQL"],
            responsibilities=["APIs"],
            codebase_refs=[CodebaseRef(kind="github", ref="https://github.com/x/y", label="api")],
            seniority_target="senior",
        )
        dumped = need.model_dump(by_alias=True)
        self.assertIn("seniorityTarget", dumped)
        self.assertIn("codebaseRefs", dumped)
        self.assertEqual(dumped["codebaseRefs"][0]["ref"], "https://github.com/x/y")
        # round-trips back from the aliased form
        self.assertEqual(DevNeed.model_validate(dumped).seniority_target, "senior")

    def test_case_scenario_with_probes_round_trips(self):
        case = CaseScenario(
            title="Refactor the ingest path",
            tasks=["Make X faster"],
            cover_probes=[CoverProbe(id="p1", kind="legacy_trap", where="ingest.py", reveals="read-first?")],
            rubric_dimensions=[RubricDimension(name="tooling", weight=0.3)],
        )
        again = CaseScenario.model_validate(case.model_dump(by_alias=True))
        self.assertEqual(again.cover_probes[0].kind, "legacy_trap")
        self.assertEqual(again.rubric_dimensions[0].name, "tooling")
        # cover-probe reveals are internal but still serialize (UI hides them)
        self.assertIn("coverProbes", case.model_dump(by_alias=True))

    def test_repo_seed_is_domain_neutral_and_round_trips(self):
        # The misnomer field holds domain-neutral starting materials, not necessarily a repo.
        # Both the legacy `repoSeed` wire name and the `startingMaterials` alias populate it...
        from_legacy = CaseScenario.model_validate({"repoSeed": "a design system + 3 mockups"})
        from_alias = CaseScenario.model_validate({"startingMaterials": "a CRM export + playbooks"})
        self.assertEqual(from_legacy.repo_seed, "a design system + 3 mockups")
        self.assertEqual(from_alias.repo_seed, "a CRM export + playbooks")
        # ...but it ALWAYS serializes back as `repoSeed` (never `startingMaterials`) so the TS
        # round-trip is unbroken.
        dumped = from_alias.model_dump(by_alias=True)
        self.assertEqual(dumped["repoSeed"], "a CRM export + playbooks")
        self.assertNotIn("startingMaterials", dumped)
        self.assertEqual(CaseScenario.model_validate(dumped).repo_seed, "a CRM export + playbooks")

    def test_evaluation_nests_reflection_and_tooling(self):
        ev = CaseEvaluation(
            dimension_scores={"tooling": 80},
            dimensions=[DimensionScore(name="tooling", label="Tooling fluency", weight=0.25, score=80, description="x")],
            strengths=["Shows verification habits"],
            has_findings=True,
            commit_reflection=CommitReflection(narrative="explored then narrowed", read_before_write=0.7),
            tooling_signal=ToolingSignal(fluency=0.8, probe_outcomes=[ProbeOutcome(probe_id="p1", detected=True, handled_well=True)]),
        )
        dumped = ev.model_dump(by_alias=True)
        self.assertEqual(dumped["dimensionScores"]["tooling"], 80)
        self.assertEqual(dumped["dimensions"][0]["label"], "Tooling fluency")
        self.assertEqual(dumped["commitReflection"]["readBeforeWrite"], 0.7)
        self.assertTrue(dumped["toolingSignal"]["probeOutcomes"][0]["handledWell"])
        # the deliberate empty-state flag is declared on the model and round-trips via its alias
        self.assertTrue(dumped["hasFindings"])
        restored = CaseEvaluation.model_validate(dumped)
        self.assertEqual(restored.tooling_signal.fluency, 0.8)
        self.assertEqual(restored.dimensions[0].weight, 0.25)
        self.assertTrue(restored.has_findings)
        # defaults False so an evaluation with no findings serializes a real empty state
        self.assertFalse(CaseEvaluation().model_dump(by_alias=True)["hasFindings"])

    def test_dimension_scores_is_canonical_mirror_cannot_diverge(self):
        # The canonical-score contract: dimension_scores is the single source of truth, so the
        # ordered `dimensions` mirror can NEVER hold a different number for the same capability.
        # Construct one with a deliberately divergent mirror score and a stale value...
        ev = CaseEvaluation(
            dimension_scores={"judgment": 80, "architecture": 40},
            dimensions=[
                DimensionScore(name="judgment", label="Judgment", weight=0.25, score=12, description="x"),
                DimensionScore(name="architecture", label="Architecture", weight=0.15, score=99, description="y"),
            ],
        )
        # ...and the validator force-syncs each row's score back to the dict (dict wins).
        synced = {d.name: d.score for d in ev.dimensions}
        self.assertEqual(synced, {"judgment": 80, "architecture": 40})
        # Same enforcement on the deserialization path (a stored/LLM artifact with a stale mirror).
        restored = CaseEvaluation.model_validate(
            {
                "dimensionScores": {"tooling": 70},
                "dimensions": [{"name": "tooling", "label": "Tooling fluency", "weight": 0.25, "score": 3, "description": "z"}],
            }
        )
        self.assertEqual(restored.dimensions[0].score, 70)

    def test_mirror_row_absent_from_dict_is_left_untouched(self):
        # A capability NOT scored in dimension_scores carries no signal to sync from, so its
        # mirror row keeps the neutral midpoint evaluate._ordered_dimensions seeded — no clobbering.
        ev = CaseEvaluation(
            dimension_scores={"judgment": 80},
            dimensions=[DimensionScore(name="transfer", label="Transfer", weight=0.15, score=50, description="d")],
        )
        self.assertEqual(ev.dimensions[0].score, 50)

    def test_canonical_rubric_is_ordered_and_normalized(self):
        # Single source of truth: five capabilities, in order, weights summing to 1.0, each labelled.
        self.assertEqual([d["name"] for d in RUBRIC_DIMENSIONS], ["framing", "tooling", "judgment", "architecture", "transfer"])
        self.assertAlmostEqual(sum(d["weight"] for d in RUBRIC_DIMENSIONS), 1.0, places=2)
        self.assertTrue(all(d["label"] and d["description"] for d in RUBRIC_DIMENSIONS))

    def test_transfer_defaults(self):
        t = TransferAssessment(transfer_score=64, transfers=["API design"], gaps=["k8s"], has_transfers=True)
        self.assertEqual(t.transfer_score, 64)
        dumped = t.model_dump(by_alias=True)
        self.assertEqual(dumped["transferScore"], 64)
        # the deliberate empty-state flag is declared on the model and round-trips via its alias
        self.assertTrue(dumped["hasTransfers"])
        self.assertTrue(TransferAssessment.model_validate(dumped).has_transfers)
        # defaults False so an assessment with no transfers serializes a real empty state
        self.assertFalse(TransferAssessment().model_dump(by_alias=True)["hasTransfers"])


def _composite(scores, rubric=None):
    # Imported per call so a missing symbol reds each case instead of the whole module.
    from pipeline.jobfit.devcase.models import rubric_composite

    return rubric_composite(scores, RUBRIC_DIMENSIONS if rubric is None else rubric)


class TestRubricComposite(unittest.TestCase):
    """challenge-r05 devcase-core/B — the rubric weights COMPUTE the headline: the case score is
    the sum of per-dimension contributions (registry: component-sum-is-authoritative)."""

    WORKED = {"framing": 40, "tooling": 90, "judgment": 90, "architecture": 40, "transfer": 40}

    def test_worked_example_is_the_weighted_sum_not_the_mean(self):
        c = _composite(self.WORKED)
        # 0.2*40 + 0.25*90 + 0.25*90 + 0.15*40 + 0.15*40 = 65 (the unweighted mean reads 60).
        self.assertEqual(c["overall"], 65)
        self.assertEqual(c["contributions"], {"framing": 8.0, "tooling": 22.5, "judgment": 22.5, "architecture": 6.0, "transfer": 6.0})
        self.assertEqual(sum(c["contributions"].values()), c["overall"])
        self.assertEqual(c["missing"], [])
        self.assertEqual(c["scoredWeight"], 1.0)
        self.assertFalse(c["normalised"])

    def test_absent_dimension_is_excluded_never_imputed_as_50(self):
        scores = {k: v for k, v in self.WORKED.items() if k != "architecture"}
        c = _composite(scores)
        self.assertEqual(c["missing"], ["architecture"])
        self.assertAlmostEqual(c["scoredWeight"], 0.85, places=6)
        self.assertNotIn("architecture", c["contributions"])
        # Renormalised over the scored weight: (8 + 22.5 + 22.5 + 6) / 0.85 = 69.41 -> 69.
        self.assertEqual(c["overall"], 69)
        self.assertEqual(round(sum(c["contributions"].values())), c["overall"])
        # Imputing MISSING_DIMENSION_SCORE (50) would have read 8+22.5+22.5+7.5+6 = 66.5.
        self.assertNotEqual(c["overall"], 66)
        self.assertNotEqual(c["overall"], 67)

    def test_nothing_scored_has_no_composite(self):
        c = _composite({})
        self.assertIsNone(c["overall"])
        self.assertEqual(c["scoredWeight"], 0.0)
        self.assertEqual(len(c["missing"]), 5)

    def test_case_weights_take_precedence_over_the_canonical_rubric(self):
        # judgment 0.40, the other four rescaled from their canonical 0.75 to 0.60 (x0.8).
        case = [
            {"name": "framing", "weight": 0.16},
            {"name": "tooling", "weight": 0.20},
            {"name": "judgment", "weight": 0.40},
            {"name": "architecture", "weight": 0.12},
            {"name": "transfer", "weight": 0.12},
        ]
        c = _composite(self.WORKED, case)
        # 6.4 + 18 + 36 + 4.8 + 4.8 = 70
        self.assertEqual(c["overall"], 70)
        self.assertEqual(c["contributions"]["judgment"], 36.0)
        self.assertFalse(c["normalised"])

    def test_weights_off_the_unit_sum_are_normalised_and_flagged(self):
        case = [{"name": d["name"], "weight": 0.4} for d in RUBRIC_DIMENSIONS]  # sums to 2.0
        c = _composite(self.WORKED, case)
        self.assertTrue(c["normalised"])
        # Equal weights after normalisation -> the plain mean, 60, and contributions still sum to it.
        self.assertEqual(c["overall"], 60)
        self.assertEqual(round(sum(c["contributions"].values())), 60)

    def test_a_case_rubric_missing_a_weight_falls_back_to_the_canonical_one(self):
        case = [{"name": "judgment", "label": "Judgment"}]  # no weight -> canonical 0.25
        self.assertEqual(_composite(self.WORKED, case)["overall"], 65)

    def test_models_carry_overall_score_and_row_contribution(self):
        ev = CaseEvaluation.model_validate(
            {
                "dimensionScores": {"judgment": 80},
                "overallScore": 80,
                "dimensions": [{"name": "judgment", "label": "Judgment", "weight": 0.25, "score": 80, "contribution": 80.0}],
            }
        )
        dumped = ev.model_dump(by_alias=True)
        self.assertEqual(dumped["overallScore"], 80)
        self.assertEqual(dumped["dimensions"][0]["contribution"], 80.0)
        # Old bundles carry neither: they stay None so the UI can label them legacy.
        legacy = CaseEvaluation.model_validate({"dimensionScores": {"judgment": 80}}).model_dump(by_alias=True)
        self.assertIsNone(legacy["overallScore"])


if __name__ == "__main__":
    unittest.main()
