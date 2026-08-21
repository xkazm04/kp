"""Agent-fit transform (agent-candidate bridge WP1): deterministic-fallback contract.

The keyless path is a product property (no provider → an honest, reproducible
spec), so these tests pin: determinism, the unassessed verdict, the budget rule
(2% of the CZK salary-band midpoint at the fixed 23 CZK/USD anchor), the
connectors-⊆-catalog invariant, and the CLI's uniform provenance envelope.
"""

from __future__ import annotations

import contextlib
import io
import json
import tempfile
import unittest
from pathlib import Path

from pipeline.jobfit import agentfit, agentfit_cli
from pipeline.jobfit.jobs import Job

CATALOG = [
    {"name": "gmail", "description": "Send and read email"},
    {"name": "postgres", "description": "Run SQL against a PostgreSQL database"},
    {"name": "sheets", "description": "Read and update spreadsheets"},
]


def _job(**overrides) -> Job:
    base = {
        "id": "job-1",
        "title": "Reporting Analyst",
        "company": "Acme",
        "location": "Praha",
        "description": "Build SQL reports and email weekly summaries to stakeholders.",
        "requirements": [
            {"skill": "SQL", "kind": "must_have", "hardness": "prerequisite"},
            {"skill": "Email communication", "kind": "must_have", "hardness": "learnable"},
            {"skill": "Public speaking", "kind": "nice_to_have", "hardness": "learnable"},
        ],
        "salary_band": [40000, 60000],
    }
    base.update(overrides)
    return Job.model_validate(base)


class AgentFitFallbackTest(unittest.TestCase):
    def test_deterministic_and_reproducible(self):
        r1, s1 = agentfit.analyze_agent_fit(_job(), CATALOG, provider=None)
        r2, s2 = agentfit.analyze_agent_fit(_job(), CATALOG, provider=None)
        self.assertEqual(s1, "deterministic")
        self.assertEqual(s2, "deterministic")
        self.assertEqual(r1, r2, "the keyless path must be byte-reproducible")

    def test_fallback_verdict_is_unassessed(self):
        result, _ = agentfit.analyze_agent_fit(_job(), CATALOG, provider=None)
        self.assertEqual(result["fit"]["verdict"], "unassessed")
        # Keyword matching may claim "assisted", never "automatable".
        for c in result["fit"]["coverage"]:
            self.assertIn(c["coverage"], ("assisted", "human_only"))
        self.assertEqual(len(result["fit"]["coverage"]), 3, "one coverage row per requirement")
        ratio = result["fit"]["coverageRatio"]
        self.assertGreaterEqual(ratio, 0.0)
        self.assertLessEqual(ratio, 1.0)

    def test_budget_rule(self):
        result, _ = agentfit.analyze_agent_fit(_job(), CATALOG, provider=None)
        budget = result["budget"]
        # midpoint 50 000 CZK * 2% = 1000 CZK/month → / 23 = 43.48 USD.
        self.assertEqual(budget["suggestedMonthlyUsd"], round(1000 / agentfit.CZK_PER_USD, 2))
        self.assertEqual(budget["rule"], agentfit.BUDGET_RULE)
        self.assertIn("40000", budget["salaryBandRef"])

    def test_budget_without_band_is_honest(self):
        result, _ = agentfit.analyze_agent_fit(_job(salary_band=[]), CATALOG, provider=None)
        self.assertIsNone(result["budget"]["suggestedMonthlyUsd"])
        self.assertEqual(result["budget"]["rule"], agentfit.BUDGET_RULE)

    def test_connectors_subset_of_catalog(self):
        result, _ = agentfit.analyze_agent_fit(_job(), CATALOG, provider=None)
        names = {c["name"] for c in CATALOG}
        self.assertTrue(set(result["spec"]["connectors"]) <= names)
        # SQL ↔ postgres and email ↔ gmail keyword-match in this fixture.
        self.assertIn("postgres", result["spec"]["connectors"])
        self.assertIn("gmail", result["spec"]["connectors"])

    def test_metrics_bounds(self):
        result, _ = agentfit.analyze_agent_fit(_job(), CATALOG, provider=None)
        metrics = result["metrics"]
        self.assertTrue(2 <= len(metrics) <= 4)
        for m in metrics:
            self.assertIn(m["direction"], ("gte", "lte"))
            self.assertTrue(m["key"] and m["label"])

    def test_coerce_intersects_connectors_and_guards_verdict(self):
        """The LLM-coerce path: hallucinated connectors are dropped, an off-taxonomy
        verdict degrades to unassessed — exercised via a fake provider."""

        class FakeProvider:
            def complete_json(self, prompt, system=None, expected_keys=None):
                return {
                    "fit": {
                        "verdict": "definitely",  # off-taxonomy → unassessed
                        "coverage": [{"item": "SQL", "coverage": "automatable", "rationale": "r"}],
                    },
                    "spec": {
                        "name": "A",
                        "mission": "m",
                        "systemPromptDraft": "s",
                        "connectors": ["postgres", "made-up-connector"],
                        "maxTurns": 50,
                    },
                    "metrics": [
                        {"key": "runs per week", "label": "Runs", "target": 5, "unit": "runs", "direction": "gte"},
                        {"key": "success_rate", "label": "Success", "target": 90, "unit": "%", "direction": "gte"},
                    ],
                }

        result, source = agentfit.analyze_agent_fit(_job(), CATALOG, provider=FakeProvider())
        self.assertEqual(source, "llm")
        self.assertEqual(result["fit"]["verdict"], "unassessed")
        self.assertEqual(result["spec"]["connectors"], ["postgres"], "hallucinated connectors never survive")
        self.assertEqual(result["spec"]["maxTurns"], 50)
        # The ratio is code-computed AND denominated in the job's responsibility
        # items (3 requirements), not in the single row the model chose to return.
        self.assertEqual(result["fit"]["coverageRatio"], 0.33)

    def test_partial_classification_does_not_read_as_full_coverage(self):
        """A model that classifies only the automatable slice — or whose remaining
        rows are dropped as off-taxonomy — must not render as 100% coverage."""

        class PartialProvider:
            def complete_json(self, prompt, system=None, expected_keys=None):
                return {
                    "fit": {
                        "verdict": "complete",
                        "coverage": [
                            {"item": "SQL", "coverage": "automatable", "rationale": "queries"},
                            # Off-taxonomy class → coerce drops the row entirely.
                            {"item": "Email communication", "coverage": "partial", "rationale": "x"},
                            {"item": "Public speaking", "coverage": "not sure", "rationale": "x"},
                        ],
                    },
                    "spec": {"name": "A", "mission": "m", "systemPromptDraft": "s", "connectors": [], "maxTurns": None},
                    "metrics": [
                        {"key": "runs_per_week", "label": "Runs", "target": 5, "unit": "runs", "direction": "gte"},
                        {"key": "success_rate", "label": "Success", "target": 90, "unit": "%", "direction": "gte"},
                    ],
                }

        result, _ = agentfit.analyze_agent_fit(_job(), CATALOG, provider=PartialProvider())
        self.assertEqual(len(result["fit"]["coverage"]), 1, "the two off-taxonomy rows are dropped")
        self.assertEqual(
            result["fit"]["coverageRatio"],
            0.33,
            "1 automatable of 3 responsibility items — the unclassified two count as NOT covered",
        )

    def test_coverage_ratio_denominator_floor(self):
        cov = [{"item": "SQL", "coverage": "automatable", "rationale": ""}]
        self.assertEqual(agentfit.coverage_ratio(cov), 1.0)  # list IS the universe
        self.assertEqual(agentfit.coverage_ratio(cov, total_items=4), 0.25)
        # A model that invents extra rows still divides by what it returned.
        self.assertEqual(agentfit.coverage_ratio(cov, total_items=0), 1.0)
        self.assertEqual(agentfit.coverage_ratio([], total_items=5), 0.0)


