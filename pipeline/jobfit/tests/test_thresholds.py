"""Pins for the one module every eval gate reads its bar out of.

``thresholds.py`` is the single source of truth for pass/fail across the eval
suite and it validates itself at import — but nothing tested the validator, so
the guard that stops a typo'd or quietly-tuned bar from shipping was itself
unguarded. A validator that has stopped rejecting anything looks exactly like a
file nobody has broken yet.

The one that matters most is ``FAULT_THRESHOLD``. Every other number here scores
a MODEL's judgement, where a margin is meaningful and moving it is a product
call. That one scores whether the CODE holds its own declared contract when a
dependency lies — the fairness gate overruling a hostile verdict, a discarded
draft reporting itself as deterministic, a failing call still bounded. There is
no "97% of the time" reading of any of those, so ``_validate`` refuses any value
but 1.0 and this pins that refusal.
"""

from __future__ import annotations

import contextlib
import io
import unittest
from dataclasses import replace
from unittest import mock

from pipeline.jobfit.eval import thresholds


class FaultThresholdIsNotTunableTest(unittest.TestCase):
    def test_the_shipped_value_is_one(self):
        self.assertEqual(thresholds.FAULT_THRESHOLD, 1.0)

    def test_lowering_it_to_a_plausible_quality_bar_is_refused(self):
        # 0.99 is the shape of the edit this guard exists for: a red drill, one
        # row failing, and a "round it off" fix that would retire the contract.
        for tuned in (0.99, 0.95, 0.5, 0.0):
            with self.subTest(value=tuned), mock.patch.object(thresholds, "FAULT_THRESHOLD", tuned):
                with self.assertRaises(ValueError) as ctx:
                    thresholds._validate()
                self.assertIn("not a tunable quality bar", str(ctx.exception))

    def test_raising_it_above_one_is_refused_too(self):
        # An unreachable bar is the mirror-image failure: the gate can never pass
        # and would be "fixed" by deleting it.
        with mock.patch.object(thresholds, "FAULT_THRESHOLD", 1.5):
            with self.assertRaises(ValueError):
                thresholds._validate()


class TableValidationTest(unittest.TestCase):
    def test_a_fraction_table_refuses_a_value_outside_the_unit_interval(self):
        for table in ("PASS_THRESHOLDS", "MATCHING_THRESHOLDS"):
            for bad in (-0.1, 1.5, "0.9", None, True):
                with self.subTest(table=table, value=bad):
                    broken = {**getattr(thresholds, table), "role_family": bad, "archetype_accuracy": bad}
                    with mock.patch.object(thresholds, table, broken):
                        with self.assertRaises(ValueError) as ctx:
                            thresholds._validate()
                    self.assertIn("must be a number in [0, 1]", str(ctx.exception))

    def test_booleans_are_not_numbers_here(self):
        # `True == 1` in Python, so a bool would sail through a naive range check
        # and read as a threshold of 1.0 that nobody wrote.
        with mock.patch.object(thresholds, "PASS_THRESHOLDS", {"role_family": True}):
            with self.assertRaises(ValueError):
                thresholds._validate()

    def test_the_scalar_bars_carry_their_own_scales(self):
        with mock.patch.object(thresholds, "RELIABILITY_THRESHOLD", 1.2):
            with self.assertRaises(ValueError):
                thresholds._validate()
        # QUALITY_THRESHOLD is on the judge's 1-5 scale, not a fraction: 0.9
        # would be a silently-always-passing bar.
        with mock.patch.object(thresholds, "QUALITY_THRESHOLD", 0.9):
            with self.assertRaises(ValueError):
                thresholds._validate()

    def test_the_shipped_tables_validate(self):
        thresholds._validate()


class ConsumersReadTheTableTest(unittest.TestCase):
    """The point of the module is that no gate restates its own number."""

    def test_every_declared_bar_is_in_range(self):
        for name, value in thresholds.PASS_THRESHOLDS.items():
            with self.subTest(key=name):
                self.assertTrue(0.0 <= value <= 1.0)
        for name, value in thresholds.MATCHING_THRESHOLDS.items():
            with self.subTest(key=name):
                self.assertTrue(0.0 <= value <= 1.0)

    def test_the_fault_drill_reads_this_module_rather_than_its_own_constant(self):
        from pipeline.jobfit.eval import fault_eval

        self.assertIs(fault_eval.FAULT_THRESHOLD, thresholds.FAULT_THRESHOLD)


