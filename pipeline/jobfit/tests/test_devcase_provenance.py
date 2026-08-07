"""idea-8b7ab54a — one shared tri-state provenance collapse.

`provenance.combine_source` is the single definition of "how degraded was this multi-step
run". The CLI envelope and BOTH eval harnesses call it, so a mixed run reads as "partial"
everywhere — the old binary "llm-if-any" collapse (which overstated LLM coverage) is gone.
"""

import logging
import unittest

from pipeline.jobfit.devcase import lifecycle_eval, submission_eval
from pipeline.jobfit.devcase.provenance import (
    FALLBACK_REASON_KEY,
    SOURCE_DETERMINISTIC,
    SOURCE_LLM,
    SOURCE_PARTIAL,
    combine_source,
    describe_fallback,
    generate_with_fallback,
)
from pipeline.jobfit.devcase.scenarios import generate_scenarios
from pipeline.jobfit.devcase.submission_scenarios import generate_submissions


class TestCombineSource(unittest.TestCase):
    def test_all_llm_is_llm(self):
        self.assertEqual(combine_source("llm", "llm", "llm"), SOURCE_LLM)

    def test_all_deterministic_is_deterministic(self):
        self.assertEqual(combine_source("deterministic", "deterministic"), SOURCE_DETERMINISTIC)

    def test_any_mix_is_partial_not_llm(self):
        # The heart of the fix: the old binary collapse reported "llm" for any-LLM run.
        self.assertEqual(combine_source("llm", "deterministic"), SOURCE_PARTIAL)
        self.assertEqual(combine_source("deterministic", "llm", "deterministic"), SOURCE_PARTIAL)

    def test_empty_sources_are_ignored(self):
        self.assertEqual(combine_source("", "llm"), SOURCE_LLM)
        self.assertEqual(combine_source("", ""), SOURCE_DETERMINISTIC)
        self.assertEqual(combine_source(), SOURCE_DETERMINISTIC)


class TestDescribeFallback(unittest.TestCase):
    """idea-81a8c28f — the one-line cause that lets an operator tell failure modes apart."""

    def test_formats_type_and_message(self):
        self.assertEqual(describe_fallback(TimeoutError("timed out after 120s")), "TimeoutError: timed out after 120s")
        self.assertEqual(describe_fallback(ValueError("not parseable JSON")), "ValueError: not parseable JSON")

    def test_bare_type_when_no_message(self):
        self.assertEqual(describe_fallback(RuntimeError()), "RuntimeError")

    def test_truncated_so_a_huge_body_cant_bloat_the_envelope(self):
        reason = describe_fallback(ValueError("x" * 5000))
        self.assertLessEqual(len(reason), 300)


class _RaisingProvider:
    def __init__(self, exc):
        self._exc = exc

    def complete_json(self, prompt, system=None):
        raise self._exc


class TestGenerateWithFallback(unittest.TestCase):
    """The shared LLM-or-deterministic runner: provider=None is a clean (reason-free)
    deterministic run, a success is 'llm', and a raise logs at WARNING + stashes the cause."""

    def _det(self):
        return {"value": 1}

    def _coerce(self, payload):
        return {"value": 2}

    def test_provider_none_is_clean_deterministic_no_reason(self):
        result, source = generate_with_fallback(None, "p", "sys", self._det, self._coerce, logging.getLogger("t"))
        self.assertEqual(source, SOURCE_DETERMINISTIC)
        self.assertNotIn(FALLBACK_REASON_KEY, result)  # off by design is NOT a failure

    def test_success_is_llm(self):
        class _Ok:
            def complete_json(self, prompt, system=None):
                return {"raw": True}

        result, source = generate_with_fallback(_Ok(), "p", "sys", self._det, self._coerce, logging.getLogger("t"))
        self.assertEqual(source, SOURCE_LLM)
        self.assertEqual(result, {"value": 2})  # coerce ran
        self.assertNotIn(FALLBACK_REASON_KEY, result)

    def test_raise_falls_back_logs_and_stashes_reason(self):
        logger = logging.getLogger("pipeline.jobfit.devcase.test_runner")
        with self.assertLogs(logger, level="WARNING") as cm:
            result, source = generate_with_fallback(
                _RaisingProvider(RuntimeError("provider down")), "p", "sys", self._det, self._coerce, logger
            )
        self.assertEqual(source, SOURCE_DETERMINISTIC)
        self.assertEqual(result["value"], 1)  # the deterministic template
        self.assertEqual(result[FALLBACK_REASON_KEY], "RuntimeError: provider down")
        self.assertTrue(any("fell back to deterministic" in m for m in cm.output))


class _PartialReflectProvider:
    """Succeeds for the reflect step only; every other step raises -> deterministic fallback,
    so a submission run mixes LLM + deterministic and must collapse to "partial"."""

    def complete_json(self, prompt, system=None):
        if "WHERE THE CANDIDATE MENTALLY WENT" in prompt:
            return {
                "narrative": "n",
                "iterationPattern": "linear",
                "deadEnds": [],
                "readBeforeWrite": 0.5,
                "verificationHabits": ["ran tests"],
                "confidence": 0.6,
            }
        raise RuntimeError("stub: force deterministic for this step")


class _PartialAnalyzeProvider:
    """Succeeds for the analyze step only; role/case design raise -> deterministic fallback."""

    def complete_json(self, prompt, system=None):
        if "REFLECT it against the actual body of work" in prompt:  # analyze prompt (need-analysis-v3)
            return {
                "realStack": ["Python"],
                "coreResponsibilities": ["own ingest"],
                "statedVsRealGaps": [],
                "trueComplexity": "medium",
                "riskAreas": [],
                "reflection": "r",
                "confidence": 0.7,
            }
        raise RuntimeError("stub: force deterministic for this step")


class TestEvalHarnessesUseSharedCollapse(unittest.TestCase):
    """Both run_one()s used to set Row.source with the binary "llm if any" form; they now
    share combine_source, so a mixed run reads as "partial" (and llm_rows counts only
    fully-LLM runs)."""

    def test_submission_mixed_run_reads_partial(self):
        scn = generate_submissions(1)[0]
        row = submission_eval.run_one(scn, _PartialReflectProvider())
        self.assertEqual(row.source, SOURCE_PARTIAL)  # not "llm"

    def test_lifecycle_mixed_run_reads_partial(self):
        scn = generate_scenarios(1)[0]
        row = lifecycle_eval.run_one(scn, _PartialAnalyzeProvider())
        self.assertEqual(row.source, SOURCE_PARTIAL)  # not "llm"

    def test_fully_deterministic_run_is_deterministic(self):
        # provider=None -> every step deterministic -> the verdict is "deterministic", never partial.
        srow = submission_eval.run_one(generate_submissions(1)[0], None)
        lrow = lifecycle_eval.run_one(generate_scenarios(1)[0], None)
        self.assertEqual(srow.source, SOURCE_DETERMINISTIC)
        self.assertEqual(lrow.source, SOURCE_DETERMINISTIC)


if __name__ == "__main__":
    unittest.main()
