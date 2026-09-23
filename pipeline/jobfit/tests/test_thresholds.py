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
import json
import os
import re
import shutil
import tempfile
import unittest
from dataclasses import replace
from pathlib import Path
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


_REPO = Path(__file__).resolve().parents[3]
_RELEVANCE = "MATCHING_THRESHOLDS.role_relevance_at5"
_MATCHING_NAMES = (
    "MATCHING_THRESHOLDS.archetype_accuracy",
    "MATCHING_THRESHOLDS.entry_precision",
    "MATCHING_THRESHOLDS.role_relevance_at5",
)


def _no_ci_env() -> dict[str, str]:
    return {k: v for k, v in os.environ.items() if k not in thresholds.CI_ENV_VARS}


class CertifiedMeasurementTest(unittest.TestCase):
    """The bar is judged against a RECORDED measurement. Until 2026-09-23 that
    record was a hand-typed literal nothing re-derived, so an engine change
    that lifted relevance@5 to 0.95 would leave the record at 0.857 and the
    slack check reading a stale number: the 0.60-vs-0.857 blindness one layer
    up. For the evals with no model in the loop the live figure is exactly
    checkable, so a strict run now certifies the record against it."""

    def test_the_live_figure_equal_to_the_record_is_certified(self):
        bar = thresholds.all_bars()[_RELEVANCE]
        self.assertEqual(bar.measured, 0.857)
        recorded = {_RELEVANCE: thresholds.load_units()[_RELEVANCE]}
        self.assertEqual(thresholds.certify_live({_RELEVANCE: (0.857, bar.n)}, recorded), [])

    def test_a_moved_live_figure_is_one_finding_naming_both_figures_and_the_record_command(self):
        bar = thresholds.all_bars()[_RELEVANCE]
        recorded = {_RELEVANCE: thresholds.load_units()[_RELEVANCE]}
        findings = thresholds.certify_live({_RELEVANCE: (0.95, bar.n)}, recorded)
        self.assertEqual(len(findings), 1)
        text = findings[0]
        self.assertIn(_RELEVANCE, text)
        self.assertIn("0.95", text)
        self.assertIn("0.857", text)
        self.assertIn("--record", text)
        self.assertIn("matching_eval", text)

    def test_matching_eval_strict_exits_one_on_a_stale_record(self):
        from pipeline.jobfit.eval import matching_eval

        real = matching_eval.Report.aggregate

        def lifted(self):
            return {**real(self), "role_relevance_at5": 0.95}

        with mock.patch.object(matching_eval.Report, "aggregate", lifted):
            with contextlib.redirect_stdout(io.StringIO()), contextlib.redirect_stderr(io.StringIO()) as err:
                code = matching_eval.main(["--strict", "--no-color"])
        # 0.95 clears the 0.84 bar, so the ONLY thing failing this run is the stale record.
        self.assertEqual(code, 1)
        self.assertIn("--record", err.getvalue())

    def test_matching_eval_strict_is_green_on_the_committed_record(self):
        from pipeline.jobfit.eval import matching_eval

        with contextlib.redirect_stdout(io.StringIO()), contextlib.redirect_stderr(io.StringIO()):
            self.assertEqual(matching_eval.main(["--strict", "--no-color"]), 0)

    def test_a_non_deterministic_bar_is_never_live_certified(self):
        bar = thresholds.all_bars()["PASS_THRESHOLDS.role_family"]
        self.assertFalse(bar.deterministic)
        self.assertEqual(thresholds.certify_live({"PASS_THRESHOLDS.role_family": (0.70, 3)}, {}), [])

    def test_a_deterministic_bar_without_a_record_is_refused(self):
        records = thresholds.load_measurements()
        del records[_RELEVANCE]
        with self.assertRaises(ValueError) as ctx:
            thresholds.bind_measurements(records)
        self.assertIn(_RELEVANCE, str(ctx.exception))
        self.assertIn("measurements.json", str(ctx.exception))

    def test_a_record_for_a_bar_that_does_not_exist_is_refused(self):
        records = {**thresholds.load_measurements(), "MATCHING_THRESHOLDS.retired": {
            "measured": 1.0, "n": 1, "measured_at": "2026-01-01", "source": "x", "corpus": "y"}}
        with self.assertRaises(ValueError):
            thresholds.bind_measurements(records)

    def test_a_deterministic_record_must_carry_its_count(self):
        records = thresholds.load_measurements()
        records[_RELEVANCE] = {**records[_RELEVANCE], "n": None}
        with self.assertRaises(ValueError):
            thresholds.bind_measurements(records)

    def test_the_committed_file_is_in_its_canonical_form(self):
        # --record rewrites through one renderer; a hand-formatted file would make
        # its first --record diff touch every line and hide the real change.
        text = thresholds.MEASUREMENTS_PATH.read_text(encoding="utf-8")
        self.assertEqual(thresholds.render_measurements(json.loads(text)["bars"]), text)


