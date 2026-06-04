"""idea-8b7ab54a — one shared tri-state provenance collapse.

`provenance.combine_source` is the single definition of "how degraded was this multi-step
run". The CLI envelope and BOTH eval harnesses call it, so a mixed run reads as "partial"
everywhere — the old binary "llm-if-any" collapse (which overstated LLM coverage) is gone.
"""

import unittest

from pipeline.jobfit.devcase import lifecycle_eval, submission_eval
from pipeline.jobfit.devcase.provenance import (
    SOURCE_DETERMINISTIC,
    SOURCE_LLM,
    SOURCE_PARTIAL,
    combine_source,
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
        if "REFLECT it against the actual codebase" in prompt:
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
