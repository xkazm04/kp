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

    # The data test above pins the COMMITTED archetypes; these pin the RUNTIME guard
    # (registry._validate_archetype_weights) that now fails fast at import, so a future
    # hand-edited archetype with a bad weight vector can never quietly mis-scale scores.
    def test_runtime_guard_rejects_bad_weight_sum(self) -> None:
        with self.assertRaises(RuntimeError):
            registry._validate_archetype_weights(
                [{"id": "typo", "weights": {"skills": 0.5, "career": 0.3, "personal": 0.1}}]  # sums to 0.9
            )

    def test_runtime_guard_rejects_wrong_weight_keys(self) -> None:
        with self.assertRaises(RuntimeError):
            registry._validate_archetype_weights(
                [{"id": "badkeys", "weights": {"skills": 0.5, "career": 0.5}}]  # missing 'personal'
            )

    def test_runtime_guard_accepts_valid_weights(self) -> None:
        # A clean vector summing to 1.0 with exactly the three slots must not raise.
        registry._validate_archetype_weights(
            [{"id": "ok", "weights": {"skills": 0.5, "career": 0.35, "personal": 0.15}}]
        )

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

    def test_shipped_archetypes_are_not_archived(self) -> None:
        # None of the committed archetypes are retired; archived_ids() reflects the flag.
        self.assertEqual(registry.archived_ids(), frozenset())

    def test_archived_flag_is_tolerated_and_still_scores(self) -> None:
        # The additive `archived` flag must not break shape validation — a retired
        # custom archetype keeps valid weights and still routes/scores ("retire, don't
        # trap"). The reader only ignores the extra key; it never drops the entry.
        retired = {"id": "legacy_custom", "archived": True, "weights": {"skills": 0.5, "career": 0.35, "personal": 0.15}}
        registry._validate_archetype_weights([retired])  # must not raise

    def test_low_confidence_threshold_is_valid_and_flags_the_default(self) -> None:
        threshold = registry.low_confidence_threshold()
        self.assertGreaterEqual(threshold, 0.0)
        self.assertLessEqual(threshold, 1.0)
        # The unguided fallback must sit BELOW the threshold, else a silent default
        # routing would read as "confident" — the exact failure this surfaces.
        self.assertLess(registry._DETECTION["defaultConfidence"], threshold)


class RoutingReasonKindsTest(unittest.TestCase):
    """The routing reasons are LOCALIZABLE, not English prose.

    `detect` has always returned rendered English sentences ("currently enrolled",
    "3 years of relevant experience"), and the profile result panel joined them into
    a "Routing: …" line — so a cs/de/fr recruiter read the router's explanation in
    English. `detect_detailed` returns the same reasons as {kind, params} codes the
    four catalogs translate; the strings stay for every existing consumer
    (soft_signals' prefix scan, signals_absent, stored analyses).
    """

    def test_every_reason_declares_a_kind(self) -> None:
        det = registry._DETECTION
        self.assertTrue(det.get("defaultReasonKind"))
        self.assertTrue(det.get("selfDeclaredReasonKind"))
        for rule in det["signals"]:
            if rule.get("reason"):
                self.assertTrue(rule.get("reasonKind"), f"signal '{rule['id']}' has a reason but no reasonKind")
        for declared, rules in det["contradictions"].items():
            for rule in rules:
                self.assertTrue(rule.get("reasonKind"), f"contradiction of '{declared}' has no reasonKind")

    def test_reason_kinds_are_unique(self) -> None:
        kinds = registry.reason_kinds()
        self.assertEqual(len(kinds), len(set(kinds)), "a reason kind is declared twice — one catalog entry, two meanings")

    def test_runtime_guard_rejects_a_reason_without_a_kind(self) -> None:
        with self.assertRaises(RuntimeError):
            registry._validate_reason_kinds(
                {
                    "defaultReasonKind": "default",
                    "selfDeclaredReasonKind": "self_declared",
                    "signals": [{"id": "orphan", "reason": "something happened"}],
                    "contradictions": {},
                }
            )

    def test_no_signal_yields_the_default_kind(self) -> None:
        archetype, confidence, reasons, codes = registry.detect_detailed()
        self.assertEqual(archetype, registry._DETECTION["defaultArchetype"])
        self.assertEqual([c["kind"] for c in codes], ["default"])
        self.assertEqual(codes[0]["params"], {})
        # The legacy strings are untouched — signals_absent still reads them.
        self.assertTrue(registry.signals_absent(reasons))

    def test_self_declaration_carries_the_archetype_as_a_param(self) -> None:
        _, _, _, codes = registry.detect_detailed(self_declared="student")
        self.assertEqual(codes[0], {"kind": "self_declared", "params": {"archetype": "student"}})

    def test_a_contradiction_appends_its_own_kind(self) -> None:
        _, confidence, reasons, codes = registry.detect_detailed(self_declared="student", years_relevant_experience=6.0, is_enrolled=False)
        self.assertEqual([c["kind"] for c in codes], ["self_declared", "contradiction_student_experienced"])
        self.assertEqual(len(codes), len(reasons))
        self.assertLess(confidence, registry._DETECTION["selfDeclaredConfidence"])

    def test_signal_params_are_taken_from_the_reason_template(self) -> None:
        # Only the placeholders the template actually names become params — a code
        # whose sentence interpolates nothing carries an empty params dict.
        _, _, _, codes = registry.detect_detailed(years_relevant_experience=5.0, has_substantial_experience=True)
        by_kind = {c["kind"]: c["params"] for c in codes}
        self.assertEqual(by_kind["signal_yre_high"], {"years_relevant_experience": 5.0})
        _, _, _, enrolled = registry.detect_detailed(is_enrolled=True)
        self.assertEqual(enrolled[0], {"kind": "signal_enrolled", "params": {}})

    def test_detect_and_detect_detailed_agree_on_the_strings(self) -> None:
        # detect() is the back-compatible face of the same computation: same
        # archetype, same confidence, same rendered reasons, one per code.
        kwargs = {"years_relevant_experience": 0.5, "is_enrolled": True, "expected_graduation": "2027-06"}
        a1, c1, r1 = registry.detect(**kwargs)
        a2, c2, r2, codes = registry.detect_detailed(**kwargs)
        self.assertEqual((a1, c1, r1), (a2, c2, r2))
        self.assertEqual(len(codes), len(r2))


if __name__ == "__main__":
    unittest.main()
