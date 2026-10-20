"""Offline tests for the bench-quality bake path: a fully-judged model whose judge
formatted a single dimension oddly must NOT have its whole scorecard column dropped
(bug-ui-scan-2026-07-09 llm-provider-layer-python #4), and the judge's dimension
coercion (numeric string → float, junk → None)."""

from __future__ import annotations

import unittest

from pipeline.jobfit.llm.bench.bake_quality import _cell
from pipeline.jobfit.llm.bench.judge import _coerce_dim


def _judged(score: float, detail: dict, *, wall_ms: int = 100) -> dict:
    return {
        "source": "llm",
        "judge_score": score,
        "valid": True,
        "wall_ms": wall_ms,
        "judge_detail": detail,
    }


class CoerceDimTest(unittest.TestCase):
    def test_numeric_string_is_rescued(self) -> None:
        # The judge sometimes emits a numeric string; _med_dim would drop it as
        # non-numeric, so coerce it to a float here.
        self.assertEqual(_coerce_dim("8"), 8.0)
        self.assertEqual(_coerce_dim(" 7 "), 7.0)

    def test_numbers_pass_through_as_float(self) -> None:
        self.assertEqual(_coerce_dim(7), 7.0)
        self.assertEqual(_coerce_dim(6.5), 6.5)

    def test_non_numeric_and_missing_become_none(self) -> None:
        self.assertIsNone(_coerce_dim("8/10"))
        self.assertIsNone(_coerce_dim("high"))
        self.assertIsNone(_coerce_dim(None))
        # bool is an int subclass but a True/False is not a 1-10 score.
        self.assertIsNone(_coerce_dim(True))


class CellDimensionResilienceTest(unittest.TestCase):
    def test_missing_dimension_does_not_void_the_cell(self) -> None:
        # bug-ui-scan-2026-07-09 (#4): the model ran and was judged (overall scores
        # 8 & 9), but the judge produced no numeric `adherence` for either row. Pre-
        # fix `_cell` returned None here, erasing a real column; now the cell stays
        # and the absent dim is imputed from the overall median (8.5).
        recs = [
            _judged(8.0, {"relevance": 8, "correctness": 7, "adherence": None}),
            _judged(9.0, {"relevance": 9, "correctness": 8, "adherence": None}),
        ]
        cell = _cell(recs)
        self.assertIsNotNone(cell)
        self.assertEqual(cell["score"], 8.5)
        self.assertEqual(cell["relevance"], 8.5)  # median(8, 9)
        self.assertEqual(cell["correctness"], 7.5)  # median(7, 8)
        self.assertEqual(cell["adherence"], 8.5)  # imputed from the overall median
        self.assertEqual(cell["judges"], 2)

    def test_present_dimensions_are_still_used_directly(self) -> None:
        # Guard: when every dim is numeric, the per-dim medians are used verbatim
        # (no imputation), so the fix doesn't disturb the normal path.
        recs = [
            _judged(7.0, {"relevance": 6, "correctness": 7, "adherence": 8}),
            _judged(7.0, {"relevance": 8, "correctness": 7, "adherence": 6}),
        ]
        cell = _cell(recs)
        assert cell is not None
        self.assertEqual(cell["relevance"], 7.0)
        self.assertEqual(cell["correctness"], 7.0)
        self.assertEqual(cell["adherence"], 7.0)

    def test_no_judged_rows_still_returns_none(self) -> None:
        # An all-fallback / all-errored group genuinely has no measurement — that
        # legitimately stays None (the fix only rescues JUDGED cells).
        recs = [{"source": "fallback", "judge_score": None, "valid": False, "wall_ms": 1}]
        self.assertIsNone(_cell(recs))


def _priced(cost: float | None, *, source: str = "llm", error: str | None = None) -> dict:
    row = _judged(8.0, {"relevance": 8, "correctness": 8, "adherence": 8})
    row["source"] = source
    row["cost_usd"] = cost
    row["error"] = error
    if source != "llm" or error:
        row["judge_score"] = None
    return row


class CellCostTest(unittest.TestCase):
    """Challenge r07 llm-layer/B acceptance 1: the bake keeps what a task COSTS."""

    def test_cost_is_the_median_of_served_llm_rows(self) -> None:
        cell = _cell([_priced(0.002), _priced(0.004), _priced(0.006)])
        assert cell is not None
        self.assertEqual(cell["costPerTaskUsd"], 0.004)

    def test_fallback_and_errored_rows_never_feed_the_cost(self) -> None:
        # A deterministic fallback costs nothing and an error may carry a partial
        # spend; neither is the price of the model's answer.
        cell = _cell(
            [
                _priced(0.004),
                _priced(0.0, source="deterministic"),
                _priced(9.99, error="boom"),
            ]
        )
        assert cell is not None
        self.assertEqual(cell["costPerTaskUsd"], 0.004)

    def test_unpriced_cell_is_null_never_free(self) -> None:
        # The CLI adapter reports cost_usd=None when the envelope had no cost:
        # unpriced, never 0.
        cell = _cell([_priced(None), _priced(None)])
        assert cell is not None
        self.assertIn("costPerTaskUsd", cell)
        self.assertIsNone(cell["costPerTaskUsd"])


class BakeTargetsTest(unittest.TestCase):
    """Challenge r07 llm-layer/B acceptance 2 + reproducibility: the bake names the
    exact bench (provider, model) a pin needs, and --measured-at pins the stamp."""

    def _bake(self) -> dict:
        import json
        import tempfile
        from pathlib import Path

        from pipeline.jobfit.llm.bench.bake_quality import bake

        rows = []
        for provider, model in (
            ("gemini", "gemini-3.6-flash"),
            ("qwen", "deepseek-v4-flash"),
            ("claude_cli", "claude-opus-5"),
        ):
            r = _priced(0.001)
            r.update({"use_case": "match_reasoning", "provider": provider, "model": model})
            rows.append(r)
        with tempfile.TemporaryDirectory() as tmp:
            (Path(tmp) / "records.jsonl").write_text(
                "\n".join(json.dumps(r) for r in rows), encoding="utf-8"
            )
            ts = bake([tmp], judge="fable-5", measured_at="2026-08-12T00:49:23.000Z")
        body = ts.split("export const QUALITY_SCORES: QualityScores = ", 1)[1].split(";\n", 1)[0]
        return json.loads(body)

    def test_targets_map_each_slug_to_its_bench_provider(self) -> None:
        payload = self._bake()
        self.assertEqual(
            payload["targets"],
            {
                "gemini-3.6-flash": {"provider": "gemini", "model": "gemini-3.6-flash"},
                "deepseek-v4-flash": {"provider": "qwen", "model": "deepseek-v4-flash"},
                "claude-opus-5": {"provider": "claude_cli", "model": "claude-opus-5"},
            },
        )

    def test_measured_at_and_judge_are_what_the_caller_passed(self) -> None:
        payload = self._bake()
        self.assertEqual(payload["measuredAt"], "2026-08-12T00:49:23.000Z")
        self.assertEqual(payload["judge"], "fable-5")


if __name__ == "__main__":
    unittest.main()