class RecordFlagTest(unittest.TestCase):
    def setUp(self):
        tmp = tempfile.mkdtemp()
        self.addCleanup(shutil.rmtree, tmp, ignore_errors=True)
        self.path = Path(tmp) / "measurements.json"
        shutil.copyfile(thresholds.MEASUREMENTS_PATH, self.path)
        shutil.copyfile(thresholds.UNITS_PATH, self.path.with_name(thresholds.UNITS_PATH.name))
        self.before = self.path.read_text(encoding="utf-8")

    def _run_matching(self, argv, env):
        from pipeline.jobfit.eval import matching_eval

        real = matching_eval.Report.aggregate

        def lifted(report):
            return {**real(report), "role_relevance_at5": 0.95}

        with mock.patch.object(thresholds, "MEASUREMENTS_PATH", self.path), \
                mock.patch.dict(os.environ, env, clear=True), \
                mock.patch.object(matching_eval.Report, "aggregate", lifted), \
                contextlib.redirect_stdout(io.StringIO()), contextlib.redirect_stderr(io.StringIO()) as err:
            code = matching_eval.main(argv)
        return code, err.getvalue()

    def test_record_rewrites_only_its_own_bars_and_leaves_every_other_line_byte_identical(self):
        code, _ = self._run_matching(["--record", "--no-color"], _no_ci_env())
        self.assertEqual(code, 0)
        after = self.path.read_text(encoding="utf-8")
        old_lines, new_lines = self.before.splitlines(), after.splitlines()
        self.assertEqual(len(old_lines), len(new_lines))
        changed = [(o, n) for o, n in zip(old_lines, new_lines) if o != n]
        self.assertTrue(changed, "the lifted figure was not recorded")
        for old, new in changed:
            self.assertTrue(any(f'"{name}"' in old for name in _MATCHING_NAMES), old)
            self.assertTrue(any(f'"{name}"' in new for name in _MATCHING_NAMES), new)
        records = json.loads(after)["bars"]
        self.assertEqual(records[_RELEVANCE]["measured"], 0.95)
        self.assertRegex(records[_RELEVANCE]["measured_at"], r"^\d{4}-\d{2}-\d{2}$")
        for name, rec in json.loads(self.before)["bars"].items():
            if name not in _MATCHING_NAMES:
                self.assertEqual(records[name], rec, name)

    def test_record_refuses_to_run_in_ci(self):
        # --record rewrites the certified figure; a CI job doing it would certify
        # whatever the push measured, which is the gate grading itself.
        for var in thresholds.CI_ENV_VARS:
            with self.subTest(var=var):
                code, err = self._run_matching(["--record"], {**_no_ci_env(), var: "true"})
                self.assertEqual(code, 2)
                self.assertIn("CI", err)
                self.assertEqual(self.path.read_text(encoding="utf-8"), self.before)
                self.assertEqual(
                    self.path.with_name(thresholds.UNITS_PATH.name).read_bytes(), thresholds.UNITS_PATH.read_bytes()
                )

    def test_record_refuses_a_non_deterministic_bar(self):
        with mock.patch.object(thresholds, "MEASUREMENTS_PATH", self.path):
            with self.assertRaises(ValueError):
                thresholds.record_measurements({"PASS_THRESHOLDS.role_family": (0.9, 50)}, {}, source="x")
        self.assertEqual(self.path.read_text(encoding="utf-8"), self.before)


_RELIABILITY = "RELIABILITY_THRESHOLD"


def _bars_with(name: str, **changes) -> dict[str, "thresholds.Bar"]:
    bars = dict(thresholds.all_bars())
    bars[name] = replace(bars[name], **changes)
    return bars


