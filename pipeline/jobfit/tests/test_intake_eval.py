"""Offline certification of the role-intake dialog eval (intake_eval.py).

Runs the full 12-persona bank in --no-llm mode (deterministic agent + golden
requestor answers) and requires every reliability invariant to hold — the
keyless product path is certified in CI, mirroring how the interview eval's
golden mode is gated."""

from __future__ import annotations

import unittest

from pipeline.jobfit.eval.intake_eval import check_dialog, load_scenarios, run_eval, simulate


class IntakeEvalOfflineTest(unittest.TestCase):
    def test_all_personas_pass_offline(self) -> None:
        scenarios = load_scenarios()
        self.assertGreaterEqual(len(scenarios), 12)
        report, ok = run_eval(scenarios, no_llm=True, cap=30, color=False)
        self.assertTrue(ok, f"offline intake eval failed:\n{report}")
        self.assertIn("personas PASS", report)

    def test_premature_end_is_caught(self) -> None:
        # A dialog whose agent emitted <<END>> mid-conversation must fail the
        # no_premature_end invariant — the check itself is load-bearing.
        scenario = load_scenarios(["power_unit_backfill"])[0]
        turns, brief, shape, done = simulate(None, None, scenario)
        agent_idx = [i for i, t in enumerate(turns) if t["role"] == "interviewer"]
        sabotaged = [dict(t) for t in turns]
        sabotaged[agent_idx[1]]["text"] += " <<END>>"
        checks = check_dialog(scenario, sabotaged, brief, shape, done)
        self.assertFalse(checks["no_premature_end"])

    def test_ungrounded_close_is_caught(self) -> None:
        scenario = load_scenarios(["power_unit_backfill"])[0]
        turns, brief, shape, done = simulate(None, None, scenario)
        sabotaged = [dict(t) for t in turns]
        sabotaged[-1]["text"] = "Thanks, that's everything! <<END>>"  # generic goodbye, no read-back
        checks = check_dialog(scenario, sabotaged, brief, shape, done)
        self.assertFalse(checks["grounded_readback"])


if __name__ == "__main__":
    unittest.main()
