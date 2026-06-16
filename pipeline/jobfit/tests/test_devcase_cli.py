"""CLI error-status differentiation (idea-5ea4fc3b).

A user-fixable input problem (missing --*-json arg, pydantic validation failure)
must surface as status 400 / "invalid_input" with exit 2, while a genuine engine
failure surfaces as status 500 / "engine_error" with exit 1 — so the UI can render
a precise inline hint vs a retry/escalate toast instead of one generic banner.
"""

import contextlib
import io
import json
import tempfile
import unittest
from pathlib import Path
from unittest import mock

from pipeline.jobfit.devcase import devcase_cli
from pipeline.jobfit.devcase.models import LOW_CONFIDENCE
from pipeline.jobfit.devcase.provenance import combine_source


def _run(argv: list[str]) -> tuple[int, str, str]:
    out, err = io.StringIO(), io.StringIO()
    with contextlib.redirect_stdout(out), contextlib.redirect_stderr(err):
        code = devcase_cli.main(argv)
    return code, out.getvalue(), err.getvalue()


def _last_json(stream: str) -> dict:
    """The CLI emits one json.dumps line; parse the last non-empty line."""
    lines = [ln for ln in stream.splitlines() if ln.strip()]
    return json.loads(lines[-1])


class _AlwaysFailProvider:
    """A provider that is available but whose every LLM call raises — so every step falls
    back to its deterministic template. Mocked in for resolve_provider to exercise the
    real CLI fallback path without a Claude CLI."""

    def __init__(self, exc: Exception):
        self._exc = exc

    def available(self) -> bool:
        return True

    def complete_json(self, prompt, system=None):
        raise self._exc


class _ReflectOnlyProvider:
    """Available; succeeds for the reflect step only (matched by its prompt) and raises for
    every other step — a 'partial' run whose fallbackReason keys EXACTLY the failed steps."""

    def available(self) -> bool:
        return True

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
        raise RuntimeError("boom: no stub for this step")


class TestDevcaseCliErrorStatus(unittest.TestCase):
    def test_missing_required_arg_is_400_invalid_input(self):
        # `source` without --role-json/--candidates-json raises our explicit ValueError guard.
        code, _out, err = _run(["source"])
        self.assertEqual(code, 2)
        payload = _last_json(err)
        self.assertEqual(payload["status"], 400)
        self.assertEqual(payload["code"], "invalid_input")
        self.assertIn("error", payload)

    def test_pydantic_validation_failure_is_400_invalid_input(self):
        # A need.json that parses but isn't a valid DevNeed raises pydantic
        # ValidationError — a ValueError subclass, so it maps to 400 too.
        with tempfile.TemporaryDirectory() as d:
            need = Path(d) / "need.json"
            need.write_text("123", encoding="utf-8")  # not an object
            code, _out, err = _run(["analyze-need", "--no-llm", "--need-json", str(need)])
        self.assertEqual(code, 2)
        payload = _last_json(err)
        self.assertEqual(payload["status"], 400)
        self.assertEqual(payload["code"], "invalid_input")

    def test_engine_failure_is_500_engine_error(self):
        # Valid input, but the engine blows up mid-run -> retry/escalate, not editable.
        with tempfile.TemporaryDirectory() as d:
            role, cands = Path(d) / "role.json", Path(d) / "cands.json"
            role.write_text("{}", encoding="utf-8")
            cands.write_text("[]", encoding="utf-8")
            with mock.patch(
                "pipeline.jobfit.devcase.source.source_candidates",
                side_effect=RuntimeError("boom"),
            ):
                code, _out, err = _run(["source", "--role-json", str(role), "--candidates-json", str(cands)])
        self.assertEqual(code, 1)
        payload = _last_json(err)
        self.assertEqual(payload["status"], 500)
        self.assertEqual(payload["code"], "engine_error")
        self.assertIn("boom", payload["error"])

    def test_success_returns_zero_with_result(self):
        with tempfile.TemporaryDirectory() as d:
            role, cands = Path(d) / "role.json", Path(d) / "cands.json"
            role.write_text(json.dumps({"title": "Backend", "roleFamily": "software_engineering"}), encoding="utf-8")
            cands.write_text("[]", encoding="utf-8")
            code, out, _err = _run(["source", "--role-json", str(role), "--candidates-json", str(cands)])
        self.assertEqual(code, 0)
        # Success now always carries the uniform provenance envelope (idea-ee96b185).
        self.assertEqual(set(_last_json(out)), {"result", "source", "perStepSources"})

    def test_source_result_carries_skipped_count(self):
        # idea-19e24fe9: a candidate whose payload fails validation must be counted in the
        # envelope's result.skipped (with a per-skip reason) instead of vanishing silently.
        with tempfile.TemporaryDirectory() as d:
            role, cands = Path(d) / "role.json", Path(d) / "cands.json"
            role.write_text(json.dumps({"title": "Backend", "roleFamily": "software_engineering"}), encoding="utf-8")
            cands.write_text(json.dumps([{"id": "broken", "payload": {"skillClaims": [{"level": "advanced"}]}}]), encoding="utf-8")
            code, out, _err = _run(["source", "--role-json", str(role), "--candidates-json", str(cands)])
        self.assertEqual(code, 0)
        result = _last_json(out)["result"]
        self.assertEqual(result["candidates"], [])
        self.assertEqual(result["skipped"], 1)
        self.assertEqual(result["skippedReasons"], [{"candidateId": "broken", "reason": "ValidationError"}])