class UnitIdentityTest(unittest.TestCase):
    """A (rate, n) pair cannot tell 'lost one unit, gained another' from
    'nothing changed', and a mean cannot tell one scenario falling from
    another rising by the same amount. Each deterministic bar's units are
    now recorded by identity, and a stale-record finding names the units
    that left, joined or flipped, so the operator reads ids rather than
    re-running four evals to find out what moved."""

    def test_a_swapped_unit_with_the_same_rate_and_n_is_one_finding_naming_both(self):
        bars = _bars_with(_RELIABILITY, measured=1.0, n=3)
        recorded = {_RELIABILITY: {"a": 1.0, "b": 1.0, "c": 1.0}}
        live_units = {_RELIABILITY: {"a": 1.0, "b": 1.0, "d": 1.0}}
        findings = thresholds.certify_live(
            {_RELIABILITY: (1.0, 3)}, live_units, bars=bars, recorded=recorded
        )
        self.assertEqual(len(findings), 1)
        self.assertIn("left: c", findings[0])
        self.assertIn("joined: d", findings[0])

    def test_compensating_relevance_moves_with_the_same_mean_name_both_scenarios(self):
        bars = _bars_with(_RELEVANCE, measured=0.8, n=2)
        recorded = {_RELEVANCE: {"s1": 1.0, "s2": 0.6}}
        live_units = {_RELEVANCE: {"s1": 0.8, "s2": 0.8}}
        findings = thresholds.certify_live({_RELEVANCE: (0.8, 2)}, live_units, bars=bars, recorded=recorded)
        self.assertEqual(len(findings), 1)
        self.assertIn("s1 1.0 -> 0.8", findings[0])
        self.assertIn("s2 0.6 -> 0.8", findings[0])

    def test_identical_units_certify_and_a_long_diff_is_capped_and_ends_with_the_recorder(self):
        bars = _bars_with(_RELIABILITY, measured=1.0, n=14)
        same = {f"u{i:02d}": 1.0 for i in range(14)}
        self.assertEqual(
            thresholds.certify_live({_RELIABILITY: (1.0, 14)}, {_RELIABILITY: dict(same)},
                                    bars=bars, recorded={_RELIABILITY: same}),
            [],
        )
        moved = {f"v{i:02d}": 1.0 for i in range(14)}  # 14 left + 14 joined = 28 changes
        findings = thresholds.certify_live({_RELIABILITY: (1.0, 14)}, {_RELIABILITY: moved},
                                           bars=bars, recorded={_RELIABILITY: same})
        self.assertEqual(len(findings), 1)
        text = findings[0]
        self.assertIn("+18 more", text)
        named = re.findall(r"\b[uv]\d\d\b", text)
        self.assertEqual(len(named), 10)
        self.assertTrue(text.endswith(f"`{bars[_RELIABILITY].recorder}`"), text)

    def test_the_committed_units_certify_every_deterministic_bar(self):
        recorded = thresholds.load_units()
        for name, bar in thresholds.all_bars().items():
            if bar.deterministic:
                with self.subTest(bar=name):
                    self.assertEqual(len(recorded[name]), bar.n)

    def test_a_duplicate_live_unit_id_is_refused_by_name(self):
        with self.assertRaises(ValueError) as ctx:
            thresholds.unit_map([("screen/bau_weak", 1.0), ("screen/bau_weak", 0.0)])
        self.assertIn("screen/bau_weak", str(ctx.exception))

    def test_a_duplicate_id_in_the_units_file_is_refused_by_name(self):
        tmp = Path(tempfile.mkdtemp())
        self.addCleanup(shutil.rmtree, tmp, ignore_errors=True)
        path = tmp / "measurements.units.json"
        path.write_text(
            '{"schema": 1, "units": {"RELIABILITY_THRESHOLD": {"x": 1.0, "x": 1.0}}}', encoding="utf-8"
        )
        with self.assertRaises(ValueError) as ctx:
            thresholds.load_units(path)
        self.assertIn("x", str(ctx.exception))

    def test_a_deterministic_bar_with_a_record_but_no_units_is_refused_naming_its_recorder(self):
        units = thresholds.load_units()
        del units[_RELIABILITY]
        with self.assertRaises(ValueError) as ctx:
            thresholds.bind_units(units)
        self.assertIn(_RELIABILITY, str(ctx.exception))
        self.assertIn(thresholds.all_bars()[_RELIABILITY].recorder, str(ctx.exception))

    def test_units_whose_count_disagrees_with_the_record_are_refused(self):
        units = thresholds.load_units()
        units[_RELIABILITY] = dict(list(units[_RELIABILITY].items())[:-1])
        with self.assertRaises(ValueError) as ctx:
            thresholds.bind_units(units)
        self.assertIn(_RELIABILITY, str(ctx.exception))

    def test_the_committed_units_file_is_in_its_canonical_form(self):
        text = thresholds.UNITS_PATH.read_text(encoding="utf-8")
        self.assertEqual(thresholds.render_units(thresholds.load_units()), text)
        body = [line for line in text.splitlines() if line.startswith("      ")]
        self.assertEqual(len(body), sum(len(u) for u in thresholds.load_units().values()))

    def test_matching_live_units_are_one_per_scenario_and_match_their_n(self):
        from pipeline.jobfit.eval import matching_eval

        report = matching_eval.run()
        live = matching_eval.live_measurements(report)
        units = matching_eval.live_units(report)
        self.assertEqual(set(units), set(live))
        names = [s.name for s in report.scenarios]
        self.assertEqual(sorted(units["MATCHING_THRESHOLDS.archetype_accuracy"]), sorted(names))
        self.assertEqual(sorted(units[_RELEVANCE]), sorted(names))
        early = [s.name for s in report.scenarios if s.entry_precision is not None]
        self.assertEqual(sorted(units["MATCHING_THRESHOLDS.entry_precision"]), sorted(early))
        for name, (_, n) in live.items():
            self.assertEqual(len(units[name]), n, name)
        self.assertEqual(thresholds.certify_live(live, units), [])


