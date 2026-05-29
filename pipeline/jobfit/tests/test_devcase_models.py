"""Phase D1 — sanity for the Dev case-scenario domain model."""

import unittest

from pipeline.jobfit.devcase.models import (
    CaseEvaluation,
    CaseScenario,
    CodebaseRef,
    CommitReflection,
    CoverProbe,
    DevNeed,
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

    def test_evaluation_nests_reflection_and_tooling(self):
        ev = CaseEvaluation(
            structure_score=72,
            judgment_score=68,
            architecture_score=70,
            dimension_scores={"tooling": 80},
            commit_reflection=CommitReflection(narrative="explored then narrowed", read_before_write=0.7),
            tooling_signal=ToolingSignal(fluency=0.8, probe_outcomes=[ProbeOutcome(probe_id="p1", detected=True, handled_well=True)]),
        )
        dumped = ev.model_dump(by_alias=True)
        self.assertEqual(dumped["dimensionScores"]["tooling"], 80)
        self.assertEqual(dumped["commitReflection"]["readBeforeWrite"], 0.7)
        self.assertTrue(dumped["toolingSignal"]["probeOutcomes"][0]["handledWell"])
        restored = CaseEvaluation.model_validate(dumped)
        self.assertEqual(restored.tooling_signal.fluency, 0.8)

    def test_transfer_defaults(self):
        t = TransferAssessment(transfer_score=64, transfers=["API design"], gaps=["k8s"])
        self.assertEqual(t.transfer_score, 64)
        self.assertEqual(t.model_dump(by_alias=True)["transferScore"], 64)


if __name__ == "__main__":
    unittest.main()
