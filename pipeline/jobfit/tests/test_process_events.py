import unittest

from pipeline.jobfit.devcase.process_events import derive_signals, tooling_from_events
from pipeline.jobfit.devcase.reflect import assess_tooling


class TestProcessEvents(unittest.TestCase):
    def test_iteration_pattern_follows_edits_per_distinct_file(self):
        one_pass = [
            {"t": 1, "kind": "edit", "path": "a.ts"},
            {"t": 2, "kind": "edit", "path": "b.ts"},
        ]
        iterative = one_pass + [
            {"t": 3, "kind": "edit", "path": "a.ts"},
            {"t": 4, "kind": "edit", "path": "b.ts"},
        ]
        self.assertEqual(derive_signals(one_pass)["iterationPattern"], "single-pass")
        self.assertEqual(derive_signals(iterative)["iterationPattern"], "iterative")

    def test_empty_events_are_safe_and_high_confidence(self):
        t = tooling_from_events([])
        self.assertEqual(t["confidence"], 0.8)
        self.assertEqual(t["overRelianceFlags"], [])
        self.assertEqual(t["probeOutcomes"], [])
        self.assertEqual(t["fluency"], 0.0)

    def test_read_before_write_from_event_order(self):
        # opened A (t=1) then edited A (t=2) -> read-before-write = 1.0
        good = [{"t": 1, "kind": "open", "path": "a.ts"}, {"t": 2, "kind": "edit", "path": "a.ts"}]
        self.assertEqual(derive_signals(good)["readBeforeWrite"], 1.0)
        # edited B with no prior open -> 0.0
        bad = [{"t": 1, "kind": "edit", "path": "b.ts"}]
        self.assertEqual(derive_signals(bad)["readBeforeWrite"], 0.0)

    def test_seed_paths_excludes_created_files_from_read_before_write(self):
        # A created helper (b.ts) must not drag rbw to 0 when the seed only had a.ts.
        evs = [
            {"t": 1, "kind": "edit", "path": "b.ts"},
            {"t": 2, "kind": "open", "path": "a.ts"},
            {"t": 3, "kind": "edit", "path": "a.ts"},
        ]
        sig = derive_signals(evs, seed_paths=["a.ts"])
        self.assertEqual(sig["readBeforeWrite"], 1.0)
        self.assertEqual(sig["filesEdited"], 2)

    def test_seed_paths_none_keeps_created_files_in_the_rbw_pool(self):
        # Legacy: without seed_paths every edited path stays in the pool, so the
        # unread created file halves the ratio.
        evs = [
            {"t": 1, "kind": "edit", "path": "b.ts"},
            {"t": 2, "kind": "open", "path": "a.ts"},
            {"t": 3, "kind": "edit", "path": "a.ts"},
        ]
        self.assertEqual(derive_signals(evs)["readBeforeWrite"], 0.5)
        self.assertEqual(derive_signals(evs, seed_paths=None)["readBeforeWrite"], 0.5)

    def test_editing_a_test_file_counts_as_verification(self):
        sig = derive_signals([{"t": 1, "kind": "edit", "path": "src/foo.test.ts"}])
        self.assertTrue(sig["editedTest"])
        t = tooling_from_events([{"t": 1, "kind": "open", "path": "src/foo.test.ts"}, {"t": 2, "kind": "edit", "path": "src/foo.test.ts"}])
        self.assertGreater(t["fluency"], 0.0)  # read-before-write + test edit both contribute

    def test_decision_log_events_are_recorded_in_evidence(self):
        evs = [{"t": 1, "kind": "decision_log", "path": "DECISIONS.md"}]
        sig = derive_signals(evs)
        self.assertTrue(sig["editedDecisions"])
        self.assertEqual(sig["decisionLogEntries"], 1)
        self.assertTrue(any("decision-log" in e for e in tooling_from_events(evs)["evidence"]))

    def test_probe_area_touch_is_observed_but_handledWell_is_unknown(self):
        probes = [{"id": "p1", "kind": "trap", "where": "src/parser.ts", "reveals": "x"}]
        touched = tooling_from_events([{"t": 1, "kind": "edit", "path": "src/parser.ts"}], probes)
        self.assertTrue(touched["probeOutcomes"][0]["detected"])
        # Handling is NOT gradeable from process: emit None (unknown), not a definitive
        # False — a False would be treated downstream as a graded failure and halve judgment.
        self.assertIsNone(touched["probeOutcomes"][0]["handledWell"])
        untouched = tooling_from_events([{"t": 1, "kind": "edit", "path": "src/other.ts"}], probes)
        self.assertFalse(untouched["probeOutcomes"][0]["detected"])

    def test_over_reliance_is_never_inferred_from_process(self):
        # heavy editing must never fabricate an over-reliance flag
        evs = [{"t": i, "kind": "edit", "path": f"f{i}.ts"} for i in range(20)]
        self.assertEqual(tooling_from_events(evs)["overRelianceFlags"], [])

    def test_assess_tooling_prefers_observed_events(self):
        # The observed branch returns BEFORE any provider/LLM logic — no network.
        evs = [{"t": 1, "kind": "open", "path": "a.ts"}, {"t": 2, "kind": "edit", "path": "a.ts"}]
        tool, src = assess_tooling({}, [], [], events=evs)
        self.assertEqual(src, "observed")
        self.assertEqual(tool["confidence"], 0.8)
        self.assertEqual(tool["overRelianceFlags"], [])

    def test_malformed_events_do_not_crash(self):
        evs = [None, 42, {"kind": "edit"}, {"kind": "open", "path": None}, {"t": "x", "kind": "edit", "path": "a"}]
        t = tooling_from_events(evs)  # must not raise
        self.assertEqual(t["confidence"], 0.8)

    def test_edits_after_perturbation_count_as_adaptation(self):
        evs = [
            {"t": 1, "kind": "open", "path": "a.ts"},
            {"t": 10, "kind": "perturbation"},
            {"t": 11, "kind": "edit", "path": "a.ts"},
        ]
        sig = derive_signals(evs)
        self.assertTrue(sig["perturbationShown"])
        self.assertGreaterEqual(sig["editsAfterPerturbation"], 1)
        evidence = " ".join(tooling_from_events(evs)["evidence"]).lower()
        self.assertIn("adapted", evidence)

    def test_perturbation_with_no_later_edit_is_stale_brief(self):
        evs = [{"t": 1, "kind": "edit", "path": "a.ts"}, {"t": 10, "kind": "perturbation"}]
        sig = derive_signals(evs)
        self.assertTrue(sig["perturbationShown"])
        self.assertEqual(sig["editsAfterPerturbation"], 0)
        evidence = " ".join(tooling_from_events(evs)["evidence"]).lower()
        self.assertIn("stale brief", evidence)

    def test_prompt_exchanges_are_observed_never_a_penalty(self):
        evs = [
            {"t": 1, "kind": "prompt", "path": "assistant"},
            {"t": 2, "kind": "prompt", "path": "stakeholder"},
        ]
        sig = derive_signals(evs)
        self.assertEqual(sig["promptExchanges"], 2)
        t = tooling_from_events(evs)
        evidence = " ".join(t["evidence"]).lower()
        self.assertIn("captured assistant/stakeholder channel", evidence)
        self.assertEqual(t["overRelianceFlags"], [])


if __name__ == "__main__":
    unittest.main()
