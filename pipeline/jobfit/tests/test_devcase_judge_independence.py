"""W0.1 — the JUDGE ≠ GENERATOR invariant for the Dev pipeline's LLM-as-judge gates.

The devcase fairness/quality gates are judged by an LLM. They used to be handed the very
provider that produced the artifacts under test (a bare ``ClaudeCliProvider()``), so the
gate was self-grading: one engine, one set of blind spots, marking its own homework — and
"our work-sample evaluation is verified" was a claim resting on that self-grade.

These tests lock the fix (tiger finding devcase#1):
  1. the judge seat resolves through the ``devcase_judge`` use case, so KP_LLM_CONFIG can
     pin a different model — and the judge's spend is metered like every other call site;
  2. independence is MEASURED and reported, never assumed (routing alone does not make the
     seats different: with no config both fall back to the same CLI default);
  3. the audit harness sends the judge prompts to the JUDGE seat, not the generator;
  4. a judged run that was not independent fails ``--strict`` — a self-graded gate must not
     be able to certify a prompt or a model.
"""

import contextlib
import io
import unittest

from pipeline.jobfit.devcase import lifecycle_audits
from pipeline.jobfit.devcase.llm_judge import (
    judge_independence,
    provider_identity,
    resolve_judge_provider,
)


class _FakeProvider:
    """Minimal ClaudeCliProvider-shaped stand-in (name/model are all identity reads)."""

    def __init__(self, model=None, name=None):
        self.model = model
        if name is not None:
            self.name = name

    def available(self):
        return True


class TestProviderIdentity(unittest.TestCase):
    def test_adapter_reports_provider_and_model(self):
        self.assertEqual(provider_identity(_FakeProvider(model="claude-opus-4", name="anthropic")), "anthropic/claude-opus-4")

    def test_cli_provider_defaults_to_claude_cli(self):
        self.assertEqual(provider_identity(_FakeProvider(model="haiku")), "claude_cli/haiku")

    def test_unpinned_model_is_reported_as_default_not_guessed(self):
        # Two seats both on "the CLI's configured default" ARE the same engine; naming it
        # `default` keeps that collision visible to the independence check below.
        self.assertEqual(provider_identity(_FakeProvider()), "claude_cli/default")

    def test_absent_provider(self):
        self.assertEqual(provider_identity(None), "none")


class TestJudgeIndependence(unittest.TestCase):
    def test_different_models_are_independent(self):
        ind = judge_independence(_FakeProvider(model="haiku"), _FakeProvider(model="opus"))
        self.assertTrue(ind["independent"])
        self.assertEqual(ind["generator"], "claude_cli/haiku")
        self.assertEqual(ind["judge"], "claude_cli/opus")

    def test_same_model_is_self_grading(self):
        ind = judge_independence(_FakeProvider(model="haiku"), _FakeProvider(model="haiku"))
        self.assertFalse(ind["independent"])

    def test_both_unpinned_is_self_grading(self):
        # The default local-dev shape: no KP_LLM_CONFIG, both seats on the CLI default.
        self.assertFalse(judge_independence(_FakeProvider(), _FakeProvider())["independent"])

    def test_same_model_different_provider_is_independent(self):
        gen = _FakeProvider(model="claude-haiku-4-5", name="anthropic")
        judge = _FakeProvider(model="claude-haiku-4-5", name="openrouter")
        self.assertTrue(judge_independence(gen, judge)["independent"])

    def test_missing_seat_is_never_independent(self):
        self.assertFalse(judge_independence(None, _FakeProvider(model="opus"))["independent"])
        self.assertFalse(judge_independence(_FakeProvider(model="opus"), None)["independent"])


class TestJudgeSeatRouting(unittest.TestCase):
    def test_resolves_through_the_devcase_judge_use_case(self):
        # With no KP_LLM_CONFIG this is a MonitoredClaudeCli — the point is that it carries
        # the devcase_judge use case, which is what makes it (a) separately pinnable and
        # (b) metered in the usage ledger. A bare ClaudeCliProvider() had neither.
        seat = resolve_judge_provider()
        self.assertEqual(getattr(seat, "use_case", None), "devcase_judge")


