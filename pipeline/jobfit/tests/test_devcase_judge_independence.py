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
import json
import os
import tempfile
import unittest
from contextlib import contextmanager
from pathlib import Path
from unittest import mock

from pipeline.jobfit.devcase import devcase_cli, lifecycle_audits
from pipeline.jobfit.devcase.llm_judge import (
    judge_independence,
    provider_identity,
    resolve_judge_provider,
)
from pipeline.jobfit.llm import resolve_provider
from pipeline.jobfit.llm.capabilities import JUDGE_CLI_MODEL, default_model
from pipeline.jobfit.llm.config import ENV_VAR


# The generator seat this file compares the judge against. Held as a CONSTANT rather
# than written inline: ``test_byom_coverage._literal_routed_use_cases`` regex-scans every
# ``pipeline/**/*.py`` — tests included, unlike its AST twin — for
# ``resolve_provider("<literal>")``, and its non-vacuity anchors assert that
# ``devcase_evaluate`` reaches the inventory ONLY through devcase_cli's per-command map.
# A literal here would break that anchor from a file that is not a call site.
EVALUATE_SEAT = "devcase_evaluate"


@contextmanager
def llm_config(value):
    """Set (or clear, with None) KP_LLM_CONFIG for the duration of the block.

    Mirrors test_llm_registry.llm_config — the config is re-read from os.environ on every
    resolve (``config.load_config`` is not cached), so this is the whole stub surface.
    """
    payload = json.dumps(value) if isinstance(value, (dict, list)) else value
    with mock.patch.dict(os.environ, {}, clear=False):
        os.environ.pop(ENV_VAR, None)
        if payload is not None:
            os.environ[ENV_VAR] = payload
        yield


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


class _FailingProvider:
    """Available, carries an identity, and fails every call — so a devcase_cli run reaches
    the emit with ``provider is not None`` while every step falls back deterministically."""

    def __init__(self, model=None):
        self.model = model

    def available(self):
        return True

    def complete_json(self, prompt, system=None):
        raise RuntimeError("no LLM in tests")


class TestJudgeSeatIsIndependentByDefault(unittest.TestCase):
    """Gap 5 — the DEFAULT install must not self-grade.

    Routing the judge through its own use case (above) made the seat PINNABLE; it did not
    make it different. With no config both seats resolved to the same engine on the same
    ``model=None``, so ``judge_independence`` reported False on every out-of-the-box
    install and the product marked its own homework. The seat now carries its own default.
    """

    def test_the_cli_judge_seat_carries_its_own_default_model(self):
        with llm_config(None):
            judge = resolve_judge_provider()
            generator = resolve_provider(EVALUATE_SEAT, timeout=120)
        self.assertEqual(judge.model, JUDGE_CLI_MODEL)
        # NON-VACUITY: the generator is unchanged — still the CLI's OWN configured
        # default. If this ever became "haiku" too the seats would collide again and the
        # assertion below would be measuring nothing.
        self.assertIsNone(generator.model)
        self.assertTrue(judge_independence(generator, judge)["independent"])

    def test_no_other_cli_seat_gained_a_pinned_model(self):
        # The registry change (default_model now consulted on the CLI branch) must be
        # inert everywhere else: DEFAULT_MODELS["claude_cli"] is None, so every seat
        # without an explicit override still rides the CLI's configured default.
        with llm_config(None):
            for use_case in (EVALUATE_SEAT, "devcase_case_design", "devcase_reflect", "match_reasoning", "automation"):
                self.assertIsNone(resolve_provider(use_case, timeout=120).model, use_case)

    def test_a_provider_only_wildcard_row_does_not_collapse_the_seats(self):
        # {"*": {"provider": "claude_cli"}} routes everything to one engine without naming
        # a model. The per-seat default still applies, so the judge stays distinct — a
        # wildcard row is not a way to accidentally re-enable self-grading.
        with llm_config({"useCases": {"*": {"provider": "claude_cli"}}}):
            judge = resolve_judge_provider()
            generator = resolve_provider(EVALUATE_SEAT, timeout=120)
        self.assertEqual(judge.model, JUDGE_CLI_MODEL)
        self.assertTrue(judge_independence(generator, judge)["independent"])

    def test_the_anthropic_judge_seat_differs_from_the_evaluate_seat(self):
        # The same collision one level down: devcase_evaluate has no anthropic override,
        # so both seats landed on DEFAULT_MODELS' claude-haiku-4-5. The judge takes the
        # cheapest model in the catalogue that is DISTINCT from it.
        self.assertNotEqual(
            default_model("devcase_judge", "anthropic"),
            default_model(EVALUATE_SEAT, "anthropic"),
        )

    def test_an_operator_pinning_the_same_model_is_still_reported_as_self_grading(self):
        # The fix is a DEFAULT, not a guarantee. An operator is free to point both seats
        # at one model — and when they do, the flag says so rather than the gate quietly
        # certifying itself.
        cfg = {
            "useCases": {
                EVALUATE_SEAT: {"provider": "claude_cli", "model": "opus"},
                "devcase_judge": {"provider": "claude_cli", "model": "opus"},
            }
        }
        with llm_config(cfg):
            generator = resolve_provider(EVALUATE_SEAT, timeout=120)
            judge = resolve_judge_provider()
        independence = judge_independence(generator, judge)
        self.assertFalse(independence["independent"])
        self.assertEqual(independence["judge"], independence["generator"])
        self.assertEqual(independence["judge"], "claude_cli/opus")


