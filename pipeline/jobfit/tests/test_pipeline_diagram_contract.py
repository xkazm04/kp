import re
import unittest
from pathlib import Path

# Makes the implicit .puml <-> TypeScript coupling explicit and CI-guarded.
#
# PipelineExplorer looks up STEP_DETAILS[node.id], where node.id is the `as <alias>`
# of a node in docs/diagrams/15-automated-pipeline-tobe.puml. If a diagram alias is
# renamed/removed, the step click silently no-ops with zero error. This test fails
# the build when a STEP_DETAILS key has no matching diagram node, so the breakage is
# caught at CI time instead of by a user clicking a dead step. (The reverse direction
# — a clickable node with no STEP_DETAILS — is surfaced as a dev-mode console warning
# in PipelineExplorer, since "clickable" can't be told from the .puml text alone.)

_ROOT = Path(__file__).resolve().parents[3]
_PUML = _ROOT / "docs" / "diagrams" / "15-automated-pipeline-tobe.puml"
_STEPS_TS = _ROOT / "app" / "diagrams" / "pipelineSteps.ts"


def _puml_aliases(text: str) -> set[str]:
    # Matches `... as jd`, `... as ingest`, etc.
    return set(re.findall(r"\bas\s+([A-Za-z_][A-Za-z0-9_]*)", text))


def _step_detail_keys(text: str) -> set[str]:
    body = text.split("export const STEP_DETAILS", 1)
    assert len(body) == 2, "STEP_DETAILS declaration not found in pipelineSteps.ts"
    # Top-level keys are 2-space indented `key: {` entries within the object.
    return set(re.findall(r"^  ([A-Za-z_][A-Za-z0-9_]*):\s*\{", body[1], re.MULTILINE))


class PipelineDiagramContractTest(unittest.TestCase):
    def test_every_step_detail_key_has_a_diagram_node(self) -> None:
        aliases = _puml_aliases(_PUML.read_text(encoding="utf-8"))
        keys = _step_detail_keys(_STEPS_TS.read_text(encoding="utf-8"))
        self.assertTrue(keys, "expected STEP_DETAILS to define at least one step")
        orphaned = sorted(keys - aliases)
        self.assertEqual(
            orphaned,
            [],
            f"STEP_DETAILS key(s) {orphaned} have no matching `as <alias>` node in "
            f"{_PUML.name} — a click handler points at a step the diagram dropped.",
        )


if __name__ == "__main__":
    unittest.main()
