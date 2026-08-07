"""W4.3 — BYOM completeness: every routed call site must be pinnable by the customer.

kp sells a $5 "bring your own model" tier and a self-host story. Both are promises about
COVERAGE: if even one call site routes to an engine the customer cannot redirect, their
data goes somewhere they did not choose and their spend lands on our key. A BYOM tier that
silently misses call sites is a broken promise, not a partial feature.

Coverage depends on two catalogs agreeing across the language boundary:

  * ``app/_lib/llm-config.ts`` LLM_USE_CASES — what the customer can PIN a provider/model
    for in the Models tab (the config that becomes KP_LLM_CONFIG).
  * ``pipeline/jobfit/llm/capabilities.py`` USE_CASE_REQUIREMENTS — what the routing layer
    KNOWS how to serve, and validates capabilities against.

Drift between them is invisible at runtime and fails in the direction that flatters us: a
use case Python routes but TS cannot configure just quietly keeps using the default engine
however the customer sets up BYOM. Nothing else in the build compares the two, so these
tests do — by reading the actual source, never a copied list that would drift with it.

(Deliberately NOT asserted here: that no TS call site ever reaches a vendor SDK directly.
`github_analysis` does, by design — it is metered and BYOM-aware but bypasses the Python
wrapper — and a source-grep proxy for that property would be a guess dressed as a gate.
Tiger tracks it as a known bypass.)
"""

from __future__ import annotations

import re
import unittest
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[3]
LLM_CONFIG_TS = REPO_ROOT / "app" / "_lib" / "llm-config.ts"
CAPABILITIES_PY = REPO_ROOT / "pipeline" / "jobfit" / "llm" / "capabilities.py"
PIPELINE_DIR = REPO_ROOT / "pipeline"

# The TS catalog carries a "*" wildcard row (route everything to one provider) that has no
# Python counterpart — it is a config convenience, not a call site.
WILDCARD = "*"


def _ts_use_cases() -> set[str]:
    src = LLM_CONFIG_TS.read_text(encoding="utf-8")
    block = re.search(r"export const LLM_USE_CASES = \[(.*?)\] as const;", src, re.S)
    assert block, f"LLM_USE_CASES not found in {LLM_CONFIG_TS} — did the declaration move?"
    return set(re.findall(r'"([^"]+)"', block.group(1))) - {WILDCARD}


def _py_use_cases() -> set[str]:
    src = CAPABILITIES_PY.read_text(encoding="utf-8")
    block = re.search(r"USE_CASE_REQUIREMENTS: dict\[str, frozenset\[str\]\] = \{(.*?)\n\}", src, re.S)
    assert block, f"USE_CASE_REQUIREMENTS not found in {CAPABILITIES_PY} — did the declaration move?"
    return set(re.findall(r'"([^"]+)": frozenset', block.group(1)))


def _routed_use_cases() -> set[str]:
    """Every string literal actually passed to resolve_provider() across the pipeline."""
    found: set[str] = set()
    for path in PIPELINE_DIR.rglob("*.py"):
        if "__pycache__" in path.parts:
            continue
        found.update(re.findall(r'resolve_provider\(\s*"([a-z0-9_]+)"', path.read_text(encoding="utf-8")))
    return found


class TestByomCatalogsAgree(unittest.TestCase):
    def test_the_scan_itself_found_both_catalogs(self):
        """Set-difference assertions pass vacuously against an empty set, so a regex that
        silently stops matching would turn every test below into a no-op that reads green.
        Pin a floor instead of trusting the parse."""
        ts, py = _ts_use_cases(), _py_use_cases()
        self.assertGreater(len(ts), 15, f"LLM_USE_CASES parsed as {sorted(ts)} — the regex is probably stale")
        self.assertGreater(len(py), 15, f"USE_CASE_REQUIREMENTS parsed as {sorted(py)} — the regex is probably stale")
        # A couple of anchors that must be present in any real parse.
        self.assertIn("cv_analysis", ts)
        self.assertIn("cv_analysis", py)

    def test_every_routable_use_case_is_customer_pinnable(self):
        missing = _py_use_cases() - _ts_use_cases()
        self.assertEqual(
            missing,
            set(),
            "these use cases route in Python but are absent from LLM_USE_CASES, so a BYOM "
            f"customer cannot pin them and they silently keep the default engine: {sorted(missing)}",
        )

    def test_no_pinnable_use_case_is_unroutable(self):
        # The opposite drift is a different lie: the Models tab offers a row that no call
        # site honours, so a customer configures a model and nothing changes.
        orphans = _ts_use_cases() - _py_use_cases()
        self.assertEqual(
            orphans,
            set(),
            f"these use cases are offered in the Models tab but unknown to the routing layer: {sorted(orphans)}",
        )


class TestEveryCallSiteIsDeclared(unittest.TestCase):
    def test_resolve_provider_literals_are_all_in_both_catalogs(self):
        """A new call site that invents a use-case string is the actual regression path.

        resolve_provider defaults an unknown use case to {json} and serves it, so nothing
        fails — it just becomes an engine the customer cannot redirect."""
        routed = _routed_use_cases()
        self.assertTrue(routed, "found no resolve_provider call sites — the scan itself is broken")
        undeclared_py = routed - _py_use_cases()
        self.assertEqual(undeclared_py, set(), f"call sites routing an undeclared use case: {sorted(undeclared_py)}")
        undeclared_ts = routed - _ts_use_cases()
        self.assertEqual(undeclared_ts, set(), f"call sites the customer cannot pin: {sorted(undeclared_ts)}")

    def test_the_devcase_judge_seat_is_pinnable(self):
        """W0.1 depends on this: the judge is only independent of the generator if a
        customer (or CI) can actually pin a different model for it."""
        self.assertIn("devcase_judge", _ts_use_cases())
        self.assertIn("devcase_judge", _py_use_cases())
        self.assertIn("devcase_judge", _routed_use_cases())


if __name__ == "__main__":
    unittest.main()
