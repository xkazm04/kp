"""Cross-language lockstep for the pipeline stage vocabulary.

The board's five columns are declared in TypeScript — ``PIPELINE_STAGES`` in
``app/_lib/pipeline-stages.ts``, with ``STAGE_ROLE`` giving each one its meaning —
and the Python side both SEEDS rows into that axis (``seed_pipeline.STAGES``) and
DECIDES moves along it (``automation.decide_policy`` returns a target stage name
that TypeScript writes straight into ``pipeline_entries.stage``).

Until now that agreement was pinned in one direction only: TypeScript tests read
the TypeScript literal, Python tests read the Python literal, and nothing compared
them. The failure that hides in the gap is silent and expensive — Python answering
`advance` to a stage name the board does not render leaves a candidate in a column
that exists in no UI, with no error anywhere, because the stage column is free text
in SQLite. It is not hypothetical: this repo has already renamed the axis once
(Sourced -> Accepted, AI-matched/Screening -> Screened, migrated on boot by
``migratePipelineStages()``), and a rename is exactly the change that would have
left one language behind.

So this module reads the TS source as data and asserts three things:

  1. ``seed_pipeline.STAGES`` is the TS ``PIPELINE_STAGES`` list, IN ORDER;
  2. every stage ``automation.py`` can advance a candidate INTO is on that list;
  3. every stage ``seed_pipeline.FUNNEL`` places a seeded row at is on it too.

FAIL-FIRST EVIDENCE (2026-09-05): editing the TS literal's "Screened" to
"Screening" turns 1, 2 and 3 red with the diff named; reverting it turns them
green. The regex reads a normalised copy of the file (this checkout is CRLF, the
worktree may be LF), so it cannot pass in one tree and fail in the other.
"""

from __future__ import annotations

import ast
import re
import unittest
from pathlib import Path

from pipeline.jobfit import automation, seed_pipeline

REPO_ROOT = Path(__file__).resolve().parents[3]
STAGES_TS = REPO_ROOT / "app" / "_lib" / "pipeline-stages.ts"
AUTOMATION_PY = Path(automation.__file__)

# `export const PIPELINE_STAGES = [ … ] as const;` — the ONE literal both the board
# and the Settings composer read. Matched non-greedily to the first `]` so a later
# array in the file cannot be swallowed.
_TS_STAGES = re.compile(r"export const PIPELINE_STAGES\s*=\s*\[(.*?)\]\s*as const", re.S)
_TS_STRING = re.compile(r"""["']([^"']+)["']""")


def _ts_source() -> str:
    """The TS file with line endings normalised — CRLF here, LF in a worktree."""
    return STAGES_TS.read_text(encoding="utf-8").replace("\r\n", "\n")


def ts_pipeline_stages() -> list[str]:
    match = _TS_STAGES.search(_ts_source())
    if not match:
        raise AssertionError(
            f"could not find `export const PIPELINE_STAGES = [...] as const` in {STAGES_TS}. "
            "If the axis moved or was renamed, this test must move with it — deleting the "
            "assertion re-opens the drift it exists to catch."
        )
    return _TS_STRING.findall(match.group(1))


def automation_advance_targets() -> set[str]:
    """Every literal stage `automation.py` can advance INTO, harvested from the AST.

    The decision helper is `out(action, to_stage, reason)`; an advance is the only
    action that names a destination, so the set is the second argument of every
    `out("advance", ...)` call. Read from the syntax tree rather than by regex so a
    reformatting (or a reason string that happens to contain the word) cannot
    change the answer.
    """
    tree = ast.parse(AUTOMATION_PY.read_text(encoding="utf-8").replace("\r\n", "\n"))
    targets: set[str] = set()
    for node in ast.walk(tree):
        if not isinstance(node, ast.Call) or getattr(node.func, "id", None) != "out":
            continue
        if len(node.args) < 2:
            continue
        action, destination = node.args[0], node.args[1]
        if isinstance(action, ast.Constant) and action.value == "advance":
            if isinstance(destination, ast.Constant) and isinstance(destination.value, str):
                targets.add(destination.value)
    return targets


class PipelineStageVocabularyTest(unittest.TestCase):
    def test_seed_stage_tuple_matches_the_typescript_axis_in_order(self) -> None:
        self.assertEqual(
            list(seed_pipeline.STAGES),
            ts_pipeline_stages(),
            "seed_pipeline.STAGES has drifted from PIPELINE_STAGES in "
            "app/_lib/pipeline-stages.ts. Order is part of the contract: the funnel "
            "metric and the org benchmarks both index off position, so a reorder is a "
            "different question silently answered.",
        )

    def test_automation_advances_only_into_stages_the_board_renders(self) -> None:
        stages = set(ts_pipeline_stages())
        targets = automation_advance_targets()
        self.assertTrue(targets, "harvested no advance targets — the AST walk is broken, not the code")
        unknown = sorted(targets - stages)
        self.assertEqual(
            unknown,
            [],
            f"automation.py advances candidates into {unknown}, which app/_lib/pipeline-stages.ts "
            "does not declare. `pipeline_entries.stage` is free text, so this does not raise "
            "anywhere — the candidate lands in a column no UI renders.",
        )

    def test_seeded_funnel_only_places_rows_on_declared_stages(self) -> None:
        stages = set(ts_pipeline_stages())
        unknown = sorted(set(seed_pipeline.FUNNEL) - stages)
        self.assertEqual(
            unknown,
            [],
            f"seed_pipeline.FUNNEL seeds demo rows at {unknown}, which the TS axis does not "
            "declare — a fresh install would open on a board with candidates off it.",
        )

    def test_every_declared_stage_has_a_role_on_the_typescript_side(self) -> None:
        # The roles are what survives a workspace renaming a column, so a stage added
        # to the axis without one is the change this pins: TS makes it a compile error
        # (STAGE_ROLE is Record<PipelineStage, StageRole>), and Python asserts the same
        # fact from the outside, so the pair cannot be half-updated in a Python-first
        # change that touches the axis.
        source = _ts_source()
        role_block = re.search(r"export const STAGE_ROLE[^=]*=\s*\{(.*?)\n\}", source, re.S)
        self.assertIsNotNone(role_block, "STAGE_ROLE literal not found in pipeline-stages.ts")
        roled = set(re.findall(r"^\s*(\w+)\s*:", role_block.group(1), re.M))
        self.assertEqual(
            sorted(roled),
            sorted(ts_pipeline_stages()),
            "STAGE_ROLE and PIPELINE_STAGES name different stages.",
        )


if __name__ == "__main__":
    unittest.main()
