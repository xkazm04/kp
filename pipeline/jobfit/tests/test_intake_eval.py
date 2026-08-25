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

    def test_market_breadth_bank_passes_offline(self) -> None:
        # The UAT-style breadth exercise: 100 generated scenarios spanning ALL
        # 16 role families × seniority × need shape (intake_scenarios_gen).
        # Every one must fill a RoleBrief, triage its shape, respect the
        # power-unit turn budget and close with a grounded read-back — keyless.
        from pipeline.jobfit.eval.intake_scenarios_gen import fixed_bank

        bank = fixed_bank(100)
        self.assertEqual(len(bank), 100)
        families = {s["family"] for s in bank}
        self.assertEqual(len(families), 16, "the bank must span every role family")
        report, ok = run_eval(bank, no_llm=True, cap=30, color=False)
        self.assertTrue(ok, f"market-breadth intake eval failed:\n{report}")

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

    def test_misclassified_family_is_caught(self) -> None:
        # A brief carrying the WRONG family — or the right value with default
        # spine provenance (the schema default nothing ever classified) — must
        # fail the role_family assertion (UAT 2026-08-10 L1-HRBP-17 / B11).
        scenario = load_scenarios(["power_unit_backfill"])[0]
        turns, brief, shape, done = simulate(None, None, scenario)
        wrong = dict(brief)
        wrong["roleFamily"] = "healthcare_clinical"
        self.assertFalse(check_dialog(scenario, turns, wrong, shape, done)["role_family"])
        defaulted = dict(brief)
        defaulted["spineProvenance"] = {
            k: v for k, v in dict(brief.get("spineProvenance") or {}).items() if k != "role_family"
        }
        self.assertFalse(check_dialog(scenario, turns, defaulted, shape, done)["role_family"])

    def test_starved_requirements_are_caught(self) -> None:
        # The persona stated hard dealbreakers in-dialog; a brief whose
        # requirements[] ended up empty (the L2-NEW-2 failure: hard conditions
        # filed as facet prose) must fail requirements_captured.
        scenario = load_scenarios(["power_unit_backfill"])[0]
        turns, brief, shape, done = simulate(None, None, scenario)
        starved = dict(brief)
        starved["requirements"] = []
        self.assertFalse(check_dialog(scenario, turns, starved, shape, done)["requirements_captured"])


if __name__ == "__main__":
    unittest.main()
