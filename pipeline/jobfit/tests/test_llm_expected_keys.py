"""Source scan: every production ``complete_json`` call names ``expected_keys``.

``_extract_json`` returns the LAST top-level JSON value in the model's answer, so
a prompt that spells its schema out as an example is one echo away from having
that example returned as the answer. ``expected_keys`` is the pin that makes the
selection shape-directed instead of positional, and the layer threads it
everywhere — except, until this test existed, at four production call sites
(automation._generate, campaign, jobs.ingest_raw_ad, weight_proposal), where the
descent is silent: the coercer sees a well-formed dict with none of the fields it
reads and quietly ships the deterministic template as if the model had answered.

Nothing in the type system can catch that (the kwarg is optional by design, for
the test fakes that predate it), so the guard is a scan of the real source. AST,
not grep: it sees multi-line calls, ignores docstrings and the ``def`` sites, and
cannot be fooled by a mention in prose.
"""

from __future__ import annotations

import ast
import unittest
from pathlib import Path

_PIPELINE = Path(__file__).resolve().parents[1]

# (module path relative to pipeline/jobfit, enclosing function) → why this ONE call
# legitimately omits the pin. Keep this table tiny and reasoned; the default answer
# to a scan failure is to pass expected_keys, not to add a row here.
_WAIVED: dict[tuple[str, str], str] = {
    ("devcase/provenance.py", "_complete_json"): (
        "the compat branch of the forwarding shim itself — it calls without the kwarg "
        "only for a provider whose signature does not accept it (a canned test fake)"
    ),
}


def _production_modules() -> list[Path]:
    return sorted(
        p
        for p in _PIPELINE.rglob("*.py")
        if "tests" not in p.parts and "__pycache__" not in p.parts
    )


def _calls(tree: ast.AST) -> list[tuple[ast.Call, str]]:
    """Every ``<obj>.complete_json(...)`` call, with the name of the function it
    sits in (``"<module>"`` at module level)."""
    found: list[tuple[ast.Call, str]] = []

    def walk(node: ast.AST, scope: str) -> None:
        for child in ast.iter_child_nodes(node):
            inner = child.name if isinstance(child, (ast.FunctionDef, ast.AsyncFunctionDef)) else scope
            if (
                isinstance(child, ast.Call)
                and isinstance(child.func, ast.Attribute)
                and child.func.attr == "complete_json"
            ):
                found.append((child, scope))
            walk(child, inner)

    walk(tree, "<module>")
    return found


class ExpectedKeysScanTests(unittest.TestCase):
    def test_every_complete_json_call_names_expected_keys(self) -> None:
        scanned = 0
        missing: list[str] = []
        for path in _production_modules():
            rel = path.relative_to(_PIPELINE).as_posix()
            tree = ast.parse(path.read_text(encoding="utf-8"), filename=str(path))
            for call, scope in _calls(tree):
                if (rel, scope) in _WAIVED:
                    continue
                scanned += 1
                named = {kw.arg for kw in call.keywords}
                if "expected_keys" not in named and None not in named:
                    missing.append(f"{rel}:{call.lineno} (in {scope}())")
        # Anti-vacuity: a scan that found nothing would pass while proving nothing.
        self.assertGreaterEqual(scanned, 5, f"only {scanned} complete_json call sites scanned")
        self.assertEqual(
            missing,
            [],
            "these complete_json calls do not pin the answer object by shape — pass "
            "expected_keys=(...) naming the key(s) the coercer reads: " + ", ".join(missing),
        )

    def test_the_waiver_table_still_describes_real_call_sites(self) -> None:
        """A waiver for a call that no longer exists is a rule nobody is following."""
        live = set()
        for path in _production_modules():
            rel = path.relative_to(_PIPELINE).as_posix()
            tree = ast.parse(path.read_text(encoding="utf-8"), filename=str(path))
            for _call, scope in _calls(tree):
                live.add((rel, scope))
        for key, reason in _WAIVED.items():
            self.assertIn(key, live, f"stale waiver {key} ({reason})")


if __name__ == "__main__":
    unittest.main()