class UnitRecordTest(unittest.TestCase):
    def setUp(self):
        tmp = tempfile.mkdtemp()
        self.addCleanup(shutil.rmtree, tmp, ignore_errors=True)
        self.path = Path(tmp) / "measurements.json"
        self.units_path = Path(tmp) / thresholds.UNITS_PATH.name
        shutil.copyfile(thresholds.MEASUREMENTS_PATH, self.path)
        shutil.copyfile(thresholds.UNITS_PATH, self.units_path)

    def test_record_writes_one_sorted_unit_per_line_and_a_second_record_changes_no_byte(self):
        n = thresholds.all_bars()[_RELIABILITY].n
        units = {_RELIABILITY: {f"task{i % 3}/scenario{i:02d}": 1.0 for i in reversed(range(n))}}
        live = {_RELIABILITY: (1.0, n)}
        source = thresholds.all_bars()[_RELIABILITY].recorder
        thresholds.record_measurements(live, units, source=source, today="2026-09-24", path=self.path)
        first = (self.path.read_bytes(), self.units_path.read_bytes())
        text = first[1].decode("utf-8")
        self.assertNotIn("\r\n", text)
        mine = [line.strip() for line in text.splitlines() if line.strip().startswith('"task')]
        self.assertEqual(len(mine), n)
        ids = [json.loads("{" + line.rstrip(",") + "}").popitem()[0] for line in mine]
        self.assertEqual(ids, sorted(ids))
        bars = list(json.loads(text)["units"])
        self.assertEqual(bars, sorted(bars))
        changed = thresholds.record_measurements(live, units, source=source, today="2026-09-25", path=self.path)
        self.assertEqual(changed, [])
        self.assertEqual((self.path.read_bytes(), self.units_path.read_bytes()), first)

    def test_record_refuses_units_that_disagree_with_their_count(self):
        before = self.units_path.read_bytes()
        with self.assertRaises(ValueError):
            thresholds.record_measurements(
                {_RELIABILITY: (1.0, 3)}, {_RELIABILITY: {"a": 1.0, "b": 1.0}}, source="x", path=self.path
            )
        self.assertEqual(self.units_path.read_bytes(), before)


class EveryGatedEvalOwnsABarTest(unittest.TestCase):
    """``thresholds.py`` claims to be the single source of every eval bar. Until
    this pin, one of the four evals `test:eval:ci` runs (intake) imported nothing
    from it."""

    def _gated_modules(self) -> list[str]:
        scripts = json.loads((_REPO / "package.json").read_text(encoding="utf-8"))["scripts"]
        modules = []
        for step in re.findall(r"npm run (\S+)", scripts["test:eval:ci"]):
            match = re.search(r"pipeline\.jobfit\.eval\.(\w+)", scripts[step])
            self.assertIsNotNone(match, f"{step} does not run an eval module")
            modules.append(match.group(1))
        return modules

    def test_the_ci_eval_gate_runs_the_four_keyless_evals(self):
        self.assertEqual(
            sorted(self._gated_modules()), ["automation_eval", "fault_eval", "intake_eval", "matching_eval"]
        )

    def test_every_gated_module_owns_a_deterministic_certified_bar(self):
        owners = {bar.recorder_module for bar in thresholds.all_bars().values() if bar.deterministic}
        for module in self._gated_modules():
            with self.subTest(module=module):
                self.assertIn(module, owners)
                source = (_REPO / "pipeline" / "jobfit" / "eval" / f"{module}.py").read_text(encoding="utf-8")
                self.assertIn("from .thresholds import", source)
                self.assertIn("settle_live(", source, f"{module} never certifies its record")


if __name__ == "__main__":
    unittest.main()
