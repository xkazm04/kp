"""Tests for the decoder-domain-gap instrument.

The instrument's whole value is that its three figures are trustworthy, so the
tests pin the two ways a counter like this goes quietly wrong: a domain hidden
behind an optional union or an enum reference (undercount), and a repair
pattern matching a test file or its own source (overcount).
"""

import unittest

from pipeline.jobfit.decoder_domain_gap import (
    CLASSIFIED,
    KNOWN_UNMATCHED,
    _domain_kinds,
    classify,
    find_known_unmatched,
    main,
    partition,
    scan_repairs,
    scan_schema,
)
from pipeline.jobfit.decoder_domain_gap import PIPELINE_ROOT, _load_schema


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

    def test_the_gap_is_open_on_the_model_produced_figure(self):
        """The guard must watch the figure the work item moves, not every clamp.

        The first version asserted ``len(scan_repairs(...)) > 0`` over hits of
        every kind. The plan forbids touching the six local clamps, so those
        alone satisfied that assertion forever — the promised regression guard
        could never fire once the model-produced repairs were gone. It now reads
        the floor (matched + hand-listed) against ``declared``, which is the
        comparison the plan is actually sized on.
        """
        total, declared = scan_schema(_load_schema())
        buckets = partition(scan_repairs(PIPELINE_ROOT))
        listed, _missing = find_known_unmatched(PIPELINE_ROOT)
        floor = len(buckets["model"]) + len(listed)
        self.assertGreater(total, 0)
        self.assertGreater(
            floor,
            len(declared),
            "the gap has closed: declare this in .ai/tasks/... and invert this assertion",
        )


class TestClassification(unittest.TestCase):
    """The figure is only evidence if every hit says which kind it is.

    The first version counted every clamp shape and reported 17 model-produced
    repairs. Six were local arithmetic a response schema could never constrain,
    and one mechanism was counted twice. These tests exist so that cannot recur
    silently.
    """

    def test_classifying_is_reported_not_gated(self):
        """An unclassified hit must NOT fail this gate, and here is why.

        The scan matches generic shapes — ``@field_validator`` and three clamp
        spellings — and those are routine additions in a Pydantic codebase. An
        assertion over the whole of ``pipeline/jobfit`` therefore reds the Python
        gate for any sibling session that adds a validator, pointing them at a
        table in a file they never opened. That cost is not worth paying by a
        sizing instrument: the figure it produces is read by whoever runs it, not
        by CI.

        So the contract is: ``partition`` labels an unmatched hit
        ``unclassified`` and ``_render`` prints it loudly above the figures with
        the figures withheld, and *that* is the signal. This test pins the
        reporting path rather than gating the tree.
        """
        buckets = partition(
            [("jobfit/nowhere.py", 1, "clamp", "max(0, min(9, x))  # never classified")]
        )
        self.assertEqual(len(buckets["unclassified"]), 1)
        self.assertEqual(buckets["model"], [])

    def test_every_classification_carries_a_reason(self):
        """An exclusion without a reason is indistinguishable from an oversight."""
        missing = [k for k, (_kind, why) in CLASSIFIED.items() if not why.strip()]
        self.assertEqual(missing, [])

    def test_only_known_kinds(self):
        kinds = {kind for kind, _why in CLASSIFIED.values()}
        self.assertLessEqual(kinds, {"model", "local", "dup_of"})

    def test_local_arithmetic_is_not_counted(self):
        """The two sites the review named must not reach the headline figure."""
        self.assertEqual(
            classify("jobfit/llm/fault.py", "time.sleep(max(0.0, min(self.hang_s, x)))")[0],
            "local",
        )
        self.assertEqual(
            classify("jobfit/embedding_bridge.py", "round(max(0.0, min(1.0, _cosine(va, vb))), 4)")[0],
            "local",
        )

    def test_one_validator_is_counted_once(self):
        """A validator matches twice - decorator and body - and is one mechanism."""
        self.assertEqual(
            classify("jobfit/matching.py", '    @field_validator("potential_score")')[0],
            "model",
        )
        self.assertEqual(
            classify("jobfit/matching.py", "        return max(0.0, min(1.0, v))")[0],
            "dup_of",
        )

    def test_classification_is_keyed_by_marker_not_by_line(self):
        """A sibling session shifting lines must not turn this into a red gate.

        This is a shared checkout. Keying on a line number means one added import
        in an unrelated module reads every hit below it as unclassified and every
        table entry as stale, failing the gate on a commit whose author never
        opened this file. Every key is (path, marker) and no key is an int.
        """
        for key in CLASSIFIED:
            self.assertIsInstance(key, tuple)
            path, marker = key
            self.assertIsInstance(marker, str)
            self.assertFalse(marker.isdigit(), "marker must be code, not a line number")
        for key in KNOWN_UNMATCHED:
            _path, marker = key
            self.assertIsInstance(marker, str)

    def test_markers_are_code_shaped(self):
        """A marker must be a distinctive code substring, not a placeholder.

        The stronger check — every marker still matches a live hit — was removed
        deliberately: it walked the whole package and so failed for whoever
        happened to edit an unrelated clamp. Drift in this table degrades the
        instrument's own report, which is where it belongs, and not somebody
        else's gate.
        """
        for path, marker in CLASSIFIED:
            self.assertTrue(path.endswith(".py"), path)
            self.assertGreaterEqual(len(marker), 8, marker)


class TestKnownUnmatched(unittest.TestCase):
    """The hand-listed repairs are why the figure is a floor.

    Nothing in the pattern machinery can catch a model-produced repair it cannot
    match, so the only guard is this list plus the assertion that each marker
    still exists. A hand-maintained list whose entries are never checked drifts
    into fiction, which is worse than not having one.
    """

    def test_each_listed_marker_still_exists(self):
        _found, missing = find_known_unmatched(PIPELINE_ROOT)
        self.assertEqual(missing, [], "KNOWN_UNMATCHED markers that no longer exist: %s" % (missing,))

    def test_each_listed_entry_carries_a_reason(self):
        blank = [k for k, why in KNOWN_UNMATCHED.items() if not why.strip()]
        self.assertEqual(blank, [])

    def test_the_two_repairs_the_review_named_are_listed(self):
        """Both were cited as seam evidence and neither is pattern-matchable."""
        paths = {rel for rel, _marker in KNOWN_UNMATCHED}
        self.assertIn("jobfit/appmaster.py", paths)
        self.assertIn("jobfit/calibration_drift.py", paths)

    def test_a_listed_site_is_not_also_pattern_matched(self):
        """Otherwise the floor double-counts one repair."""
        found = scan_repairs(PIPELINE_ROOT)
        for path, marker in KNOWN_UNMATCHED:
            dupes = [t for rel, _n, _k, t in found if rel == path and marker in t]
            self.assertEqual(dupes, [], "%s is both hand-listed and matched" % (marker,))


class TestCli(unittest.TestCase):
    """Both output modes must run without raising."""

    def test_text_mode_returns_zero(self):
        self.assertEqual(main([]), 0)

    def test_json_mode_returns_zero(self):
        self.assertEqual(main(["--json"]), 0)

    def test_list_mode_returns_zero(self):
        self.assertEqual(main(["--list"]), 0)


if __name__ == "__main__":
    unittest.main()
