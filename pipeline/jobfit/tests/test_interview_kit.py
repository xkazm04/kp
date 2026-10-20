"""The JOB-level interview kit generator (spark interview-kit-template, WP-A).

``automation.interview_kit`` authors the ROLE's shared kit — competencies, questions,
budgets, a role FAQ — and ``automation_cli interview-kit`` exposes it to the TS runner
(app/_lib/interview-kit-run.ts). Four properties are pinned here:

  * KEYLESS is a supported path, not a failure: with no provider the deterministic kit is
    built from the role's own stated requirements, and ``source`` says so.
  * EVERY kit this module can emit is one the TS boundary accepts
    (app/_lib/interview-kit-validate.ts refuses a weight outside 1..3, a budget that is not
    a positive whole number of minutes, and a competency with no question). The model's
    kit is coerced INTO those limits here rather than refused there, because a refusal at
    the store would throw away a paid call over one bad number.
  * The FAQ is drawn ONLY from facts the posting stated: a phantom that ``normalize_job``
    filled in (a default city, a default seniority) never becomes an answer the
    interviewer reads to a candidate.
  * No candidate is an input. The kit is stored job-keyed, where the entry-keyed GDPR
    scrub cannot reach it, so the signature itself is the guard.

The TS half of the agreement lives in app/_lib/interview-kit-run.test.ts, which feeds a
snapshot of the BACKEND fixture's keyless kit through the real normalizer.
"""

from __future__ import annotations

import inspect
import io
import json
import tempfile
import unittest
from contextlib import redirect_stdout
from pathlib import Path

from pipeline.jobfit import automation, automation_cli
from pipeline.jobfit.jobs import Job
from pipeline.jobfit.tests._helpers import mkjob

# The same role the TS snapshot was taken from: two must-haves, one nice-to-have, two
# detected skills, a stated city and work mode.
BACKEND = {
    "id": "job-kit-1",
    "title": "Backend Engineer",
    "company": "Acme",
    "location": "Brno",
    "workMode": "hybrid",
    "seniority": "senior",
    "roleFamily": "software_engineering",
    "languages": ["cs", "en"],
    "description": "Own the payments service end to end.",
    "requirements": [
        {"skill": "Go", "kind": "must_have"},
        {"skill": "PostgreSQL", "kind": "must_have"},
        {"skill": "Kafka", "kind": "nice_to_have"},
    ],
    "detectedSkills": ["Docker", "Kubernetes"],
    "defaultedFields": [],
}


def backend_job() -> Job:
    return Job.model_validate(dict(BACKEND))


class _Fake:
    """A provider double that records the prompt and returns a canned payload."""

    def __init__(self, payload):
        self.payload = payload
        self.prompt = None

    def complete_json(self, prompt, system=None, expected_keys=None):
        self.prompt = prompt
        return self.payload


def assert_ts_contract(test: unittest.TestCase, kit: dict) -> None:
    """The limits app/_lib/interview-kit-validate.ts REFUSES on. A kit that trips one of
    these would be generated, paid for, and then thrown away at the store."""
    comps = kit["competencies"]
    test.assertGreaterEqual(len(comps), 1, "a kit with no competency cannot run an interview")
    test.assertLessEqual(len(comps), automation.KIT_MAX_COMPETENCIES)
    must_asks = 0
    for c in comps:
        test.assertTrue(str(c["title"]).strip(), "every competency needs a title")
        # `bool` first: True == 1 in Python, but JSON `true` is not a number to the TS side.
        test.assertNotIsInstance(c["weight"], bool, "a boolean weight serializes as `true` and would be refused")
        test.assertIn(c["weight"], (1, 2, 3), f"weight {c['weight']!r} would be refused")
        test.assertIsInstance(c["budgetMin"], int)
        test.assertNotIsInstance(c["budgetMin"], bool)
        test.assertGreater(c["budgetMin"], 0, "a budget must be a positive number of minutes")
        test.assertGreaterEqual(len(c["questions"]), 1, "a competency with no question would be refused")
        test.assertLessEqual(len(c["questions"]), automation.KIT_MAX_QUESTIONS_PER_COMPETENCY)
        for q in c["questions"]:
            test.assertTrue(str(q["text"]).strip())
            test.assertIsInstance(q["mustAsk"], bool)
            must_asks += q["mustAsk"]
    test.assertLessEqual(must_asks, automation.KIT_MAX_MUST_ASKS)
    test.assertLessEqual(len(kit["faq"]), automation.KIT_MAX_FAQ)
    for f in kit["faq"]:
        test.assertTrue(f["question"].strip() and f["answer"].strip(), "a FAQ row needs both halves")