class BarProvenanceTest(unittest.TestCase):
    """A bare number is not a threshold. Every bar states what it protects and
    what the pipeline actually measured — or that nothing was ever measured."""

    def test_every_bar_carries_a_why_and_a_measured_at(self):
        for name, bar in thresholds.all_bars().items():
            with self.subTest(bar=name):
                self.assertTrue(bar.why.strip(), f"{name} has no reason")
                self.assertTrue(bar.measured_at.strip(), f"{name} has no measured_at")

    def test_a_measured_bar_names_the_run_it_came_from(self):
        for name, bar in thresholds.all_bars().items():
            if bar.is_measured:
                with self.subTest(bar=name):
                    self.assertNotEqual(bar.measured_at, thresholds.UNMEASURED)
                    self.assertTrue(bar.source.strip(), f"{name} names no source command")

    def test_an_unmeasured_bar_declares_the_gap_in_its_own_why(self):
        # "nobody has measured this" and "this was measured and it is fine" must
        # not look the same in the table.
        for name, bar in thresholds.all_bars().items():
            if not bar.is_measured:
                with self.subTest(bar=name):
                    self.assertEqual(bar.measured_at, thresholds.UNMEASURED)
                    self.assertIn(thresholds.UNMEASURED.upper(), bar.why.upper())

    def test_the_float_tables_stay_derived_from_the_bars(self):
        self.assertEqual(
            thresholds.PASS_THRESHOLDS, {k: b.value for k, b in thresholds.PASS_BARS.items()}
        )
        self.assertEqual(
            thresholds.MATCHING_THRESHOLDS, {k: b.value for k, b in thresholds.MATCHING_BARS.items()}
        )
        with mock.patch.object(thresholds, "PASS_THRESHOLDS", {**thresholds.PASS_THRESHOLDS, "role_family": 0.5}):
            with self.assertRaises(ValueError) as ctx:
                thresholds._validate()
            self.assertIn("drifted from its Bar table", str(ctx.exception))

    def test_a_bar_without_a_reason_is_refused(self):
        blank = replace(thresholds.MATCHING_BARS["role_relevance_at5"], why="  ")
        with mock.patch.dict(thresholds.MATCHING_BARS, {"role_relevance_at5": blank}):
            with self.assertRaises(ValueError) as ctx:
                thresholds._validate()
            self.assertIn("bare number is not a threshold", str(ctx.exception))


class SlackTest(unittest.TestCase):
    """The bug this file exists to stop: a bar sitting so far under what the
    engine measures that a real regression still ships green.
    ``role_relevance_at5`` was 0.60 against a measured 0.857 — a quarter of the
    ranking could rot without turning the gate red."""

    def test_every_measured_bar_sits_within_its_stated_slack(self):
        for name, bar in thresholds.all_bars().items():
            if not bar.is_measured:
                continue
            with self.subTest(bar=name):
                self.assertTrue(
                    bar.within_slack,
                    f"{name} is {bar.value} but the recorded measurement is {bar.measured} "
                    f"({bar.measured_at}) with slack {bar.slack} — the bar may not sit below "
                    f"{bar.floor}. Ratchet it to {bar.tightened()}, or widen the slack WITH a "
                    f"reason (`python -m pipeline.jobfit.eval.thresholds --tighten`).",
                )

    def test_a_loosened_bar_is_caught_and_a_ratchet_proposed(self):
        # The shape of the regression: someone drops the bar to make a red run green.
        loosened = replace(thresholds.MATCHING_BARS["role_relevance_at5"], value=0.60)
        with mock.patch.dict(thresholds.MATCHING_BARS, {"role_relevance_at5": loosened}):
            loose = thresholds.loose_bars()
            self.assertIn("MATCHING_THRESHOLDS.role_relevance_at5", loose)
            self.assertEqual(loose["MATCHING_THRESHOLDS.role_relevance_at5"].tightened(), 0.84)

    def test_slack_is_the_distance_below_the_measurement_not_a_free_pass(self):
        bar = thresholds.Bar(value=0.80, why="w", slack=0.10, measured=0.95, measured_at="2026-01-01", source="cmd")
        self.assertEqual(bar.floor, 0.85)
        self.assertFalse(bar.within_slack)
        self.assertEqual(bar.tightened(), 0.85)
        self.assertTrue(replace(bar, value=0.85).within_slack)
        self.assertIsNone(replace(bar, value=0.85).tightened())

    def test_an_unmeasured_bar_is_never_reported_as_loose(self):
        # No measurement means no claim either way — it must not fake a green tick
        # nor a red one. The gap is declared in `why`, and the test above pins that.
        unmeasured = thresholds.Bar(value=0.9, why="UNMEASURED: no keyed run recorded", slack=0.1)
        self.assertTrue(unmeasured.within_slack)
        self.assertIsNone(unmeasured.tightened())


class TightenCliTest(unittest.TestCase):
    def test_tighten_exits_zero_when_every_bar_is_tight(self):
        with contextlib.redirect_stdout(io.StringIO()) as out:
            self.assertEqual(thresholds.main(["--tighten"]), 0)
        self.assertIn("Nothing to tighten", out.getvalue())

    def test_tighten_exits_one_and_names_the_proposal_while_a_bar_is_loose(self):
        loosened = replace(thresholds.MATCHING_BARS["role_relevance_at5"], value=0.60)
        with mock.patch.dict(thresholds.MATCHING_BARS, {"role_relevance_at5": loosened}):
            with contextlib.redirect_stdout(io.StringIO()) as out:
                self.assertEqual(thresholds.main(["--tighten"]), 1)
        text = out.getvalue()
        self.assertIn("role_relevance_at5", text)
        self.assertIn("0.84", text)

    def test_the_plain_listing_never_fails_the_run(self):
        loosened = replace(thresholds.MATCHING_BARS["role_relevance_at5"], value=0.60)
        with mock.patch.dict(thresholds.MATCHING_BARS, {"role_relevance_at5": loosened}):
            with contextlib.redirect_stdout(io.StringIO()):
                self.assertEqual(thresholds.main([]), 0)
                self.assertEqual(thresholds.main(["--json"]), 0)


if __name__ == "__main__":
    unittest.main()
