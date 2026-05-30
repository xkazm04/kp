"""Phase D5 — reflect_commits + assess_tooling (deterministic path + fairness)."""

import unittest

from pipeline.jobfit.devcase.reflect import (
    COMMIT_REFLECTION_PROMPT_VERSION,
    TOOLING_SIGNAL_PROMPT_VERSION,
    assess_tooling,
    reflect_commits,
)


class TestReflect(unittest.TestCase):
    def test_reflect_detects_tests_and_dead_ends(self):
        commits = [
            {"message": "fix edge case in host parsing"},
            {"message": "revert experimental router change"},
            {"message": "add tests for autoescape"},
            {"message": "scaffold project + read existing ingest"},
        ]
        r, source = reflect_commits(commits, provider=None)
        self.assertEqual(source, "deterministic")
        self.assertTrue(any("test" in v.lower() for v in r["verificationHabits"]))
        self.assertTrue(any("revert" in d.lower() for d in r["deadEnds"]))
        self.assertIn(r["iterationPattern"], ("exploratory", "linear", "big-bang", "test-driven", "unclear"))
        self.assertEqual(r["promptVersion"], COMMIT_REFLECTION_PROMPT_VERSION)

    def test_assess_tooling_one_outcome_per_probe_and_fair_default(self):
        probes = [
            {"id": "p1", "kind": "verification_trap", "where": "tests", "reveals": "do they verify?"},
            {"id": "p2", "kind": "legacy_trap", "where": "legacy.py", "reveals": "read first?"},
        ]
        reflection, _ = reflect_commits([{"message": "wip"}], provider=None)
        t, _ = assess_tooling(reflection, [{"message": "wip"}], probes, provider=None)
        self.assertEqual({o["probeId"] for o in t["probeOutcomes"]}, {"p1", "p2"})
        # fairness: the deterministic fallback is NEUTRAL, never a penalty for using tools
        self.assertEqual(t["overRelianceFlags"], [])
        self.assertGreaterEqual(t["fluency"], 0.5)
        self.assertEqual(t["promptVersion"], TOOLING_SIGNAL_PROMPT_VERSION)

    def test_empty_trace_is_safe(self):
        r, _ = reflect_commits([], provider=None)
        self.assertIn(r["iterationPattern"], ("big-bang", "unclear"))
        t, _ = assess_tooling(r, [], [], provider=None)
        self.assertEqual(t["probeOutcomes"], [])


if __name__ == "__main__":
    unittest.main()
