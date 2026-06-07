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


if __name__ == "__main__":
    unittest.main()
