"""App master contract (P1): the schemas, the coercer and the deterministic backbone.

What is pinned here is what the rest of the App master work will be built on top
of, so the tests are about the *contract*, not the arithmetic:

* the spec round-trips through camelCase JSON without losing a field;
* the mandate ladder refuses rungs 3 and 4 (deploy/merge, gate changes) — for
  either population, in v1, always;
* the forbidden-change vocabulary is closed;
* the coercer drops hallucinated connectors and hallucinated forbidden classes,
  clamps the rung, and REPORTS each intervention instead of swallowing it;
* :func:`backbone_score` is deterministic, attributable (per-rule contributions,
  never a bare number), and treats an unmeasured input as unmeasured — an
  unmetered budget must not score as perfect adherence.
"""

from __future__ import annotations

import json
import unittest

from pydantic import ValidationError

from pipeline.jobfit.appmaster import (
    APP_MASTER_PROMPT_VERSION,
    FORBIDDEN_CHANGE_CLASSES,
    AppMasterSpec,
    KpiDelta,
    Mandate,
    PerformanceBackbone,
    RepoDossier,
    backbone_score,
    coerce_app_master_spec,
)

CATALOG = ["github", "linear", "slack"]


def _raw_spec(**overrides) -> dict:
    base = {
        "role": {"title": "App master — kp", "population": "agent", "seniority": "senior"},
        "app": {
            "name": "kp",
            "repo": {"url": "https://github.com/xkazm04/kp", "mainBranch": "main"},
            "contextMapRef": "context-map.json",
        },
        "objectives": [
            {
                "kpiKey": "gate_green_rate",
                "label": "Gate green rate",
                "baseline": 0.82,
                "target": 0.95,
                "unit": "ratio",
                "direction": "gte",
                "windowDays": 30,
            }
        ],
        "mandate": {
            "scopeRung": 2,
            "forbiddenClasses": list(FORBIDDEN_CHANGE_CLASSES),
            "approvalGates": ["npm run typecheck", "npm run test:unit"],
            "owner": "kazdanm@gmail.com",
        },
        "cadence": {"triggers": [{"kind": "schedule", "config": {"cron": "0 2 * * *"}}]},
        "budget": {"monthlyUsd": 40, "reservationPolicy": "estimate", "onCap": "drain"},
        "tenure": {"probationDays": 30, "reviewCadenceDays": 14, "retireCriteria": ["0 merged proposals in 60 days"]},
        "agent": {
            "name": "kp App master",
            "mission": "Move kp's value ledger without breaking its gates.",
            "systemPromptDraft": "You own kp's continuing value.",
            "connectors": ["github", "linear"],
            "maxTurns": 40,
        },
    }
    base.update(overrides)
    return base


class SpecSchemaTest(unittest.TestCase):
    def test_round_trip_through_camel_case_json(self):
        spec = coerce_app_master_spec(_raw_spec(), CATALOG)
        wire = json.loads(spec.model_dump_json(by_alias=True))
        # The wire is camelCase (the TS side reads schemas.generated.ts).
        self.assertIn("scopeRung", wire["mandate"])
        self.assertIn("forbiddenClasses", wire["mandate"])
        self.assertIn("mainBranch", wire["app"]["repo"])
        self.assertIn("systemPromptDraft", wire["agent"])
        self.assertEqual(wire["promptVersion"], APP_MASTER_PROMPT_VERSION)
        # …and re-validates to an identical model.
        again = AppMasterSpec.model_validate(wire)
        self.assertEqual(again.model_dump(), spec.model_dump())

    def test_human_population_needs_no_agent_block(self):
        raw = _raw_spec()
        raw["role"] = {"population": "human"}
        raw.pop("agent")
        raw["human"] = {"jdSlug": "app-master-kp", "compBandRef": "software_engineering:senior+1"}
        spec = coerce_app_master_spec(raw, CATALOG)
        self.assertIsNone(spec.agent)
        self.assertEqual(spec.human.jd_slug, "app-master-kp")

    def test_on_cap_is_drain_only(self):
        with self.assertRaises(ValidationError):
            AppMasterSpec.model_validate({"budget": {"monthlyUsd": 10, "onCap": "kill"}})

    def test_negative_budget_is_rejected_by_the_schema(self):
        with self.assertRaises(ValidationError):
            AppMasterSpec.model_validate({"budget": {"monthlyUsd": -1}})


