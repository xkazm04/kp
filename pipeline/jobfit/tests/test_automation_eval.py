"""CI guard for the automation quality-gating eval (deterministic path only)."""

import unittest

from pipeline.jobfit.eval.automation_eval import _EARLY, SCENARIOS, TASKS, _aggregate, run_tasks


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
                self.assertNotEqual(r.output.get("recommendation"), "reject", r.scenario)
                self.assertNotEqual(r.output.get("route"), "advance", r.scenario)

    def test_rejection_has_no_protected_characteristic_language(self):
        for r in (x for x in self.rows if x.task == "rejection"):
            self.assertEqual([i for i in r.issues if "FAIRNESS" in i], [], r.scenario)


if __name__ == "__main__":
    unittest.main()
