"""CI guard for the automation quality-gating eval (deterministic path only)."""

import unittest

from pipeline.jobfit.eval.automation_eval import (
    _EARLY,
    SCENARIOS,
    TASKS,
    _aggregate,
    _automation_banner,
    _passes,
    run_tasks,
)
from pipeline.jobfit.eval._style import _make_styler
from pipeline.jobfit.eval.thresholds import QUALITY_THRESHOLD


class TestAutomationEval(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.rows = run_tasks(None)  # deterministic fallbacks, no Claude CLI

    def test_deterministic_reliability_is_perfect(self):
        agg = _aggregate(self.rows)
        failures = [(r.task, r.scenario, r.issues) for r in self.rows if not r.reliable]
        self.assertEqual(agg["reliability"], 1.0, failures)

    def test_every_task_runs_over_every_scenario(self):
        self.assertEqual(len(self.rows), len(TASKS) * len(SCENARIOS))

    def test_early_career_never_auto_rejected_or_advanced(self):
        names = {s.name: s for s in SCENARIOS}
        for r in (x for x in self.rows if x.task == "screen"):
            if names[r.scenario].candidate.archetype in _EARLY:
                with self.subTest(scenario=r.scenario):
                    self.assertNotEqual(r.output.get("recommendation"), "reject", r.scenario)
                    self.assertNotEqual(r.output.get("route"), "advance", r.scenario)

    def test_rejection_has_no_protected_characteristic_language(self):
        for r in (x for x in self.rows if x.task == "rejection"):
            with self.subTest(scenario=r.scenario):
                self.assertEqual([i for i in r.issues if "FAIRNESS" in i], [], r.scenario)


class TestJudgeGate(unittest.TestCase):
    """bug-ui-scan-2026-07-09 (hiring-automation-scheduler #5): a --judge run whose
    judge scored NOTHING (quality_mean=None) must FAIL the gate, not silently pass
    on reliability alone."""

    RELIABLE = {"reliability": 1.0, "quality_mean": None, "unscored": 24, "total": 24, "reliable": 24, "by_task": {}}

    def test_judge_requested_but_unscored_fails(self):
        # Judge was asked for but produced no usable scores → the quality gate can't
        # be satisfied, so a strict run must NOT pass on reliability alone.
        self.assertFalse(_passes(self.RELIABLE, judge_requested=True))

    def test_judge_not_requested_still_passes_on_reliability(self):
        # A deterministic (--no-llm) run never requested a judge; quality_mean=None
        # is a legitimate skip, so reliability alone still passes.
        self.assertTrue(_passes(self.RELIABLE, judge_requested=False))
        # Default arg preserves the historical (judge-not-requested) behavior.
        self.assertTrue(_passes(self.RELIABLE))

    def test_scored_run_still_gated_on_quality_threshold(self):
        good = {**self.RELIABLE, "quality_mean": QUALITY_THRESHOLD}
        bad = {**self.RELIABLE, "quality_mean": QUALITY_THRESHOLD - 0.1}
        self.assertTrue(_passes(good, judge_requested=True))
        self.assertFalse(_passes(bad, judge_requested=True))

    def test_banner_counts_the_unavailable_judge_as_a_failed_check(self):
        # The verdict word (FAIL) must not contradict the checks count: the missing
        # quality gate is counted as a check so the count can't read "N/N PASS".
        banner = _automation_banner(self.RELIABLE, _make_styler(False), judge_requested=True)
        self.assertIn("FAIL", banner)
        # 24 reliable pass out of 24 runs + 1 (failed) quality check = 24/25.
        self.assertIn("24/25", banner)


if __name__ == "__main__":
    unittest.main()
