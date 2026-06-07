"""Single-source-of-truth contract for the profile taxonomy enums (idea-ba28f11b).

EVIDENCE_KINDS, SKILL_LEVELS and the provenance vocabulary used to be declared
independently in ProfileTypes.ts, profile.py and taxonomy.py, so a kind or
provenance added in one place silently scored zero elsewhere. They now have one
Python source of truth that codegen.py emits into app/_lib/taxonomy.generated.ts.

This pins the invariants that make that contract checkable:
 * the developer-authored maps in profile.py agree internally, and
 * the committed generated TS file is in sync with the Python lists.
"""

from __future__ import annotations

import unittest

from pipeline.jobfit import codegen
from pipeline.jobfit.profile import (
    EVIDENCE_KINDS,
    SKILL_LEVELS,
    Evidence,
    SkillClaim,
    _KIND_PROVENANCE,
)
from pipeline.jobfit.taxonomy import (
    DEFAULT_PROVENANCE,
    PROVENANCE_WEIGHTS,
    UI_PROVENANCE,
)


class ProfileTaxonomyContractTest(unittest.TestCase):
    def test_every_evidence_kind_has_a_default_provenance(self) -> None:
        # resolved_provenance() does _KIND_PROVENANCE.get(kind, "unknown"); a kind
        # without an entry would silently fall through to the "unknown" weight.
        self.assertEqual(set(_KIND_PROVENANCE), set(EVIDENCE_KINDS))

    def test_kind_provenance_defaults_are_weighted(self) -> None:
        # Each default must be a real provenance with a scoring weight, else the
        # evidence scores as PROVENANCE_WEIGHTS["unknown"] with no error.
        for kind, prov in _KIND_PROVENANCE.items():
            self.assertIn(prov, PROVENANCE_WEIGHTS, f"{kind!r} -> unweighted {prov!r}")

    def test_ui_provenance_is_a_weighted_subset(self) -> None:
        for prov in UI_PROVENANCE:
            self.assertIn(prov, PROVENANCE_WEIGHTS, f"UI provenance {prov!r} has no weight")
        # The two non-selectable values are intentionally excluded from the dropdown.
        self.assertNotIn("observed", UI_PROVENANCE)  # machine-set only
        self.assertNotIn("unknown", UI_PROVENANCE)  # scoring fallback, not a choice

    def test_model_defaults_are_valid_provenance(self) -> None:
        # The defaults the editor round-trips must themselves be in-vocab.
        self.assertIn(SkillClaim(skill="x").provenance, PROVENANCE_WEIGHTS)
        self.assertIn(SkillClaim(skill="x").provenance, UI_PROVENANCE)
        self.assertIn(Evidence().provenance, PROVENANCE_WEIGHTS)
        self.assertIn(DEFAULT_PROVENANCE, PROVENANCE_WEIGHTS)

    def test_no_duplicate_entries(self) -> None:
        for name, values in (
            ("EVIDENCE_KINDS", EVIDENCE_KINDS),
            ("SKILL_LEVELS", SKILL_LEVELS),
            ("UI_PROVENANCE", UI_PROVENANCE),
        ):
            self.assertEqual(len(values), len(set(values)), f"{name} has duplicates")

    def test_generated_ts_is_in_sync(self) -> None:
        # The committed app/_lib/taxonomy.generated.ts must equal a fresh render
        # of the Python lists — the same invariant `npm run schemas:check`
        # enforces in CI, asserted here so a stale file fails the Python suite too.
        existing = (
            codegen.TAXONOMY_OUTPUT.read_text(encoding="utf-8")
            if codegen.TAXONOMY_OUTPUT.exists()
            else ""
        )
        self.assertEqual(
            existing,
            codegen.render_taxonomy(),
            "app/_lib/taxonomy.generated.ts is stale — run `python -m pipeline.jobfit.codegen`.",
        )


if __name__ == "__main__":
    unittest.main()
