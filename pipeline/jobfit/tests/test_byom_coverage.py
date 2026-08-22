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

import ast
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


def _literal_routed_use_cases() -> set[str]:
    """Every string literal actually passed to resolve_provider() across the pipeline."""
    found: set[str] = set()
    for path in PIPELINE_DIR.rglob("*.py"):
        if "__pycache__" in path.parts:
            continue
        found.update(re.findall(r'resolve_provider\(\s*"([a-z0-9_]+)"', path.read_text(encoding="utf-8")))
    return found


# --- the call sites the literal scan cannot see -------------------------------
#
# 2026-08-22 mutation audit: the literal scan above WAS the whole call-site inventory,
# and the two busiest routers do not pass a literal. ``automation_cli`` and
# ``devcase_cli`` call ``resolve_provider(use_case, timeout=120)`` with a VARIABLE read
# out of a per-command map (``_USE_CASE_BY_COMMAND``), so ~10 routed use cases —
# devcase_reflect, devcase_evaluate, devcase_interview_scenario, devcase_seed,
# interview_scorecard, automation … — never reached this scan. Renaming one map value
# to a use case neither catalog declares (precisely the regression this file exists to
# catch: resolve_provider serves an unknown use case on the DEFAULT engine, so a BYOM
# customer cannot pin it and their data goes somewhere they did not choose) left the
# whole 156-test scope green, while the identical string in a positional literal
# correctly turned two tests red.
#
# So the map IS the call site. It is harvested from the AST — deliberately NOT by name
# across the whole tree (``bench/judge._USE_CASE_TASK`` maps use cases to prose task
# descriptions and would poison the set) but only inside the modules that actually route
# a variable into resolve_provider. A new CLI following the same convention is covered
# for free; one that does not is caught by test_every_dynamic_call_site_is_scannable.

# Modules whose dynamic argument comes from the OPERATOR rather than a map: the local
# ``llm/test_cli.py`` debug harness resolves whatever --use-case the developer typed.
# There is no catalog to check that against and it is not a product call site.
_OPERATOR_SUPPLIED_USE_CASE_MODULES = {"test_cli.py"}


def _pipeline_sources() -> list[Path]:
    return [
        path
        for path in PIPELINE_DIR.rglob("*.py")
        # The suite's own fixtures are not call sites (test_llm_registry drives
        # resolve_provider through a variable on purpose).
        if "__pycache__" not in path.parts and "tests" not in path.parts
    ]


def _parse(path: Path):
    try:
        return ast.parse(path.read_text(encoding="utf-8"))
    except SyntaxError:  # pragma: no cover - a broken source fails elsewhere, loudly
        return None


def _resolve_provider_args(tree):
    for node in ast.walk(tree):
        if not isinstance(node, ast.Call) or not node.args:
            continue
        fn = node.func
        name = fn.attr if isinstance(fn, ast.Attribute) else getattr(fn, "id", None)
        if name == "resolve_provider":
            yield node.args[0]


def _dynamic_route_modules() -> list[Path]:
    """Modules that hand resolve_provider a VARIABLE — the sites the regex cannot see."""
    out: list[Path] = []
    for path in _pipeline_sources():
        tree = _parse(path)
        if tree is None:
            continue
        if any(
            not (isinstance(arg, ast.Constant) and isinstance(arg.value, str))
            for arg in _resolve_provider_args(tree)
        ):
            out.append(path)
    return out


def _use_case_map_values(tree) -> set[str]:
    """String values of a module's ``*USE_CASE*`` dict(s), plus the literal defaults its
    ``.get(command, "…")`` lookups fall back to — ``automation`` and the devcase
    case-design row are ONLY reachable through such a default."""
    found: set[str] = set()
    for node in ast.walk(tree):
        names: list[str] = []
        if isinstance(node, ast.Assign):
            names = [t.id for t in node.targets if isinstance(t, ast.Name)]
        elif isinstance(node, ast.AnnAssign) and isinstance(node.target, ast.Name):
            names = [node.target.id]
        if names and any("USE_CASE" in n.upper() for n in names) and isinstance(node.value, ast.Dict):
            found.update(
                v.value for v in node.value.values if isinstance(v, ast.Constant) and isinstance(v.value, str)
            )
        if (
            isinstance(node, ast.Call)
            and isinstance(node.func, ast.Attribute)
            and node.func.attr == "get"
            and isinstance(node.func.value, ast.Name)
            and "USE_CASE" in node.func.value.id.upper()
            and len(node.args) == 2
            and isinstance(node.args[1], ast.Constant)
            and isinstance(node.args[1].value, str)
        ):
            found.add(node.args[1].value)
    return found


def _map_routed_use_cases() -> set[str]:
    found: set[str] = set()
    for path in _dynamic_route_modules():
        if path.name in _OPERATOR_SUPPLIED_USE_CASE_MODULES:
            continue
        tree = _parse(path)
        if tree is not None:
            found.update(_use_case_map_values(tree))
    return found


def _routed_use_cases() -> set[str]:
    """Every use case a call site can actually route — literal AND map-driven."""
    return _literal_routed_use_cases() | _map_routed_use_cases()


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

    def test_the_map_driven_call_sites_are_actually_scanned(self):
        """Non-vacuity for the AST harvest: these use cases exist ONLY as values in a
        ``_USE_CASE_BY_COMMAND`` map, never as a resolve_provider literal. Without this
        floor a scan that silently stopped finding the maps would put the assertion above
        back over an incomplete inventory — which is how it read green while a map entry
        routed a use case neither catalog declares."""
        mapped = _map_routed_use_cases()
        literal = _literal_routed_use_cases()
        self.assertGreaterEqual(len(mapped), 5, f"map scan found only {sorted(mapped)} — is it stale?")
        for use_case in ("devcase_evaluate", "devcase_reflect", "devcase_seed", "interview_scorecard", "automation"):
            self.assertIn(use_case, mapped, f"{use_case} routes only through a per-command map; the scan lost it")
            self.assertNotIn(use_case, literal, f"{use_case} is now a literal too — pick a different anchor")

    def test_every_dynamic_call_site_is_scannable(self):
        """Fail closed: a module that routes a VARIABLE into resolve_provider must expose a
        ``*USE_CASE*`` map this file can read, or be a documented operator-supplied harness.
        Otherwise its call sites drop out of the inventory again, silently."""
        blind = []
        for path in _dynamic_route_modules():
            if path.name in _OPERATOR_SUPPLIED_USE_CASE_MODULES:
                continue
            tree = _parse(path)
            if tree is None or not _use_case_map_values(tree):
                blind.append(str(path.relative_to(REPO_ROOT)))
        self.assertEqual(
            blind,
            [],
            "these modules route a computed use case with no map this scan can read, so their "
            f"call sites are invisible to the BYOM coverage gate: {blind}",
        )

    def test_the_devcase_judge_seat_is_pinnable(self):
        """W0.1 depends on this: the judge is only independent of the generator if a
        customer (or CI) can actually pin a different model for it."""
        self.assertIn("devcase_judge", _ts_use_cases())
        self.assertIn("devcase_judge", _py_use_cases())
        self.assertIn("devcase_judge", _routed_use_cases())


if __name__ == "__main__":
    unittest.main()
