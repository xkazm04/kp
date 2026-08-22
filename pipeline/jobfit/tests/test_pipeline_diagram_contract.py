import glob
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


def _step_detail_entries(text: str) -> list[tuple[str, str]]:
    """Top-level (key, raw value source) pairs of the STEP_DETAILS object literal.

    Parsed by brace depth (not a fixed-indent regex) so a reformat, a quoted key,
    or template/nested content can neither shrink nor inflate the checked set. Only
    keys at object depth 1 are returned; strings and backtick templates are consumed
    wholesale, so a ``key: {`` sitting inside a puml template string is ignored.

    The VALUE source is returned alongside the key so the honesty checks below can
    read each step's ``status`` / ``files`` without a second, weaker parser.
    """
    marker = "export const STEP_DETAILS"
    start = text.find(marker)
    assert start != -1, "STEP_DETAILS declaration not found in pipelineSteps.ts"
    brace = text.find("{", start)
    assert brace != -1, "STEP_DETAILS object literal opening brace not found"

    spans: list[list] = []  # [key, value_start, value_end]
    depth = 0
    i, n = brace, len(text)
    while i < n:
        ch = text[i]
        if ch in "\"'`":
            token_start = i
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
                    if spans:
                        spans[-1][2] = token_start
                    spans.append([content, m + 1, n])
            continue
        if ch == "{":
            depth += 1
            i += 1
            continue
        if ch == "}":
            depth -= 1
            i += 1
            if depth == 0:
                if spans:
                    spans[-1][2] = i
                break
            continue
        if depth == 1 and (ch.isalpha() or ch == "_"):
            # An unquoted top-level key: foo: ...
            token_start = i
            j = i + 1
            while j < n and (text[j].isalnum() or text[j] == "_"):
                j += 1
            ident = text[i:j]
            m = j
            while m < n and text[m] in " \t\r\n":
                m += 1
            i = j
            if m < n and text[m] == ":":
                if spans:
                    spans[-1][2] = token_start
                spans.append([ident, m + 1, n])
            continue
        i += 1
    return [(key, text[s:e]) for key, s, e in spans]


def _step_detail_keys(text: str) -> set[str]:
    """Top-level keys of the STEP_DETAILS object literal (see _step_detail_entries)."""
    return {key for key, _value in _step_detail_entries(text)}


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


# ---------------------------------------------------------------------------
# The key bijection above only proves a click LANDS somewhere. It says nothing
# about whether what the panel then SHOWS is true — which is the failure this
# explorer actually shipped: a fully-built subsystem rendered as an unbuilt gap.
# The two honesty invariants below are what the panel's content rests on:
#   * every file path a step cites resolves on disk (a moved module makes the
#     panel cite a file the reader cannot open), and
#   * the status is consistent with that evidence — a "live" step must point at
#     something that exists, and a step declared a "gap" must NOT be pointing at
#     a shipped subsystem.
# ---------------------------------------------------------------------------

_STATUS_RE = re.compile(r'\bstatus:\s*"([A-Za-z_]+)"')
_STATUS_UNION_RE = re.compile(r"export type StepStatus\s*=\s*([^;]+);")


def _declared_statuses(text: str) -> set[str]:
    m = _STATUS_UNION_RE.search(text)
    assert m, "StepStatus union not found in pipelineSteps.ts"
    return set(re.findall(r'"([A-Za-z_]+)"', m.group(1)))


def _cited_files(value_src: str) -> list[str]:
    r"""The path strings inside a step's ``files: [...]`` array.

    Scanned, not regexed: many citations are Next.js dynamic routes whose path
    CONTAINS brackets (``app/offer/[token]/page.tsx``), so a lazy ``\[(.*?)\]``
    terminates on the ``]`` of ``[token]`` and silently reports the step as citing
    no files at all — the exact way this check first went dark while looking green.
    """
    at = value_src.find("files:")
    if at == -1:
        return []
    start = value_src.find("[", at)
    if start == -1:
        return []
    items: list[str] = []
    depth = 0
    i, n = start, len(value_src)
    while i < n:
        ch = value_src[i]
        if ch in "\"'":
            quote = ch
            j = i + 1
            while j < n and value_src[j] != quote:
                j += 2 if value_src[j] == "\\" else 1
            # A citation may carry a human annotation — "pipeline/jobfit/automation.py
            # (evaluate_entry)" — which is not part of the path.
            items.append(value_src[i + 1 : j].split(" (")[0].strip())
            i = j + 1
            continue
        if ch == "[":
            depth += 1
        elif ch == "]":
            depth -= 1
            if depth == 0:
                break
        i += 1
    return [item for item in items if item]


