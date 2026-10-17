"""tiger C1 — channel-neutral verification in the keyless evaluator.

Two candidates who verify equally get equal judgment whether they asked the assistant,
wrote a test, flagged a defect in the decision log or raised it with the stakeholder.
Until 2026-10-17 the observed term was 0.5 editedTest + 0.3 log warm + 0.2 assistant
verify ask, so only the assistant channel paid for a check beyond the test, and the
observed fairness landscape read AI verifiers +20 judgment over their non-AI peers.
"""

import unittest

from pipeline.jobfit.devcase.evaluate import (
    OBSERVED_VERIFY_ACTS_FOR_FULL,
    evaluate_submission,
    verification_acts,
)
from pipeline.jobfit.devcase.prompt_signals import derive_prompt_signals, prompt_evidence

_DIMS = ("framing", "tooling", "judgment", "architecture", "transfer")
CASE = {"rubricDimensions": [{"name": d, "weight": 0.2} for d in _DIMS], "coverProbes": []}
ROLE = {"title": "Backend", "seniority": "mid", "mustHaves": [], "responsibilities": []}


def _tooling(*, edited_test=False, log_entries=2):
    # The observed shape process_events.tooling_from_events emits (signals block present,
    # no graded probes), so judgment rests on verification alone.
    return {
        "fluency": 0.6,
        "probeOutcomes": [],
        "signals": {"editedTest": edited_test, "decisionLogEntries": log_entries, "readBeforeWrite": 1.0},
    }


def _judgment(tooling, chat=(), canaries=()):
    extras = {"promptSignals": derive_prompt_signals(list(chat), {}), "canaryOutcomes": list(canaries)}
    ev, _ = evaluate_submission({}, tooling, CASE, ROLE, extras=extras, provider=None)
    return ev["dimensionScores"]["judgment"]


_ASSISTANT_CHECK = {"channel": "assistant", "role": "user", "text": "Verify the rounding against the existing test"}
_STAKEHOLDER_CHECK = {"channel": "stakeholder", "role": "user", "text": "retries = 0 in the config looks wrong, can you confirm?"}
_FLAGGED = {"id": "c2", "status": "flagged"}
_ADDRESSED = {"id": "c1", "status": "addressed"}
_PROPAGATED = {"id": "c1", "status": "propagated"}


class TestOneActEarnsTheSameWhateverTheChannel(unittest.TestCase):
    def test_each_single_channel_scores_identically(self):
        scores = {
            "test": _judgment(_tooling(edited_test=True)),
            "assistant": _judgment(_tooling(), chat=[_ASSISTANT_CHECK]),
            "stakeholder": _judgment(_tooling(), chat=[_STAKEHOLDER_CHECK]),
            "decision_log_flag": _judgment(_tooling(), canaries=[_FLAGGED]),
        }
        self.assertEqual(len(set(scores.values())), 1, scores)
        # ...and one act is worth something, but not the whole term.
        self.assertGreater(scores["test"], _judgment(_tooling()))
        self.assertLess(scores["test"], 100)

    def test_two_acts_score_the_same_whichever_two(self):
        pairs = {
            "test+assistant": _judgment(_tooling(edited_test=True), chat=[_ASSISTANT_CHECK]),
            "test+log_flag": _judgment(_tooling(edited_test=True), canaries=[_FLAGGED]),
            "test+stakeholder": _judgment(_tooling(edited_test=True), chat=[_STAKEHOLDER_CHECK]),
            "assistant+log_flag": _judgment(_tooling(), chat=[_ASSISTANT_CHECK], canaries=[_FLAGGED]),
        }
        self.assertEqual(set(pairs.values()), {100}, pairs)

    def test_extra_assistant_asks_buy_nothing_past_the_full_term(self):
        many = [_ASSISTANT_CHECK] * 5
        self.assertEqual(
            _judgment(_tooling(edited_test=True), chat=many),
            _judgment(_tooling(edited_test=True), canaries=[_FLAGGED]),
        )


class TestVerificationActs(unittest.TestCase):
    def test_counts_every_channel(self):
        psig = {"verificationAsks": 1, "stakeholderVerificationAsks": 1}
        self.assertEqual(verification_acts({"editedTest": True}, psig, [_FLAGGED]), 4)

    def test_caught_canaries_count_as_one_act(self):
        # Canaries are not durable against a model swept for traps (case-sim round 3):
        # catching every one lifts like a single habit and never fills the term alone.
        self.assertEqual(verification_acts({}, {}, [_ADDRESSED, _FLAGGED]), 1)
        self.assertLess(1, OBSERVED_VERIFY_ACTS_FOR_FULL)

    def test_a_missed_canary_is_not_an_act(self):
        self.assertEqual(verification_acts({}, {}, [_PROPAGATED, {"status": "unverifiable"}]), 0)

    def test_missing_inputs_are_zero_not_a_crash(self):
        self.assertEqual(verification_acts(None, None, None), 0)
        self.assertEqual(verification_acts({}, {"verificationAsks": "x"}, ["junk"]), 0)


class TestStakeholderVerificationAsks(unittest.TestCase):
    def test_a_check_raised_with_the_stakeholder_is_counted(self):
        sig = derive_prompt_signals([_STAKEHOLDER_CHECK], {})
        self.assertEqual(sig["stakeholderVerificationAsks"], 1)
        self.assertEqual(sig["verificationAsks"], 0)  # the "asked the model" line stays true
        self.assertTrue(any("stakeholder" in line for line in prompt_evidence(sig)))

    def test_a_scoping_question_is_not_a_verification_act(self):
        sig = derive_prompt_signals([{"channel": "stakeholder", "role": "user", "text": "Which markets need their own rate first?"}], {})
        self.assertEqual(sig["stakeholderVerificationAsks"], 0)


if __name__ == "__main__":
    unittest.main()
