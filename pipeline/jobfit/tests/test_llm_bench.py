"""Offline tests for the Phase 3 benchmark suite: scenario construction from
the real seed corpus, contract validators, envelope recording, and the matrix
runner — all with stub providers (no network, no tokens spent)."""

from __future__ import annotations

import contextlib
import io
import json
import os
import tempfile
import unittest
from unittest import mock
from pathlib import Path

from pipeline.jobfit.llm.base import LLMResult, TextProvider
from pipeline.jobfit.llm.bench import contracts
from pipeline.jobfit.llm.bench.bench_cli import MAX_USD_ENV, resolve_max_usd
from pipeline.jobfit.llm.bench.runner import (
    NOMINAL_INPUT_TOKENS,
    BenchTarget,
    BudgetGuard,
    estimate_matrix_usd,
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


class ValidRateScopeTest(unittest.TestCase):
    """`validRate` must measure the MODEL's answers, not the harness's fallback.

    The deterministic fallback passes every contract by construction (contracts.py
    mirrors the production coercion), so counting fallback rows made validRate a
    signal that could not fail: a target whose every call was unusable — coerced
    to the template on all 8 scenarios — used to publish `valid 100%`.
    """

    @staticmethod
    def _rows(sources: list[str]) -> list:
        from pipeline.jobfit.llm.bench.runner import BenchRecord

        return [
            BenchRecord(
                scenario_id=f"s{i}", use_case="match_reasoning", provider="gemini",
                model="gemini-3.6-flash", source=src, valid=True,
            )
            for i, src in enumerate(sources)
        ]

    def test_all_fallback_target_is_not_100_percent_valid(self) -> None:
        row = summarize(self._rows(["deterministic"] * 8))[0]
        self.assertEqual(row["llmRate"], 0.0)
        self.assertEqual(row["validRate"], 0.0)  # never once answered → nothing valid
        self.assertIn("0%", to_markdown([row]))

    def test_partial_fallback_scopes_validity_to_served_rows(self) -> None:
        rows = self._rows(["llm", "llm", "deterministic", "deterministic"])
        rows[1].valid = False  # one real answer violated the contract
        row = summarize(rows)[0]
        self.assertEqual(row["llmRate"], 0.5)
        self.assertEqual(row["validRate"], 0.5)  # 1 of the 2 SERVED rows, not 3 of 4

    def test_fully_served_target_is_unchanged(self) -> None:
        row = summarize(self._rows(["llm"] * 4))[0]
        self.assertEqual(row["validRate"], 1.0)
        self.assertEqual(row["llmRate"], 1.0)


class JudgeScopeDenominatorTest(unittest.TestCase):
    """`judged N/M` and the "judge produced no scores" warning must count only the
    rows the judge actually looks at.

    With fallback rows in the denominator, a run where the TARGET degraded on every
    scenario printed "judged 0/8" and raised a WARNING blaming an unauthenticated /
    usage-capped Claude CLI — sending the operator to re-run a healthy judge instead
    of reading the 0% llm-rate that was the real signal.
    """

    @staticmethod
    def _row(source: str, *, payload=object(), error=None):
        from pipeline.jobfit.llm.bench.runner import BenchRecord

        return BenchRecord(
            scenario_id="s", use_case="match_reasoning", provider="gemini", model="m",
            source=source, payload=payload, error=error,
        )

    def test_fallback_rows_are_not_judgeable(self) -> None:
        from pipeline.jobfit.llm.bench.bench_cli import judge_scope

        records = [self._row("llm"), self._row("deterministic"), self._row("deterministic")]
        self.assertEqual(judge_scope(records), (1, 2))

    def test_all_fallback_run_reports_nothing_judgeable(self) -> None:
        from pipeline.jobfit.llm.bench.bench_cli import judge_scope

        judgeable, fell_back = judge_scope([self._row("deterministic") for _ in range(8)])
        self.assertEqual(judgeable, 0)  # → the "judge is broken" warning must NOT fire
        self.assertEqual(fell_back, 8)

    def test_errored_and_payloadless_rows_are_excluded(self) -> None:
        from pipeline.jobfit.llm.bench.bench_cli import judge_scope

        records = [
            self._row("llm"),
            self._row("", payload=None, error="provider unavailable"),
            self._row("llm", payload=None),
        ]
        self.assertEqual(judge_scope(records), (1, 0))



class BudgetEstimateTest(unittest.TestCase):
    """A pre-run estimate exists so the operator sees the order of magnitude BEFORE
    authorising spend. It is an upper bound by construction (every call assumed to
    fill its output budget) - a guard that under-promises spend is the dangerous
    direction - and it is PURE, so it needs neither a provider nor the seed corpus."""

    def test_priced_target_is_estimated_from_the_price_book(self) -> None:
        est = estimate_matrix_usd({"match_reasoning": 10}, [BenchTarget("anthropic", "claude-haiku-4-5")])
        row = est.rows[0]
        self.assertEqual(row.calls, 10)
        self.assertEqual(row.input_tokens, NOMINAL_INPUT_TOKENS * 10)
        # $1.00/Mtok in, $5.00/Mtok out (MTOK_PRICES) over the estimated draw.
        expected = (row.input_tokens * 1.00 + row.output_tokens * 5.00) / 1_000_000
        self.assertAlmostEqual(row.usd, expected, places=6)
        self.assertAlmostEqual(est.total_usd, round(expected, 4), places=4)
        self.assertEqual(est.unpriced, [])

    def test_the_estimate_scales_with_limit_and_targets(self) -> None:
        one = estimate_matrix_usd({"match_reasoning": 5}, [BenchTarget("anthropic", "claude-haiku-4-5")])
        two = estimate_matrix_usd(
            {"match_reasoning": 5},
            [BenchTarget("anthropic", "claude-haiku-4-5"), BenchTarget("anthropic", "claude-sonnet-4-6")],
        )
        self.assertGreater(two.total_usd, one.total_usd)
        wider = estimate_matrix_usd({"match_reasoning": 50}, [BenchTarget("anthropic", "claude-haiku-4-5")])
        self.assertAlmostEqual(wider.total_usd, one.total_usd * 10, places=2)

    def test_an_unpriced_target_is_named_not_counted_as_free(self) -> None:
        """The Claude CLI is subscription-billed and Azure deployments are customer-
        named: neither has a list price. Reporting them as $0.00 would tell the
        operator a matrix is free when nobody knows what it costs."""
        est = estimate_matrix_usd({"match_reasoning": 4}, [BenchTarget("claude_cli", "some-local-model")])
        self.assertIsNone(est.rows[0].usd)
        self.assertEqual(est.total_usd, 0.0)
        self.assertEqual(est.unpriced, ["claude_cli:some-local-model"])
        self.assertIn("cost unknown", "\n".join(est.to_lines()))

    def test_lines_render_a_total(self) -> None:
        est = estimate_matrix_usd({"match_reasoning": 2}, [BenchTarget("anthropic", "claude-haiku-4-5")])
        self.assertTrue(any("TOTAL" in line for line in est.to_lines()))


class BudgetGuardTest(unittest.TestCase):
    def test_it_never_trips_without_a_ceiling(self) -> None:
        guard = BudgetGuard()
        guard.charge(1000.0)
        self.assertFalse(guard.exhausted())

    def test_it_trips_at_the_ceiling(self) -> None:
        guard = BudgetGuard(max_usd=0.10)
        guard.charge(0.04)
        self.assertFalse(guard.exhausted())
        guard.charge(0.06)
        self.assertTrue(guard.exhausted())

    def test_unpriced_calls_are_counted_never_charged(self) -> None:
        """Treating unknown as $0 would let an unpriced target run the entire matrix
        under a ceiling that can never trip - the one failure a budget must not have,
        so the count is surfaced instead."""
        guard = BudgetGuard(max_usd=0.01)
        for _ in range(5):
            guard.charge(None)
        self.assertEqual(guard.spent_usd, 0.0)
        self.assertEqual(guard.unpriced_calls, 5)
        self.assertFalse(guard.exhausted())


class BudgetStopRuleTest(unittest.TestCase):
    """The estimate is an estimate; the ceiling is what actually stops the spend."""

    def _run(self, max_usd, limit=6, targets=None):
        guard = BudgetGuard(max_usd=max_usd)
        records = run_matrix(
            ["match_reasoning"],
            targets or [BenchTarget(provider="anthropic", model="stub-model")],
            limit=limit,
            provider_factory=lambda target, use_case: StubText(),
            budget=guard,
        )
        return records, guard

    def test_the_matrix_stops_when_the_running_cost_crosses_the_ceiling(self) -> None:
        records, guard = self._run(0.0025)  # StubText bills $0.001 a call
        self.assertTrue(guard.stopped)
        self.assertEqual(len(records), 3)
        self.assertAlmostEqual(guard.spent_usd, 0.003, places=6)

    def test_a_stopped_run_keeps_what_it_paid_for(self) -> None:
        """Records are the receipt: the ceiling is checked AFTER a row is priced, so
        no spend is ever dropped on the floor."""
        records, _ = self._run(0.001)
        self.assertEqual(len(records), 1)
        self.assertIsNone(records[0].error)
        self.assertEqual(records[0].cost_usd, 0.001)

    def test_a_stop_adds_no_synthetic_row_to_the_scorecard(self) -> None:
        """A "stopped" record would land in summarize() as an error and corrupt the
        very numbers the run exists to produce."""
        records, _ = self._run(0.0025)
        rows = summarize(records)
        self.assertEqual(len(rows), 1)
        self.assertEqual(rows[0]["errors"], 0)
        self.assertEqual(rows[0]["n"], 3)

    def test_a_generous_ceiling_runs_the_whole_matrix(self) -> None:
        records, guard = self._run(100.0)
        self.assertFalse(guard.stopped)
        self.assertEqual(len(records), 6)

    def test_no_budget_argument_is_unchanged_behaviour(self) -> None:
        records = run_matrix(
            ["match_reasoning"],
            [BenchTarget(provider="anthropic", model="stub-model")],
            limit=4,
            provider_factory=lambda target, use_case: StubText(),
        )
        self.assertEqual(len(records), 4)

    def test_the_stop_ends_the_remaining_targets_too(self) -> None:
        records, guard = self._run(
            0.0015,
            limit=2,
            targets=[BenchTarget("anthropic", "stub-a"), BenchTarget("anthropic", "stub-b")],
        )
        self.assertTrue(guard.stopped)
        self.assertEqual({r.model for r in records}, {"stub-a"})


class MaxUsdResolutionTest(unittest.TestCase):
    """No ceiling = no run. The CLI must not invent one, and must not accept a
    malformed environment value as one either."""

    def test_flag_wins_over_env(self) -> None:
        self.assertEqual(resolve_max_usd(2.5, {MAX_USD_ENV: "9"}), 2.5)

    def test_env_is_the_default(self) -> None:
        self.assertEqual(resolve_max_usd(None, {MAX_USD_ENV: "1.25"}), 1.25)

    def test_unset_is_none(self) -> None:
        self.assertIsNone(resolve_max_usd(None, {}))
        self.assertIsNone(resolve_max_usd(None, {MAX_USD_ENV: "   "}))

    def test_unparseable_or_nonpositive_env_is_treated_as_unset(self) -> None:
        for raw in ("free", "0", "-3", "1,25"):
            self.assertIsNone(resolve_max_usd(None, {MAX_USD_ENV: raw}), raw)

    def test_a_nonpositive_flag_is_also_unset(self) -> None:
        self.assertIsNone(resolve_max_usd(0.0, {}))


class BenchCliBudgetGateTest(unittest.TestCase):
    """Without a ceiling the CLI spends nothing and tells the operator what it would
    have cost - the whole point of the refusal."""

    def test_main_refuses_and_prints_the_estimate_without_a_ceiling(self) -> None:
        from pipeline.jobfit.llm.bench import bench_cli

        out, err = io.StringIO(), io.StringIO()
        env = {k: v for k, v in os.environ.items() if k != MAX_USD_ENV}
        with mock.patch.dict(os.environ, env, clear=True):
            with contextlib.redirect_stdout(out), contextlib.redirect_stderr(err):
                code = bench_cli.main(
                    ["--use-cases", "match_reasoning", "--targets", "anthropic:claude-haiku-4-5", "--limit", "2"]
                )
        self.assertEqual(code, 2)
        self.assertIn("pre-run cost estimate", out.getvalue())
        self.assertIn("TOTAL", out.getvalue())
        self.assertIn("refusing to run without a spend ceiling", err.getvalue())



class BenchTargetTest(unittest.TestCase):
    def test_parse_with_model(self) -> None:
        target = BenchTarget.parse("anthropic:claude-sonnet-4-6")
        self.assertEqual((target.provider, target.model), ("anthropic", "claude-sonnet-4-6"))

    def test_parse_without_model(self) -> None:
        self.assertIsNone(BenchTarget.parse("gemini").model)


if __name__ == "__main__":
    unittest.main()
