"""Pins for the prompt hill-climb — the loop that WRITES rules into a brief.

It had no tests, and it is the one entry point in the eval suite that runs the
engine rounds x folds x scenarios: an unbounded loop with an accept rule, on a
non-deterministic signal, spending real calls. Three things are pinned here.

**The accept rule.** Reliability is deterministic; the judge's quality sum is a
sum of unpaired LLM scores. Accepting on a quality delta at equal reliability
would be accepting sampling noise, so ``_accept`` must never do it.

**The held-out fold.** Rules are proposed from the train fold's failures and
accepted only on the disjoint validation fold. With too few scenarios to hold one
out, the loop must refuse to accept anything rather than report an in-sample gain.

**The ceiling.** ``BudgetedProvider`` is the only thing between a mistyped
``--rounds`` and a session's budget; a spent budget stops the climb and says so,
it does not fail the run or discard what was already accepted.
"""

from __future__ import annotations

import unittest
from types import SimpleNamespace
from unittest import mock

from pipeline.jobfit.eval import interview_optimize as opt


def _scenario(name: str):
    return SimpleNamespace(name=name)


def _row(scenario: str, *, reliable: bool = True, quality: int | None = None):
    return SimpleNamespace(
        scenario=scenario,
        reliable=reliable,
        quality=quality,
        quality_issues=[],
        issues=[] if reliable else ["broke"],
        behavior="neutral",
        turns=[],
    )


class AcceptRuleTest(unittest.TestCase):
    def test_a_strict_reliability_gain_is_accepted(self):
        self.assertTrue(opt._accept((4, 10), (3, 20), set()))

    def test_equal_reliability_is_never_accepted_on_the_quality_sum(self):
        # The judge's score is non-deterministic and unpaired: a +5 quality delta at
        # equal reliability is sampling noise, not an improvement.
        self.assertFalse(opt._accept((3, 99), (3, 10), set()))

    def test_a_reliability_drop_is_refused_however_good_the_quality_looks(self):
        self.assertFalse(opt._accept((2, 99), (3, 0), set()))

    def test_any_newly_failing_validation_scenario_vetoes_the_rule(self):
        # Even a net reliability gain: a rule that fixes two cases and breaks one
        # previously-passing case is a regression someone would have to debug later.
        self.assertFalse(opt._accept((5, 10), (3, 0), {"adversarial_asks_score"}))


class SplitScenariosTest(unittest.TestCase):
    def test_the_folds_are_disjoint_and_cover_everything(self):
        scenarios = [_scenario(f"s{i}") for i in range(7)]
        train, val = opt.split_scenarios(scenarios)
        names = lambda rows: {r.name for r in rows}  # noqa: E731 — one-line helper, local to the test
        self.assertEqual(names(train) & names(val), set())
        self.assertEqual(names(train) | names(val), names(scenarios))

    def test_the_split_is_stable_across_input_orderings(self):
        forward = [_scenario(n) for n in ("b", "a", "d", "c")]
        backward = [_scenario(n) for n in ("c", "d", "a", "b")]
        self.assertEqual(
            [[s.name for s in fold] for fold in opt.split_scenarios(forward)],
            [[s.name for s in fold] for fold in opt.split_scenarios(backward)],
        )

    def test_it_interleaves_rather_than_cutting_the_bank_in_half(self):
        # A first-half/second-half cut would put every scenario of one behaviour in
        # one fold whenever the bank is grouped — which banks generally are.
        train, val = opt.split_scenarios([_scenario(n) for n in ("a", "b", "c", "d")])
        self.assertEqual([s.name for s in train], ["a", "c"])
        self.assertEqual([s.name for s in val], ["b", "d"])

    def test_a_single_scenario_leaves_the_validation_fold_empty(self):
        train, val = opt.split_scenarios([_scenario("only")])
        self.assertEqual([s.name for s in train], ["only"])
        self.assertEqual(val, [])


class _FakeProvider:
    """Answers nothing — optimize's real LLM calls are patched out; this only has to
    look like a provider to the metering wrapper."""

    model = "test-engine"

    def available(self) -> bool:
        return True

    def complete(self, *_a, **_k):
        return None

    def complete_json(self, *_a, **_k):
        return {}

    def map(self, prompts, **_k):
        return [None] * len(prompts)


