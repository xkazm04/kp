"""Tests for the decoder-domain-gap instrument.

The instrument's whole value is that its three figures are trustworthy, so the
tests pin the two ways a counter like this goes quietly wrong: a domain hidden
behind an optional union or an enum reference (undercount), and a repair
pattern matching a test file or its own source (overcount).
"""

import unittest

from pipeline.jobfit.decoder_domain_gap import (
    _domain_kinds,
    main,
    scan_repairs,
    scan_schema,
)
from pipeline.jobfit.decoder_domain_gap import PIPELINE_ROOT


class TestDomainKinds(unittest.TestCase):
    """Domain detection must see through the shapes Pydantic actually emits."""

    def test_plain_bounds_are_found(self):
        self.assertEqual(_domain_kinds({"minimum": 0, "maximum": 100}, {}), ["maximum", "minimum"])

    def test_enum_behind_optional_union_is_found(self):
        """An Optional[Literal[...]] is an anyOf with null - the domain is inside it."""
        schema = {"anyOf": [{"enum": ["a", "b"]}, {"type": "null"}]}
        self.assertEqual(_domain_kinds(schema, {}), ["enum"])

    def test_enum_behind_a_ref_is_found(self):
        """A referenced enum definition is the common case and the easy miss."""
        defs = {"Status": {"enum": ["ok", "bad"]}}
        self.assertEqual(_domain_kinds({"$ref": "#/$defs/Status"}, defs), ["enum"])

    def test_unbounded_field_reports_nothing(self):
        self.assertEqual(_domain_kinds({"type": "integer"}, {}), [])

    def test_recursive_ref_terminates(self):
        """A self-referencing definition must not hang the walk."""
        defs = {"Node": {"$ref": "#/$defs/Node"}}
        self.assertEqual(_domain_kinds({"$ref": "#/$defs/Node"}, defs), [])


class TestScanSchema(unittest.TestCase):
    """The denominator counts every exported field, nested definitions included."""

    def test_counts_definitions_and_root(self):
        schema = {
            "title": "Root",
            "properties": {"top": {"type": "string"}},
            "$defs": {
                "Inner": {"properties": {"score": {"minimum": 0, "maximum": 10}}},
            },
        }
        total, declared = scan_schema(schema)
        self.assertEqual(total, 2)
        self.assertEqual([(o, f) for o, f, _ in declared], [("Inner", "score")])

    def test_schema_without_defs_is_handled(self):
        total, declared = scan_schema({"properties": {"a": {"type": "string"}}})
        self.assertEqual((total, declared), (1, []))


class TestScanRepairs(unittest.TestCase):
    """Repair counting must exclude tests and the instrument's own source."""

    def test_does_not_count_its_own_patterns(self):
        """This test file contains clamp-shaped text; it must not be counted."""
        sites = scan_repairs(PIPELINE_ROOT)
        offenders = [s for s in sites if "test_decoder_domain_gap" in s[0]]
        self.assertEqual(offenders, [], f"instrument counted its own tests: {offenders}")

    def test_excludes_the_instrument_module(self):
        sites = scan_repairs(PIPELINE_ROOT)
        offenders = [s for s in sites if s[0].endswith("decoder_domain_gap.py")]
        self.assertEqual(offenders, [])

    def test_finds_the_known_confidence_clamp(self):
        """A known positive: the confidence clamp in automation.py.

        Asserting a known present site is what separates "the scan found
        nothing" from "the scan is broken" - an absence proved by an
        unasserted instrument is not evidence.
        """
        sites = scan_repairs(PIPELINE_ROOT)
        hits = [s for s in sites if s[0].endswith("automation.py") and s[2] == "clamp"]
        self.assertTrue(hits, "expected at least one clamp in automation.py")

    def test_reports_a_nonzero_gap_today(self):
        """The gap this instrument was written for is currently open.

        This assertion is expected to change when the domains are lifted into
        the schema; when it fails because declared >= repairs, the work item in
        .ai/ is done and the assertion becomes the regression guard.
        """
        sites = scan_repairs(PIPELINE_ROOT)
        self.assertGreater(len(sites), 0)


class TestCli(unittest.TestCase):
    """Both output modes must run without raising."""

    def test_text_mode_returns_zero(self):
        self.assertEqual(main([]), 0)

    def test_json_mode_returns_zero(self):
        self.assertEqual(main(["--json"]), 0)


if __name__ == "__main__":
    unittest.main()