class MandateLadderTest(unittest.TestCase):
    def test_rungs_zero_to_two_are_grantable(self):
        for rung in (0, 1, 2):
            self.assertEqual(Mandate(scope_rung=rung).scope_rung, rung)

    def test_rungs_three_and_four_are_never_grantable(self):
        for rung in (3, 4, 9, -1):
            with self.assertRaises(ValidationError, msg=f"rung {rung} must be refused"):
                Mandate(scope_rung=rung)

    def test_forbidden_class_vocabulary_is_closed(self):
        with self.assertRaises(ValidationError):
            Mandate(forbidden_classes=["rewrite_history"])
        # …and the full closed list validates.
        self.assertEqual(
            Mandate(forbidden_classes=list(FORBIDDEN_CHANGE_CLASSES)).forbidden_classes,
            list(FORBIDDEN_CHANGE_CLASSES),
        )

    def test_default_mandate_forbids_everything_in_the_vocabulary(self):
        # The safe default is the whole list: a spec composed from a thin answer
        # must not read as "these changes are fine".
        self.assertEqual(Mandate().forbidden_classes, list(FORBIDDEN_CHANGE_CLASSES))


class CoercionTest(unittest.TestCase):
    def test_hallucinated_connectors_are_dropped_and_reported(self):
        raw = _raw_spec()
        raw["agent"]["connectors"] = ["github", "prod-database", "GitHub", "wire-transfer"]
        spec = coerce_app_master_spec(raw, CATALOG)
        # "GitHub" folds onto the catalog's own spelling and de-dupes.
        self.assertEqual(spec.agent.connectors, ["github"])
        for name in spec.agent.connectors:
            self.assertIn(name, CATALOG)
        note = " ".join(spec.coercion_notes)
        self.assertIn("prod-database", note)
        self.assertIn("wire-transfer", note)

    def test_rung_is_clamped_and_reported(self):
        raw = _raw_spec()
        raw["mandate"]["scopeRung"] = 4
        spec = coerce_app_master_spec(raw, CATALOG)
        self.assertEqual(spec.mandate.scope_rung, 2)
        self.assertTrue(any("scopeRung 4" in n for n in spec.coercion_notes))

    def test_unknown_forbidden_classes_are_dropped_and_reported(self):
        raw = _raw_spec()
        raw["mandate"]["forbiddenClasses"] = ["test_deletion_or_skip", "be_nice", "gate_configuration"]
        spec = coerce_app_master_spec(raw, CATALOG)
        self.assertEqual(
            spec.mandate.forbidden_classes, ["test_deletion_or_skip", "gate_configuration"]
        )
        self.assertTrue(any("be_nice" in n for n in spec.coercion_notes))

    def test_empty_forbidden_list_falls_back_to_the_full_vocabulary(self):
        raw = _raw_spec()
        raw["mandate"]["forbiddenClasses"] = ["nonsense"]
        spec = coerce_app_master_spec(raw, CATALOG)
        self.assertEqual(spec.mandate.forbidden_classes, list(FORBIDDEN_CHANGE_CLASSES))

    def test_unknown_population_becomes_either_not_a_guess(self):
        raw = _raw_spec()
        raw["role"]["population"] = "cyborg"
        spec = coerce_app_master_spec(raw, CATALOG)
        self.assertEqual(spec.role.population, "either")
        self.assertTrue(any("cyborg" in n for n in spec.coercion_notes))

    def test_unknown_trigger_kind_is_dropped(self):
        raw = _raw_spec()
        raw["cadence"]["triggers"] = [{"kind": "seance"}, {"kind": "pr", "config": {}}]
        spec = coerce_app_master_spec(raw, CATALOG)
        self.assertEqual([t.kind for t in spec.cadence.triggers], ["pr"])

    def test_garbage_input_yields_a_default_spec_not_a_crash(self):
        spec = coerce_app_master_spec("not a dict", CATALOG)  # type: ignore[arg-type]
        self.assertEqual(spec.mandate.scope_rung, 2)
        self.assertEqual(spec.budget.on_cap, "drain")
        self.assertTrue(spec.coercion_notes)

    def test_coercion_is_deterministic(self):
        a = coerce_app_master_spec(_raw_spec(), CATALOG)
        b = coerce_app_master_spec(_raw_spec(), CATALOG)
        self.assertEqual(a.model_dump(), b.model_dump())


