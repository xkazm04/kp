"""Phase D3 — design_role + design_case (deterministic path)."""

import unittest

from pipeline.jobfit.devcase.design import (
    CASE_DESIGN_PROMPT_VERSION,
    ROLE_DESIGN_PROMPT_VERSION,
    _PROBE_REVEALS_DEFAULT,
    design_case,
    design_role,
)
from pipeline.jobfit.devcase.lifecycle_eval import _check_case
from pipeline.jobfit.devcase.models import DevNeed, NeedAnalysis


class _StubProvider:
    """Minimal provider stub: returns a fixed JSON payload for the design prompt."""

    def __init__(self, payload):
        self._payload = payload

    def complete_json(self, prompt, system=None):
        return self._payload


class TestDesign(unittest.TestCase):
    def setUp(self):
        self.need = DevNeed(title="Backend Engineer", stack=["Python"], seniority_target="senior", responsibilities=["APIs"])
        self.analysis = NeedAnalysis(
            real_stack=["Go", "PostgreSQL"], core_responsibilities=["Own ingest"], true_complexity="high", risk_areas=["scaling"]
        )

    def test_role_prefers_real_stack(self):
        role, source = design_role(self.need, self.analysis, provider=None)
        self.assertEqual(source, "deterministic")
        self.assertEqual(role["seniority"], "senior")
        self.assertEqual(role["mustHaves"], ["Go", "PostgreSQL"])  # grounded in the code, not the claim
        self.assertEqual(role["promptVersion"], ROLE_DESIGN_PROMPT_VERSION)

    def test_case_has_covert_probes_and_full_rubric(self):
        role, _ = design_role(self.need, self.analysis, provider=None)
        case, _ = design_case(self.need, self.analysis, role, provider=None)
        self.assertGreaterEqual(len(case["coverProbes"]), 2)
        for p in case["coverProbes"]:
            self.assertIn(p["kind"], ("ambiguity", "legacy_trap", "verification_trap", "underspecified"))
            self.assertTrue(p["reveals"])  # internal note on what it reveals
        names = {d["name"] for d in case["rubricDimensions"]}
        self.assertEqual(names, {"framing", "tooling", "judgment", "architecture", "transfer"})
        self.assertAlmostEqual(sum(d["weight"] for d in case["rubricDimensions"]), 1.0, places=2)
        self.assertTrue(all(d.get("label") for d in case["rubricDimensions"]))  # self-describing labels
        self.assertEqual(case["promptVersion"], CASE_DESIGN_PROMPT_VERSION)
        self.assertGreater(case["timeboxHours"], 0)


class TestProbeRevealsEnforced(unittest.TestCase):
    """idea-0b8fdd90: `reveals` is mandatory. coerce() must backfill any LLM probe that
    leaves it empty/missing so a valid design never fails lifecycle_eval._check_case — the
    very validator it is meant to satisfy."""

    def setUp(self):
        self.need = DevNeed(title="Backend Engineer", stack=["Python"], seniority_target="medior")
        self.analysis = NeedAnalysis(real_stack=["Python"], true_complexity="medium")
        self.role = {"title": "Backend Engineer", "seniority": "medior", "roleFamily": "software_engineering", "responsibilities": []}

    def _payload_with_probes(self, probes):
        return {"title": "Case", "brief": "b", "repoSeed": "r", "tasks": ["t"], "coverProbes": probes, "timeboxHours": 4}

    def test_empty_or_missing_reveals_is_backfilled_per_kind(self):
        payload = self._payload_with_probes(
            [
                {"id": "x1", "kind": "legacy_trap", "where": "old.py", "reveals": ""},          # empty string
                {"id": "x2", "kind": "verification_trap", "where": "tests"},                     # key absent
                {"id": "x3", "kind": "ambiguity", "where": "brief", "reveals": "   "},            # whitespace-only
            ]
        )
        case, source = design_case(self.need, self.analysis, self.role, provider=_StubProvider(payload))
        self.assertEqual(source, "llm")
        by_id = {p["id"]: p for p in case["coverProbes"]}
        self.assertEqual(len(by_id), 3)  # nothing dropped — every probe survives with a note
        self.assertEqual(by_id["x1"]["reveals"], _PROBE_REVEALS_DEFAULT["legacy_trap"])
        self.assertEqual(by_id["x2"]["reveals"], _PROBE_REVEALS_DEFAULT["verification_trap"])
        self.assertEqual(by_id["x3"]["reveals"], _PROBE_REVEALS_DEFAULT["ambiguity"])
        # The producer/validator gap is closed: the case the LLM path emits is now reliable.
        self.assertEqual(_check_case(case, None), [])

    def test_nonempty_reveals_is_preserved(self):
        payload = self._payload_with_probes(
            [
                {"id": "x1", "kind": "legacy_trap", "where": "old.py", "reveals": "Do they grok the migration?"},
                {"id": "x2", "kind": "ambiguity", "where": "brief", "reveals": "Do they ask?"},
            ]
        )
        case, _ = design_case(self.need, self.analysis, self.role, provider=_StubProvider(payload))
        by_id = {p["id"]: p for p in case["coverProbes"]}
        self.assertEqual(by_id["x1"]["reveals"], "Do they grok the migration?")
        self.assertEqual(by_id["x2"]["reveals"], "Do they ask?")
        self.assertNotIn("case: probe missing 'reveals'", _check_case(case, None))


class TestAmbiguityAsInstrument(unittest.TestCase):
    """case-design v4: probes carry a decisionSpace of defensible options and the case
    forces a visible decision trail, so the submission must encode the candidate's path
    through the ambiguities (what mint_followups later verifies they own)."""

    def setUp(self):
        self.need = DevNeed(title="Backend Engineer", stack=["Python"], seniority_target="medior")
        self.analysis = NeedAnalysis(real_stack=["Python"], true_complexity="medium")
        self.role = {"title": "Backend Engineer", "seniority": "medior", "roleFamily": "software_engineering", "responsibilities": []}

    def test_deterministic_case_forces_decision_log_and_decision_spaces(self):
        case, source = design_case(self.need, self.analysis, self.role, provider=None)
        self.assertEqual(source, "deterministic")
        self.assertTrue(any("DECISIONS log" in t for t in case["tasks"]))
        core = [p for p in case["coverProbes"] if p["id"] in ("p1", "p2", "p3")]
        for p in core:
            self.assertGreaterEqual(len(p["decisionSpace"]), 2, p["id"])

    def test_llm_decision_space_is_coerced_and_optional(self):
        payload = {
            "title": "Case",
            "brief": "b",
            "repoSeed": "r",
            "tasks": ["t"],
            "coverProbes": [
                {"id": "x1", "kind": "ambiguity", "where": "brief", "reveals": "r", "decisionSpace": ["Option A", "  ", "Option B"]},
                {"id": "x2", "kind": "legacy_trap", "where": "old.py", "reveals": "r"},  # decisionSpace absent — legal
            ],
            "timeboxHours": 4,
        }
        case, _ = design_case(self.need, self.analysis, self.role, provider=_StubProvider(payload))
        by_id = {p["id"]: p for p in case["coverProbes"]}
        self.assertEqual(by_id["x1"]["decisionSpace"], ["Option A", "Option B"])  # cleaned
        self.assertEqual(by_id["x2"]["decisionSpace"], [])  # pre-v4 probes degrade gracefully


if __name__ == "__main__":
    unittest.main()
