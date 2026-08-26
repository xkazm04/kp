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

    def test_every_scenario_carries_both_standing_assertions(self) -> None:
        # role_family and requirements_captured are CONDITIONAL in check_dialog:
        # it emits them only when the scenario declares a family / dealbreakers,
        # and run_eval's all(checks.values()) then passes over the smaller set.
        # So a scenario added without those keys loses both assertions silently
        # and still reports PASS. Both are meant to be STANDING coverage (B11,
        # L2-NEW-2) — pin the declaration for every scenario in BOTH banks so
        # the coverage cannot be dropped by omitting a key.
        from pipeline.jobfit.eval.intake_scenarios_gen import fixed_bank

        for label, bank in (("curated", load_scenarios()), ("generated", fixed_bank(100))):
            for scenario in bank:
                name = f"{label}:{scenario['name']}"
                family = scenario.get("family") or (scenario.get("expect") or {}).get("role_family")
                self.assertTrue(family, f"{name} declares no family — role_family would not be asserted")
                self.assertTrue(
                    scenario.get("dealbreakers"),
                    f"{name} declares no dealbreakers — requirements_captured would not be asserted",
                )

    def test_undeclared_scenario_would_lose_both_assertions(self) -> None:
        # Proves the guard above is load-bearing rather than decorative: strip
        # the two declaring keys and check_dialog stops emitting both checks —
        # a vacuous PASS. This is the failure the guard exists to prevent.
        scenario = load_scenarios(["power_unit_backfill"])[0]
        turns, brief, shape, done = simulate(None, None, scenario)
        undeclared = {k: v for k, v in scenario.items() if k not in ("family", "dealbreakers")}
        undeclared["expect"] = {k: v for k, v in (scenario.get("expect") or {}).items() if k != "role_family"}
        checks = check_dialog(undeclared, turns, brief, shape, done)
        self.assertNotIn("role_family", checks)
        self.assertNotIn("requirements_captured", checks)
        # …and the stripped scenario still "passes", which is exactly the hazard.
        _, ok = run_eval([undeclared], no_llm=True, cap=30, color=False)
        self.assertTrue(ok)

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

    def test_every_scenario_carries_both_standing_assertions(self) -> None:
        # role_family and requirements_captured are CONDITIONAL in check_dialog
        # (a scenario that declares neither field simply skips them, and the
        # bank still reports PASS). That makes the coverage silently erodable:
        # a persona added without `family`/`dealbreakers` would quietly drop the
        # two UAT regressions it was supposed to carry. Pin the declaration in
        # BOTH banks so the skip can never happen unnoticed.
        from pipeline.jobfit.eval.intake_scenarios_gen import fixed_bank

        for label, bank in (("curated", load_scenarios()), ("generated", fixed_bank(100))):
            for scenario in bank:
                name = f"{label}/{scenario['name']}"
                with self.subTest(scenario=name):
                    family = scenario.get("family") or (scenario.get("expect") or {}).get("role_family")
                    self.assertTrue(family, f"{name} declares no role family — role_family would be skipped")
                    self.assertTrue(
                        scenario.get("dealbreakers"),
                        f"{name} states no dealbreaker — requirements_captured would be skipped",
                    )

        # …and prove the declaration actually materialises as a check, rather
        # than merely being present in the JSON.
        scenario = load_scenarios(["power_unit_backfill"])[0]
        turns, brief, shape, done = simulate(None, None, scenario)
        checks = check_dialog(scenario, turns, brief, shape, done)
        self.assertIn("role_family", checks)
        self.assertIn("requirements_captured", checks)

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

    def test_dealbreaker_filed_as_prose_is_caught(self) -> None:
        # The check must be PER-CONDITION, not merely non-empty. A brief that
        # kept one unrelated requirement while filing every stated dealbreaker
        # as facet prose is exactly the L2-NEW-2 shape, and it satisfies both
        # `len(requirements) >= 1` and brief_core — so a non-empty check could
        # never catch it. The extraction contract (intake.py prompt v2) says
        # each named condition MUST get its own row; assert that.
        scenario = load_scenarios(["power_unit_backfill"])[0]
        self.assertEqual(scenario["dealbreakers"], ["Java", "Spring", "Kafka"])
        turns, brief, shape, done = simulate(None, None, scenario)
        prose = dict(brief)
        prose["requirements"] = [
            {"skill": "team player", "kind": "must_have", "hardness": "learnable",
             "weight": 0.5, "provenance": "stated", "confidence": 0.6}
        ]
        prose["facets"] = [
            *(brief.get("facets") or []),
            {"key": "dealbreaker_context", "label": "Must-haves",
             "value": "Java, Spring and Kafka are non-negotiable", "importance": "core"},
        ]
        checks = check_dialog(scenario, turns, prose, shape, done)
        self.assertTrue(checks["brief_core"], "the decoy must pass brief_core — that is the point")
        self.assertFalse(checks["requirements_captured"])

    def test_partially_routed_dealbreakers_are_caught(self) -> None:
        # Two of three routed is still a dropped hard condition.
        scenario = load_scenarios(["power_unit_backfill"])[0]
        turns, brief, shape, done = simulate(None, None, scenario)
        partial = dict(brief)
        partial["requirements"] = [
            r for r in brief["requirements"] if "kafka" not in str(r.get("skill", "")).lower()
        ]
        self.assertEqual(len(partial["requirements"]), 2)
        self.assertFalse(check_dialog(scenario, turns, partial, shape, done)["requirements_captured"])

    def test_narrowed_dealbreaker_phrasing_still_passes(self) -> None:
        # Tolerant in both directions: a live agent that captures "Java 17" for
        # a stated "Java", or "Flutter" for a stated "Flutter or React Native",
        # has routed the condition — only prose is a miss.
        scenario = load_scenarios(["cant_articulate_level"])[0]
        turns, brief, shape, done = simulate(None, None, scenario)
        self.assertIn("Flutter or React Native", scenario["dealbreakers"])
        narrowed = dict(brief)
        narrowed["requirements"] = [
            {**r, "skill": "Flutter"} if r.get("skill") == "Flutter or React Native" else r
            for r in brief["requirements"]
        ]
        self.assertTrue(check_dialog(scenario, turns, narrowed, shape, done)["requirements_captured"])


if __name__ == "__main__":
    unittest.main()
