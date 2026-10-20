"""The contract numbers both languages enforce are GENERATED, not typed twice.

``codegen.CONTRACT_CONSTANTS`` names, for each number, the Python value behind it
and the ``app/_lib`` module that exposes it to TypeScript. ``render_contract_constants``
reads those values at render time into ``app/_lib/contract-constants.generated.ts``,
and each TS home module re-exports the generated name instead of declaring its own
literal. This file pins the door from both ends:

  * the renderer emits exactly one line per row, with the value READ from Python
    (patch the Python value and the output follows — nothing is copied into the
    generator), and refuses a row whose Python source does not exist;
  * the committed generated file equals the renderer byte-for-byte. CI never runs
    ``schemas:check``; ``npm run typecheck`` regenerates silently, so without this
    test a stale committed file would ship. ``test:python:gate`` runs this file;
  * ``--check`` reports the contract file by name when it is stale;
  * every TS home re-exports its names from the generated module and declares no
    literal of its own, so a hand-typed number cannot come back unnoticed;
  * the generated file imports nothing (some homes sit on client component graphs).
"""

from __future__ import annotations

import io
import re
import tempfile
import unittest
from contextlib import redirect_stderr
from pathlib import Path
from unittest import mock

from pipeline.jobfit import automation, codegen

REPO_ROOT = Path(__file__).resolve().parents[3]
LIB = REPO_ROOT / "app" / "_lib"
GENERATED_REL = "app/_lib/contract-constants.generated.ts"
GENERATED_SPECIFIER = "./contract-constants.generated.ts"

EXPECTED_NAMES = {
    "MAX_SCORECARD_NOTES_CHARS",
    "SCREEN_VOLUME_SPARSE_MAX",
    "SCREEN_VOLUME_MODERATE_MAX",
    "MIN_CALIBRATION_OUTCOMES",
    "CALIBRATION_BIN_COUNT",
    "KIT_MAX_COMPETENCIES",
    "KIT_MAX_QUESTIONS_PER_COMPETENCY",
    "KIT_MAX_MUST_ASKS",
    "KIT_MAX_FAQ",
    "LETTER_MAX_CHARS",
    "MIN_PROBE_DECISION_OPTIONS",
}


def strip_ts_comments(text: str) -> str:
    """Drop // line and /* */ block comments — the homes NAME their constants in prose."""
    text = re.sub(r"/\*.*?\*/", "", text, flags=re.DOTALL)
    return re.sub(r"//[^\n]*", "", text)


def home_problems(source: str, name: str) -> list[str]:
    """Why ``source`` (a TS home module) does not correctly re-export ``name`` from the
    generated file. Empty when it does. Shared by the per-area sync tests."""
    code = strip_ts_comments(source)
    problems: list[str] = []
    if re.search(rf"\bconst\s+{re.escape(name)}\s*[:=]", code):
        problems.append(f"declares its own `const {name}` — re-export the generated value instead")
    spec = r"""["']\./contract-constants\.generated(?:\.ts)?["']"""
    imported = re.search(rf"\bimport\s*\{{[^}}]*\b{re.escape(name)}\b[^}}]*\}}\s*from\s*{spec}", code)
    reexported_from = re.search(rf"\bexport\s*\{{[^}}]*\b{re.escape(name)}\b[^}}]*\}}\s*from\s*{spec}", code)
    exported = re.search(rf"\bexport\s*\{{[^}}]*\b{re.escape(name)}\b[^}}]*\}}\s*;", code)
    if not (reexported_from or (imported and exported)):
        problems.append(f"does not re-export {name} from {GENERATED_SPECIFIER}")
    return problems