class KeylessKitTest(unittest.TestCase):
    def test_keyless_builds_a_kit_from_the_roles_own_requirements(self):
        kit, source = automation.interview_kit(backend_job(), None, provider=None)
        self.assertEqual(source, "deterministic", "the template must be reported as the template")
        self.assertEqual(kit["promptVersion"], automation.INTERVIEW_KIT_PROMPT_VERSION)
        assert_ts_contract(self, kit)

        titles = [c["title"] for c in kit["competencies"]]
        self.assertEqual(titles, ["Go", "PostgreSQL", "Kafka", "Docker", "Kubernetes"], "must-haves first, in order")
        weights = {c["title"]: c["weight"] for c in kit["competencies"]}
        self.assertEqual(weights["Go"], 3, "a stated must-have carries the decision")
        self.assertEqual(weights["Kafka"], 2, "a nice-to-have marks emphasis")
        self.assertEqual(weights["Docker"], 1, "a merely-detected skill is context")
        # The must-haves' opening questions are the ones the director overruns for.
        musts = [c["title"] for c in kit["competencies"] if c["questions"][0]["mustAsk"]]
        self.assertEqual(musts, ["Go", "PostgreSQL"])

    def test_keyless_kit_stops_at_the_competency_target_and_dedupes(self):
        many = dict(BACKEND)
        many["requirements"] = [{"skill": f"Skill{i}", "kind": "must_have"} for i in range(10)]
        many["detectedSkills"] = ["skill0", "SKILL1"]  # case-folded duplicates of must-haves
        kit, _ = automation.interview_kit(Job.model_validate(many), None, provider=None)
        assert_ts_contract(self, kit)
        self.assertEqual(len(kit["competencies"]), automation._KIT_TARGET_COMPETENCIES[1])
        titles = [c["title"].casefold() for c in kit["competencies"]]
        self.assertEqual(len(titles), len(set(titles)), "one competency per skill, however it was spelled")
        must_asks = sum(q["mustAsk"] for c in kit["competencies"] for q in c["questions"])
        self.assertEqual(must_asks, automation.KIT_MAX_MUST_ASKS, "must-asks stop at the kit-wide cap")

    def test_a_role_with_no_requirements_still_gets_something_to_edit(self):
        bare = dict(BACKEND, requirements=[], detectedSkills=[])
        kit, source = automation.interview_kit(Job.model_validate(bare), None, provider=None)
        self.assertEqual(source, "deterministic")
        assert_ts_contract(self, kit)
        self.assertEqual(len(kit["competencies"]), 1)

    def test_the_faq_never_answers_from_a_phantom(self):
        # normalize_job stamps a default city/work mode onto an ad that stated none, and
        # records it in defaulted_fields. The kit must not put that phantom in the
        # interviewer's mouth as a fact about the role.
        job = mkjob(title="Nurse", requirements=[{"skill": "Triage", "kind": "must_have"}])
        self.assertIn("location", job.defaulted_fields, "fixture precondition: the city is a phantom")
        kit, _ = automation.interview_kit(job, None, provider=None)
        answers = " ".join(f["answer"] for f in kit["faq"])
        self.assertNotIn(job.location, answers, "a defaulted city is not a stated fact")
        questions = [f["question"] for f in kit["faq"]]
        self.assertNotIn("Where is this role based?", questions)

    def test_stated_facts_do_reach_the_faq(self):
        kit, _ = automation.interview_kit(backend_job(), None, provider=None)
        faq = {f["question"]: f["answer"] for f in kit["faq"]}
        self.assertEqual(faq["Where is this role based?"], "Brno (hybrid)")
        self.assertIn("cs", faq["Which languages does the team work in?"])


