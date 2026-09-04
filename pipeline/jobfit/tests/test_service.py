"""The service façade: the thin layer that decides what analyze_cv is given.

``service.analyze`` is the single entry point every caller of the CV pipeline
goes through (``cli.py``, and via it ``/api/analyze``), and it had no tests. It
looks trivial, which is exactly why it is worth pinning: everything it does is a
CHOICE about what reaches the paid call, and each choice has a quiet failure
mode if it flips.

  * ``job_description_path`` OVERRIDES ``job_description_text`` (the path is the
    caller's more specific intent). Same for company. A silent reversal would
    analyse against the wrong JD and still look green.
  * the structured job JSON is read here but parsed INSIDE ``analyze_cv``, so a
    malformed file degrades to a repair note instead of failing the analysis.
    Parsing it here would trade a degraded result for a hard failure.
  * every keyword — grounding, lang, blind, progress — is forwarded, unrenamed.
    A dropped kwarg is invisible: blind screening would silently stop being
    blind, ``lang`` would silently answer English.
  * the result is serialized ``by_alias`` with ``exclude_none``, which is the
    wire shape ``app/_lib/python-runner.ts`` parses.

``analyze_cv`` and ``extract_text`` are stubbed at the module boundary: this is
a test of the façade's wiring, and it must not spawn a model call or read a PDF.
"""

from __future__ import annotations

import tempfile
import unittest
from pathlib import Path
from unittest import mock

from pipeline.jobfit import service


class _FakeResult:
    """Stands in for the pydantic model analyze_cv returns."""

    def __init__(self) -> None:
        self.dump_kwargs: dict[str, object] = {}

    def model_dump(self, **kwargs: object) -> dict[str, object]:
        self.dump_kwargs = kwargs
        return {"score": {"total": 71}, "empty": None}


class _ServiceHarness(unittest.TestCase):
    def setUp(self) -> None:
        self.tmp = tempfile.TemporaryDirectory(prefix="kp-service-test-")
        self.addCleanup(self.tmp.cleanup)
        self.root = Path(self.tmp.name)
        self.cv = self.root / "cv.txt"
        self.cv.write_text("a cv", encoding="utf-8")

        self.calls: list[dict[str, object]] = []
        self.result = _FakeResult()

        def fake_analyze_cv(cv_path: Path, **kwargs: object) -> _FakeResult:
            self.calls.append({"cv_path": cv_path, **kwargs})
            return self.result

        patch = mock.patch.object(service, "analyze_cv", fake_analyze_cv)
        patch.start()
        self.addCleanup(patch.stop)

        # extract_text is the PDF/DOCX reader; here it just names its input, so
        # the assertions can tell "extracted from this path" from "passed as text".
        extract = mock.patch.object(
            service, "extract_text", lambda path: f"extracted:{Path(path).name}"
        )
        extract.start()
        self.addCleanup(extract.stop)

    @property
    def call(self) -> dict[str, object]:
        self.assertEqual(len(self.calls), 1, "analyze_cv must be called exactly once")
        return self.calls[0]


class JobDescriptionSourceTest(_ServiceHarness):
    def test_inline_text_is_passed_through_untouched(self) -> None:
        service.analyze(self.cv, job_description_text="a JD as text")
        self.assertEqual(self.call["job_description_text"], "a JD as text")

    def test_a_path_is_extracted(self) -> None:
        jd = self.root / "jd.pdf"
        jd.write_text("x", encoding="utf-8")
        service.analyze(self.cv, job_description_path=jd)
        self.assertEqual(self.call["job_description_text"], "extracted:jd.pdf")

    def test_a_path_overrides_inline_text(self) -> None:
        # The more specific intent wins. A reversal here would analyse against
        # the wrong JD and report a perfectly plausible score.
        jd = self.root / "jd.pdf"
        jd.write_text("x", encoding="utf-8")
        service.analyze(self.cv, job_description_text="ignored", job_description_path=jd)
        self.assertEqual(self.call["job_description_text"], "extracted:jd.pdf")

    def test_no_jd_at_all_is_none_not_an_empty_string(self) -> None:
        service.analyze(self.cv)
        self.assertIsNone(self.call["job_description_text"])


class CompanySourceTest(_ServiceHarness):
    def test_a_company_path_overrides_company_text(self) -> None:
        company = self.root / "about.txt"
        company.write_text("x", encoding="utf-8")
        service.analyze(self.cv, company_text="ignored", company_path=company)
        self.assertEqual(self.call["company_text"], "extracted:about.txt")

    def test_company_text_passes_through_when_no_path_is_given(self) -> None:
        service.analyze(self.cv, company_text="we build things")
        self.assertEqual(self.call["company_text"], "we build things")


class JobJsonTest(_ServiceHarness):
    def test_the_structured_job_is_forwarded_as_raw_text(self) -> None:
        # Read here, PARSED inside analyze_cv on purpose: that is what lets a
        # malformed file degrade to a repair note instead of failing the
        # (already paid for) analysis.
        job_json = self.root / "job.json"
        job_json.write_text('{"id": "j-1"}', encoding="utf-8")
        service.analyze(self.cv, job_json_path=job_json)
        self.assertEqual(self.call["job_json"], '{"id": "j-1"}')

    def test_malformed_job_json_still_reaches_the_pipeline_unparsed(self) -> None:
        job_json = self.root / "job.json"
        job_json.write_text("{not json", encoding="utf-8")
        service.analyze(self.cv, job_json_path=job_json)  # must not raise here
        self.assertEqual(self.call["job_json"], "{not json")

    def test_no_job_json_is_none(self) -> None:
        service.analyze(self.cv)
        self.assertIsNone(self.call["job_json"])


class ForwardingTest(_ServiceHarness):
    def test_the_defaults_are_the_deterministic_offline_ones(self) -> None:
        service.analyze(self.cv)
        self.assertIs(self.call["use_grounding"], False)
        self.assertIs(self.call["blind"], False)
        self.assertEqual(self.call["lang"], "en")
        self.assertIsNone(self.call["progress"])

    def test_grounding_lang_and_blind_are_forwarded_not_dropped(self) -> None:
        # A dropped kwarg is the silent kind of bug this test exists for: blind
        # screening would stop being blind and the analysis would still succeed.
        service.analyze(self.cv, grounding=True, lang="cs", blind=True)
        self.assertIs(self.call["use_grounding"], True)
        self.assertIs(self.call["blind"], True)
        self.assertEqual(self.call["lang"], "cs")

    def test_the_progress_callback_is_forwarded_by_identity(self) -> None:
        seen: list[tuple[str, str]] = []
        service.analyze(self.cv, progress=lambda a, b: seen.append((a, b)))
        callback = self.call["progress"]
        assert callable(callback)
        callback("extract", "started")
        self.assertEqual(seen, [("extract", "started")])

    def test_the_cv_path_is_passed_through_unchanged(self) -> None:
        service.analyze(self.cv)
        self.assertEqual(self.call["cv_path"], self.cv)


class SerializationTest(_ServiceHarness):
    def test_the_wire_shape_is_aliased_and_drops_nulls(self) -> None:
        # python-runner.ts parses this envelope; by_alias is the camelCase
        # contract and exclude_none keeps unset optionals off the wire.
        out = service.analyze(self.cv)
        self.assertEqual(self.result.dump_kwargs, {"by_alias": True, "exclude_none": True})
        self.assertEqual(out, {"score": {"total": 71}, "empty": None})


if __name__ == "__main__":  # pragma: no cover
    unittest.main()