class TestDevcaseCliProvenanceContract(unittest.TestCase):
    """Every command emits the same {result, source, perStepSources} envelope
    (idea-ee96b185) — single-step commands carry a one-key perStepSources map —
    so the frontend has ONE stable contract to render a consistent provenance
    strip (and its degraded 'partial' badge) across the whole pipeline.
    """

    def _assert_envelope(self, payload: dict) -> None:
        # Base contract is the three required keys; `confidence` and `fallbackReason` are
        # OPTIONAL blocks that only ride along when a step rates its own confidence, or when
        # a step's LLM call raised and fell back (idea-81a8c28f) respectively.
        self.assertTrue({"result", "source", "perStepSources"} <= set(payload))
        self.assertTrue(set(payload) <= {"result", "source", "perStepSources", "confidence", "fallbackReason"})
        self.assertIn(payload["source"], ("llm", "deterministic", "partial"))
        self.assertIsInstance(payload["perStepSources"], dict)
        self.assertTrue(payload["perStepSources"], "perStepSources must never be empty")
        # `source` is always the combined verdict of the per-step sources, never independent.
        self.assertEqual(payload["source"], combine_source(*payload["perStepSources"].values()))
        if "fallbackReason" in payload:
            reasons = payload["fallbackReason"]
            self.assertTrue(reasons, "fallbackReason block is only emitted when non-empty")
            # Every reason keys a real step, and that step necessarily fell back (deterministic).
            self.assertTrue(set(reasons) <= set(payload["perStepSources"]))
            for step, reason in reasons.items():
                self.assertEqual(payload["perStepSources"][step], "deterministic")
                self.assertIsInstance(reason, str)
                self.assertTrue(reason)
        if "confidence" in payload:
            conf = payload["confidence"]
            self.assertEqual(set(conf), {"byStep", "threshold", "low"})
            self.assertTrue(conf["byStep"], "confidence block is only emitted when non-empty")
            self.assertEqual(conf["threshold"], LOW_CONFIDENCE)
            # `low` is exactly the steps at/below the threshold, drawn from byStep.
            self.assertEqual(conf["low"], sorted(s for s, v in conf["byStep"].items() if v <= LOW_CONFIDENCE))

    def test_source_command_emits_one_key_deterministic_map(self):
        # `source` is pure matching: it used to emit {result} alone — now it must
        # carry the same envelope, a one-key {"source": "deterministic"} map.
        with tempfile.TemporaryDirectory() as d:
            role, cands = Path(d) / "role.json", Path(d) / "cands.json"
            role.write_text(json.dumps({"title": "Backend", "roleFamily": "software_engineering"}), encoding="utf-8")
            cands.write_text("[]", encoding="utf-8")
            code, out, _err = _run(["source", "--role-json", str(role), "--candidates-json", str(cands)])
        self.assertEqual(code, 0)
        payload = _last_json(out)
        self._assert_envelope(payload)
        self.assertEqual(payload["perStepSources"], {"source": "deterministic"})

    def test_analyze_need_emits_perstepsources(self):
        # analyze-need previously dropped perStepSources entirely; it must now
        # carry a one-key {"analyze": ...} map like every other command.
        with tempfile.TemporaryDirectory() as d:
            need = Path(d) / "need.json"
            need.write_text(json.dumps({"title": "Backend", "stack": ["Python"]}), encoding="utf-8")
            code, out, _err = _run(["analyze-need", "--no-llm", "--need-json", str(need)])
        self.assertEqual(code, 0)
        payload = _last_json(out)
        self._assert_envelope(payload)
        self.assertEqual(list(payload["perStepSources"]), ["analyze"])
        self.assertEqual(payload["source"], "deterministic")  # --no-llm forces the template path
        # idea-81a8c28f: --no-llm is a DELIBERATE deterministic run, not a failed LLM call, so it
        # carries NO fallbackReason — the reason block is reserved for a swallowed exception, and
        # the artifact itself never leaks the transient key either (it's popped into the envelope).
        self.assertNotIn("fallbackReason", payload)
        self.assertNotIn("fallbackReason", payload["result"])
        # idea-22b0e962: the deterministic, ungrounded analysis rates itself 0.3 (deliberately
        # low), so the consumer surfaces it beside the badge and flags it as low-confidence.
        self.assertIn("confidence", payload)
        self.assertEqual(payload["confidence"]["byStep"], {"analyze": 0.3})
        self.assertEqual(payload["confidence"]["low"], ["analyze"])

    def test_evaluate_submission_surfaces_propagated_decision_confidence(self):
        # idea-9281c8e9: evaluate/transfer now carry a PROPAGATED confidence (min of the upstream
        # reflection/tooling), surfaced beside the badge so a decision built on thin/degraded
        # evidence isn't mistaken for an authoritative one. --no-llm => reflect 0.3, tooling 0.2,
        # so evaluate = transfer = min = 0.2 — all at/below the low-confidence threshold.
        with tempfile.TemporaryDirectory() as d:
            commits = Path(d) / "commits.json"
            commits.write_text(json.dumps([{"message": "wip"}]), encoding="utf-8")
            case = Path(d) / "case.json"
            case.write_text(json.dumps({"rubricDimensions": []}), encoding="utf-8")
            role = Path(d) / "role.json"
            role.write_text(json.dumps({"title": "Backend", "seniority": "medior"}), encoding="utf-8")
            code, out, _err = _run(
                ["evaluate-submission", "--no-llm", "--commits-json", str(commits), "--case-json", str(case), "--role-json", str(role)]
            )
        self.assertEqual(code, 0)
        payload = _last_json(out)
        self._assert_envelope(payload)
        conf = payload["confidence"]["byStep"]
        # All four evidence-bearing steps report a confidence; followups (interview material) does not.
        self.assertEqual(set(conf), {"reflect", "tooling", "evaluate", "transfer"})
        # The decision artifacts inherit the WEAKEST upstream signal (tooling 0.2), never a rosier mean.
        self.assertEqual(conf["evaluate"], 0.2)
        self.assertEqual(conf["transfer"], 0.2)
        self.assertEqual(payload["confidence"]["low"], ["evaluate", "reflect", "tooling", "transfer"])

    def test_design_artifacts_emits_multi_step_map(self):
        with tempfile.TemporaryDirectory() as d:
            need, analysis = Path(d) / "need.json", Path(d) / "analysis.json"
            need.write_text(json.dumps({"title": "Backend", "stack": ["Python"]}), encoding="utf-8")
            analysis.write_text(json.dumps({"realStack": ["Python"], "trueComplexity": "medium"}), encoding="utf-8")
            code, out, _err = _run(
                ["design-artifacts", "--no-llm", "--need-json", str(need), "--analysis-json", str(analysis)]
            )
        self.assertEqual(code, 0)
        payload = _last_json(out)
        self._assert_envelope(payload)
        self.assertEqual(set(payload["perStepSources"]), {"role", "case"})
        self.assertEqual(set(payload["result"]), {"role", "case"})
        # role/case carry no confidence self-rating, so the optional block is omitted entirely.
        self.assertNotIn("confidence", payload)


