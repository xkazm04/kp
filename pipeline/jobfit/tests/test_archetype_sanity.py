from __future__ import annotations

import unittest

from pathlib import Path

from pipeline.jobfit import registry
from pipeline.jobfit.archetype import detect_archetype, label_for
from pipeline.jobfit.pipeline import _archetype_needs_review, _archetype_sanity_checks


class ArchetypeSanityCheckTest(unittest.TestCase):
    """The CV path always auto-detects the archetype (self_declared=None) from
    best-effort Gemini booleans that are frequently null. When nothing fires it
    defaults to Experienced (BAU) at low confidence — silently scoring a student
    or switcher as an experienced hire. That routing must surface for a human."""

    def test_unguided_default_is_flagged_with_no_signals(self) -> None:
        # All booleans null and years in the 1..3 dead-zone where neither the
        # yre_low nor yre_high signal fires -> registry default (bau @ 0.4).
        archetype, confidence, reasons = detect_archetype(years_relevant_experience=2.0)
        self.assertEqual(archetype, "bau")
        self.assertTrue(registry.signals_absent(reasons))

        checks = _archetype_sanity_checks(archetype, confidence, reasons)
        self.assertEqual(len(checks), 1)
        self.assertIn("low-confidence", checks[0])
        self.assertIn("no detection signals fired", checks[0])
        # Surfaces the archetype (human label) and its confidence as a percent.
        self.assertIn(label_for("bau"), checks[0])
        self.assertIn("40%", checks[0])

    def test_confident_routing_is_surfaced_as_ok(self) -> None:
        # Enrollment + sub-1y experience is an unambiguous student signal.
        archetype, confidence, reasons = detect_archetype(
            is_enrolled=True, years_relevant_experience=0.0
        )
        self.assertEqual(archetype, "student")
        self.assertFalse(registry.signals_absent(reasons))
        self.assertGreaterEqual(confidence, registry.low_confidence_threshold())

        checks = _archetype_sanity_checks(archetype, confidence, reasons)
        self.assertEqual(checks, [f"Archetype routing OK — {label_for('student')} at 100% confidence"])
        self.assertNotIn("low-confidence", checks[0])

    def test_weak_signal_routing_is_flagged_below_threshold(self) -> None:
        # A signal DID fire (reasons are non-default), but the winning archetype
        # holds less than the threshold's share -> flagged as weak, not "absent".
        reasons = ["<1 year of relevant experience"]
        self.assertFalse(registry.signals_absent(reasons))
        checks = _archetype_sanity_checks("student", 0.45, reasons)
        self.assertEqual(len(checks), 1)
        self.assertIn("low-confidence", checks[0])
        self.assertIn("weak signals", checks[0])
        self.assertIn("45%", checks[0])

    def test_tie_at_half_is_below_threshold(self) -> None:
        # A 50/50 split between two archetypes is a coin-flip the recruiter should
        # see; the threshold sits above 0.5 so a tie is flagged.
        checks = _archetype_sanity_checks("bau", 0.5, ["some non-default reason"])
        self.assertIn("low-confidence", checks[0])

    def test_signals_absent_flags_even_above_the_confidence_threshold(self) -> None:
        # The rule `_archetype_sanity_checks` states in its own docstring: "The
        # signals-absent guard is INDEPENDENT of the numeric threshold so an unguided
        # default stays flagged even if its confidence were ever tuned upward."
        # Nothing pinned that. Every other fixture here sits BELOW the threshold as
        # well as having no signals, so `if absent or low:` -> `if low:` passed the
        # whole 156-test scope green — and a registry default whose confidence was
        # nudged up would then read "Archetype routing OK", handing the recruiter a
        # BAU score for a student with no warning at all.
        _a, _c, default_reasons = detect_archetype(years_relevant_experience=2.0)
        self.assertTrue(registry.signals_absent(default_reasons))
        high = min(1.0, registry.low_confidence_threshold() + 0.4)
        self.assertGreater(high, registry.low_confidence_threshold())  # the branch is real

        checks = _archetype_sanity_checks("bau", high, default_reasons)
        self.assertEqual(len(checks), 1)
        self.assertIn("low-confidence", checks[0])
        self.assertIn("no detection signals fired", checks[0])  # absent, not "weak signals"

        # Control at the SAME confidence: with a signal that did fire, the routing reads
        # OK — so the flag above is caused by the absent signals, never by the number.
        ok = _archetype_sanity_checks("student", high, ["<1 year of relevant experience"])
        self.assertNotIn("low-confidence", ok[0])

    def test_dump_needs_review_follows_the_0_55_rule(self) -> None:
        # 0.54 is below the registry threshold; 0.55 is not; a self-declared 0.9
        # with no contradiction is settled. The dump stamps the boolean so the
        # report does not re-implement the cutoff.
        needs, why = _archetype_needs_review(0.54, ["currently enrolled"])
        self.assertEqual((needs, why), (True, "low_confidence"))
        needs, why = _archetype_needs_review(0.55, ["currently enrolled"])
        self.assertEqual((needs, why), (False, None))
        needs, why = _archetype_needs_review(0.9, ["self-declared: Experienced"])
        self.assertEqual((needs, why), (False, None))
        src = Path(__file__).resolve().parents[1].joinpath("pipeline.py").read_text(encoding="utf-8")
        self.assertIn('dump["archetypeNeedsReview"]', src)
        self.assertIn('dump["archetypeNeedsReviewCode"]', src)

    def test_dump_needs_review_flags_a_fired_contradiction_above_the_threshold(self) -> None:
        reasons = ["self-declared: Student", "contradiction: 3+ years of relevant experience for a 'student'"]
        needs, why = _archetype_needs_review(0.65, reasons)
        self.assertEqual((needs, why), (True, "contradiction"))
        self.assertTrue(registry.contradiction_fired(reasons))
        self.assertFalse(registry.contradiction_fired(["currently enrolled"]))

    def test_signals_absent_marker_matches_default_fallback_only(self) -> None:
        # Precise marker: present only on the no-signal fallback branch.
        _a, _c, default_reasons = detect_archetype(years_relevant_experience=2.0)
        self.assertTrue(registry.signals_absent(default_reasons))
        self.assertFalse(registry.signals_absent([]))
        self.assertFalse(registry.signals_absent(["currently enrolled"]))


if __name__ == "__main__":
    unittest.main()
