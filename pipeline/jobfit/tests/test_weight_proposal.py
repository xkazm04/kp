"""Tests for the LLM weight proposer: it refines the deterministic proposal when a
provider is available, stays within the contract, and always degrades safely.
"""
from __future__ import annotations

import unittest

from pipeline.jobfit import weight_proposal
from pipeline.jobfit.matching import MatchCandidate
from pipeline.jobfit.tests._helpers import mkjob


class _FakeProvider:
    """Returns a canned JSON payload from complete_json (no real LLM)."""

    def __init__(self, payload):
        self._payload = payload
        self.calls = 0

    def complete_json(self, prompt, system=None):  # noqa: ARG002 - mirrors ClaudeCliProvider
        self.calls += 1
        return self._payload


class _BoomProvider:
    def complete_json(self, prompt, system=None):  # noqa: ARG002
        raise RuntimeError("provider unavailable")


def _job():
    return mkjob(
        title="Backend Engineer",
        description="A backend team.",
        requirements=[{"skill": "Python", "kind": "must_have", "hardness": "prerequisite"}],
    )


def _candidates():
    ada = MatchCandidate(
        skills=["Python"], skill_provenance={"Python": "observed"}, seniority="junior",
        role_family="software_engineering", languages=["English"], archetype="student",
        potential_score=0.8, label="Ada",
    )
    bo = MatchCandidate(
        skills=["HTML"], seniority="junior", role_family="software_engineering",
        languages=["English"], archetype="student", potential_score=0.3, label="Bo",
    )
    return [("a", ada), ("b", bo)]


class WeightProposalTest(unittest.TestCase):
    def test_deterministic_without_provider(self):
        proposals, source = weight_proposal.generate(_candidates(), _job(), provider=None)
        self.assertEqual(source, "deterministic")
        self.assertEqual(set(proposals), {"a", "b"})
        # Ada's observed, role-relevant must-have leans her toward skills vs Bo (baseline).
        self.assertGreater(proposals["a"]["weights"]["skills"], proposals["b"]["weights"]["skills"])
        self.assertTrue(proposals["a"]["rationale"])
        self.assertEqual(proposals["b"]["rationale"], [])

    def test_llm_proposals_are_used(self):
        provider = _FakeProvider(
            {
                "proposals": [
                    {"candidateId": "a", "weights": {"skills": 0.5, "career": 0.3, "personal": 0.2}, "rationale": "Observed Python."},
                    {"candidateId": "b", "weights": {"skills": 0.4, "career": 0.4, "personal": 0.2}, "rationale": ""},
                ]
            }
        )
        proposals, source = weight_proposal.generate(_candidates(), _job(), provider=provider)
        self.assertEqual(source, "llm")
        self.assertEqual(provider.calls, 1)  # ONE pool-level call, not one per candidate
        self.assertEqual(proposals["a"]["weights"], {"skills": 0.5, "career": 0.3, "personal": 0.2})
        self.assertEqual(proposals["a"]["rationale"], ["Observed Python."])
        self.assertEqual(proposals["b"]["rationale"], [])  # empty rationale -> empty list

    def test_missing_candidate_is_backfilled_from_deterministic(self):
        provider = _FakeProvider(
            {"proposals": [{"candidateId": "a", "weights": {"skills": 0.5, "career": 0.3, "personal": 0.2}, "rationale": "x"}]}
        )
        proposals, source = weight_proposal.generate(_candidates(), _job(), provider=provider)
        self.assertEqual(source, "llm")
        det, _ = weight_proposal.generate(_candidates(), _job(), provider=None)
        self.assertIn("b", proposals)
        self.assertEqual(proposals["b"], det["b"])  # the missing candidate falls back

    def test_garbled_weights_fall_back_for_that_candidate(self):
        provider = _FakeProvider(
            {"proposals": [{"candidateId": "a", "weights": {"skills": "lots"}, "rationale": "bad"}]}
        )
        proposals, _ = weight_proposal.generate(_candidates(), _job(), provider=provider)
        det, _ = weight_proposal.generate(_candidates(), _job(), provider=None)
        self.assertEqual(proposals["a"], det["a"])  # invalid numbers -> deterministic

    def test_provider_error_falls_back(self):
        proposals, source = weight_proposal.generate(_candidates(), _job(), provider=_BoomProvider())
        self.assertEqual(source, "deterministic")
        self.assertEqual(set(proposals), {"a", "b"})


if __name__ == "__main__":
    unittest.main()