class DossierTest(unittest.TestCase):
    def test_dossier_defaults_to_heuristic_with_no_invented_provenance(self):
        d = RepoDossier()
        self.assertEqual(d.source, "heuristic")
        self.assertEqual(d.field_provenance, {})
        self.assertEqual(d.maintainer_load_estimate, "")

    def test_dossier_round_trips_camel_case(self):
        d = RepoDossier.model_validate(
            {
                "dossierId": "kp-2026-08-23",
                "source": "llm",
                "repo": {"rootPath": "C:/Users/kazda/kiro/kp", "mainBranch": "main"},
                "declaredGates": ["npm run typecheck"],
                "size": {"files": 2377, "contexts": 143},
                "hotSpots": [{"ref": "app/_lib/db", "note": "widest fan-in"}],
                "fieldProvenance": {"declared_gates": "llm", "size": "heuristic"},
            }
        )
        wire = json.loads(d.model_dump_json(by_alias=True))
        self.assertEqual(wire["declaredGates"], ["npm run typecheck"])
        self.assertEqual(wire["size"]["contexts"], 143)
        self.assertEqual(RepoDossier.model_validate(wire).model_dump(), d.model_dump())

    def test_dossier_source_vocabulary_is_closed(self):
        with self.assertRaises(ValidationError):
            RepoDossier.model_validate({"source": "vibes"})


def _backbone(**overrides) -> PerformanceBackbone:
    base = {
        "windowDays": 30,
        "proposalsOpened": 10,
        "proposalsMerged": 7,
        "proposalsReverted": 1,
        "gatePassRate": 0.9,
        "forbiddenClassViolations": 0,
        "kpiDeltas": [
            {"kpiKey": "gate_green_rate", "baseline": 0.82, "current": 0.96, "target": 0.95, "measured": True},
            {"kpiKey": "p95_latency", "baseline": 400, "current": 380, "target": 300, "direction": "lte", "measured": True},
        ],
        "budgetReservedUsd": 40.0,
        "budgetSettledUsd": 31.5,
        "budgetUnmeasured": False,
        "ledgerConsistent": True,
    }
    base.update(overrides)
    return PerformanceBackbone.model_validate(base)


