"""C2 - an unwitnessed trace caps PROCESS confidence and changes nothing else."""
import unittest

from pipeline.jobfit.devcase.process_events import UNWITNESSED_CONFIDENCE_CAP, tooling_from_events

EVENTS = [
    {"t": 1, "kind": "open", "path": "src/a.py"},
    {"t": 2, "kind": "edit", "path": "src/a.py"},
    {"t": 3, "kind": "decision_log", "path": "DECISIONS.md"},
]


class UnwitnessedConfidenceTest(unittest.TestCase):
    def test_unwitnessed_caps_confidence_only(self):
        base = tooling_from_events(EVENTS)
        capped = tooling_from_events(EVENTS, witnessed=False)
        self.assertEqual(base["confidence"], 0.8)
        self.assertEqual(capped["confidence"], UNWITNESSED_CONFIDENCE_CAP)
        self.assertLess(capped["confidence"], base["confidence"])
        for key in ("fluency", "probeOutcomes", "overRelianceFlags", "signals"):
            self.assertEqual(base[key], capped[key], f"{key}: an unwitnessed trace never moves a score")

    def test_witnessed_and_unknown_are_unchanged(self):
        base = tooling_from_events(EVENTS)
        self.assertEqual(tooling_from_events(EVENTS, witnessed=True), base)
        self.assertEqual(tooling_from_events(EVENTS, witnessed=None), base)

    def test_cap_stays_above_the_low_confidence_floor(self):
        # The cap holds auto-promote through the explicit unwitnessed reason; it must not
        # also masquerade as thin evidence (LOW_CONFIDENCE 0.4 in models.py).
        self.assertGreater(UNWITNESSED_CONFIDENCE_CAP, 0.4)


if __name__ == "__main__":
    unittest.main()
