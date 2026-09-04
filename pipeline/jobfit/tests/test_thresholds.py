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

import unittest
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


if __name__ == "__main__":
    unittest.main()
