"""One evaluation pipeline, certified on the path in-product candidates take.

The evaluate-submission chain (observed events -> tooling, seed paths, submission
excerpts, prompt signals, canary verdicts, baseline distance -> extras -> evaluate ->
transfer -> followups) used to be assembled only inside devcase_cli's argv branch, so
the fairness/discrimination gate (submission_eval) could not run it without a
subprocess and certified the commit-message path alone. These cases pin:

  * PARITY — run_evaluation and the CLI envelope agree on the result, the per-step
    sources, the confidences and every fallback reason AND its ledger code (r04's
    FallbackReasons.codes must survive the extraction);
  * the gate routes an OBSERVED scenario through run_evaluation;
  * the observed scenario family (one fixed template per BEHAVIOR, replicated to n)
    passes fairness + discrimination keyless, and the CLI --path observed --strict
    exits 0.
"""

from __future__ import annotations

import contextlib
import io
import json
import tempfile
import unittest
from pathlib import Path
from unittest import mock

from pipeline.jobfit.devcase import devcase_cli
from pipeline.jobfit.devcase.evaluation_pipeline import EvaluationInputs, run_evaluation
from pipeline.jobfit.devcase.submission_eval import (
    AI_PENALTY_TOLERANCE,
    MIN_DISCRIMINATION_MARGIN,
    MIN_GROUP_N,
    main as eval_main,
    run,
    run_one,
    signals,
)
from pipeline.jobfit.devcase.submission_scenarios import BEHAVIORS, generate_submissions

_LEGACY = "def rate(x):\n    RATE = 0.19\n    return x * RATE\n\n\ndef keep():\n    return 1\n"
_CONFIG = "TIMEOUT = 30\nRETRIES = 'retries = 0'\nNAME = 'svc'\n"


def _fixture() -> dict:
    """A casesim-shaped Live Work Surface submission: events + chat + submitted tree +
    seed with 2 canaries + a frozen baseline."""
    probes = [
        {"id": "p1", "kind": "legacy_trap", "where": "src/legacy.py", "reveals": "read first?"},
        {"id": "p2", "kind": "verification_trap", "where": "tests/test_legacy.py", "reveals": "real tests?"},
    ]
    seed = {
        "files": [
            {"path": "src/legacy.py", "contents": _LEGACY},
            {"path": "src/config.py", "contents": _CONFIG},
            {"path": "tests/test_legacy.py", "contents": "def test_rate():\n    assert True\n"},
            {"path": "DECISIONS.md", "contents": "# Decisions\n"},
        ],
        "canaries": [
            {"id": "c1", "kind": "subtle_bug", "path": "src/legacy.py", "flaw": "hardcoded 'RATE = 0.19' tax rate", "reveals": "r"},
            {"id": "c2", "kind": "subtle_bug", "path": "src/config.py", "flaw": "the config sets 'retries = 0'", "reveals": "r"},
        ],
    }
    files = [
        {"path": "src/legacy.py", "contents": "def rate(x, rate):\n    return x * rate\n\n\ndef keep():\n    return 1\n"},
        {"path": "src/config.py", "contents": _CONFIG},
        {"path": "tests/test_legacy.py", "contents": "def test_rate():\n    assert rate(10, 0.2) == 2\n"},
        {"path": "DECISIONS.md", "contents": "# Decisions\n- src/legacy.py: rate is a parameter now\n"},
    ]
    events = [
        {"t": 1, "kind": "open", "path": "src/legacy.py"},
        {"t": 2, "kind": "open", "path": "tests/test_legacy.py"},
        {"t": 3, "kind": "prompt", "path": "assistant"},
        {"t": 4, "kind": "edit", "path": "src/legacy.py"},
        {"t": 5, "kind": "edit", "path": "tests/test_legacy.py"},
        {"t": 6, "kind": "decision_log", "path": "DECISIONS.md"},
        {"t": 7, "kind": "decision_log", "path": "DECISIONS.md"},
        {"t": 8, "kind": "submit", "path": "DECISIONS.md"},
    ]
    chat = [
        {"channel": "assistant", "role": "user", "text": "Draft a rate() that takes the rate as a parameter"},
        {"channel": "assistant", "role": "model", "text": "Here you go"},
        {"channel": "assistant", "role": "user", "text": "Now check it against the existing test and verify the edge cases"},
        {"channel": "stakeholder", "role": "user", "text": "Which tax rate should apply to exports?"},
    ]
    baseline = {"solutions": [{"files": [{"path": "src/legacy.py", "contents": _LEGACY + "\n# one-shot\n"}]}]}
    case = {"title": "Rate module", "brief": "Make the rate configurable.", "coverProbes": probes,
            "rubricDimensions": [{"name": n, "weight": 0.2} for n in ("framing", "tooling", "judgment", "architecture", "transfer")]}
    role = {"title": "Backend engineer", "seniority": "medior", "mustHaves": ["Python"], "responsibilities": ["APIs"]}
    return {"probes": probes, "seed": seed, "files": files, "events": events, "chat": chat, "baseline": baseline, "case": case, "role": role}