class TestAuditRoutesJudgePromptsToTheJudgeSeat(unittest.TestCase):
    """audit_role_fit generates cases with one provider and grades them with another."""

    def setUp(self):
        self._run, self._verdicts = lifecycle_audits.run, lifecycle_audits.role_fit_verdicts
        self.seen = {}
        lifecycle_audits.run = lambda subset, provider, workers=4: self.seen.setdefault("generator", provider) and [] or []
        lifecycle_audits.role_fit_verdicts = lambda rows, provider, workers=4: (self.seen.setdefault("judge", provider), [])[1]

    def tearDown(self):
        lifecycle_audits.run, lifecycle_audits.role_fit_verdicts = self._run, self._verdicts

    def test_judge_provider_grades_generator_generates(self):
        gen, judge = _FakeProvider(model="haiku"), _FakeProvider(model="opus")
        res = lifecycle_audits.audit_role_fit([], gen, judge_provider=judge)
        self.assertIs(self.seen["generator"], gen)
        self.assertIs(self.seen["judge"], judge)
        self.assertTrue(res["independence"]["independent"])

    def test_defaults_to_the_generator_and_reports_self_grading(self):
        # Backwards-compatible: an old caller that passes no judge_provider still works,
        # but the result says plainly that the number was self-graded.
        gen = _FakeProvider(model="haiku")
        res = lifecycle_audits.audit_role_fit([], gen)
        self.assertIs(self.seen["judge"], gen)
        self.assertFalse(res["independence"]["independent"])


class TestStrictRefusesASelfGradedGate(unittest.TestCase):
    """--strict must not certify a run whose judge was the engine under test.

    Drives ``submission_eval.main`` with both seats stubbed so no LLM is involved: the
    generator is an available fake, ``run`` returns clean rows (so the deterministic
    fairness/discrimination gates cannot be the thing that fails), and ``judge`` is a
    no-op. The ONLY variable is which model each seat reports.
    """

    def setUp(self):
        from pipeline.jobfit.devcase import submission_eval

        self.mod = submission_eval
        self._saved = {k: getattr(submission_eval, k) for k in ("ClaudeCliProvider", "resolve_judge_provider", "judge", "run", "signals")}
        submission_eval.judge = lambda rows, provider, workers=4: None
        submission_eval.run = lambda scenarios, provider, workers=4: []
        # A clean, fully-passing signal block: the deterministic gates are green, so a
        # non-zero exit can only come from the independence check under test.
        submission_eval.signals = lambda rows: {
            "scenarios": 0,
            "reliable": 0,
            "reliability": 1.0,
            "llm_rows": 0,
            "error_fallbacks": 0,
            "fairness": {"status": "pass", "passed": True, "no_invented_overreliance": True, "overreliance_violations": [], "verify_rewarded": True, "ai_not_penalised": True, "judgment_mean": {}, "sample": {}, "margins": {"verify_lead": 0, "ai_gap": 0}},
            "discrimination": {"status": "pass", "passed": True, "strong_mean": 0, "weak_mean": 0, "margin": 0, "strong_beats_weak": True, "gamer_mean": 0, "gamer_margin": 0, "gamer_below_strong": True, "sample": {}},
        }

    def tearDown(self):
        for k, v in self._saved.items():
            setattr(self.mod, k, v)

    def _run_main(self, generator_model, judge_model):
        self.mod.ClaudeCliProvider = lambda **kw: _FakeProvider(model=generator_model)
        self.mod.resolve_judge_provider = lambda **kw: _FakeProvider(model=judge_model)
        out, err = io.StringIO(), io.StringIO()
        with contextlib.redirect_stdout(out), contextlib.redirect_stderr(err):
            code = self.mod.main(["--count", "4", "--judge", "--strict"])
        return code, out.getvalue(), err.getvalue()

    def test_self_graded_run_fails_strict(self):
        code, out, err = self._run_main("haiku", "haiku")
        self.assertEqual(code, 1)
        self.assertIn("judge is not independent", err)
        self.assertIn("claude_cli/haiku == claude_cli/haiku", err)
        self.assertIn("SELF-GRADING", out)

    def test_independent_run_passes_strict(self):
        code, out, err = self._run_main("haiku", "opus")
        self.assertEqual(code, 0)
        self.assertNotIn("judge is not independent", err)
        self.assertIn("independent: True", out)

    def test_unjudged_strict_run_is_unaffected(self):
        # --strict WITHOUT --judge certifies only the deterministic gates; the
        # independence rule must not fire there (it would fail every keyless CI run).
        self.mod.ClaudeCliProvider = lambda **kw: _FakeProvider(model="haiku")
        out, err = io.StringIO(), io.StringIO()
        with contextlib.redirect_stdout(out), contextlib.redirect_stderr(err):
            code = self.mod.main(["--count", "4", "--strict"])
        self.assertEqual(code, 0)
        self.assertNotIn("judge is not independent", err.getvalue())


if __name__ == "__main__":
    unittest.main()