class TestDevcaseCliInputGuards(unittest.TestCase):
    """Missing required flags (idea-1352c4e9) and wrong-SHAPE-but-valid-JSON inputs
    (idea-e6c71e0a) must fail loudly as 400 invalid_input / exit 2 — never silently degrade
    to a confident-looking ungrounded result, nor misroute to 500 engine_error."""

    def test_evaluate_submission_requires_case_and_role(self):
        # Omitting --case-json used to default the rubric to {} and exit 0 with an ungrounded
        # CaseEvaluation; it must now be a loud 400 (fix-your-input) instead.
        with tempfile.TemporaryDirectory() as d:
            commits, role = Path(d) / "commits.json", Path(d) / "role.json"
            commits.write_text(json.dumps([{"message": "wip"}]), encoding="utf-8")
            role.write_text(json.dumps({"title": "Backend", "seniority": "medior"}), encoding="utf-8")
            code, _out, err = _run(
                ["evaluate-submission", "--no-llm", "--commits-json", str(commits), "--role-json", str(role)]
            )
        self.assertEqual(code, 2)
        payload = _last_json(err)
        self.assertEqual(payload["status"], 400)
        self.assertEqual(payload["code"], "invalid_input")

    def test_wrong_shape_commits_is_400_not_500(self):
        # A valid-JSON object where an array of objects is required — parses, then would blow
        # up in reflect_commits (iterating a dict) and misroute to 500 without the shape guard.
        with tempfile.TemporaryDirectory() as d:
            commits = Path(d) / "commits.json"
            commits.write_text(json.dumps({"message": "not an array"}), encoding="utf-8")
            code, _out, err = _run(["reflect-commits", "--no-llm", "--commits-json", str(commits)])
        self.assertEqual(code, 2)
        payload = _last_json(err)
        self.assertEqual(payload["status"], 400)
        self.assertEqual(payload["code"], "invalid_input")

    def test_wrong_shape_candidates_is_400_not_500(self):
        # An array of strings (not objects) for --candidates-json: source_candidates would
        # AttributeError on c.get(...) and misroute to 500 without the guard.
        with tempfile.TemporaryDirectory() as d:
            role, cands = Path(d) / "role.json", Path(d) / "cands.json"
            role.write_text(json.dumps({"title": "Backend", "roleFamily": "software_engineering"}), encoding="utf-8")
            cands.write_text(json.dumps(["alice", "bob"]), encoding="utf-8")
            code, _out, err = _run(["source", "--role-json", str(role), "--candidates-json", str(cands)])
        self.assertEqual(code, 2)
        payload = _last_json(err)
        self.assertEqual(payload["status"], 400)
        self.assertEqual(payload["code"], "invalid_input")