class ModelKitTest(unittest.TestCase):
    def test_a_good_model_kit_is_kept_and_reported_as_the_models(self):
        payload = {
            "competencies": [
                {"title": "Payments reliability", "weight": 3, "budgetMin": 15, "questions": [
                    {"text": "Tell me about an outage you led the response to.", "mustAsk": True, "followUp": "What did you change after?"},
                    {"text": "Which alert did you last delete, and why?", "mustAsk": False},
                ]},
                {"title": "Data modelling", "weight": 2, "budgetMin": 10, "questions": [
                    {"text": "Walk me through a schema migration you ran on live data.", "mustAsk": False},
                ]},
            ],
            "faq": [{"question": "Is the role hybrid?", "answer": "Yes, based in Brno."}],
        }
        fake = _Fake(payload)
        kit, source = automation.interview_kit(backend_job(), None, provider=fake)
        self.assertEqual(source, "llm")
        assert_ts_contract(self, kit)
        self.assertEqual([c["title"] for c in kit["competencies"]], ["Payments reliability", "Data modelling"])
        self.assertNotIn("followUp", kit["competencies"][0]["questions"][1], "an empty follow-up is omitted, not blank")

    def test_out_of_contract_numbers_are_coerced_not_passed_through(self):
        # The TS store REFUSES these. Coercing here is what keeps one bad number from
        # throwing a whole paid kit away.
        payload = {
            "competencies": [
                {"title": "A", "weight": 7, "budgetMin": 999, "questions": [{"text": "Q1?", "mustAsk": True}]},
                {"title": "B", "weight": "3", "budgetMin": 2.5, "questions": [{"text": "Q2?"}]},
                {"title": "C", "weight": True, "budgetMin": True, "questions": [{"text": "Q3?"}]},
            ],
            "faq": [],
        }
        kit, source = automation.interview_kit(backend_job(), None, provider=_Fake(payload))
        self.assertEqual(source, "llm")
        assert_ts_contract(self, kit)

    def test_only_a_literal_true_makes_a_must_ask(self):
        # A model that answers "false" (a string) must not mint an unskippable question —
        # the TS boundary reads `=== true`, and the two sides must agree.
        payload = {
            "competencies": [
                {"title": "A", "weight": 2, "budgetMin": 10, "questions": [
                    {"text": "Q1?", "mustAsk": "false"},
                    {"text": "Q2?", "mustAsk": 1},
                    {"text": "Q3?", "mustAsk": True},
                ]},
            ],
            "faq": [],
        }
        kit, _ = automation.interview_kit(backend_job(), None, provider=_Fake(payload))
        self.assertEqual([q["mustAsk"] for q in kit["competencies"][0]["questions"]], [False, False, True])

    def test_must_ask_overflow_is_demoted_never_dropped(self):
        payload = {
            "competencies": [
                {"title": f"Area {i}", "weight": 2, "budgetMin": 10, "questions": [{"text": f"Q{i}?", "mustAsk": True}]}
                for i in range(automation.KIT_MAX_MUST_ASKS + 2)
            ],
            "faq": [],
        }
        kit, _ = automation.interview_kit(backend_job(), None, provider=_Fake(payload))
        assert_ts_contract(self, kit)
        questions = [q for c in kit["competencies"] for q in c["questions"]]
        self.assertEqual(len(questions), automation.KIT_MAX_MUST_ASKS + 2, "no question may be lost to the cap")

    def test_an_unusable_answer_degrades_to_the_template_and_says_so(self):
        template, _ = automation.interview_kit(backend_job(), None, provider=None)
        for garbage in (
            None,
            "prose",
            {"competencies": "no"},
            {"competencies": [{"title": "", "questions": []}]},
            # The hybrid case: nothing usable in the competencies, but a plausible FAQ. The
            # whole kit must fall back — the template's competencies beside the model's
            # FAQ would be reported as the model's work.
            {"competencies": [{"title": "A", "questions": []}], "faq": [{"question": "Q?", "answer": "A."}]},
        ):
            kit, source = automation.interview_kit(backend_job(), None, provider=_Fake(garbage))
            assert_ts_contract(self, kit)
            self.assertEqual(source, "deterministic", f"{garbage!r} must not be reported as the model's kit")
            self.assertEqual(kit, template, "a discarded answer serves the template, byte for byte")

    def test_a_half_faq_row_is_dropped(self):
        payload = {
            "competencies": [{"title": "A", "weight": 2, "budgetMin": 10, "questions": [{"text": "Q?"}]}],
            "faq": [{"question": "Salary?"}, {"question": "Remote?", "answer": "Hybrid."}, "junk"],
        }
        kit, _ = automation.interview_kit(backend_job(), None, provider=_Fake(payload))
        self.assertEqual([f["question"] for f in kit["faq"]], ["Remote?"])


