"""The fenced-block contract: what survives, what is dropped, and what the
operator is left holding either way.

The property under test is not "the parser understands good input" — it is that
a model which gets the schema slightly wrong costs the operator a table and
never the turn. So every malformed case below asserts three things at once: the
block is gone, the prose is intact, and the drop was COUNTED rather than
swallowed.
"""

from __future__ import annotations

import unittest

from pipeline.jobfit.companion_blocks import (
    MAX_BLOCKS,
    MAX_CHART_POINTS,
    MAX_TABLE_COLUMNS,
    MAX_TABLE_ROWS,
    split_reply_blocks,
)

TABLE_JSON = (
    '{"title": "Top candidates", "columns": [{"key": "name", "label": "Candidate"}, '
    '{"key": "fit", "label": "Fit"}], "rows": [{"name": "A. Novak", "fit": 82}, '
    '{"name": "J. Rimmer", "fit": "74"}]}'
)
CHART_JSON = (
    '{"title": "Pipeline by stage", "kind": "bar", "x": {"label": "Stage", '
    '"values": ["Screen", "Interview", "Offer"]}, "y": {"label": "Candidates"}, '
    '"series": [{"label": "Active", "values": [12, 5, 2]}]}'
)


def fenced(kind: str, body: str) -> str:
    return f"```kp:{kind}\n{body}\n```"


