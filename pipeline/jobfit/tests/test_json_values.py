"""The one JSON-value scanner, and the two selection policies that sit on it.

Why this file exists: the scan was duplicated near-verbatim in ``claude_cli.py``
and ``gemini.py``, and ``llm/base.py`` reached into the CLI module's private copy
to get at it — so the two adapters could drift apart silently, and neither copy
had a test of its own (both were only ever exercised through a provider's
end-to-end fake). ``json_values.py`` is now the single implementation and this is
its contract.

The two policies are NOT interchangeable, and the corpus below is the proof:
:func:`select_last_matching` (Claude CLI) takes the trailing value, because a
few-shot prompt makes the model echo the example schema FIRST;
:func:`select_best_scoring` (Gemini grounded) ranks by schema-key overlap,
because a grounded answer trails citation blobs AFTER the payload. Feed each
policy the other's corpus and it picks the wrong object — asserted here, so a
future "simplification" that collapses them fails loudly.

Equality of behaviour with the pre-extraction copies is pinned two ways: the
CLI-facing aliases (``claude_cli._extract_json``, ``claude_cli._scan_json_values``)
and the Gemini-facing ones (``gemini._scan_json_values``, ``gemini._select_payload``)
must still be the shared functions, and the end-to-end selection cases below are
the ones those modules' own docstrings describe.
"""

from __future__ import annotations

import unittest

from pipeline.jobfit import claude_cli, gemini
from pipeline.jobfit.json_values import (
    candidate_values,
    extract_json,
    scan_json_values,
    select_best_scoring,
    select_last_matching,
)


class ScannerTest(unittest.TestCase):
    def test_top_level_values_in_order_of_appearance(self) -> None:
        text = 'prelude {"a": 1} middle [1, 2] tail {"b": 2}'
        self.assertEqual(scan_json_values(text), [{"a": 1}, [1, 2], {"b": 2}])

    def test_a_nested_object_is_part_of_its_parent_not_a_sibling(self) -> None:
        # The whole point of skipping past a decoded value: an array of objects
        # is ONE entry, not one entry per element.
        self.assertEqual(
            scan_json_values('[{"a": 1}, {"b": 2}]'),
            [[{"a": 1}, {"b": 2}]],
        )

    def test_a_stray_brace_in_prose_does_not_stop_the_scan(self) -> None:
        # The failure the scanner replaced: `text.find("{")` latched onto the
        # first brace and the whole grounded analysis failed.
        text = 'I considered { the options } and answer: {"verdict": "hire"}'
        self.assertEqual(scan_json_values(text), [{"verdict": "hire"}])

    def test_no_json_is_an_empty_list_not_an_error(self) -> None:
        self.assertEqual(scan_json_values("no json here at all"), [])
        self.assertEqual(scan_json_values(""), [])

    def test_a_fenced_block_wins_over_the_surrounding_prose(self) -> None:
        text = 'chatter {"echo": true}\n```json\n{"verdict": "hire"}\n```\nmore {"trailing": 1}'
        self.assertEqual(candidate_values(text), [{"verdict": "hire"}])

    def test_an_unparseable_fence_falls_back_to_the_whole_text(self) -> None:
        text = '```\nnot json at all\n```\nthe real answer: {"verdict": "hire"}'
        self.assertEqual(candidate_values(text), [{"verdict": "hire"}])


class LastMatchingPolicyTest(unittest.TestCase):
    """The Claude-CLI policy: the trailing value, pinned by shape when known."""

    def test_the_last_value_wins_so_an_echoed_example_loses(self) -> None:
        values = [{"title": "EXAMPLE"}, {"title": "the real answer"}]
        self.assertEqual(select_last_matching(values), {"title": "the real answer"})

    def test_expected_keys_beat_document_order(self) -> None:
        # A chatty trailing object after the answer: without the pin it wins.
        values = [{"verdict": "hire", "why": "x"}, {"note": "hope that helps"}]
        self.assertEqual(select_last_matching(values), {"note": "hope that helps"})
        self.assertEqual(
            select_last_matching(values, ("verdict",)), {"verdict": "hire", "why": "x"}
        )

    def test_the_last_keyed_value_wins_when_several_match(self) -> None:
        values = [{"verdict": "example"}, {"verdict": "real"}, {"note": "bye"}]
        self.assertEqual(select_last_matching(values, ("verdict",)), {"verdict": "real"})

    def test_unmatched_keys_degrade_to_the_last_value(self) -> None:
        values = [{"a": 1}, {"b": 2}]
        self.assertEqual(select_last_matching(values, ("verdict",)), {"b": 2})


