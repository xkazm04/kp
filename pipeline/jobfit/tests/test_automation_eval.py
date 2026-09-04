"""CI guard for the automation quality-gating eval (deterministic path only)."""

import contextlib
import io
import unittest
from unittest import mock

from pipeline.jobfit.claude_cli import ClaudeCliError
from pipeline.jobfit.eval import automation_eval, interview_eval, judging
from pipeline.jobfit.eval.automation_eval import (
    _EARLY,
    SCENARIOS,
    TASKS,
    _aggregate,
    _automation_banner,
    _passes,
    run_tasks,
)
from pipeline.jobfit.eval._style import _make_styler
from pipeline.jobfit.eval.thresholds import QUALITY_THRESHOLD


class TestAutomationEval(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.rows = run_tasks(None)  # deterministic fallbacks, no Claude CLI

    def test_deterministic_reliability_is_perfect(self):
        agg = _aggregate(self.rows)
        failures = [(r.task, r.scenario, r.issues) for r in self.rows if not r.reliable]
        self.assertEqual(agg["reliability"], 1.0, failures)

    def test_every_task_runs_over_every_scenario(self):
        self.assertEqual(len(self.rows), len(TASKS) * len(SCENARIOS))

    def test_early_career_never_auto_rejected_or_advanced(self):
        names = {s.name: s for s in SCENARIOS}
        for r in (x for x in self.rows if x.task == "screen"):
            if names[r.scenario].candidate.archetype in _EARLY:
                with self.subTest(scenario=r.scenario):
                    self.assertNotEqual(r.output.get("recommendation"), "reject", r.scenario)
                    self.assertNotEqual(r.output.get("route"), "advance", r.scenario)

    def test_rejection_has_no_protected_characteristic_language(self):
        for r in (x for x in self.rows if x.task == "rejection"):
            with self.subTest(scenario=r.scenario):
                self.assertEqual([i for i in r.issues if "FAIRNESS" in i], [], r.scenario)


class TestJudgeGate(unittest.TestCase):
    """bug-ui-scan-2026-07-09 (hiring-automation-scheduler #5): a --judge run whose
    judge scored NOTHING (quality_mean=None) must FAIL the gate, not silently pass
    on reliability alone."""

    RELIABLE = {"reliability": 1.0, "quality_mean": None, "unscored": 24, "total": 24, "reliable": 24, "by_task": {}}

    def test_judge_requested_but_unscored_fails(self):
        # Judge was asked for but produced no usable scores → the quality gate can't
        # be satisfied, so a strict run must NOT pass on reliability alone.
        self.assertFalse(_passes(self.RELIABLE, judge_requested=True))

    def test_judge_not_requested_still_passes_on_reliability(self):
        # A deterministic (--no-llm) run never requested a judge; quality_mean=None
        # is a legitimate skip, so reliability alone still passes.
        self.assertTrue(_passes(self.RELIABLE, judge_requested=False))
        # Default arg preserves the historical (judge-not-requested) behavior.
        self.assertTrue(_passes(self.RELIABLE))

    def test_scored_run_still_gated_on_quality_threshold(self):
        good = {**self.RELIABLE, "quality_mean": QUALITY_THRESHOLD}
        bad = {**self.RELIABLE, "quality_mean": QUALITY_THRESHOLD - 0.1}
        self.assertTrue(_passes(good, judge_requested=True))
        self.assertFalse(_passes(bad, judge_requested=True))

    def test_banner_counts_the_unavailable_judge_as_a_failed_check(self):
        # The verdict word (FAIL) must not contradict the checks count: the missing
        # quality gate is counted as a check so the count can't read "N/N PASS".
        banner = _automation_banner(self.RELIABLE, _make_styler(False), judge_requested=True)
        self.assertIn("FAIL", banner)
        # 24 reliable pass out of 24 runs + 1 (failed) quality check = 24/25.
        self.assertIn("24/25", banner)


class JudgeIndependenceTest(unittest.TestCase):
    """The judge must not be the engine.

    Until this landed, ``main`` ran every task with one provider and then handed
    that SAME object the "you are a strict QA reviewer" prompt, while the module
    docstring claimed "an independent Claude CLI judge". A model grading its own
    output is self-assessment; in a gate built to catch quality regressions that is
    the success theatre the rest of this suite refuses.
    """

    def test_the_default_judge_is_a_different_pinned_model(self):
        engine = _FakeProvider(model="opus")
        with mock.patch.object(judging, "ClaudeCliProvider", _FakeProvider):
            judge = judging.resolve_judge_provider(engine, stream=io.StringIO())
        self.assertIsNot(judge, engine)
        self.assertEqual(judge.model, judging.DEFAULT_JUDGE_MODEL)

    def test_judging_with_the_engines_own_model_is_refused(self):
        engine = _FakeProvider(model="opus")
        with self.assertRaises(judging.SameJudgeRefused) as ctx:
            judging.resolve_judge_provider(engine, judge_model="opus", stream=io.StringIO())
        self.assertIn("self-assessment", str(ctx.exception))

    def test_the_same_judge_concession_prints_itself(self):
        engine = _FakeProvider(model="opus")
        log = io.StringIO()
        judge = judging.resolve_judge_provider(engine, judge_model="opus", allow_same=True, stream=log)
        self.assertIs(judge, engine)
        self.assertIn("SELF-ASSESSMENT", log.getvalue())

    def test_an_unpinned_engine_says_independence_is_by_pin_only(self):
        # model=None is the Claude CLI's own default: we cannot prove the judge is a
        # different model, only a different pin, and the run must not imply otherwise.
        with mock.patch.object(judging, "ClaudeCliProvider", _FakeProvider):
            log = io.StringIO()
            judging.resolve_judge_provider(_FakeProvider(model=None), stream=log)
        self.assertIn("by pin only", log.getvalue())

    def test_an_unavailable_judge_returns_none_rather_than_falling_back_to_the_engine(self):
        engine = _FakeProvider(model="opus")
        with mock.patch.object(judging, "ClaudeCliProvider", lambda **kw: _FakeProvider(available=False, **kw)):
            self.assertIsNone(judging.resolve_judge_provider(engine, stream=io.StringIO()))

    def test_the_docstring_no_longer_claims_an_independence_it_did_not_have(self):
        doc = automation_eval.__doc__ or ""
        self.assertNotIn("an independent Claude CLI judge", doc)
        self.assertIn("--allow-same-judge", doc)


class SharedJudgingQuartetTest(unittest.TestCase):
    """judge / parse / pass / chip lived verbatim in BOTH harnesses, so the
    fail-closed fix for "the judge scored nothing" had to be re-derived twice."""

    def test_both_harnesses_read_the_same_module(self):
        self.assertIs(automation_eval.quality_passes, judging.quality_passes)
        self.assertIs(interview_eval.quality_passes, judging.quality_passes)
        self.assertIs(automation_eval.quality_state, judging.quality_state)
        self.assertIs(interview_eval.quality_state, judging.quality_state)

    def test_a_missing_or_invalid_score_stays_unscored_rather_than_faking_one_star(self):
        for payload in ({}, {"score": None}, {"score": "n/a"}, {"score": 0}, {"score": 9}, []):
            with self.subTest(payload=payload):
                self.assertIsNone(judging.parse_judgement(payload)[0])
        self.assertEqual(judging.parse_judgement({"score": 4, "issues": ["a", "b", "c", "d"]}), (4, ["a", "b", "c"]))

    def test_a_judge_that_errored_leaves_the_row_untouched(self):
        row = _ScorableRow()
        judging.apply_judgements([row], [ClaudeCliError("down")])
        self.assertIsNone(row.quality)

    def test_a_requested_judge_that_scored_nothing_fails_the_gate_closed(self):
        self.assertFalse(judging.quality_passes(None, judge_requested=True))
        self.assertTrue(judging.quality_passes(None, judge_requested=False))
        self.assertFalse(judging.quality_passes(QUALITY_THRESHOLD - 0.1, judge_requested=True))
        self.assertTrue(judging.quality_passes(QUALITY_THRESHOLD, judge_requested=True))

    def test_the_unscored_judge_counts_as_a_failed_check_in_the_banner(self):
        state = judging.quality_state(None, judge_requested=True)
        self.assertTrue(state.counted)
        self.assertFalse(state.ok)
        agg = {"reliability": 1.0, "quality_mean": None, "total": 3, "reliable": 3}
        banner = automation_eval._automation_banner(agg, _make_styler(False), judge_requested=True)
        self.assertIn("FAIL", banner)
        self.assertIn("3/4 checks", banner)


class ExitCodeContractTest(unittest.TestCase):
    def test_a_run_that_measured_nothing_exits_one(self):
        with mock.patch.object(automation_eval, "run_tasks", lambda *a, **k: []):
            with contextlib.redirect_stdout(io.StringIO()), contextlib.redirect_stderr(io.StringIO()):
                self.assertEqual(automation_eval.main(["--no-llm", "--strict"]), 1)

    def test_a_refused_judge_exits_two_not_one(self):
        # 2 = the run could not be performed, distinct from 1 = a gate failed.
        def _refuse(*a, **k):
            raise judging.SameJudgeRefused("nope")

        with mock.patch.object(automation_eval, "resolve_judge_provider", _refuse):
            with contextlib.redirect_stdout(io.StringIO()), contextlib.redirect_stderr(io.StringIO()):
                self.assertEqual(automation_eval.main(["--no-llm", "--judge"]), 2)


class _FakeProvider:
    def __init__(self, model=None, available=True, **_kw):
        self.model = model
        self._available = available

    def available(self) -> bool:
        return self._available


class _ScorableRow:
    def __init__(self):
        self.quality = None
        self.quality_issues = []


if __name__ == "__main__":
    unittest.main()
