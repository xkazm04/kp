"""Contract tests for the shared archetype registry (archetypes.json).

These guard the invariants that make the registry safely extensible: a new
archetype added as data must declare valid weights, a known scoringModel, known
completeness `check` ids, and detection rules that reference known signals and
known archetype ids. They fail loudly at CI time rather than letting a typo in
the data desync the fairness gate or silently no-op a checklist item.

The TS app reads the SAME file, so validating it here also protects the TS side.
"""

from __future__ import annotations

import unittest

from pipeline.jobfit import registry
from pipeline.jobfit.profile import CHECKS

_VALID_SCORING_MODELS = {"experienced", "early_career"}
# The signal names registry.detect() builds into its evaluation context.
_KNOWN_SIGNALS = {
    "years_relevant_experience",
    "is_enrolled",
    "expected_graduation",
    "education_is_dominant",
    "wants_domain_change",
    "has_substantial_experience",
}
_SLOTS = ("skills", "career", "personal")


def _signal_names(cond: dict) -> set[str]:
    """Recursively collect the `signal` names referenced in a condition tree."""
    if "all" in cond:
        return set().union(*(_signal_names(c) for c in cond["all"]))
    if "any" in cond:
        return set().union(*(_signal_names(c) for c in cond["any"]))
    return {cond["signal"]}


class RegistryShapeTest(unittest.TestCase):
    def setUp(self) -> None:
        self.archetypes = registry._ARCHETYPES  # the raw data rows
        self.ids = set(registry.archetype_ids())

    def test_archetypes_have_required_fields(self) -> None:
        for a in self.archetypes:
            for field in ("id", "label", "badge", "pythonLabel", "fairnessProtected", "scoringModel", "weights", "dimensionLabels", "checklist"):
                self.assertIn(field, a, f"{a.get('id')} missing '{field}'")

    def test_ids_are_unique(self) -> None:
        ids = [a["id"] for a in self.archetypes]
        self.assertEqual(len(ids), len(set(ids)), "duplicate archetype id")

    def test_weights_sum_to_one(self) -> None:
        for a in self.archetypes:
            self.assertEqual(set(a["weights"]), set(_SLOTS), f"{a['id']} weights need exactly {_SLOTS}")
            self.assertAlmostEqual(sum(a["weights"].values()), 1.0, places=6, msg=f"{a['id']} weights must sum to 1.0")

    def test_dimension_labels_cover_every_slot(self) -> None:
        for a in self.archetypes:
            self.assertEqual(set(a["dimensionLabels"]), set(_SLOTS), f"{a['id']} dimensionLabels need {_SLOTS}")

    def test_scoring_models_are_known(self) -> None:
        for a in self.archetypes:
            self.assertIn(a["scoringModel"], _VALID_SCORING_MODELS, f"{a['id']} has unknown scoringModel")

    def test_every_checklist_check_is_a_known_predicate(self) -> None:
        # common + per-archetype checks must all resolve to a CHECKS predicate,
        # else a completeness item would silently never be satisfiable.
        specs = list(registry._COMMON_CHECKLIST)
        for a in self.archetypes:
            specs += a["checklist"]
        for spec in specs:
            self.assertIn(spec["check"], CHECKS, f"unknown checklist check '{spec['check']}'")

    def test_detection_signals_and_targets_are_known(self) -> None:
        det = registry._DETECTION
        self.assertIn(det["defaultArchetype"], self.ids)
        for rule in det["signals"]:
            self.assertLessEqual(_signal_names(rule["when"]), _KNOWN_SIGNALS, f"rule '{rule['id']}' references unknown signal")
            self.assertLessEqual(set(rule["scores"]), self.ids, f"rule '{rule['id']}' scores an unknown archetype")
        for declared, rules in det["contradictions"].items():
            self.assertIn(declared, self.ids, f"contradiction keyed by unknown archetype '{declared}'")
            for rule in rules:
                self.assertLessEqual(_signal_names(rule["when"]), _KNOWN_SIGNALS)
                self.assertGreaterEqual(rule["confidence"], 0.0)
                self.assertLessEqual(rule["confidence"], 1.0)

    def test_fairness_protected_is_a_subset_of_ids(self) -> None:
        self.assertLessEqual(registry.fairness_protected_archetypes(), self.ids)


if __name__ == "__main__":
    unittest.main()