class RenderContractConstantsTest(unittest.TestCase):
    def test_every_row_renders_exactly_one_line_with_the_python_value(self) -> None:
        text = codegen.render_contract_constants()
        self.assertEqual({row.ts_name for row in codegen.CONTRACT_CONSTANTS}, EXPECTED_NAMES)
        for row in codegen.CONTRACT_CONSTANTS:
            with self.subTest(constant=row.ts_name):
                declarations = re.findall(rf"^export const {row.ts_name} = (\d+);$", text, flags=re.MULTILINE)
                self.assertEqual(declarations, [str(codegen.resolve_contract_constant(row))])

    def test_the_value_is_read_from_python_at_render_time(self) -> None:
        with mock.patch.object(automation, "KIT_MAX_FAQ", 13):
            text = codegen.render_contract_constants()
        self.assertIn("export const KIT_MAX_FAQ = 13;\n", text)
        with mock.patch.dict(automation.POLICY, {"screen_volume_sparse_max": 7}):
            text = codegen.render_contract_constants()
        self.assertIn("export const SCREEN_VOLUME_SPARSE_MAX = 7;\n", text)

    def test_a_row_naming_a_missing_python_source_raises(self) -> None:
        bad_attr = codegen.ContractConstant("NOPE", "calibration.ts", "automation", "NO_SUCH_CONSTANT")
        with mock.patch.object(codegen, "CONTRACT_CONSTANTS", codegen.CONTRACT_CONSTANTS + (bad_attr,)):
            with self.assertRaisesRegex(AttributeError, "NOPE"):
                codegen.render_contract_constants()
        bad_key = codegen.ContractConstant("NOPE_KEY", "calibration.ts", "automation", "POLICY", "no_such_key")
        with mock.patch.object(codegen, "CONTRACT_CONSTANTS", (bad_key,)):
            with self.assertRaisesRegex(AssertionError, "NOPE_KEY"):
                codegen.render_contract_constants()
        not_int = codegen.ContractConstant("NOT_INT", "calibration.ts", "calibration_drift", "BRIER_DEGRADATION_ALERT")
        with mock.patch.object(codegen, "CONTRACT_CONSTANTS", (not_int,)):
            with self.assertRaisesRegex(AssertionError, "NOT_INT"):
                codegen.render_contract_constants()

    def test_the_generated_file_imports_nothing(self) -> None:
        self.assertNotRegex(strip_ts_comments(codegen.render_contract_constants()), r"\bimport\b|\brequire\s*\(")


class CommittedContractFileTest(unittest.TestCase):
    def test_the_committed_file_is_fresh(self) -> None:
        path = REPO_ROOT / GENERATED_REL
        self.assertTrue(path.exists(), f"missing {GENERATED_REL} — run `python -m pipeline.jobfit.codegen`")
        self.assertEqual(
            path.read_text(encoding="utf-8"),
            codegen.render_contract_constants(),
            f"{GENERATED_REL} is stale — run `python -m pipeline.jobfit.codegen` and commit it",
        )

    def test_the_contract_file_is_a_generated_output(self) -> None:
        self.assertIn((codegen.CONTRACT_OUTPUT, codegen.render_contract_constants), codegen._GENERATED)
        self.assertEqual(codegen.CONTRACT_OUTPUT, REPO_ROOT / GENERATED_REL)

    def test_check_names_a_hand_edited_contract_file(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            edited = root / GENERATED_REL
            edited.parent.mkdir(parents=True)
            edited.write_text(
                codegen.render_contract_constants().replace(
                    f"export const KIT_MAX_FAQ = {automation.KIT_MAX_FAQ};", "export const KIT_MAX_FAQ = 99;"
                ),
                encoding="utf-8",
            )
            err = io.StringIO()
            with (
                mock.patch.object(codegen, "ROOT", root),
                mock.patch.object(codegen, "_GENERATED", ((edited, codegen.render_contract_constants),)),
                redirect_stderr(err),
            ):
                self.assertEqual(codegen.main(["--check"]), 1)
                self.assertIn(GENERATED_REL, err.getvalue())
                # And the unedited file passes, so the exit above is the edit's.
                edited.write_text(codegen.render_contract_constants(), encoding="utf-8")
                self.assertEqual(codegen.main(["--check"]), 0)


class TsHomesReexportTest(unittest.TestCase):
    def test_every_home_reexports_and_declares_no_literal(self) -> None:
        for row in codegen.CONTRACT_CONSTANTS:
            with self.subTest(constant=row.ts_name, home=row.ts_home):
                home = LIB / row.ts_home
                self.assertTrue(home.exists(), f"missing {home}")
                self.assertEqual(home_problems(home.read_text(encoding="utf-8"), row.ts_name), [])

    def test_the_checker_catches_a_hand_typed_literal(self) -> None:
        # Mutation guard for the guard: prose naming the literal does not count, a real
        # declaration does, and each of the two re-export shapes is accepted.
        good_import = 'import { KIT_MAX_FAQ } from "./contract-constants.generated";\nexport { KIT_MAX_FAQ };\n'
        good_from = 'export { KIT_MAX_FAQ, KIT_MAX_MUST_ASKS } from "./contract-constants.generated";\n'
        self.assertEqual(home_problems(good_import, "KIT_MAX_FAQ"), [])
        self.assertEqual(home_problems(good_from, "KIT_MAX_FAQ"), [])
        self.assertEqual(home_problems("// export const KIT_MAX_FAQ = 12;\n" + good_from, "KIT_MAX_FAQ"), [])
        self.assertNotEqual(home_problems("export const KIT_MAX_FAQ = 12;\n", "KIT_MAX_FAQ"), [])
        self.assertNotEqual(home_problems(good_from + "const KIT_MAX_FAQ = 12;\n", "KIT_MAX_FAQ"), [])
        # Imported but never exported: consumers of the home would lose the name.
        self.assertNotEqual(
            home_problems('import { KIT_MAX_FAQ } from "./contract-constants.generated";\n', "KIT_MAX_FAQ"), []
        )


if __name__ == "__main__":
    unittest.main()
