"""Offline tests for the Phase 3 benchmark suite: scenario construction from
the real seed corpus, contract validators, envelope recording, and the matrix
runner — all with stub providers (no network, no tokens spent)."""

from __future__ import annotations

import json
import tempfile
import unittest
from pathlib import Path

from pipeline.jobfit.llm.base import LLMResult, TextProvider
from pipeline.jobfit.llm.bench import contracts
from pipeline.jobfit.llm.bench.runner import (
    BenchTarget,
    record_calls,
    run_matrix,
    summarize,
    to_markdown,
    write_outputs,
)
from pipeline.jobfit.llm.bench.scenarios import SCENARIO_BUILDERS, scenarios_for

VALID_REASONING = json.dumps(
    {
        "verdict": "A strong fit for the role with minor, addressable gaps.",
        "strengths": ["Covers the core stack", "Relevant domain background"],
        "gaps": ["No direct Kubernetes evidence"],
        "interviewProbes": ["Walk through a recent production incident."],
    }
)


class StubText(TextProvider):
    """Adapter-shaped stub: returns canned JSON text through the real
    complete/complete_json machinery so envelopes are recordable."""

    name = "anthropic"

    def __init__(self, text: str = VALID_REASONING, *, up: bool = True):
        super().__init__(model="stub-model")
        self._text = text
        self._up = up

    def available(self) -> bool:
        return self._up

    def _call(self, prompt, *, system, timeout):
        return LLMResult(
            text=self._text,
            provider=self.name,
            model=self.model,
            usage={"input_tokens": 100, "output_tokens": 20},
            cost_usd=0.001,
        )


class ScenarioConstructionTest(unittest.TestCase):
    def test_builders_registered(self) -> None:
        self.assertIn("match_reasoning", SCENARIO_BUILDERS)
        self.assertIn("campaign_pack", SCENARIO_BUILDERS)

    def test_match_reasoning_from_seeds_deterministic_path(self) -> None:
        scenarios = scenarios_for("match_reasoning", limit=2)
        self.assertEqual(len(scenarios), 2)
        payload, source = scenarios[0].run(None)  # provider=None → deterministic
        self.assertEqual(source, "deterministic")
        self.assertEqual(scenarios[0].contract(payload), [])
        self.assertTrue(scenarios[0].meta["jobId"])

    def test_automation_screen_deterministic_passes_contract(self) -> None:
        scenario = scenarios_for("automation_screen", limit=1)[0]
        payload, source = scenario.run(None)
        self.assertEqual(source, "deterministic")
        self.assertEqual(scenario.contract(payload), [])

    def test_campaign_pack_deterministic_passes_contract(self) -> None:
        scenario = scenarios_for("campaign_pack", limit=1)[0]
        payload, source = scenario.run(None)
        self.assertEqual(source, "deterministic")
        self.assertEqual(scenario.contract(payload), [])

    def test_unknown_use_case_raises(self) -> None:
        with self.assertRaises(ValueError):
            scenarios_for("nope")

    def test_scenario_ids_are_stable_across_builds(self) -> None:
        first = [s.id for s in scenarios_for("match_reasoning", limit=3)]
        second = [s.id for s in scenarios_for("match_reasoning", limit=3)]
        self.assertEqual(first, second)


class ContractTest(unittest.TestCase):
    def test_match_reasoning_rejects_empty(self) -> None:
        self.assertTrue(contracts.match_reasoning({}))
        self.assertTrue(contracts.match_reasoning("not a dict"))

    def test_screen_rejects_bad_recommendation(self) -> None:
        violations = contracts.automation_screen(
            {
                "recommendation": "maybe",
                "confidence": 70,
                "rationale": "Looks broadly fine to me.",
                "strengths": [],
                "redFlags": [],
                "route": "hold",
            }
        )
        self.assertEqual(len(violations), 1)
        self.assertIn("recommendation", violations[0])

    def test_outreach_rejects_short_body(self) -> None:
        violations = contracts.automation_outreach({"subject": "Hello there", "body": "Hi.", "language": "English"})
        self.assertTrue(any("body" in v for v in violations))

    def test_campaign_pack_requires_variant_fields(self) -> None:
        violations = contracts.campaign_pack({"variants": [{"hook": "x"}], "warnings": []})
        self.assertTrue(any("hookType" in v for v in violations))