class AgentFitCliTest(unittest.TestCase):
    def test_envelope_contract(self):
        with tempfile.TemporaryDirectory() as td:
            job_path = Path(td) / "job.json"
            catalog_path = Path(td) / "catalog.json"
            job_path.write_text(json.dumps({
                "id": "job-1",
                "title": "Reporting Analyst",
                "requirements": [{"skill": "SQL", "kind": "must_have", "hardness": "prerequisite"}],
                "salaryBand": [40000, 60000],
            }), encoding="utf-8")
            catalog_path.write_text(json.dumps(CATALOG), encoding="utf-8")

            out = io.StringIO()
            with contextlib.redirect_stdout(out):
                code = agentfit_cli.main([
                    "--job-json", str(job_path),
                    "--catalog-json", str(catalog_path),
                    "--no-llm",
                ])
            self.assertEqual(code, 0)
            envelope = json.loads(out.getvalue().strip().splitlines()[-1])
            self.assertEqual(envelope["source"], "deterministic")
            self.assertEqual(envelope["perStepSources"], {"agentFit": "deterministic"})
            self.assertNotIn("fallbackReason", envelope, "--no-llm is a clean deterministic run, not a failure")
            result = envelope["result"]
            for key in ("fit", "spec", "budget", "metrics", "promptVersion"):
                self.assertIn(key, result)
            # camelCase salaryBand (the TS JobRecord shape) validated into the band rule.
            self.assertEqual(result["budget"]["suggestedMonthlyUsd"], round(1000 / agentfit.CZK_PER_USD, 2))

    def test_invalid_input_is_a_400(self):
        with tempfile.TemporaryDirectory() as td:
            job_path = Path(td) / "job.json"
            catalog_path = Path(td) / "catalog.json"
            job_path.write_text(json.dumps([1, 2]), encoding="utf-8")  # wrong shape
            catalog_path.write_text(json.dumps(CATALOG), encoding="utf-8")
            err = io.StringIO()
            with contextlib.redirect_stderr(err):
                code = agentfit_cli.main(["--job-json", str(job_path), "--catalog-json", str(catalog_path), "--no-llm"])
            self.assertEqual(code, 2)
            envelope = json.loads(err.getvalue().strip().splitlines()[-1])
            self.assertEqual(envelope["status"], 400)
            self.assertEqual(envelope["code"], "invalid_input")


if __name__ == "__main__":
    unittest.main()
