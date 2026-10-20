"""The probe-strength threshold is enforced in TWO languages — pin them together.

``app/_lib/devcase-probe-audit.ts`` BLOCKS a case approval when a cover probe's
``decisionSpace`` admits fewer than ``MIN_PROBE_DECISION_OPTIONS`` distinct defensible
options: a probe with one answer cannot separate a strong submission from a naive one,
and shipping such a case wastes a candidate's evening on a take-home that measures
nothing. Until this pass the Python half of the same doctrine — ``lifecycle_eval``'s
design-health validator — never read ``decisionSpace`` AT ALL, and ``design.coerce``
called it "best-effort". So the health eval reported a clean landscape for exactly the
cases the product would refuse to publish, and nothing compared the two readings.

Now ``design.MIN_PROBE_DECISION_OPTIONS`` is the Python mirror, ``lifecycle_eval``
validates against it, and this file is the gate that keeps the two numbers equal.

The TS number is no longer typed a second time: ``pipeline/jobfit/codegen.py``
(``CONTRACT_CONSTANTS``) renders it from ``design.MIN_PROBE_DECISION_OPTIONS`` into
``app/_lib/contract-constants.generated.ts`` and the audit module re-exports it. This
file pins that door (the codegen row reads THIS constant, the committed generated file
declares its value, the TS module re-exports it and declares no literal) and keeps the
behavioural probes that prove the Python validator actually reads the constant.
"""

from __future__ import annotations

import unittest
from pathlib import Path

from pipeline.jobfit import codegen
from pipeline.jobfit.devcase import lifecycle_eval
from pipeline.jobfit.devcase.design import MIN_PROBE_DECISION_OPTIONS
from pipeline.jobfit.tests.test_codegen_contract_constants import home_problems

REPO_ROOT = Path(__file__).resolve().parents[3]
PROBE_AUDIT_TS = REPO_ROOT / "app" / "_lib" / "devcase-probe-audit.ts"

# TS constant -> the Python value it must equal.
MIRRORED: dict[str, int] = {"MIN_PROBE_DECISION_OPTIONS": MIN_PROBE_DECISION_OPTIONS}


class ProbeThresholdSyncTest(unittest.TestCase):
    def setUp(self) -> None:
        self.assertTrue(PROBE_AUDIT_TS.exists(), f"missing {PROBE_AUDIT_TS}")
        self.source = PROBE_AUDIT_TS.read_text(encoding="utf-8")

    def test_the_threshold_matches_across_the_language_boundary(self) -> None:
        rows = {row.ts_name: row for row in codegen.CONTRACT_CONSTANTS}
        generated = codegen.CONTRACT_OUTPUT.read_text(encoding="utf-8")
        for name, python_value in MIRRORED.items():
            with self.subTest(constant=name):
                self.assertIn(name, rows, f"{name} is not a codegen CONTRACT_CONSTANTS row")
                self.assertEqual(rows[name].ts_home, PROBE_AUDIT_TS.name)
                self.assertEqual(
                    codegen.resolve_contract_constant(rows[name]),
                    python_value,
                    f"codegen reads {name} from {rows[name].source()}, not from "
                    "pipeline/jobfit/devcase/design.py. A case the approve gate blocks would "
                    "pass the design-health eval (or the reverse).",
                )
                self.assertIn(f"\nexport const {name} = {python_value};\n", generated)
                self.assertEqual(home_problems(self.source, name), [])

    def test_the_python_validator_actually_reads_the_constant(self) -> None:
        """Mutation guard: equal numbers are worthless if the Python side ignores them.

        Mirrored at the TS BLOCKING rule (``enforceProbeGate``): a case where NO probe
        reaches the threshold is flagged, a case whose probes reach it is not — so the
        check is bound to the constant, not merely declared beside it. (The rubric /
        tasks / timebox fields are filled so the only issue this case can raise is the
        probe one.)
        """
        rubric = [{"name": n, "weight": 1.0 / len(lifecycle_eval.RUBRIC_NAMES)} for n in lifecycle_eval.RUBRIC_NAMES]

        def case_with(options: list[str]) -> dict:
            return {
                "coverProbes": [
                    {"id": "p1", "kind": "ambiguity", "where": "brief", "reveals": "r", "decisionSpace": list(options)},
                    {"id": "p2", "kind": "legacy_trap", "where": "old.py", "reveals": "r", "decisionSpace": list(options)},
                ],
                "rubricDimensions": rubric,
                "tasks": ["t"],
                "timeboxHours": 4,
            }

        at_threshold = [f"option {i}" for i in range(MIN_PROBE_DECISION_OPTIONS)]
        one_short = at_threshold[:-1]
        # Not stricter than the gate: ONE load-bearing probe is enough to clear it.
        mixed = {
            "coverProbes": [
                {"id": "p1", "kind": "ambiguity", "where": "brief", "reveals": "r", "decisionSpace": at_threshold},
                {"id": "p2", "kind": "legacy_trap", "where": "old.py", "reveals": "r", "decisionSpace": one_short},
            ],
            "rubricDimensions": rubric,
            "tasks": ["t"],
            "timeboxHours": 4,
        }
        self.assertEqual(lifecycle_eval._check_case(mixed, None), [])
        self.assertEqual(lifecycle_eval._check_case(case_with(at_threshold), None), [])
        self.assertIn(
            "case: no load-bearing probe (decisionSpace forces no choice)",
            lifecycle_eval._check_case(case_with(one_short), None),
        )

    def test_blank_and_duplicate_options_do_not_count(self) -> None:
        """The TS side dedupes on trim+casefold before comparing; so must this one, or a
        probe listing the same answer twice passes here and is blocked at approval."""
        rubric = [{"name": n, "weight": 1.0 / len(lifecycle_eval.RUBRIC_NAMES)} for n in lifecycle_eval.RUBRIC_NAMES]
        case = {
            "coverProbes": [{"id": "p1", "kind": "ambiguity", "where": "b", "reveals": "r", "decisionSpace": ["Ship it", "  ship IT  ", "   "]}],
            "rubricDimensions": rubric,
            "tasks": ["t"],
            "timeboxHours": 4,
        }
        # "Ship it" twice + a blank is ONE option, so no probe is load-bearing. (<2 probes
        # is a separate, expected issue here — assert on the probe-strength one.)
        self.assertIn("case: no load-bearing probe (decisionSpace forces no choice)", lifecycle_eval._check_case(case, None))

    def test_extractor_rejects_a_documented_value(self) -> None:
        # A literal named only in prose does not count against the home; a real one does.
        reexport = 'import { MIN_PROBE_DECISION_OPTIONS } from "./contract-constants.generated";\nexport { MIN_PROBE_DECISION_OPTIONS };\n'
        self.assertEqual(home_problems("// export const MIN_PROBE_DECISION_OPTIONS = 1;\n" + reexport, "MIN_PROBE_DECISION_OPTIONS"), [])
        self.assertNotEqual(home_problems("export const MIN_PROBE_DECISION_OPTIONS = 7;\n", "MIN_PROBE_DECISION_OPTIONS"), [])


if __name__ == "__main__":
    unittest.main()
