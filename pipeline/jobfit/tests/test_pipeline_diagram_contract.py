import re
import unittest
from pathlib import Path

# Makes the implicit .puml <-> TypeScript coupling explicit and CI-guarded.
#
# PipelineExplorer looks up STEP_DETAILS[node.id], where node.id is the `as <alias>`
# of a node in docs/diagrams/15-automated-pipeline-tobe.puml. If a diagram alias is
# renamed/removed, the step click silently no-ops with zero error, and the reverse
# — a clickable step node with no STEP_DETAILS — also no-ops. This test fails the
# build on EITHER break, so both are caught at CI time instead of by a user clicking
# a dead step.
#
# bug-ui-scan-2026-07-09 (pipeline-test-suite-python #4): the old test was
# one-directional and its two regexes could each mask a real drift —
#   * `_puml_aliases` harvested EVERY `\bas\s+X`, so prose like "...as ingest..."
#     or the `actor "Recruiter" as rec` injected phantom aliases that could mask a
#     genuinely orphaned key; and
#   * `_step_detail_keys` matched only `^  key: {` (exactly 2-space indent, brace on
#     the same line, unquoted key), so a reformat or a quoted key silently shrank
#     the checked set, and the `assertTrue(keys)` guard caught only a TOTAL miss.
# This anchors alias parsing to actual STEP nodes (a rectangle `[...] as X`, not the
# actor and not prose), parses top-level keys by brace depth (robust to indent,
# quoting, and nested/template content), and asserts BOTH directions.

_ROOT = Path(__file__).resolve().parents[3]
_PUML = _ROOT / "docs" / "diagrams" / "15-automated-pipeline-tobe.puml"
_STEPS_TS = _ROOT / "app" / "diagrams" / "pipelineSteps.ts"

_IDENT_FULL = re.compile(r"[A-Za-z_][A-Za-z0-9_]*\Z")


def _puml_node_aliases(text: str) -> set[str]:
    """Aliases of clickable STEP nodes only — a rectangle ``[...] <<stereo>> as X``.

    Anchoring the ``as`` to a preceding ``]`` (the close of a rectangle node)
    excludes the ``actor "Recruiter" as rec`` line and any prose ``...as word...``,
    which the old ``\\bas\\s+X`` harvest wrongly counted as diagram nodes.
    """
    return set(re.findall(r"\][ \t]*(?:<<[^>]*>>[ \t]*)?as\s+([A-Za-z_][A-Za-z0-9_]*)", text))


def _step_detail_keys(text: str) -> set[str]:
    """Top-level keys of the STEP_DETAILS object literal.

    Parsed by brace depth (not a fixed-indent regex) so a reformat, a quoted key,
    or template/nested content can neither shrink nor inflate the checked set. Only
    keys at object depth 1 are returned; strings and backtick templates are consumed
    wholesale, so a ``key: {`` sitting inside a puml template string is ignored.
    """
    marker = "export const STEP_DETAILS"
    start = text.find(marker)
    assert start != -1, "STEP_DETAILS declaration not found in pipelineSteps.ts"
    brace = text.find("{", start)
    assert brace != -1, "STEP_DETAILS object literal opening brace not found"

    keys: set[str] = set()
    depth = 0
    i, n = brace, len(text)
    while i < n:
        ch = text[i]
        if ch in "\"'`":
            # Consume the entire string / template literal (respecting \ escapes).
            quote = ch
            j = i + 1
            while j < n:
                c = text[j]
                if c == "\\":
                    j += 2
                    continue
                if c == quote:
                    break
                j += 1
            content = text[i + 1 : j]
            i = j + 1
            # A quoted top-level key: "foo": { ...
            if depth == 1 and quote in "\"'" and _IDENT_FULL.match(content):
                m = i
                while m < n and text[m] in " \t\r\n":
                    m += 1
                if m < n and text[m] == ":":
                    keys.add(content)
            continue
        if ch == "{":
            depth += 1
            i += 1
            continue
        if ch == "}":
            depth -= 1
            i += 1
            if depth == 0:
                break
            continue
        if depth == 1 and (ch.isalpha() or ch == "_"):
            # An unquoted top-level key: foo: ...
            j = i + 1
            while j < n and (text[j].isalnum() or text[j] == "_"):
                j += 1
            ident = text[i:j]
            m = j
            while m < n and text[m] in " \t\r\n":
                m += 1
            i = j
            if m < n and text[m] == ":":
                keys.add(ident)
            continue
        i += 1
    return keys


class PipelineDiagramContractTest(unittest.TestCase):
    def test_step_details_and_diagram_nodes_are_in_bijection(self) -> None:
        aliases = _puml_node_aliases(_PUML.read_text(encoding="utf-8"))
        keys = _step_detail_keys(_STEPS_TS.read_text(encoding="utf-8"))
        self.assertTrue(keys, "expected STEP_DETAILS to define at least one step")
        self.assertTrue(aliases, "expected the .puml to define at least one step node")

        orphaned_keys = sorted(keys - aliases)
        self.assertEqual(
            orphaned_keys,
            [],
            f"STEP_DETAILS key(s) {orphaned_keys} have no matching `[...] as <alias>` node in "
            f"{_PUML.name} — a click handler points at a step the diagram dropped.",
        )
        orphaned_nodes = sorted(aliases - keys)
        self.assertEqual(
            orphaned_nodes,
            [],
            f"diagram step node(s) {orphaned_nodes} have no STEP_DETAILS entry — clicking "
            f"them silently no-ops. Add an entry in {_STEPS_TS.name} or drop the node.",
        )


class DiagramParsingHelpersTest(unittest.TestCase):
    """Non-vacuous guards for the two parsers (#4): synthetic inputs prove the exact
    behaviours the old regexes got wrong."""

    def test_node_aliases_ignore_prose_and_actors(self) -> None:
        puml = (
            'actor "Recruiter" as rec\n'
            "[Do a thing] <<auto>> as work\n"
            "[Plain node] as bare\n"
            "note over rec: we pipe data as ingest downstream\n"
        )
        # Only the two rectangle nodes — NOT the actor `rec`, NOT the prose `ingest`.
        self.assertEqual(_puml_node_aliases(puml), {"work", "bare"})

    def test_step_detail_keys_tolerate_quotes_indent_and_templates(self) -> None:
        ts = (
            "export const STEP_DETAILS = {\n"
            "      alpha: {\n"
            '        title: "x",\n'
            "      },\n"
            '  "beta": {\n'
            "    puml: `phantom: { not a key }`,\n"
            "  },\n"
            "};\n"
        )
        # `alpha` (odd indent) + `beta` (quoted); NOT nested `title`/`puml`, NOT the
        # `phantom: {` living inside the backtick template.
        self.assertEqual(_step_detail_keys(ts), {"alpha", "beta"})


if __name__ == "__main__":
    unittest.main()