class BackboneScoreTest(unittest.TestCase):
    def test_deterministic(self):
        self.assertEqual(backbone_score(_backbone()), backbone_score(_backbone()))

    def test_attributable_never_a_bare_number(self):
        out = backbone_score(_backbone())
        keys = {r["rule"] for r in out["rules"]}
        self.assertEqual(keys, {"delivery", "durability", "gates", "objectives", "budget", "ledger"})
        for rule in out["rules"]:
            self.assertTrue(rule["reason"], f"{rule['rule']} must explain itself")
            self.assertIn("weight", rule)
            if rule["measured"]:
                self.assertIsNotNone(rule["contribution"])
        # The score is reconstructible from the contributions — no hidden term.
        earned = sum(r["contribution"] for r in out["rules"] if r["measured"])
        scored = sum(r["weight"] for r in out["rules"] if r["measured"])
        self.assertAlmostEqual(out["score"], round(earned / scored, 4), places=4)
        self.assertEqual(out["totalWeight"], 100)

    def test_delivery_and_objectives_are_read_from_the_record(self):
        out = backbone_score(_backbone())
        by_rule = {r["rule"]: r for r in out["rules"]}
        self.assertAlmostEqual(by_rule["delivery"]["value"], 0.7)
        # Both objectives moved toward target (one hit it, one improved).
        self.assertAlmostEqual(by_rule["objectives"]["value"], 1.0)
        self.assertEqual(out["verdict"], "pass")

    def test_forbidden_class_violation_is_a_gate_not_a_weight(self):
        out = backbone_score(_backbone(forbiddenClassViolations=2))
        gate = next(g for g in out["gates"] if g["gate"] == "forbidden_classes")
        self.assertFalse(gate["passed"])
        self.assertEqual(gate["value"], 2)
        self.assertEqual(out["verdict"], "fail")
        # The rule contributions are unchanged — the gate is legible, not a
        # silent multiplier hidden inside the average.
        self.assertEqual(
            [r["contribution"] for r in out["rules"]],
            [r["contribution"] for r in backbone_score(_backbone())["rules"]],
        )

    def test_unmeasured_budget_is_not_free(self):
        measured_zero = backbone_score(_backbone(budgetSettledUsd=0.0, budgetUnmeasured=False))
        unmeasured = backbone_score(_backbone(budgetSettledUsd=0.0, budgetUnmeasured=True))

        m_budget = next(r for r in measured_zero["rules"] if r["rule"] == "budget")
        u_budget = next(r for r in unmeasured["rules"] if r["rule"] == "budget")

        # Metered zero spend IS perfect adherence and earns the full weight…
        self.assertTrue(m_budget["measured"])
        self.assertEqual(m_budget["contribution"], float(m_budget["weight"]))
        # …an unmetered window earns nothing, is excluded from the denominator,
        # and says so. It must NOT look like the well-behaved case.
        self.assertFalse(u_budget["measured"])
        self.assertIsNone(u_budget["contribution"])
        self.assertIn("budget", unmeasured["unmeasured"])
        self.assertIn("not zero spend", u_budget["reason"])
        self.assertLess(unmeasured["scoredWeight"], measured_zero["scoredWeight"])
        self.assertLess(unmeasured["coverage"], 1.0)
        self.assertEqual(unmeasured["verdict"], "incomplete")
        self.assertNotEqual(unmeasured, measured_zero)

    def test_unmeasured_kpi_is_neither_a_hit_nor_a_miss(self):
        deltas = [
            {"kpiKey": "a", "baseline": 1, "current": 2, "target": 2, "measured": True},
            {"kpiKey": "b", "baseline": 1, "target": 5, "measured": False},
        ]
        out = backbone_score(_backbone(kpiDeltas=deltas))
        objectives = next(r for r in out["rules"] if r["rule"] == "objectives")
        # 1 of 1 READABLE objectives moved; the unread one is disclosed, not counted.
        self.assertAlmostEqual(objectives["value"], 1.0)
        self.assertIn("1 unmeasured and excluded", objectives["reason"])

    def test_unrecorded_gate_rate_is_excluded_not_scored_zero(self):
        out = backbone_score(_backbone(gatePassRate=None))
        gates_rule = next(r for r in out["rules"] if r["rule"] == "gates")
        self.assertFalse(gates_rule["measured"])
        self.assertIsNone(gates_rule["contribution"])
        self.assertIn("gates", out["unmeasured"])
        # …and a recorded 0.0 IS a score of zero, not the same state.
        zero = backbone_score(_backbone(gatePassRate=0.0))
        zero_rule = next(r for r in zero["rules"] if r["rule"] == "gates")
        self.assertTrue(zero_rule["measured"])
        self.assertEqual(zero_rule["contribution"], 0.0)

    def test_empty_window_scores_nothing_rather_than_scoring_badly(self):
        out = backbone_score(PerformanceBackbone())
        self.assertEqual(out["verdict"], "incomplete")
        # Only the ledger-consistency rule is readable on an empty window.
        self.assertEqual([r["rule"] for r in out["rules"] if r["measured"]], ["ledger"])
        self.assertEqual(out["score"], 1.0)
        self.assertLess(out["coverage"], 0.1)

    def test_reverted_proposals_cost_durability(self):
        clean = backbone_score(_backbone(proposalsReverted=0))
        churn = backbone_score(_backbone(proposalsReverted=7))
        c_rule = next(r for r in clean["rules"] if r["rule"] == "durability")
        r_rule = next(r for r in churn["rules"] if r["rule"] == "durability")
        self.assertEqual(c_rule["contribution"], float(c_rule["weight"]))
        self.assertEqual(r_rule["contribution"], 0.0)

    def test_overspend_reduces_the_budget_contribution(self):
        out = backbone_score(_backbone(budgetReservedUsd=40.0, budgetSettledUsd=60.0))
        rule = next(r for r in out["rules"] if r["rule"] == "budget")
        self.assertTrue(rule["measured"])
        self.assertLess(rule["contribution"], rule["weight"] * 0.6)


if __name__ == "__main__":
    unittest.main()