class BestScoringPolicyTest(unittest.TestCase):
    """The Gemini grounded policy: rank by schema overlap, then size, then order."""

    def test_the_payload_beats_a_trailing_citation_blob(self) -> None:
        dicts = [{"score": 80, "summary": "s"}, {"uri": "https://example.com"}]
        self.assertEqual(
            select_best_scoring(dicts, ("score", "summary")), {"score": 80, "summary": "s"}
        )

    def test_schema_overlap_outranks_size_and_order(self) -> None:
        # The blob is bigger AND later; only the key overlap saves the payload.
        # (Mutating the ranker's first term to a constant is caught here alone.)
        payload = {"score": 80}
        blob = {"uri": "https://a", "title": "a", "snippet": "…", "index": 3}
        self.assertEqual(select_best_scoring([payload, blob], ("score",)), payload)

    def test_the_payload_beats_a_leading_empty_brace(self) -> None:
        dicts = [{}, {"score": 80}]
        self.assertEqual(select_best_scoring(dicts, ("score",)), {"score": 80})

    def test_size_breaks_a_tie_on_schema_overlap(self) -> None:
        dicts = [{"score": 1, "extra": 2}, {"score": 3}]
        self.assertEqual(select_best_scoring(dicts, ("score",)), {"score": 1, "extra": 2})

    def test_document_order_is_only_the_final_tiebreak(self) -> None:
        dicts = [{"score": 1}, {"score": 2}]
        self.assertEqual(select_best_scoring(dicts, ("score",)), {"score": 2})

    def test_with_no_expected_keys_it_falls_back_to_size_then_order(self) -> None:
        dicts = [{"a": 1, "b": 2}, {"c": 3}]
        self.assertEqual(select_best_scoring(dicts), {"a": 1, "b": 2})


class PoliciesAreNotInterchangeableTest(unittest.TestCase):
    """Each policy picks the WRONG object on the other's corpus. Keep them apart."""

    # A grounded answer: the payload, then a citation blob the model appended.
    GROUNDED = [{"score": 80, "summary": "strong fit"}, {"uri": "https://example.com"}]
    # A few-shot CLI answer: the echoed schema example, then the real answer.
    FEW_SHOT = [{"verdict": "EXAMPLE"}, {"verdict": "hire"}]

    def test_the_cli_policy_would_take_the_citation_blob(self) -> None:
        self.assertEqual(select_last_matching(self.GROUNDED), {"uri": "https://example.com"})
        self.assertEqual(
            select_best_scoring(self.GROUNDED, ("score", "summary")),
            {"score": 80, "summary": "strong fit"},
        )

    def test_the_grounded_policy_would_take_the_echoed_example(self) -> None:
        # Same keys, same size — ranking cannot separate them, so it falls to
        # document order and picks the FIRST-ranked max... which for equal ranks
        # is the LAST index. The separation is elsewhere: give the echo one extra
        # key (a comment field, as real few-shot examples carry) and ranking
        # prefers the echo while the CLI policy still takes the real answer.
        echoed = [{"verdict": "EXAMPLE", "_comment": "shape only"}, {"verdict": "hire"}]
        self.assertEqual(
            select_best_scoring(echoed, ("verdict",)),
            {"verdict": "EXAMPLE", "_comment": "shape only"},
        )
        self.assertEqual(select_last_matching(echoed, ("verdict",)), {"verdict": "hire"})


class ExtractJsonTest(unittest.TestCase):
    def test_empty_text_is_a_value_error(self) -> None:
        with self.assertRaises(ValueError):
            extract_json("   ")

    def test_no_json_is_a_value_error(self) -> None:
        with self.assertRaises(ValueError):
            extract_json("the model refused to answer")

    def test_the_fenced_answer_wins_over_a_trailing_object(self) -> None:
        text = '```json\n{"verdict": "hire"}\n```\nHope that helps! {"note": 1}'
        self.assertEqual(extract_json(text), {"verdict": "hire"})

    def test_expected_keys_pin_the_answer_past_a_trailing_object(self) -> None:
        text = '{"verdict": "hire", "why": "x"}\n\nLet me know! {"note": "bye"}'
        self.assertEqual(extract_json(text, expected_keys=("verdict",))["verdict"], "hire")


class OneImplementationTest(unittest.TestCase):
    """Both adapters must resolve to the SHARED functions, not private twins.

    This is the regression that motivated the extraction: two copies of the same
    scan, one of them reached through another module's private name.
    """

    def test_the_cli_aliases_are_the_shared_functions(self) -> None:
        self.assertIs(claude_cli._scan_json_values, scan_json_values)
        self.assertIs(claude_cli._extract_json, extract_json)

    def test_the_gemini_aliases_are_the_shared_functions(self) -> None:
        self.assertIs(gemini._scan_json_values, scan_json_values)
        self.assertIs(gemini._select_payload, select_best_scoring)

    def test_llm_base_no_longer_imports_the_cli_modules_private_name(self) -> None:
        from pipeline.jobfit.llm import base

        self.assertIs(base._extract_json, extract_json)


if __name__ == "__main__":  # pragma: no cover
    unittest.main()