class TestEvaluationRecordsTheJudgeSeat(unittest.TestCase):
    """The flag lands on the bundle a REVIEWER reads.

    Before this, the only trace of a self-grading gate was a stderr line inside offline
    harnesses (calibrate / lifecycle_eval / submission_eval) that no recruiter runs.
    ``evaluate-submission`` now stamps the two seat identities onto the evaluation itself,
    which is what lets DevEvalPanelIntegrity say "Judge = generator" where the evidence is
    actually being weighed.
    """

    def _evaluate(self, argv_extra, provider=None):
        with tempfile.TemporaryDirectory() as d:
            commits = Path(d) / "commits.json"
            commits.write_text(json.dumps([{"message": "wip"}]), encoding="utf-8")
            case = Path(d) / "case.json"
            case.write_text("{}", encoding="utf-8")
            role = Path(d) / "role.json"
            role.write_text(json.dumps({"title": "Backend", "seniority": "medior"}), encoding="utf-8")
            argv = [
                "evaluate-submission",
                "--commits-json", str(commits),
                "--case-json", str(case),
                "--role-json", str(role),
                *argv_extra,
            ]
            out, err = io.StringIO(), io.StringIO()
            with contextlib.redirect_stdout(out), contextlib.redirect_stderr(err):
                if provider is None:
                    code = devcase_cli.main(argv)
                else:
                    with mock.patch.object(devcase_cli, "resolve_provider", return_value=provider):
                        code = devcase_cli.main(argv)
        lines = [ln for ln in out.getvalue().splitlines() if ln.strip()]
        return code, json.loads(lines[-1])

    def test_an_llm_backed_evaluation_records_both_seat_identities(self):
        with llm_config(None):
            code, payload = self._evaluate([], provider=_FailingProvider())
        self.assertEqual(code, 0)
        independence = payload["result"]["judgeIndependence"]
        self.assertEqual(independence["generator"], "claude_cli/default")
        self.assertEqual(independence["judge"], "claude_cli/" + JUDGE_CLI_MODEL)
        self.assertTrue(independence["independent"])

    def test_a_self_grading_install_records_false(self):
        cfg = {"useCases": {"devcase_judge": {"provider": "claude_cli", "model": "opus"}}}
        with llm_config(cfg):
            code, payload = self._evaluate([], provider=_FailingProvider(model="opus"))
        self.assertEqual(code, 0)
        independence = payload["result"]["judgeIndependence"]
        self.assertFalse(independence["independent"])
        self.assertEqual(independence["generator"], "claude_cli/opus")
        self.assertEqual(independence["judge"], "claude_cli/opus")

    def test_a_keyless_deterministic_evaluation_claims_nothing(self):
        # --no-llm produced this bundle with no model at all, so there is no generating
        # engine for a judge to be independent OF. The key is ABSENT, not False: a
        # fabricated "judge = generator" warning on a run containing no model would be
        # exactly the confident wrong answer this field exists to prevent.
        code, payload = self._evaluate(["--no-llm"])
        self.assertEqual(code, 0)
        self.assertNotIn("judgeIndependence", payload["result"])


if __name__ == "__main__":
    unittest.main()