class TestDevcaseCliObservedSkills(unittest.TestCase):
    """observed-skills — the take-home -> observed-evidence bridge as a CLI step:
    the same deterministic gate as live_case.apply_live_case, emitted in the uniform
    envelope so the TS promote path can persist the enriched profile."""

    def _write(self, d: str, name: str, obj: object) -> str:
        p = Path(d) / name
        p.write_text(json.dumps(obj), encoding="utf-8")
        return str(p)

    def _args(self, d: str, transfer_score: int) -> list[str]:
        return [
            "observed-skills",
            "--case-json", self._write(d, "case.json", {"title": "Mini API"}),
            "--role-json", self._write(d, "role.json", {
                "title": "Backend", "roleFamily": "software_engineering",
                "seniority": "junior", "mustHaves": ["Python", "SQL"],
            }),
            "--evaluation-json", self._write(d, "eval.json", {"summary": "Handled it well."}),
            # Healthy propagated confidence on purpose — these tests pin the SCORE
            # gate; the low-confidence kill is pinned in test_live_case.py.
            "--transfer-json", self._write(d, "transfer.json", {"transferScore": transfer_score, "transfers": ["Python", "SQL"], "confidence": 0.8}),
            "--profile-json", self._write(d, "profile.json", {
                "archetype": "student", "roleFamily": "software_engineering",
                "skillClaims": [{"skill": "Python", "provenance": "coursework"}],
            }),
        ]

    def test_passing_take_home_mints_observed_evidence(self):
        with tempfile.TemporaryDirectory() as d:
            code, out, _err = _run(self._args(d, 82))
        self.assertEqual(code, 0)
        payload = _last_json(out)
        self.assertEqual(payload["perStepSources"], {"observed": "deterministic"})
        self.assertEqual(payload["result"]["creditedSkills"], ["Python", "SQL"])
        evidence = payload["result"]["profile"].get("evidence", [])
        self.assertTrue(any(e.get("provenance") == "observed" for e in evidence))

    def test_below_bar_credits_nothing(self):
        with tempfile.TemporaryDirectory() as d:
            code, out, _err = _run(self._args(d, 40))
        self.assertEqual(code, 0)
        payload = _last_json(out)
        self.assertEqual(payload["result"]["creditedSkills"], [])
        evidence = payload["result"]["profile"].get("evidence", [])
        self.assertFalse(any(e.get("provenance") == "observed" for e in evidence))

    def test_missing_inputs_are_400(self):
        code, _out, err = _run(["observed-skills"])
        self.assertEqual(code, 2)
        payload = _last_json(err)
        self.assertEqual(payload["status"], 400)
        self.assertEqual(payload["code"], "invalid_input")


