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
        # Base contract is the three required keys; `confidence` is an OPTIONAL block that
        # only rides along when a step's artifact carries a 0..1 confidence self-rating.
        self.assertTrue({"result", "source", "perStepSources"} <= set(payload))
        self.assertTrue(set(payload) <= {"result", "source", "perStepSources", "confidence"})
        self.assertIn(payload["source"], ("llm", "deterministic", "partial"))
        self.assertIsInstance(payload["perStepSources"], dict)
        self.assertTrue(payload["perStepSources"], "perStepSources must never be empty")
        # `source` is always the combined verdict of the per-step sources, never independent.
        self.assertEqual(payload["source"], combine_source(*payload["perStepSources"].values()))
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
        # idea-22b0e962: the deterministic, ungrounded analysis rates itself 0.3 (deliberately
        # low), so the consumer surfaces it beside the badge and flags it as low-confidence.
        self.assertIn("confidence", payload)
        self.assertEqual(payload["confidence"]["byStep"], {"analyze": 0.3})
        self.assertEqual(payload["confidence"]["low"], ["analyze"])

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


if __name__ == "__main__":
    unittest.main()