def _inputs(fx: dict) -> EvaluationInputs:
    return EvaluationInputs(
        commits=[], probes=fx["probes"], case=fx["case"], role=fx["role"], events=fx["events"],
        seed=fx["seed"], files=fx["files"], chat=fx["chat"], baseline=fx["baseline"],
    )


def _cli(fx: dict, *extra: str) -> tuple[int, dict]:
    with tempfile.TemporaryDirectory() as d:
        def w(name: str, data) -> str:
            p = Path(d) / name
            p.write_text(json.dumps(data, ensure_ascii=False), encoding="utf-8")
            return str(p)

        argv = [
            "evaluate-submission", "--commits-json", w("c.json", []), "--probes-json", w("p.json", fx["probes"]),
            "--case-json", w("k.json", fx["case"]), "--role-json", w("r.json", fx["role"]),
            "--events-json", w("e.json", fx["events"]), "--chat-json", w("ch.json", fx["chat"]),
            "--files-json", w("f.json", fx["files"]), "--seed-json", w("s.json", fx["seed"]),
            "--baseline-json", w("b.json", fx["baseline"]), *extra,
        ]
        out, err = io.StringIO(), io.StringIO()
        with contextlib.redirect_stdout(out), contextlib.redirect_stderr(err):
            code = devcase_cli.main(argv)
    lines = [ln for ln in out.getvalue().splitlines() if ln.strip()]
    return code, json.loads(lines[-1]) if lines else {}


class TestEnvelopeParity(unittest.TestCase):
    """Case 1 — the CLI is a thin argv -> EvaluationInputs adapter over run_evaluation."""

    def test_keyless_result_sources_and_confidence_match_the_cli(self):
        fx = _fixture()
        code, env = _cli(fx, "--no-llm")
        self.assertEqual(code, 0, env)
        ran = run_evaluation(_inputs(fx), provider=None)
        self.assertEqual(env["result"], ran.result)
        for key in ("reflection", "tooling", "evaluation", "transfer", "followups", "observedChecks"):
            self.assertIn(key, ran.result)
        self.assertEqual(env["perStepSources"], ran.per_step)
        self.assertEqual(env["confidence"]["byStep"], ran.confidences)
        self.assertNotIn("fallbackReason", env)
        self.assertEqual(dict(ran.fallback_reasons), {})
        # The observed evidence really was assembled (not a commit-only run).
        self.assertIn("signals", ran.result["tooling"])
        self.assertEqual(len(ran.result["observedChecks"]["canaryOutcomes"]), 2)
        self.assertTrue(ran.result["observedChecks"]["baselineSimilarity"]["available"])

    def test_coded_descents_survive_the_extraction(self):
        # r04 (4771dcc46): every descent stamps a fallbackCode that rides on
        # FallbackReasons.codes to the usage ledger — never in the envelope. A
        # run_evaluation that returned a plain dict would silently drop it.
        from pipeline.jobfit.llm.fault import FaultProvider

        fx = _fixture()
        with mock.patch.object(devcase_cli, "resolve_provider", return_value=FaultProvider("wrong_shape")), \
                mock.patch.object(devcase_cli, "emit_deterministic") as emit:
            code, env = _cli(fx)
        self.assertEqual(code, 0, env)
        ran = run_evaluation(_inputs(fx), provider=FaultProvider("wrong_shape"))
        self.assertTrue(ran.fallback_reasons, "a wrong-shape provider must descend with a reason")
        self.assertEqual(env["fallbackReason"], dict(ran.fallback_reasons))
        self.assertEqual(env["perStepSources"], ran.per_step)
        self.assertTrue(ran.fallback_reasons.codes)
        ledger = {c.kwargs.get("reason") for c in emit.call_args_list}
        self.assertEqual(ledger, set(ran.fallback_reasons.codes.values()))
        # Result parity modulo the install-configuration stamp the CLI owns.
        cli_result = {k: v for k, v in env["result"].items() if k != "judgeIndependence"}
        self.assertEqual(cli_result, ran.result)
        self.assertIn("judgeIndependence", env["result"])
        for art in ran.result.values():
            if isinstance(art, dict):
                self.assertNotIn("fallbackCode", art)
                self.assertNotIn("fallbackReason", art)


