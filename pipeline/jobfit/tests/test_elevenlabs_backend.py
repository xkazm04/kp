"""Pins for the ElevenLabs voice-eval backend — the module with no tests at all.

Its whole job is a MAPPING: our deterministic reliability invariants out to EL's
``extra_evaluation_criteria``, and EL's simulated conversation back into the turn
shape our own validators read. Both halves fail silently when they drift — a
criterion key EL never heard of is simply not graded, and a role label we do not
recognise quietly becomes a candidate turn, which flips who said what in every
invariant downstream.

The offline seal is pinned here too: api.elevenlabs.io is a cloud host with no
on-box alternative, so ``KP_OFFLINE`` must stop the call at ``available()`` AND
again at ``post_simulation`` for a caller that skipped the check.
"""

from __future__ import annotations

import os
import unittest
from types import SimpleNamespace
from unittest import mock

from pipeline.jobfit.eval import elevenlabs_backend as el
from pipeline.jobfit.eval import interview_eval as ie


def _clean_env(**overrides):
    env = {k: v for k, v in os.environ.items() if k not in ("KP_OFFLINE", "ELEVENLABS_API_KEY", "ELEVENLABS_AGENT_ID")}
    env.update(overrides)
    return mock.patch.dict(os.environ, env, clear=True)


class CriteriaMirrorTest(unittest.TestCase):
    """``CRITERIA_PROMPTS`` says its keys mirror ``interview_eval._DETECTORS``.

    A key on either side with no partner is the failure mode: EL grades a
    criterion we never check, or we check an invariant EL was never told about,
    and nothing in either report says the two runs measured different things.
    """

    # The one deliberate asymmetry. language_consistency is checked on EVERY
    # scenario (interview_eval._ALWAYS_HOLD) rather than being opted into by
    # must_hold, so it is not a per-scenario goal prompt EL is handed.
    DETECTORS_WITHOUT_A_PROMPT = {"language_consistency"}

    def test_every_criterion_prompt_names_a_real_detector(self):
        unknown = set(el.CRITERIA_PROMPTS) - set(ie._DETECTORS)
        self.assertEqual(unknown, set(), f"criteria EL would grade that we never check: {unknown}")

    def test_every_detector_has_a_prompt_or_a_stated_reason(self):
        missing = set(ie._DETECTORS) - set(el.CRITERIA_PROMPTS)
        self.assertEqual(missing, self.DETECTORS_WITHOUT_A_PROMPT)

    def test_no_prompt_is_empty(self):
        for key, prompt in el.CRITERIA_PROMPTS.items():
            with self.subTest(criterion=key):
                self.assertTrue(prompt.strip())


class ScenarioMappingTest(unittest.TestCase):
    def _scenario(self, **over):
        base = dict(
            candidate_prompt="You are a nervous junior developer.",
            first_message="Hi!",
            language="cs",
            must_hold=["no_decision", "no_leak"],
            handles="a candidate who demands a score",
        )
        base.update(over)
        return SimpleNamespace(**base)

    def test_must_hold_invariants_become_evaluation_criteria(self):
        req = el.scenario_to_request(self._scenario())
        ids = [c["id"] for c in req["extra_evaluation_criteria"]]
        self.assertEqual(ids, ["no_decision", "no_leak", "handling"])

    def test_an_invariant_with_no_prompt_is_dropped_not_sent_blank(self):
        req = el.scenario_to_request(self._scenario(must_hold=["language_consistency", "no_leak"]))
        self.assertEqual([c["id"] for c in req["extra_evaluation_criteria"]], ["no_leak", "handling"])

    def test_the_persona_and_language_ride_the_simulated_user_config(self):
        req = el.scenario_to_request(self._scenario(), new_turns_limit=12)
        cfg = req["simulation_specification"]["simulated_user_config"]
        self.assertEqual(cfg["language"], "cs")
        self.assertEqual(cfg["first_message"], "Hi!")
        self.assertIn("nervous junior", cfg["prompt"])
        self.assertEqual(req["new_turns_limit"], 12)

    def test_a_scenario_missing_optional_fields_still_maps(self):
        req = el.scenario_to_request(SimpleNamespace())
        cfg = req["simulation_specification"]["simulated_user_config"]
        self.assertEqual(cfg["language"], "en")
        self.assertEqual(req["extra_evaluation_criteria"], [])


