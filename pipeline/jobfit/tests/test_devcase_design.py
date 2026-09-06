"""Phase D3 — design_role + design_case (deterministic path)."""

import unittest

from pipeline.jobfit.devcase.design import (
    CASE_DESIGN_PROMPT_VERSION,
    MIN_PROBE_DECISION_OPTIONS,
    ROLE_DESIGN_PROMPT_VERSION,
    _PROBE_REVEALS_DEFAULT,
    design_case,
    design_role,
)
from pipeline.jobfit.devcase.lifecycle_eval import _check_case
from pipeline.jobfit.devcase.models import (
    DEFAULT_TIMEBOX_HOURS,
    MAX_TIMEBOX_HOURS,
    MIN_TIMEBOX_HOURS,
    CaseScenario,
    DevNeed,
    NeedAnalysis,
)


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
                # decisionSpace is filled so the ONLY thing under test here is the `reveals`
                # backfill: _check_case also enforces probe STRENGTH now (a case with no
                # load-bearing probe is one the TS approve gate blocks), and a fixture with
                # no decision spaces would fail on that instead of on what this asserts.
                {"id": "x1", "kind": "legacy_trap", "where": "old.py", "reveals": "", "decisionSpace": ["Work around it", "Fix it first"]},          # empty string
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


class TestMustHavesReachTheDesigner(unittest.TestCase):
    """D4: score_transfer grades the submission against role.mustHaves (evaluate.py), so the
    designer has to know them — otherwise a candidate does exactly what the case asked and
    still loses transfer points. They reach the DESIGNER as terrain, never the candidate as
    a checklist: naming the requirements would collapse the probes' decisionSpace into a
    compliance exercise, which is the discrimination this module exists to protect."""

    def setUp(self):
        self.need = DevNeed(title="Backend Engineer", stack=["Python"], seniority_target="medior")
        self.analysis = NeedAnalysis(real_stack=["Python"], true_complexity="medium")
        self.role = {
            "title": "Backend Engineer",
            "seniority": "medior",
            "roleFamily": "software_engineering",
            "responsibilities": ["Own ingest"],
            "mustHaves": ["idempotent ingest", "PostgreSQL"],
        }

    def _capture(self, role):
        captured = {}

        class Capture:
            def complete_json(self, prompt, system=None):
                captured["prompt"] = prompt
                return {}

        design_case(self.need, self.analysis, role, provider=Capture())
        return captured["prompt"]

    def test_must_haves_reach_the_design_prompt(self):
        prompt = self._capture(self.role)
        self.assertIn("mustHaves", prompt)
        self.assertIn("idempotent ingest", prompt)
        self.assertIn("PostgreSQL", prompt)
        # …as terrain: the prompt must forbid the checklist shape, not just carry the list.
        self.assertIn("UNAVOIDABLY EXERCISED", prompt)
        self.assertIn("checklist", prompt)

    def test_decision_space_survives_the_must_haves(self):
        # The probe contract the rest of this module uses to express "the candidate still
        # has real choices" — same assertion as TestAmbiguityAsInstrument, now with a role
        # whose must-haves are in play.
        case, _ = design_case(self.need, self.analysis, self.role, provider=None)
        core = [p for p in case["coverProbes"] if p["id"] in ("p1", "p2", "p3")]
        self.assertTrue(core)
        for p in core:
            self.assertGreaterEqual(len(p["decisionSpace"]), MIN_PROBE_DECISION_OPTIONS, p["id"])
        # Nothing the candidate reads may name a must-have back at them.
        facing = " ".join([case["title"], case["brief"], case["repoSeed"], *case["tasks"], case["midFlightUpdate"]["update"]]).lower()
        for must in self.role["mustHaves"]:
            self.assertNotIn(must.lower(), facing)

    def test_role_without_must_haves_is_unchanged(self):
        bare = {k: v for k, v in self.role.items() if k != "mustHaves"}
        self.assertNotIn("mustHaves", self._capture(bare))
        self.assertEqual(design_case(self.need, self.analysis, bare, provider=None)[0], design_case(self.need, self.analysis, self.role, provider=None)[0])


class TestTimeboxCapAtEveryWriter(unittest.TestCase):
    """The cap on a candidate's unpaid work (2h, UAT M8) was enforced ONLY in the
    designer's clamp of the LLM estimate; the model default was 4.0 (double the cap) and
    the TS approve route accepted 80. Whatever survives renders verbatim to the candidate
    (seed_materializer), so the bound has to hold at every writer, not one."""

    def setUp(self):
        self.need = DevNeed(title="Backend Engineer", stack=["Python"], seniority_target="medior")
        self.analysis = NeedAnalysis(real_stack=["Python"], true_complexity="medium")
        self.role = {"title": "Backend Engineer", "seniority": "medior", "roleFamily": "software_engineering", "responsibilities": []}

    def test_model_default_is_mid_band_not_double_the_cap(self):
        self.assertEqual(CaseScenario().timebox_hours, DEFAULT_TIMEBOX_HOURS)
        self.assertLessEqual(CaseScenario().timebox_hours, MAX_TIMEBOX_HOURS)

    def test_model_clamps_every_construction_path(self):
        # A stored case, a fixture, or a future intake path can carry any number; the
        # field validator is the writer-agnostic enforcement point.
        self.assertEqual(CaseScenario(timebox_hours=40).timebox_hours, MAX_TIMEBOX_HOURS)
        self.assertEqual(CaseScenario(timeboxHours=80).timebox_hours, MAX_TIMEBOX_HOURS)
        self.assertEqual(CaseScenario(timebox_hours=0).timebox_hours, MIN_TIMEBOX_HOURS)
        self.assertEqual(CaseScenario(timebox_hours=float("nan")).timebox_hours, DEFAULT_TIMEBOX_HOURS)
        self.assertEqual(CaseScenario(timebox_hours=1.5).timebox_hours, 1.5)  # in-band is untouched

    def test_designer_clamps_the_llm_estimate_to_the_shared_cap(self):
        payload = {
            "title": "Case",
            "brief": "b",
            "repoSeed": "r",
            "tasks": ["t"],
            "coverProbes": [{"id": "x1", "kind": "ambiguity", "where": "brief", "reveals": "r"}],
            "timeboxHours": 16,  # the LLM routinely echoes a longer take-home back
        }
        case, _ = design_case(self.need, self.analysis, self.role, provider=_StubProvider(payload))
        self.assertEqual(case["timeboxHours"], MAX_TIMEBOX_HOURS)

    def test_every_seniority_band_is_within_the_cap(self):
        for seniority in ("junior", "medior", "senior", "lead", "unknown"):
            need = DevNeed(title="Engineer", stack=["Python"], seniority_target=seniority)
            role = {**self.role, "seniority": seniority}
            case, _ = design_case(need, self.analysis, role, provider=None)
            self.assertGreaterEqual(case["timeboxHours"], MIN_TIMEBOX_HOURS, seniority)
            self.assertLessEqual(case["timeboxHours"], MAX_TIMEBOX_HOURS, seniority)


if __name__ == "__main__":
    unittest.main()
