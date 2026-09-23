"""solve_baseline — the naive one-shot baseline frozen per case (LLM-era controls #6).

The first tests this module has ever had (challenge-r08 tests-devcase/B). Two things
are pinned: the producing seam sanitises the model's file tree (a traversal path never
reaches the TS writer), and a degraded solve lifts BOTH provenance stamps onto the
envelope artifact. Before, only the prose ``fallbackReason`` was lifted and the
``fallbackCode`` stayed on the discarded inner result, so ``baseline-solve`` wrote an
anonymous (reason None) deterministic line to the usage ledger for every mid-call
descent.
"""

from __future__ import annotations

import unittest

from pipeline.jobfit.devcase.baseline import BASELINE_PROMPT_VERSION, solve_baseline
from pipeline.jobfit.devcase.models import CaseScenario, RoleSpec
from pipeline.jobfit.devcase.provenance import (
    FALLBACK_CODE_KEY,
    FALLBACK_REASON_KEY,
    SOURCE_DETERMINISTIC,
    SOURCE_LLM,
    collect_fallback_reasons,
)


def _case() -> CaseScenario:
    return CaseScenario.model_validate({"title": "Mini API", "brief": "b", "tasks": ["t1"]})


def _role() -> RoleSpec:
    return RoleSpec.model_validate({"title": "Backend", "seniority": "medior"})


class _Answering:
    """Answers one canned payload; takes the shape pin like every production provider."""

    def __init__(self, payload: object) -> None:
        self.payload = payload
        self.expected_keys: object = None

    def complete_json(self, prompt, system=None, expected_keys=None):
        self.expected_keys = expected_keys
        return self.payload


class _Raising:
    def __init__(self, exc: Exception) -> None:
        self.exc = exc

    def complete_json(self, prompt, system=None, expected_keys=None):
        raise self.exc


class SolveBaselineTest(unittest.TestCase):
    def test_a_traversal_path_is_dropped_and_the_rest_is_the_models_work(self):
        provider = _Answering(
            {
                "files": [
                    {"path": "../etc/x", "contents": "a"},
                    {"path": "src/a.py", "contents": "b"},
                ],
                "note": "n",
            }
        )
        out, source = solve_baseline(_case(), _role(), None, provider=provider)
        self.assertEqual(source, SOURCE_LLM)
        self.assertEqual(out["solutions"], [{"files": [{"path": "src/a.py", "contents": "b"}], "note": "n"}])
        self.assertEqual(out["promptVersion"], BASELINE_PROMPT_VERSION)
        # A clean LLM run carries neither stamp.
        self.assertNotIn(FALLBACK_REASON_KEY, out)
        self.assertNotIn(FALLBACK_CODE_KEY, out)
        # The answer is pinned by shape (the submission side is adversary-authored).
        self.assertEqual(tuple(provider.expected_keys or ()), ("files", "note"))

    def test_a_raising_provider_leaves_no_solution_and_both_stamps(self):
        out, source = solve_baseline(_case(), _role(), None, provider=_Raising(RuntimeError("provider is down")))
        self.assertEqual(source, SOURCE_DETERMINISTIC)
        # No fabricated baseline: a template would poison every downstream comparison.
        self.assertEqual(out["solutions"], [])
        self.assertIn(FALLBACK_REASON_KEY, out)
        self.assertIn(FALLBACK_CODE_KEY, out)
        reasons = collect_fallback_reasons([("baseline", out)], pop=True)
        self.assertEqual(reasons["baseline"], "RuntimeError: provider is down")
        self.assertTrue(reasons.codes.get("baseline"), "the ledger code must survive the lift")
        # pop=True leaves the frozen artifact clean of both stamps.
        self.assertNotIn(FALLBACK_REASON_KEY, out)
        self.assertNotIn(FALLBACK_CODE_KEY, out)

    def test_an_answer_that_keeps_nothing_is_coded_unusable_output(self):
        # Every file rejected -> coercion kept nothing -> the template, coded.
        out, source = solve_baseline(
            _case(), _role(), None, provider=_Answering({"files": [{"path": "/abs", "contents": "x"}], "note": "n"})
        )
        self.assertEqual(source, SOURCE_DETERMINISTIC)
        self.assertEqual(out["solutions"], [])
        self.assertEqual(out.get(FALLBACK_CODE_KEY), "unusable_output")

    def test_no_provider_is_a_clean_deterministic_run(self):
        out, source = solve_baseline(_case(), _role(), None, provider=None)
        self.assertEqual(source, SOURCE_DETERMINISTIC)
        self.assertEqual(out, {"solutions": [], "promptVersion": BASELINE_PROMPT_VERSION})


if __name__ == "__main__":
    unittest.main()