class NormalizeTranscriptTest(unittest.TestCase):
    def test_el_roles_map_onto_our_two(self):
        turns, _, _ = el.normalize_transcript(
            {"simulated_conversation": [
                {"role": "agent", "message": "Hello"},
                {"role": "user", "message": "Hi"},
                {"source": "assistant", "text": "Next question"},
            ]}
        )
        self.assertEqual([t["role"] for t in turns], ["interviewer", "candidate", "interviewer"])

    def test_an_unknown_role_reads_as_the_candidate_not_the_interviewer(self):
        # Fail-safe direction: mislabelling a candidate line as the interviewer's
        # would hand our invariants words the interviewer never said.
        turns, _, _ = el.normalize_transcript({"transcript": [{"role": "caller", "message": "hey"}]})
        self.assertEqual(turns[0]["role"], "candidate")

    def test_blank_and_malformed_turns_are_skipped(self):
        turns, _, _ = el.normalize_transcript(
            {"simulated_conversation": ["nope", {"role": "agent", "message": "   "}, {"role": "agent"}]}
        )
        self.assertEqual(turns, [])

    def test_ended_reads_els_call_successful_in_every_spelling(self):
        for value, expected in (("success", True), ("true", True), (True, True), ("failure", False), (None, False)):
            with self.subTest(value=value):
                _, ended, _ = el.normalize_transcript({"analysis": {"call_successful": value}})
                self.assertIs(ended, expected)

    def test_a_response_with_no_analysis_yields_an_empty_dict(self):
        _, ended, analysis = el.normalize_transcript({"analysis": "not-a-dict"})
        self.assertEqual(analysis, {})
        self.assertFalse(ended)


class FailedCriteriaTest(unittest.TestCase):
    def test_both_shapes_el_returns_are_read(self):
        as_dict = {"evaluation_criteria_results": {"no_leak": {"criteria_id": "no_leak", "result": "failure"}}}
        as_list = {"evaluation_criteria_results": [{"name": "no_leak", "status": "failed"}]}
        self.assertEqual(el.failed_criteria(as_dict), ["no_leak"])
        self.assertEqual(el.failed_criteria(as_list), ["no_leak"])

    def test_a_passing_run_names_nothing(self):
        self.assertEqual(el.failed_criteria({"evaluation_criteria_results": [{"id": "x", "result": "success"}]}), [])
        self.assertEqual(el.failed_criteria({}), [])


class OfflineSealTest(unittest.TestCase):
    def test_offline_refuses_the_backend_before_the_keys_are_even_read(self):
        with _clean_env(KP_OFFLINE="1", ELEVENLABS_API_KEY="k", ELEVENLABS_AGENT_ID="a"):
            ok, reason = el.available()
        self.assertFalse(ok)
        self.assertIn("KP_OFFLINE", reason)

    def test_each_missing_credential_names_itself(self):
        with _clean_env():
            self.assertEqual(el.available()[1], "ELEVENLABS_API_KEY not set")
        with _clean_env(ELEVENLABS_API_KEY="k"):
            self.assertEqual(el.available()[1], "ELEVENLABS_AGENT_ID not set")
        with _clean_env(ELEVENLABS_API_KEY="k", ELEVENLABS_AGENT_ID="a"):
            self.assertEqual(el.available(), (True, ""))

    def test_post_simulation_refuses_to_egress_even_when_called_directly(self):
        # Belt-and-suspenders behind available(): the seal is on the call, not only
        # on the precondition a caller might skip.
        with _clean_env(KP_OFFLINE="1"):
            with self.assertRaises(RuntimeError) as ctx:
                el.post_simulation("agent", "key", {})
        self.assertIn("api.elevenlabs.io", str(ctx.exception))


if __name__ == "__main__":
    unittest.main()
