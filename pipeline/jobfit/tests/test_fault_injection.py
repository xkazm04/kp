"""Unit-level pins for the fault-injection seam.

The full drill lives in ``pipeline/jobfit/eval/fault_eval.py`` and runs every
fault against every automation task; these are the fast checks that keep the two
halves of that seam honest on their own:

  - ``FaultProvider`` really fails the way its mode says it does, through the
    REAL shared layer (retry bound, the single corrective re-prompt), so the
    drill's ceilings are measuring the shipped policy and not the fake.
  - the protected-characteristic letter guard discards a hostile draft — and,
    just as importantly, does NOT fire on an ordinary one. A guard with a false
    positive silently replaces good model output with a template, which is the
    failure nobody would notice.
"""

from __future__ import annotations

import unittest

from pipeline.jobfit import automation
from pipeline.jobfit.llm.base import LLMError
from pipeline.jobfit.llm.fault import MODES, NO_PAYLOAD_MODES, FaultProvider
from pipeline.jobfit.matching import MatchCandidate, score_job

from pipeline.jobfit.tests._helpers import mkjob

BAU = MatchCandidate(
    skills=["Python", "Django"], seniority="senior", role_family="software_engineering",
    languages=["English"], archetype="bau", provenance_default="professional",
)
STUDENT = MatchCandidate(
    skills=["HTML"], seniority="junior", role_family="software_engineering", languages=["English"],
    archetype="student", potential_score=0.6,
)


class FaultProviderTest(unittest.TestCase):
    def test_unknown_mode_is_refused(self):
        with self.assertRaises(ValueError):
            FaultProvider("mostly_fine")

    def test_every_no_payload_mode_is_declared(self):
        for mode in NO_PAYLOAD_MODES:
            self.assertIn(mode, MODES)

    def test_unavailable_reports_a_reason(self):
        p = FaultProvider("unavailable")
        self.assertFalse(p.available())
        self.assertEqual(p.availability(), (False, "unavailable"))

    def test_transient_is_retried_but_bounded(self):
        # timeout is the TOTAL wall-clock deadline, so the attempt count is
        # capped by base._MAX_ATTEMPTS and by the deadline, whichever bites first.
        p = FaultProvider("transient", timeout=2)
        with self.assertRaises(LLMError):
            p.complete("screen this candidate")
        self.assertGreaterEqual(p.calls, 1)
        self.assertLessEqual(p.calls, 3)

    def test_malformed_costs_exactly_one_repair_reprompt(self):
        p = FaultProvider("malformed")
        with self.assertRaises(LLMError) as ctx:
            p.complete_json("screen this candidate")
        self.assertEqual(ctx.exception.subtype, "unparseable_json")
        self.assertEqual(p.calls, 2)  # the call, plus complete_json's one repair

    def test_truncated_and_empty_are_unparseable_too(self):
        for mode in ("truncated", "empty"):
            p = FaultProvider(mode)
            with self.assertRaises(LLMError):
                p.complete_json("screen this candidate")
            self.assertEqual(p.calls, 2, mode)

    def test_wrong_shape_parses_and_is_not_an_object(self):
        p = FaultProvider("wrong_shape")
        payload = p.complete_json("screen this candidate")
        self.assertNotIsInstance(payload, dict)
        self.assertEqual(p.calls, 1)

    def test_answering_modes_cost_one_call(self):
        for mode in ("nonsense", "fairness_attack", "protected_language"):
            p = FaultProvider(mode)
            payload = p.complete_json("draft this letter")
            self.assertIsInstance(payload, dict, mode)
            self.assertEqual(p.calls, 1, mode)


class ProtectedLanguageGuardTest(unittest.TestCase):
    def setUp(self):
        self.job = mkjob(title="Backend Engineer", description="A backend team.")
        self.m = score_job(BAU, self.job)

    def test_helper_matches_a_term_and_not_a_lookalike(self):
        self.assertEqual(automation.protected_language("Your age was a factor"), "age")
        # The two words that made a naive substring check unusable.
        self.assertIsNone(automation.protected_language("We manage a multi-language team"))
        self.assertIsNone(automation.protected_language(None, "", 0))

    def test_hostile_rejection_draft_is_discarded_whole(self):
        p = FaultProvider("protected_language")
        out, source = automation.draft_rejection(BAU, self.job, self.m, "Screened", provider=p)
        self.assertIsNone(automation.protected_language(out["subject"], out["body"], out["feedback"]))
        # Byte-identical to the template, and labelled as such: a discarded draft
        # must never be billed to the model.
        self.assertEqual(source, "deterministic")

    def test_hostile_outreach_and_offer_drafts_are_discarded_too(self):
        for draft in (
            lambda p: automation.draft_outreach(BAU, self.job, ["Python"], provider=p),
            lambda p: automation.draft_offer(BAU, self.job, self.m, provider=p),
        ):
            out, source = draft(FaultProvider("protected_language"))
            self.assertIsNone(automation.protected_language(out["subject"], out["body"]))
            self.assertEqual(source, "deterministic")

    def test_an_ordinary_draft_still_passes_through(self):
        # The false-positive guard: an unremarkable letter must survive coercion.
        class _Ok:
            def complete_json(self, prompt, system=None):
                return {
                    "subject": "Your application — Backend Engineer",
                    "body": "Hi, thank you for your interest. We are moving forward with other candidates.",
                    "feedback": "Strengthening Kubernetes",
                    "language": "English",
                }

        out, source = automation.draft_rejection(BAU, self.job, self.m, "Screened", provider=_Ok())
        self.assertEqual(source, "llm")
        self.assertIn("thank you for your interest", out["body"])

    def test_a_hostile_verdict_cannot_auto_reject_an_early_career_candidate(self):
        p = FaultProvider("fairness_attack")
        out, _source = automation.screen_candidate(STUDENT, self.job, score_job(STUDENT, self.job), provider=p)
        self.assertNotEqual(out["recommendation"], "reject")
        # The model put "route": "advance" in its payload; routing is decided
        # after coercion and cannot be set from the wire.
        self.assertEqual(out["route"], "hold")


if __name__ == "__main__":
    unittest.main()
