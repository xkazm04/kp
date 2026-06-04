"""The case-designed interview: a designed case instantiates the canonical
six-phase script's case-grounded phases, so every candidate on a role faces the
same material. The skeleton comes from interview-script.json — the SAME file the
TS brief renderer reads (pinned on the TS side by student-interview.test.ts) —
and the deterministic fallback always yields a complete, case-referencing
scenario, so the lifecycle never blocks on the LLM.
"""
from __future__ import annotations

import contextlib
import io
import json
import tempfile
import unittest
from pathlib import Path

from pipeline.jobfit.devcase import interview_scenario
from pipeline.jobfit.devcase.devcase_cli import main
from pipeline.jobfit.devcase.models import CaseScenario, CoverProbe, RoleSpec

_SCRIPT = json.loads(
    (Path(interview_scenario.__file__).resolve().parents[1] / "interview-script.json").read_text(encoding="utf-8")
)

CASE = CaseScenario(
    id="case-1",
    title="Order notifications",
    brief="Customers sometimes get the shipping email twice; the service reads events from a queue.",
    tasks=["Diagnose why duplicate emails can happen", "Propose how to make delivery reliable"],
    cover_probes=[
        CoverProbe(
            id="p1",
            kind="ambiguity",
            where="the duplicate-delivery constraint",
            reveals="Do they reason toward idempotency or assume the queue is exactly-once?",
        )
    ],
)
ROLE = RoleSpec(title="Junior Backend Developer", seniority="junior", must_haves=["Python", "SQL"])


class _FakeProvider:
    def __init__(self, payload):
        self._payload = payload

    def complete_json(self, prompt, system=None):  # noqa: ARG002 - mirrors ClaudeCliProvider
        return self._payload


class DeterministicScenarioTest(unittest.TestCase):
    def test_complete_and_case_referencing(self):
        scenario, src = interview_scenario.scenario_from_case(CASE, ROLE, provider=None)
        self.assertEqual(src, "deterministic")
        # Skeleton order + duration intact.
        self.assertEqual([p["phase"] for p in scenario["phases"]], [p["phase"] for p in _SCRIPT["phases"]])
        self.assertEqual(scenario["durationMin"], _SCRIPT["durationMin"])
        by = {p["phase"]: p for p in scenario["phases"]}
        # Case-grounded phases reference the shared case...
        self.assertIn(CASE.tasks[0], by["Mechanism probes"]["probe"])
        self.assertEqual(by["Coachability injection"]["listenFor"], CASE.cover_probes[0].reveals)
        self.assertEqual(by["Coachability injection"]["caseRef"], "coverProbes[p1]")
        # ...personal phases pass through unchanged from the skeleton.
        skeleton_anchor = next(p for p in _SCRIPT["phases"] if p["phase"] == "Anchor on their ground")
        self.assertEqual(by["Anchor on their ground"]["probe"], skeleton_anchor["probe"])
        self.assertEqual(by["Anchor on their ground"]["caseRef"], "")
        # The narrated intro names the case, and construct coverage is preserved.
        self.assertIn("Order notifications", scenario["caseIntro"])
        self.assertEqual(
            {f for p in scenario["phases"] for f in p["feeds"]},
            {f for p in _SCRIPT["phases"] for f in p["feeds"]},
        )

    def test_llm_probes_merge_and_backfill(self):
        payload = {
            "caseIntro": "A two-minute spoken intro.",
            "phases": [
                {"phase": "Mechanism probes", "probe": "Why a queue here?", "listenFor": "Causality.", "caseRef": "brief"},
                # Counterfactual missing entirely; Coachability present but garbled (empty probe).
                {"phase": "Coachability injection", "probe": ""},
            ],
        }
        scenario, src = interview_scenario.scenario_from_case(CASE, ROLE, provider=_FakeProvider(payload))
        self.assertEqual(src, "llm")
        by = {p["phase"]: p for p in scenario["phases"]}
        self.assertEqual(scenario["caseIntro"], "A two-minute spoken intro.")
        self.assertEqual(by["Mechanism probes"]["probe"], "Why a queue here?")
        # Missing / garbled phases keep their deterministic instantiation — never empty.
        self.assertIn("100×", by["Counterfactual & transfer"]["probe"])
        self.assertTrue(by["Coachability injection"]["probe"])

    def test_provider_error_falls_back(self):
        class Boom:
            def complete_json(self, *a, **k):  # noqa: ARG002
                raise RuntimeError("no")

        scenario, src = interview_scenario.scenario_from_case(CASE, ROLE, provider=Boom())
        self.assertEqual(src, "deterministic")
        self.assertEqual(len(scenario["phases"]), len(_SCRIPT["phases"]))


class ScenarioCliTest(unittest.TestCase):
    def test_cli_emits_scenario_envelope(self):
        with tempfile.TemporaryDirectory() as tmp:
            case_path = Path(tmp) / "case.json"
            case_path.write_text(json.dumps(CASE.model_dump(mode="json")), encoding="utf-8")
            role_path = Path(tmp) / "role.json"
            role_path.write_text(json.dumps(ROLE.model_dump(mode="json")), encoding="utf-8")
            out = io.StringIO()
            with contextlib.redirect_stdout(out):
                code = main(
                    ["interview-scenario", "--case-json", str(case_path), "--role-json", str(role_path), "--no-llm"]
                )
        self.assertEqual(code, 0)
        payload = json.loads(out.getvalue())
        self.assertEqual(payload["perStepSources"], {"scenario": "deterministic"})
        self.assertEqual(payload["source"], "deterministic")
        self.assertEqual(len(payload["result"]["scenario"]["phases"]), len(_SCRIPT["phases"]))


if __name__ == "__main__":
    unittest.main()