def _resolves(pattern: str) -> bool:
    """Does this citation name something that exists in the repo?

    A literal path is checked literally FIRST. That ordering is load-bearing:
    ``fnmatch``/``glob`` read ``[token]`` as a character class, so the very paths
    this project cites most (Next.js dynamic routes) would match zero files and a
    naive glob-only check would call every one of them broken — the mirror image of
    the ``node --test '[id]'`` trap. Only a citation carrying real wildcard magic
    falls through to glob, and bracket runs are escaped to stay literal there too.
    """
    if (_ROOT / pattern).exists():
        return True
    if not any(ch in pattern for ch in "*?"):
        return False
    safe = pattern.replace("[", "[[]")  # glob.escape's bracket form
    return bool(glob.glob(str(_ROOT / safe)))


class StepDetailHonestyTest(unittest.TestCase):
    steps: dict[str, str]
    statuses: set[str]

    @classmethod
    def setUpClass(cls) -> None:
        text = _STEPS_TS.read_text(encoding="utf-8")
        cls.steps = dict(_step_detail_entries(text))
        cls.statuses = _declared_statuses(text)

    def test_the_citation_parser_survives_bracketed_route_paths(self) -> None:
        # The trap this check walked into on its first run: a Next.js dynamic route
        # path contains brackets, so a lazy regex stops inside `[token]` and reports
        # ZERO citations — a check that passes by seeing nothing.
        block = (
            '{ status: "live", '
            'files: ["app/offer/[token]/page.tsx", "app/_lib/offers-store.ts"], }'
        )
        self.assertEqual(
            _cited_files(block),
            ["app/offer/[token]/page.tsx", "app/_lib/offers-store.ts"],
        )
        # ...and the resolver must treat those brackets as literal path text, not as
        # a glob character class (which would match nothing and read as "missing").
        self.assertTrue(_resolves("app/offer/[token]/page.tsx"))
        self.assertFalse(_resolves("app/offer/[token]/does-not-exist.tsx"))

    def test_the_block_parser_reached_every_step(self) -> None:
        # Non-vacuity: if the value-span parse silently returned empty blocks, every
        # assertion below would pass over nothing. Each step must expose a status.
        self.assertTrue(self.steps, "no STEP_DETAILS entries parsed")
        self.assertTrue(self.statuses, "no StepStatus union values parsed")
        for key, value in self.steps.items():
            with self.subTest(step=key):
                self.assertIsNotNone(
                    _STATUS_RE.search(value), f"step {key!r}: no status parsed from its block"
                )

    def test_every_step_status_is_in_the_declared_union(self) -> None:
        for key, value in self.steps.items():
            with self.subTest(step=key):
                status = _STATUS_RE.search(value).group(1)
                self.assertIn(
                    status,
                    self.statuses,
                    f"step {key!r} has status {status!r}, not in StepStatus {sorted(self.statuses)}",
                )

    def test_every_cited_file_resolves_on_disk(self) -> None:
        checked = 0
        for key, value in self.steps.items():
            for pattern in _cited_files(value):
                checked += 1
                with self.subTest(step=key, path=pattern):
                    self.assertTrue(
                        _resolves(pattern),
                        f"step {key!r} cites {pattern!r}, which no longer exists — the "
                        "explorer panel points a reader at a file that was moved or renamed",
                    )
        self.assertGreater(checked, 0, "no file citations parsed — the check went dark")

    def test_a_live_step_points_at_something_that_exists(self) -> None:
        live = [k for k, v in self.steps.items() if _STATUS_RE.search(v).group(1) == "live"]
        self.assertTrue(live, "expected at least one step marked live")
        for key in live:
            with self.subTest(step=key):
                files = _cited_files(self.steps[key])
                self.assertTrue(files, f'step {key!r} is marked "live" but cites no file')

    def test_a_step_declared_a_gap_is_not_actually_shipped(self) -> None:
        """The batch-5 shape, inverted into a rule: a step the explorer renders as an
        unbuilt GAP must not cite shipped implementation files. Marking a delivered
        subsystem "gap" tells every reader of /diagrams the product is less complete
        than it is — and nothing else in this repo checks that claim."""
        for key, value in self.steps.items():
            if _STATUS_RE.search(value).group(1) != "gap":
                continue
            with self.subTest(step=key):
                shipped = [p for p in _cited_files(value) if _resolves(p)]
                self.assertEqual(
                    shipped,
                    [],
                    f'step {key!r} is rendered as an unbuilt "gap" yet cites shipped '
                    f"implementation {shipped} — either the status or the citation is a lie",
                )


if __name__ == "__main__":
    unittest.main()