class TestDevcaseCliFallbackReason(unittest.TestCase):
    """idea-81a8c28f — when a step's LLM call RAISES and falls back to its deterministic
    template, the swallowed cause must surface in the envelope's `fallbackReason` map (and be
    logged at WARNING). A fully-deterministic run previously looked identical whether the
    provider was down, slow, or returning garbage; the reason makes the failure mode visible."""

    def _need(self, d: str) -> str:
        need = Path(d) / "need.json"
        need.write_text(json.dumps({"title": "Backend", "stack": ["Python"]}), encoding="utf-8")
        return str(need)

    def test_llm_exception_surfaces_reason_and_keeps_artifact_clean(self):
        with tempfile.TemporaryDirectory() as d:
            need = self._need(d)
            # NOTE: no --no-llm — the CLI builds a (mocked) provider, whose call raises.
            with mock.patch.object(devcase_cli, "resolve_provider", return_value=_AlwaysFailProvider(RuntimeError("provider is down"))):
                code, out, _err = _run(["analyze-need", "--need-json", need])
        self.assertEqual(code, 0)
        payload = _last_json(out)
        self.assertEqual(payload["source"], "deterministic")  # the only step fell back
        self.assertEqual(payload["fallbackReason"], {"analyze": "RuntimeError: provider is down"})
        # The reason rides in the envelope, NEVER inside the artifact — so a saved analysis fed
        # back into design-artifacts stays clean (the key is popped off before emit).
        self.assertNotIn("fallbackReason", payload["result"])

    def test_reason_distinguishes_failure_modes(self):
        # The point of the requirement: a timeout, a JSON parse error and a misconfigured
        # provider must read DIFFERENTLY. The captured "<Type>: <message>" is threaded verbatim.
        for expected, exc in (
            ("TimeoutError: Claude CLI timed out after 120s", TimeoutError("Claude CLI timed out after 120s")),
            ("ValueError: Claude did not return parseable JSON", ValueError("Claude did not return parseable JSON")),
            ("FileNotFoundError: Claude CLI not found. Is it on PATH?", FileNotFoundError("Claude CLI not found. Is it on PATH?")),
        ):
            with tempfile.TemporaryDirectory() as d:
                need = self._need(d)
                with mock.patch.object(devcase_cli, "resolve_provider", return_value=_AlwaysFailProvider(exc)):
                    code, out, _err = _run(["analyze-need", "--need-json", need])
            self.assertEqual(code, 0)
            self.assertEqual(_last_json(out)["fallbackReason"]["analyze"], expected)

    def test_reason_is_logged_at_warning(self):
        with tempfile.TemporaryDirectory() as d:
            need = self._need(d)
            with mock.patch.object(devcase_cli, "resolve_provider", return_value=_AlwaysFailProvider(RuntimeError("xyz cause"))):
                with self.assertLogs("pipeline.jobfit.devcase.analyze", level="WARNING") as cm:
                    _run(["analyze-need", "--need-json", need])
        self.assertTrue(any("fell back to deterministic" in m and "xyz cause" in m for m in cm.output))

    def _case_role(self, d: str) -> tuple[str, str]:
        case = Path(d) / "case.json"
        case.write_text(json.dumps({"title": "Mini API", "brief": "b", "tasks": ["t1"]}), encoding="utf-8")
        role = Path(d) / "role.json"
        role.write_text(json.dumps({"title": "Backend", "seniority": "medior"}), encoding="utf-8")
        return str(case), str(role)

    def test_materialize_seed_surfaces_reason(self):
        # The seed was one of the LAST two steps with a bare `except Exception`: a timed-out
        # provider shipped the prose-only skeleton while the run read as healthy. The cause
        # must now ride in the envelope (and never inside the saved seed artifact).
        with tempfile.TemporaryDirectory() as d:
            case, role = self._case_role(d)
            exc = TimeoutError("Claude CLI timed out after 120s")
            with mock.patch.object(devcase_cli, "resolve_provider", return_value=_AlwaysFailProvider(exc)):
                with self.assertLogs("pipeline.jobfit.devcase.seed_materializer", level="WARNING") as cm:
                    code, out, _err = _run(["materialize-seed", "--case-json", case, "--role-json", role])
        self.assertEqual(code, 0)
        payload = _last_json(out)
        self._assert_no_llm_shape(payload, step="seed")
        self.assertEqual(payload["fallbackReason"], {"seed": "TimeoutError: Claude CLI timed out after 120s"})
        self.assertTrue(any("fell back to deterministic" in m for m in cm.output))

    def test_interview_scenario_surfaces_reason(self):
        # Same hole for the interview scenario: template probes shipped as a healthy success.
        with tempfile.TemporaryDirectory() as d:
            case, role = self._case_role(d)
            exc = ValueError("Claude did not return parseable JSON")
            with mock.patch.object(devcase_cli, "resolve_provider", return_value=_AlwaysFailProvider(exc)):
                with self.assertLogs("pipeline.jobfit.devcase.interview_scenario", level="WARNING") as cm:
                    code, out, _err = _run(["interview-scenario", "--case-json", case, "--role-json", role])
        self.assertEqual(code, 0)
        payload = _last_json(out)
        self._assert_no_llm_shape(payload, step="scenario")
        self.assertEqual(payload["fallbackReason"], {"scenario": "ValueError: Claude did not return parseable JSON"})
        self.assertTrue(any("fell back to deterministic" in m for m in cm.output))

    def _assert_no_llm_shape(self, payload: dict, step: str) -> None:
        """The failed single step fell back, and the saved artifact stays clean —
        the reason is popped into the envelope, never persisted with the blob."""
        self.assertEqual(payload["source"], "deterministic")
        self.assertEqual(payload["perStepSources"], {step: "deterministic"})
        self.assertNotIn("fallbackReason", payload["result"][step])

    def test_seed_and_scenario_no_llm_carry_no_reason(self):
        # --no-llm is a DELIBERATE deterministic run, not a failed LLM call — no reason block.
        for command, step in (("materialize-seed", "seed"), ("interview-scenario", "scenario")):
            with tempfile.TemporaryDirectory() as d:
                case, role = self._case_role(d)
                code, out, _err = _run([command, "--no-llm", "--case-json", case, "--role-json", role])
            self.assertEqual(code, 0)
            payload = _last_json(out)
            self._assert_no_llm_shape(payload, step=step)
            self.assertNotIn("fallbackReason", payload)

    def test_multi_step_keys_only_the_failed_steps(self):
        with tempfile.TemporaryDirectory() as d:
            commits = Path(d) / "commits.json"
            commits.write_text(json.dumps([{"message": "wip"}]), encoding="utf-8")
            case = Path(d) / "case.json"
            case.write_text("{}", encoding="utf-8")
            role = Path(d) / "role.json"
            role.write_text(json.dumps({"title": "Backend", "seniority": "medior"}), encoding="utf-8")
            with mock.patch.object(devcase_cli, "resolve_provider", return_value=_ReflectOnlyProvider()):
                code, out, _err = _run(
                    ["evaluate-submission", "--commits-json", str(commits), "--case-json", str(case), "--role-json", str(role)]
                )
        self.assertEqual(code, 0)
        payload = _last_json(out)
        # reflect succeeded (llm); every later step raised and fell back -> the verdict is partial.
        self.assertEqual(payload["source"], "partial")
        self.assertEqual(payload["perStepSources"]["reflect"], "llm")
        # fallbackReason keys EXACTLY the steps that raised — the one that succeeded is absent.
        self.assertNotIn("reflect", payload["fallbackReason"])
        self.assertEqual(set(payload["fallbackReason"]), {"tooling", "evaluate", "transfer", "followups"})
        # No emitted artifact leaks the transient key.
        for art in payload["result"].values():
            self.assertNotIn("fallbackReason", art)


if __name__ == "__main__":
    unittest.main()
