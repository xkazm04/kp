"""Pin early-career detection to ONE source: the shared registry.

Early-career detection drives the most safety-critical invariant in the
automation pipeline — early-career candidates (student / career_switcher) are
NEVER silently auto-advanced or auto-rejected (the fairness gate). For a long
time that set lived in two competing places: a hand-written ``("student",
"career_switcher")`` tuple copied into several modules AND
``registry.early_career_archetypes()`` (derived from archetypes.json, the same
file the scorer and the TS app read). A divergence between the two would
mis-route a protected candidate with ZERO error — exactly the silent failure
the fairness gate exists to prevent.

These tests make that divergence impossible:

  * the registry's early-career set is pinned to the known canonical literal, so
    any change to archetypes.json is a deliberate, test-breaking act rather than
    a silent one;
  * every consumer module derives its set FROM the registry (so a registry change
    propagates everywhere automatically); and
  * the shadowed literal cannot be reintroduced into the Python sources.
"""

from __future__ import annotations

import re
import unittest
from pathlib import Path

from pipeline.jobfit import automation, group_compare, match_reasoning, registry
from pipeline.jobfit.eval import automation_eval

# The canonical early-career set. This is the literal that used to be copied by
# hand across the codebase; pinning the registry to it means a future
# archetypes.json change (adding/removing an early-career archetype) trips this
# test loudly instead of silently diverging from the consumers below.
CANONICAL_EARLY_CAREER = {"student", "career_switcher"}

# A 2-element tuple/list of the early-career ids, in either order — the shadowed
# literal this requirement killed. (A 3-element list like
# ["bau", "student", "career_switcher"] is the *full* archetype list, a
# different concept, and deliberately does not match.)
_SHADOWED_LITERAL_RE = re.compile(
    r"""[\(\[]\s*["'](?:student|career_switcher)["']\s*,\s*"""
    r"""["'](?:student|career_switcher)["']\s*[\)\]]"""
)

# The jobfit package root (pipeline/jobfit). Production + eval code lives here;
# the tests/ subtree is excluded — the literal is legal to *name* in a test.
_PACKAGE_ROOT = Path(registry.__file__).resolve().parent


class EarlyCareerSingleSourceTest(unittest.TestCase):
    def test_registry_matches_the_canonical_literal(self) -> None:
        """literal-vs-registry: the registry IS the canonical early-career set.

        If this fails, archetypes.json changed the early-career roster. That is
        allowed — but update CANONICAL_EARLY_CAREER here in the same change, which
        forces a conscious review of every fairness-gated path rather than a
        silent drift.
        """
        self.assertEqual(set(registry.early_career_archetypes()), CANONICAL_EARLY_CAREER)

    def test_every_consumer_derives_from_the_registry(self) -> None:
        """No module may carry its own early-career set; all equal the registry."""
        canonical = set(registry.early_career_archetypes())
        for label, value in (
            ("automation._EARLY_CAREER", automation._EARLY_CAREER),
            ("match_reasoning._EARLY_CAREER", match_reasoning._EARLY_CAREER),
            ("group_compare._EARLY_CAREER", group_compare._EARLY_CAREER),
            ("eval.automation_eval._EARLY", automation_eval._EARLY),
        ):
            with self.subTest(consumer=label):
                self.assertEqual(set(value), canonical, f"{label} diverged from the registry")

    def test_no_shadowed_literal_in_python_sources(self) -> None:
        """The hand-written early-career tuple cannot be reintroduced anywhere in
        the package (tests excluded) — every site must go through the registry."""
        offenders = []
        for path in _PACKAGE_ROOT.rglob("*.py"):
            if "tests" in path.relative_to(_PACKAGE_ROOT).parts:
                continue
            if _SHADOWED_LITERAL_RE.search(path.read_text(encoding="utf-8")):
                offenders.append(str(path.relative_to(_PACKAGE_ROOT)))
        self.assertEqual(
            offenders,
            [],
            "shadowed early-career literal found — use registry.early_career_archetypes(): "
            + ", ".join(offenders),
        )


if __name__ == "__main__":
    unittest.main()