class RecordCallsTest(unittest.TestCase):
    def test_captures_envelopes_through_complete_json(self) -> None:
        provider = StubText()
        calls = record_calls(provider)
        provider.complete_json("give json")
        self.assertEqual(len(calls), 1)
        self.assertEqual(calls[0].usage["input_tokens"], 100)


class RunMatrixTest(unittest.TestCase):
    def test_end_to_end_with_stub_provider(self) -> None:
        records = run_matrix(
            ["match_reasoning"],
            [BenchTarget(provider="anthropic", model="stub-model")],
            limit=2,
            provider_factory=lambda target, use_case: StubText(),
        )
        self.assertEqual(len(records), 2)
        for r in records:
            self.assertIsNone(r.error)
            self.assertTrue(r.valid, r.violations)
            self.assertEqual(r.source, "llm")
            self.assertEqual(r.llm_calls, 1)
            self.assertEqual(r.input_tokens, 100)
            self.assertEqual(r.cost_usd, 0.001)

        rows = summarize(records)
        self.assertEqual(len(rows), 1)
        self.assertEqual(rows[0]["validRate"], 1.0)
        self.assertEqual(rows[0]["llmRate"], 1.0)
        self.assertEqual(rows[0]["totalCostUsd"], 0.002)
        # The three axes travel separately: economics per task + interaction mode.
        self.assertEqual(rows[0]["costPerTaskUsd"], 0.001)
        self.assertEqual(rows[0]["mode"], "online")  # match_reasoning: a person waits

        markdown = to_markdown(rows)
        self.assertIn("anthropic:stub-model", markdown)
        self.assertIn("$/task", markdown)

    def test_unavailable_provider_yields_skip_record(self) -> None:
        records = run_matrix(
            ["match_reasoning"],
            [BenchTarget(provider="anthropic")],
            limit=2,
            provider_factory=lambda target, use_case: StubText(up=False),
        )
        self.assertEqual(len(records), 1)
        self.assertIn("unavailable", records[0].error)

    def test_write_outputs(self) -> None:
        records = run_matrix(
            ["match_reasoning"],
            [BenchTarget(provider="anthropic", model="stub-model")],
            limit=1,
            provider_factory=lambda target, use_case: StubText(),
        )
        with tempfile.TemporaryDirectory() as tmp:
            paths = write_outputs(records, Path(tmp) / "bench")
            for path in paths.values():
                self.assertTrue(path.exists(), path)
            lines = paths["records"].read_text(encoding="utf-8").strip().splitlines()
            self.assertEqual(len(lines), 1)
            row = json.loads(lines[0])
            self.assertEqual(row["use_case"], "match_reasoning")


class JudgeScopeTest(unittest.TestCase):
    """Judged quality and measured reliability are separate axes: the judge must
    never score a deterministic fallback (it is the same template for every
    model — a reliability failure already counted by llmRate, not a quality
    signal for the model)."""

    def test_judge_skips_deterministic_fallback_records(self) -> None:
        from pipeline.jobfit.llm.bench.judge import judge_records
        from pipeline.jobfit.llm.bench.runner import BenchRecord

        judge_json = json.dumps(
            {"score": 8, "relevance": 8, "correctness": 8, "adherence": 8, "verdict": "ok", "issues": []}
        )
        llm_row = BenchRecord(
            scenario_id="s1", use_case="match_reasoning", provider="ollama", model="m",
            source="llm", payload={"verdict": "fit"},
        )
        fallback_row = BenchRecord(
            scenario_id="s2", use_case="match_reasoning", provider="ollama", model="m",
            source="deterministic", payload={"verdict": "template"},
        )
        scored = judge_records([llm_row, fallback_row], StubText(text=judge_json), workers=1)
        self.assertEqual(scored, 1)
        self.assertEqual(llm_row.judge_score, 8.0)
        self.assertIsNone(fallback_row.judge_score)


class BenchTargetTest(unittest.TestCase):
    def test_parse_with_model(self) -> None:
        target = BenchTarget.parse("anthropic:claude-sonnet-4-6")
        self.assertEqual((target.provider, target.model), ("anthropic", "claude-sonnet-4-6"))

    def test_parse_without_model(self) -> None:
        self.assertIsNone(BenchTarget.parse("gemini").model)


if __name__ == "__main__":
    unittest.main()