class PromptTest(unittest.TestCase):
    def test_prompt_carries_the_brief_and_the_honesty_rules(self):
        fake = _Fake({"competencies": []})
        brief = {
            "summary": "Own payments reliability.",
            "successCriteria": ["Zero P1 incidents in 90 days"],
            "dealbreakers": ["Go"],
            "outcomes": ["On-call rotation owned"],
            "noise": "ignored",
        }
        automation.interview_kit(backend_job(), brief, lang="cs", provider=fake)
        prompt = fake.prompt
        self.assertIn("Zero P1 incidents in 90 days", prompt, "the requestor's 90-day outcome reaches the prompt")
        self.assertNotIn("noise", prompt, "only the brief's projected fields reach the prompt")
        self.assertIn("never invent a salary", prompt, "the FAQ may only answer from stated facts")
        self.assertIn(f"at most {automation.KIT_MAX_MUST_ASKS} questions", prompt)
        self.assertIn("Czech", prompt, "a Czech tenant's kit is authored in Czech")

    def test_no_candidate_is_an_input(self):
        # The row this ends up in is job-keyed; the erasure scrub is entry-keyed. The
        # signature is the guard: there is no parameter a candidate could arrive through.
        params = set(inspect.signature(automation.interview_kit).parameters)
        self.assertEqual(params, {"job", "brief", "lang", "provider"})


class CliTest(unittest.TestCase):
    def _run(self, *argv: str) -> tuple[int, dict]:
        out = io.StringIO()
        with redirect_stdout(out):
            code = automation_cli.main(list(argv))
        return code, json.loads(out.getvalue()) if out.getvalue().strip() else {}

    def test_cli_keyless_envelope(self):
        with tempfile.TemporaryDirectory() as tmp:
            job_path = Path(tmp) / "job.json"
            job_path.write_text(json.dumps(BACKEND), encoding="utf-8")
            code, envelope = self._run("interview-kit", "--job-json", str(job_path), "--no-llm")
        self.assertEqual(code, 0)
        self.assertEqual(envelope["source"], "deterministic")
        assert_ts_contract(self, envelope["result"])

    def test_cli_takes_no_candidate(self):
        # `interview-kit` returns before _load_candidate: passing no candidate is the
        # normal call, not a 400.
        with tempfile.TemporaryDirectory() as tmp:
            job_path = Path(tmp) / "job.json"
            brief_path = Path(tmp) / "brief.json"
            job_path.write_text(json.dumps(BACKEND), encoding="utf-8")
            brief_path.write_text(json.dumps({"summary": "Own payments."}), encoding="utf-8")
            code, envelope = self._run("interview-kit", "--job-json", str(job_path), "--brief-json", str(brief_path), "--no-llm")
        self.assertEqual(code, 0)
        self.assertIn("competencies", envelope["result"])

    def test_cli_without_a_job_is_an_honest_400(self):
        err = io.StringIO()
        from contextlib import redirect_stderr

        with redirect_stderr(err), redirect_stdout(io.StringIO()):
            code = automation_cli.main(["interview-kit", "--no-llm"])
        self.assertEqual(code, 2)
        self.assertEqual(json.loads(err.getvalue())["status"], 400)


if __name__ == "__main__":
    unittest.main()