class TestGateRunsTheObservedPath(unittest.TestCase):
    """Case 2 — run_one feeds an observed scenario's events/seed/files/chat through."""

    def test_observed_row_carries_signals_and_canary_verdicts(self):
        scn = generate_submissions(6, path="observed")[0]
        row = run_one(scn, None)
        self.assertTrue(row.reliable, row.issues)
        self.assertIn("signals", row.tooling)
        self.assertTrue(row.observed_checks.get("canaryOutcomes"))
        self.assertTrue(row.observed_checks.get("promptSignals") or scn.chat == [])

    def test_commit_row_is_unchanged_in_shape(self):
        row = run_one(generate_submissions(1)[0], None)
        self.assertNotIn("signals", row.tooling)
        self.assertEqual(row.observed_checks, {})


class TestObservedFamily(unittest.TestCase):
    """Case 3 — one fixed template per BEHAVIOR, replicated to n (no per-scenario generator)."""

    def test_every_behavior_has_the_full_observed_bundle(self):
        scns = generate_submissions(48, path="observed")
        self.assertEqual(len(scns), 48)
        seen = {s.planted["behavior"] for s in scns}
        self.assertEqual(seen, set(BEHAVIORS))
        for s in scns:
            self.assertEqual(s.planted["path"], "observed")
            self.assertTrue(s.events and s.files and s.seed)
            self.assertGreaterEqual(len(s.seed.get("canaries") or []), 2)

    def test_verifiers_read_first_and_non_verifiers_do_not(self):
        for s in generate_submissions(6, path="observed"):
            kinds = [e["kind"] for e in s.events]
            if s.planted["verifies"]:
                self.assertLess(kinds.index("open"), kinds.index("edit"), s.planted["behavior"])
                self.assertTrue(any(e["kind"] == "edit" and "test" in e["path"] for e in s.events))
            else:
                self.assertFalse(any(e["kind"] == "edit" and "test" in e["path"] for e in s.events))

    def test_template_is_fixed_per_behavior(self):
        a = generate_submissions(12, path="observed")
        for x, y in zip(a[:6], a[6:]):
            self.assertEqual(x.planted["behavior"], y.planted["behavior"])
            self.assertEqual((x.events, x.files, x.chat, x.seed), (y.events, y.files, y.chat, y.seed))

    def test_cohorts_clear_the_minimum(self):
        f = signals(run(generate_submissions(48, path="observed"), None))
        for sample in (f["fairness"]["sample"], f["discrimination"]["sample"]):
            for name, n in sample.items():
                self.assertGreaterEqual(n, MIN_GROUP_N, name)


class TestKeylessObservedGate(unittest.TestCase):
    """Case 4 — the gate certifies the observed path keyless."""

    def test_fairness_and_discrimination_pass(self):
        sig = signals(run(generate_submissions(48, path="observed"), None))
        self.assertEqual(sig["reliability"], 1.0)
        f, d = sig["fairness"], sig["discrimination"]
        self.assertEqual(f["status"], "pass", f)
        self.assertEqual(d["status"], "pass", d)
        self.assertGreaterEqual(d["margin"], MIN_DISCRIMINATION_MARGIN)
        self.assertGreaterEqual(d["gamer_margin"], MIN_DISCRIMINATION_MARGIN)
        self.assertGreaterEqual(f["margins"]["ai_gap"], -AI_PENALTY_TOLERANCE)


class TestObservedCli(unittest.TestCase):
    """Case 7 — `submission_eval --path observed --count 48 --no-llm --strict` exits 0."""

    def _main(self, argv):
        buf = io.StringIO()
        with contextlib.redirect_stdout(buf), contextlib.redirect_stderr(buf):
            return eval_main(argv), buf.getvalue()

    def test_observed_strict_exits_zero(self):
        code, out = self._main(["--path", "observed", "--count", "48", "--no-llm", "--strict"])
        self.assertEqual(code, 0, out)

    def test_both_paths_strict_exits_zero(self):
        code, out = self._main(["--path", "both", "--count", "48", "--no-llm", "--strict"])
        self.assertEqual(code, 0, out)


if __name__ == "__main__":
    unittest.main()