class InsufficientFoldTest(unittest.TestCase):
    def test_one_scenario_accepts_no_rule_and_says_why(self):
        rows = [_row("only", reliable=False)]
        with mock.patch.object(opt.ie, "run_scenarios", return_value=rows), \
             mock.patch.object(opt.ie, "render_brief", return_value="brief"), \
             mock.patch.object(opt, "propose_patches", return_value=["a new rule"]) as proposed:
            result = opt.optimize([_scenario("only")], _FakeProvider(), rounds=3)
        self.assertEqual(result["patches"], [])
        self.assertEqual(result["validation"], [])
        self.assertIn("insufficient scenarios", result["history"][0]["reason"])
        # And it never even asked for a rule it could not have judged.
        proposed.assert_not_called()


class BudgetedProviderTest(unittest.TestCase):
    def setUp(self):
        self.inner = mock.Mock()
        self.inner.map.return_value = ["a", "b", "c"]
        self.inner.available.return_value = True

    def test_every_call_shape_is_counted(self):
        p = opt.BudgetedProvider(self.inner)
        p.complete("prompt")
        p.complete_json("prompt")
        p.map(["one", "two", "three"])  # a batch is N calls, not one
        self.assertEqual(p.calls, 5)
        self.assertIsNone(p.report()["max_calls"])

    def test_the_call_cap_stops_the_next_call_before_it_is_made(self):
        p = opt.BudgetedProvider(self.inner, max_calls=2)
        p.complete("a")
        p.complete("b")
        with self.assertRaises(opt.BudgetExceeded) as ctx:
            p.complete("c")
        self.assertIn("call budget spent", str(ctx.exception))
        self.assertEqual(self.inner.complete.call_count, 2)

    def test_a_batch_that_would_overshoot_is_refused_whole(self):
        p = opt.BudgetedProvider(self.inner, max_calls=2)
        with self.assertRaises(opt.BudgetExceeded):
            p.map(["one", "two", "three"])
        self.inner.map.assert_not_called()

    def test_the_time_cap_stops_the_loop(self):
        p = opt.BudgetedProvider(self.inner, max_minutes=5.0)
        with mock.patch.object(type(p), "elapsed_minutes", property(lambda self: 6.0)):
            with self.assertRaises(opt.BudgetExceeded) as ctx:
                p.complete("a")
        self.assertIn("time budget spent", str(ctx.exception))

    def test_unlimited_still_counts_so_the_report_can_say_what_a_run_cost(self):
        p = opt.BudgetedProvider(self.inner, max_calls=0, max_minutes=0)
        for _ in range(50):
            p.complete("a")
        self.assertEqual(p.report()["calls"], 50)

    def test_anything_else_belongs_to_the_wrapped_provider(self):
        # judging.resolve_judge_provider reads `.model` off whatever it is handed.
        p = opt.BudgetedProvider(_FakeProvider())
        self.assertEqual(p.model, "test-engine")
        self.assertTrue(p.available())


class BudgetStopsTheClimbTest(unittest.TestCase):
    def _run(self, budget: int):
        val_rows = [_row("b"), _row("d", reliable=False)]
        train_rows = [_row("a"), _row("c", reliable=False)]
        provider = opt.BudgetedProvider(_FakeProvider(), max_calls=budget)

        def _eval(scen, prov, **_kw):
            prov.complete("one eval = one call")
            return train_rows if scen and scen[0].name == "a" else val_rows

        with mock.patch.object(opt.ie, "run_scenarios", side_effect=_eval), \
             mock.patch.object(opt.ie, "render_brief", return_value="brief"), \
             mock.patch.object(opt, "propose_patches", return_value=["a new rule"]):
            return opt.optimize([_scenario(n) for n in ("a", "b", "c", "d")], provider, rounds=5)

    def test_a_budget_spent_before_the_baseline_measures_nothing(self):
        result = self._run(budget=1)
        self.assertEqual(result["final_rows"], [])
        self.assertIn("before the baseline", result["history"][0]["reason"])
        self.assertIn("call budget spent", result["budget_stop"])

    def test_a_budget_spent_mid_climb_stops_the_loop_without_losing_the_log(self):
        result = self._run(budget=3)  # 2 baseline evals + 1 of the round's 2
        self.assertIsNotNone(result["budget_stop"])
        self.assertIn("budget exhausted", result["history"][-1]["reason"])
        self.assertFalse(result["history"][-1]["accepted"])
        # The baseline still measured: this is a stopped climb, not a dead run.
        self.assertTrue(result["final_rows"])

    def test_the_spend_is_reported_whether_or_not_a_cap_was_set(self):
        result = self._run(budget=0)
        self.assertGreater(result["spend"]["calls"], 0)
        self.assertIsNone(result["spend"]["max_calls"])
        report = opt._format_report(result)
        self.assertIn("provider call(s)", report)


if __name__ == "__main__":
    unittest.main()