class SplitReplyBlocksTestCase(unittest.TestCase):
    def test_prose_only_is_untouched_and_yields_no_blocks(self):
        prose, blocks, dropped = split_reply_blocks("Four candidates are waiting on you.")
        self.assertEqual(prose, "Four candidates are waiting on you.")
        self.assertEqual(blocks, [])
        self.assertEqual(dropped, 0)

    def test_a_valid_table_is_parsed_and_its_fence_is_stripped(self):
        prose, blocks, dropped = split_reply_blocks(f"Three lead the role.\n\n{fenced('table', TABLE_JSON)}")
        self.assertEqual(prose, "Three lead the role.")
        self.assertEqual(dropped, 0)
        self.assertEqual(len(blocks), 1)
        block = blocks[0]
        self.assertEqual(block["type"], "table")
        self.assertEqual(block["title"], "Top candidates")
        self.assertEqual([c["key"] for c in block["columns"]], ["name", "fit"])
        # Cells are normalised to strings: a model writes a score as a number as
        # often as a string, and the renderer must not branch on which it got.
        self.assertEqual(block["rows"], [{"name": "A. Novak", "fit": "82"}, {"name": "J. Rimmer", "fit": "74"}])

    def test_a_valid_chart_is_parsed_with_its_kind_and_axes(self):
        prose, blocks, dropped = split_reply_blocks(f"{fenced('chart', CHART_JSON)}\n\nScreen is the bottleneck.")
        self.assertEqual(prose, "Screen is the bottleneck.")
        self.assertEqual(dropped, 0)
        block = blocks[0]
        self.assertEqual(block["type"], "chart")
        self.assertEqual(block["kind"], "bar")
        self.assertEqual(block["x"], {"label": "Stage", "values": ["Screen", "Interview", "Offer"]})
        self.assertEqual(block["y"], {"label": "Candidates"})
        self.assertEqual(block["series"], [{"label": "Active", "values": [12.0, 5.0, 2.0]}])

    def test_a_block_on_the_info_line_parses_too(self):
        # Real completions put the JSON on the fence line about as often as below it.
        prose, blocks, dropped = split_reply_blocks(f"```kp:table {TABLE_JSON}```")
        self.assertEqual(len(blocks), 1)
        self.assertEqual(dropped, 0)
        self.assertEqual(prose, "")

    def test_malformed_json_is_dropped_counted_and_leaves_the_prose(self):
        prose, blocks, dropped = split_reply_blocks(
            f"Here is the board.\n\n{fenced('table', '{not json at all,,,')}\n\nAsk me for more."
        )
        self.assertEqual(blocks, [])
        self.assertEqual(dropped, 1)
        self.assertEqual(prose, "Here is the board.\n\nAsk me for more.")

    def test_a_table_with_no_columns_is_dropped(self):
        _, blocks, dropped = split_reply_blocks(fenced("table", '{"columns": [], "rows": [{"a": 1}]}'))
        self.assertEqual(blocks, [])
        self.assertEqual(dropped, 1)

    def test_a_chart_with_an_unknown_kind_is_dropped(self):
        body = CHART_JSON.replace('"kind": "bar"', '"kind": "sankey"')
        _, blocks, dropped = split_reply_blocks(fenced("chart", body))
        self.assertEqual(blocks, [])
        self.assertEqual(dropped, 1)

    def test_a_chart_series_holding_a_non_number_is_dropped(self):
        body = CHART_JSON.replace("[12, 5, 2]", '[12, "five", 2]')
        _, blocks, dropped = split_reply_blocks(fenced("chart", body))
        self.assertEqual(blocks, [])
        self.assertEqual(dropped, 1)

    def test_an_unterminated_fence_never_leaks_raw_json_at_the_operator(self):
        prose, blocks, dropped = split_reply_blocks(f"Here it is.\n\n```kp:chart\n{CHART_JSON[:40]}")
        self.assertEqual(prose, "Here it is.")
        self.assertEqual(blocks, [])
        self.assertEqual(dropped, 1)

    # ---- caps are structural, not advisory --------------------------------

    def test_columns_past_the_cap_are_truncated_not_dropped(self):
        columns = ", ".join(f'{{"key": "c{i}", "label": "C{i}"}}' for i in range(MAX_TABLE_COLUMNS + 3))
        row = ", ".join(f'"c{i}": {i}' for i in range(MAX_TABLE_COLUMNS + 3))
        _, blocks, dropped = split_reply_blocks(
            fenced("table", f'{{"columns": [{columns}], "rows": [{{{row}}}]}}')
        )
        self.assertEqual(dropped, 0)
        self.assertEqual(len(blocks[0]["columns"]), MAX_TABLE_COLUMNS)
        self.assertEqual(list(blocks[0]["rows"][0]), [f"c{i}" for i in range(MAX_TABLE_COLUMNS)])

    def test_rows_past_the_cap_are_truncated(self):
        rows = ", ".join(f'{{"name": "n{i}"}}' for i in range(MAX_TABLE_ROWS + 5))
        _, blocks, _ = split_reply_blocks(
            fenced("table", f'{{"columns": [{{"key": "name", "label": "Name"}}], "rows": [{rows}]}}')
        )
        self.assertEqual(len(blocks[0]["rows"]), MAX_TABLE_ROWS)

    def test_a_chart_is_truncated_to_the_cap_and_series_stay_aligned(self):
        values = ", ".join(f'"x{i}"' for i in range(MAX_CHART_POINTS + 4))
        numbers = ", ".join(str(i) for i in range(MAX_CHART_POINTS + 4))
        body = (
            f'{{"kind": "line", "x": {{"label": "Week", "values": [{values}]}}, '
            f'"y": {{"label": "Hires"}}, "series": [{{"label": "A", "values": [{numbers}]}}]}}'
        )
        _, blocks, dropped = split_reply_blocks(fenced("chart", body))
        self.assertEqual(dropped, 0)
        self.assertEqual(len(blocks[0]["x"]["values"]), MAX_CHART_POINTS)
        self.assertEqual(len(blocks[0]["series"][0]["values"]), MAX_CHART_POINTS)

    def test_a_short_series_shortens_the_axis_with_it(self):
        # A bar may never be drawn against a tick that does not exist, so the
        # SHORTEST of x and every series decides the length.
        body = CHART_JSON.replace("[12, 5, 2]", "[12, 5]")
        _, blocks, _ = split_reply_blocks(fenced("chart", body))
        self.assertEqual(blocks[0]["x"]["values"], ["Screen", "Interview"])
        self.assertEqual(blocks[0]["series"][0]["values"], [12.0, 5.0])

    def test_only_the_first_blocks_up_to_the_cap_survive(self):
        reply = "\n\n".join(fenced("table", TABLE_JSON) for _ in range(MAX_BLOCKS + 2))
        _, blocks, dropped = split_reply_blocks(reply)
        self.assertEqual(len(blocks), MAX_BLOCKS)
        self.assertEqual(dropped, 2)

    def test_two_different_blocks_in_one_reply_both_land(self):
        reply = f"Two views.\n\n{fenced('table', TABLE_JSON)}\n\n{fenced('chart', CHART_JSON)}"
        prose, blocks, dropped = split_reply_blocks(reply)
        self.assertEqual(dropped, 0)
        self.assertEqual([b["type"] for b in blocks], ["table", "chart"])
        self.assertEqual(prose, "Two views.")

    def test_a_removed_fence_does_not_leave_a_hole_in_the_prose(self):
        reply = f"First line.\n\n{fenced('table', TABLE_JSON)}\n\nSecond line."
        prose, _, _ = split_reply_blocks(reply)
        self.assertEqual(prose, "First line.\n\nSecond line.")

    def test_empty_input_is_answered_not_raised(self):
        self.assertEqual(split_reply_blocks(""), ("", [], 0))


if __name__ == "__main__":
    unittest.main()
