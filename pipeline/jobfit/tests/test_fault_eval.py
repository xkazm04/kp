"""Pins for the fault drill's own machinery — the part that decides the gate.

``test_fault_injection.py`` covers the seam under test (the provider, the letter
guard, the descent vocabulary). Nothing covered the DRILL: ``_aggregate`` folds
every row into the verdict, ``_passes`` turns that into CI's exit code, and
``_format_md`` is the only thing an operator reads. All three could have been
wrong in a way that made a red matrix report green, and the drill would still
have "passed" every push.

What is pinned here, and why each one is not decoration:

  - ``_aggregate`` keeps the per-mode maxima and the ORDER rows arrived in. The
    maxima are what the report's "max calls (ceiling)" column shows, so a fold
    that averaged or last-wrote would hide the one run that blew the bound.
  - ``_passes`` under the immovable 1.0, INCLUDING the empty-filter case: an
    aggregate over zero rows must be a FAIL, or ``--mode`` with a filter that
    selected nothing would be a vacuous green.
  - ``_format_md``'s columns, because they are the record.
  - the BOUND's floor (``min_calls``), which is what makes "the provider was
    never called" a failure instead of a free pass.
  - the doc's generated fault table against ``EXPECTATIONS``.
"""

from __future__ import annotations

import io
import unittest
from contextlib import redirect_stdout
from pathlib import Path
from unittest import mock

from pipeline.jobfit.eval import fault_eval
from pipeline.jobfit.eval.fault_eval import (
    DOC_PATH,
    DOC_TABLE_BEGIN,
    DOC_TABLE_END,
    EXPECTATIONS,
    Row,
    _aggregate,
    _call_was_owed,
    _doc_table,
    _format_md,
    _passes,
    _run_one,
)
from pipeline.jobfit.eval.thresholds import FAULT_THRESHOLD


def _row(mode: str, task: str = "screen", *, ok: bool = True, **kw) -> Row:
    return Row(
        mode=mode,
        task=task,
        scenario=kw.pop("scenario", "bau_weak"),
        source=kw.pop("source", "deterministic"),
        calls=kw.pop("calls", 1),
        seconds=kw.pop("seconds", 0.1),
        reason=kw.pop("reason", None),
        failures=[] if ok else kw.pop("failures", ["boom"]),
    )


class AggregateTest(unittest.TestCase):
    def test_folds_per_mode_and_keeps_the_maxima(self):
        rows = [
            _row("hang", calls=1, seconds=0.5),
            _row("hang", calls=3, seconds=2.25),
            _row("hang", ok=False, calls=2, seconds=0.1),
        ]
        agg = _aggregate(rows)
        m = agg["by_mode"]["hang"]
        self.assertEqual((m["n"], m["ok"]), (3, 2))
        # MAX, not last and not mean: the one run that spent the most is the
        # whole point of the column.
        self.assertEqual(m["max_calls"], 3)
        self.assertEqual(m["max_seconds"], 2.25)
        self.assertEqual((agg["total"], agg["passed"]), (3, 2))
        self.assertEqual(agg["pass_rate"], round(2 / 3, 3))

    def test_mode_order_follows_the_rows(self):
        agg = _aggregate([_row("empty"), _row("hang"), _row("empty"), _row("nonsense")])
        self.assertEqual(list(agg["by_mode"]), ["empty", "hang", "nonsense"])

    def test_reasons_are_deduped_and_a_missing_one_is_shown_as_a_dash(self):
        agg = _aggregate(
            [
                _row("hang", reason="provider_timeout"),
                _row("hang", reason="provider_timeout"),
                _row("hang", reason=None),
                _row("hang", reason="provider_error"),
            ]
        )
        # Order preserved so the report reads as "what happened, in order".
        self.assertEqual(agg["by_mode"]["hang"]["reasons"], ["provider_timeout", "—", "provider_error"])

    def test_no_rows_aggregates_to_a_zero_rate_rather_than_dividing_by_zero(self):
        agg = _aggregate([])
        self.assertEqual((agg["total"], agg["passed"], agg["pass_rate"]), (0, 0, 0.0))


class PassesTest(unittest.TestCase):
    def test_the_bar_is_every_expectation(self):
        self.assertEqual(FAULT_THRESHOLD, 1.0)
        self.assertTrue(_passes(_aggregate([_row("nonsense"), _row("empty")])))

    def test_one_failed_row_fails_the_drill(self):
        self.assertFalse(_passes(_aggregate([_row("nonsense"), _row("empty", ok=False)])))

    def test_an_empty_filter_is_a_failure_not_a_vacuous_pass(self):
        # A `--mode` filter that selected nothing must not read as "every fault
        # degraded correctly": total > 0 is the guard, and it holds even when the
        # rate says 1.0 the way a fold over zero rows could.
        self.assertFalse(_passes(_aggregate([])))
        self.assertFalse(_passes({"total": 0, "passed": 0, "pass_rate": 1.0, "by_mode": {}}))


