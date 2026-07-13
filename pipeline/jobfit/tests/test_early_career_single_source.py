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

import ast
import importlib
import re
import unittest
from pathlib import Path

from pipeline.jobfit import registry

# The canonical early-career set. This is the literal that used to be copied by
# hand across the codebase; pinning the registry to it means a future
# archetypes.json change (adding/removing an early-career archetype) trips this
# test loudly instead of silently diverging from the consumers below.
CANONICAL_EARLY_CAREER = {"student", "career_switcher"}

# A 2-element collection of the early-career ids, in either order — the shadowed
# literal this requirement killed. (A 3-element list like
# ["bau", "student", "career_switcher"] is the *full* archetype list, a
# different concept, and deliberately does not match.)
#
# bug-ui-scan-2026-07-09 (pipeline-test-suite-python #3): the old class only
# covered ()/[] brackets, so a set/frozenset literal `{"student",
# "career_switcher"}` — the most natural Python idiom for this set — sailed
# through. `{`/`}` are now in the bracket classes (which also catches
# `frozenset({...})` / `frozenset((...))` via the inner literal), and an optional
# trailing comma is tolerated.
_SHADOWED_LITERAL_RE = re.compile(
    r"""[\(\[\{]\s*["'](?:student|career_switcher)["']\s*,\s*"""
    r"""["'](?:student|career_switcher)["']\s*,?\s*[\)\]\}]"""
)

# The jobfit package root (pipeline/jobfit). Production + eval code lives here;
# the tests/ subtree is excluded — the literal is legal to *name* in a test.
_PACKAGE_ROOT = Path(registry.__file__).resolve().parent

# The consumers the OLD test hardcoded plus the three it silently missed
# (matching/transform/live_case). Used only as a discovery FLOOR — the real check
# below finds every consumer dynamically, so a future one is covered automatically.
_KNOWN_CONSUMERS = {
    ("pipeline.jobfit.automation", "_EARLY_CAREER"),
    ("pipeline.jobfit.match_reasoning", "_EARLY_CAREER"),
    ("pipeline.jobfit.group_compare", "_EARLY_CAREER"),
    ("pipeline.jobfit.matching", "_EARLY_CAREER"),
    ("pipeline.jobfit.transform", "_EARLY_CAREER"),
    ("pipeline.jobfit.live_case", "_EARLY_CAREER"),
    ("pipeline.jobfit.eval.automation_eval", "_EARLY"),
}


def _iter_production_modules() -> list[tuple[str, Path]]:
    """(dotted_name, path) for every non-test, non-__init__ module in the package."""
    out: list[tuple[str, Path]] = []
    for path in sorted(_PACKAGE_ROOT.rglob("*.py")):
        rel = path.relative_to(_PACKAGE_ROOT)
        if "tests" in rel.parts or path.name == "__init__.py":
            continue
        dotted = "pipeline.jobfit." + ".".join(rel.with_suffix("").parts)
        out.append((dotted, path))
    return out


def _module_level_assignments(tree: ast.Module):
    """Yield (target_names, value_node) for each module-level assignment."""
    for stmt in tree.body:
        if isinstance(stmt, ast.Assign):
            names = [t.id for t in stmt.targets if isinstance(t, ast.Name)]
            yield names, stmt.value
        elif isinstance(stmt, ast.AnnAssign) and isinstance(stmt.target, ast.Name):
            yield [stmt.target.id], stmt.value


def _derives_from_registry(value: ast.AST | None) -> bool:
    """True if the expression subtree calls registry.early_career_archetypes()."""
    if value is None:
        return False
    for sub in ast.walk(value):
        if isinstance(sub, ast.Call) and isinstance(sub.func, ast.Attribute):
            if sub.func.attr == "early_career_archetypes":
                return True
    return False


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
        """No module may carry its own early-career set; all equal the registry.

        bug-ui-scan-2026-07-09 (pipeline-test-suite-python #3): the old test checked
        a STATIC list of 4 hardcoded attributes and silently missed the three real
        consumers matching/transform/live_case (and would miss any 5th added later).
        This DISCOVERS every module that binds an early-career set from the registry
        via AST, then asserts each equals the canonical set — so a new consumer is
        covered automatically and a derivation that truncates/mutates the registry
        value (e.g. `registry.early_career_archetypes()[:1]`) is caught.
        """
        canonical = set(registry.early_career_archetypes())
        discovered: set[tuple[str, str]] = set()
        for dotted, path in _iter_production_modules():
            tree = ast.parse(path.read_text(encoding="utf-8"), filename=str(path))
            for names, value in _module_level_assignments(tree):
                if _derives_from_registry(value):
                    for name in names:
                        discovered.add((dotted, name))
        self.assertTrue(discovered, "AST discovery found no registry-derived consumer — discovery is broken")
        missing = _KNOWN_CONSUMERS - discovered
        self.assertFalse(missing, f"known early-career consumers no longer discovered: {sorted(missing)}")
        for dotted, attr in sorted(discovered):
            with self.subTest(consumer=f"{dotted}.{attr}"):
                module = importlib.import_module(dotted)
                self.assertEqual(
                    set(getattr(module, attr)), canonical, f"{dotted}.{attr} diverged from the registry"
                )

    def test_no_module_defines_its_own_early_career_set(self) -> None:
        """Structural single-source rule (bug-ui-scan-2026-07-09
        (pipeline-test-suite-python #3)): a module-level ``_EARLY_CAREER`` attribute
        MUST derive from ``registry.early_career_archetypes()`` — never a hand-rolled
        literal. This is the AST/import-graph guard that closes the regex bypass: a
        future ``_EARLY_CAREER = {"student", "career_switcher"}`` set literal that the
        text scan might miss is caught here structurally, by name, at its definition.
        (Differently-named sets like interview_scenarios_gen._EARLY = {"intern",
        "junior"} are a distinct seniority concept and are intentionally untouched.)
        """
        offenders: list[str] = []
        for dotted, path in _iter_production_modules():
            tree = ast.parse(path.read_text(encoding="utf-8"), filename=str(path))
            for names, value in _module_level_assignments(tree):
                if "_EARLY_CAREER" in names and not _derives_from_registry(value):
                    offenders.append(f"{dotted}.{'/'.join(names)}")
        self.assertEqual(
            offenders,
            [],
            "module-level `_EARLY_CAREER` not derived from the registry (use "
            "registry.early_career_archetypes()): " + ", ".join(offenders),
        )

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


class ShadowedLiteralRegexTest(unittest.TestCase):
    """Non-vacuous guards for the strengthened regex (#3): each asserts the exact
    match/no-match behaviour that the old ()/[]-only class got wrong."""

    def test_matches_every_two_element_collection_form(self) -> None:
        for src in (
            '("student", "career_switcher")',
            '["career_switcher", "student"]',
            '{"student", "career_switcher"}',            # set literal — OLD regex MISSED this
            'frozenset({"student", "career_switcher"})',  # matched via the inner {...}
            "('student', 'career_switcher',)",           # trailing comma
        ):
            with self.subTest(src=src):
                self.assertRegex(src, _SHADOWED_LITERAL_RE)

    def test_ignores_the_full_three_element_archetype_list(self) -> None:
        # The full archetype roster is a different concept and must NOT trip.
        self.assertNotRegex('["bau", "student", "career_switcher"]', _SHADOWED_LITERAL_RE)
        self.assertNotRegex('{"student": 1, "career_switcher": 2}', _SHADOWED_LITERAL_RE)


if __name__ == "__main__":
    unittest.main()