class FormatMdTest(unittest.TestCase):
    def test_the_table_carries_the_columns_an_operator_reads(self):
        rows = [_row("nonsense", calls=1, seconds=0.4)]
        md = _format_md(rows, _aggregate(rows), color=False)
        self.assertIn("| fault | runs | held | max calls (ceiling) | slowest | ledger reason | degrades to |", md)
        # observed calls, then the recorded ceiling in parentheses
        self.assertIn("| 1 (1) |", md)
        self.assertIn("0.40s", md)
        self.assertIn(fault_eval._BY_MODE["nonsense"].degrades_to, md)
        self.assertIn("1/1 checks PASS", md)
        self.assertNotIn("Expectations that did NOT hold", md)

    def test_a_failure_is_named_with_its_row_and_its_reason(self):
        rows = [
            _row("hang", task="rejection", ok=False, failures=["spent 9 completions, ceiling 3"]),
            _row("hang", task="screen"),
        ]
        md = _format_md(rows, _aggregate(rows), color=False)
        self.assertIn("1/2 checks FAIL", md)
        self.assertIn("1 FAIL", md)
        self.assertIn("## Expectations that did NOT hold", md)
        self.assertIn("**hang / rejection / bau_weak**: spent 9 completions, ceiling 3", md)


class CallFloorTest(unittest.TestCase):
    """THE BOUND's floor: a fault that never reached the provider is not a pass."""

    @staticmethod
    def _fake_tasks(out: dict, *, call_provider: bool):
        def run(scenario, provider):
            if call_provider and provider is not None:
                provider.complete("ping", timeout=1)
            return out, "deterministic"

        return {"screen": {"run": run, "check": lambda _o, _s: []}}

    def _run(self, mode: str, out: dict, *, call_provider: bool) -> Row:
        scenario = fault_eval.SCENARIOS_UNDER_FAULT[0]
        with mock.patch.dict(fault_eval.TASKS, self._fake_tasks(out, call_provider=call_provider), clear=True):
            return _run_one(mode, "screen", scenario)

    def test_a_task_that_never_calls_the_provider_fails_the_bound(self):
        row = self._run("nonsense", {}, call_provider=False)
        self.assertEqual(row.calls, 0)
        self.assertTrue(
            any("floor 1" in f and "never called" in f for f in row.failures),
            f"expected a BOUND floor failure, got {row.failures}",
        )

    def test_a_task_that_does_call_it_clears_the_floor(self):
        row = self._run("nonsense", {}, call_provider=True)
        self.assertEqual(row.calls, 1)
        self.assertEqual(row.failures, [])

    def test_unavailable_is_the_declared_exception(self):
        # available() is False, so nothing is handed over and spending 0 is the
        # expectation rather than a finding.
        row = self._run("unavailable", {}, call_provider=True)
        self.assertEqual(row.calls, 0)
        self.assertEqual(row.failures, [])

    def test_the_floor_is_declared_for_every_fault_that_hands_a_provider_over(self):
        for exp in EXPECTATIONS:
            with self.subTest(mode=exp.mode):
                self.assertEqual(exp.min_calls, 0 if exp.mode == "unavailable" else 1)
                self.assertLessEqual(exp.min_calls, exp.max_calls)

    def test_rematch_is_exempt_only_where_it_short_circuits(self):
        self.assertFalse(_call_was_owed("rematch", {"found": False}))
        self.assertTrue(_call_was_owed("rematch", {"found": True}))
        self.assertTrue(_call_was_owed("screen", {}))


class DocTableTest(unittest.TestCase):
    def test_every_mode_has_a_row_with_its_recorded_cost(self):
        lines = _doc_table().splitlines()
        self.assertEqual(len(lines), len(EXPECTATIONS) + 2)
        for exp in EXPECTATIONS:
            with self.subTest(mode=exp.mode):
                row = next(line for line in lines if line.startswith(f"| `{exp.mode}` |"))
                self.assertIn(exp.lie, row)
                self.assertIn(exp.degrades_to, row)
                # "≤ N" only where a range exists; an exact cost must not read
                # as a limit someone may relax.
                bound = f"≤ {exp.max_calls}" if exp.max_calls > 1 else str(exp.max_calls)
                self.assertTrue(row.endswith(f"| {bound} |"), row)

    def test_the_doc_carries_the_generated_table_verbatim(self):
        doc = Path(__file__).resolve().parents[3] / DOC_PATH
        text = doc.read_text(encoding="utf-8")
        self.assertIn(DOC_TABLE_BEGIN, text)
        block = text.split(DOC_TABLE_BEGIN, 1)[1].split(DOC_TABLE_END, 1)[0]
        # Line endings are the checkout's business (this repo is CRLF); the
        # content is ours.
        got = "\n".join(line for line in block.replace("\r\n", "\n").split("\n") if line.startswith("|"))
        self.assertEqual(
            got,
            _doc_table(),
            f"{DOC_PATH} is stale — regenerate with "
            "`python -m pipeline.jobfit.eval.fault_eval --doc-table`",
        )

    def test_the_flag_prints_the_table_and_runs_no_drill(self):
        buf = io.StringIO()
        with redirect_stdout(buf):
            code = fault_eval.main(["--doc-table"])
        self.assertEqual(code, 0)
        self.assertEqual(buf.getvalue().strip(), _doc_table())


if __name__ == "__main__":
    unittest.main()
