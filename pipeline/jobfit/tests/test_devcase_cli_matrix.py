"""Every devcase_cli door, one matrix (challenge-r08 tests-devcase/B).

The coded-ledger proof (challenge-r04 tests-llm-eval/A, test_devcase_cli.py) drove ONE
command, analyze-need, and baseline-solve kept writing an anonymous (reason None)
deterministic line for every mid-call descent while that proof stayed green. The
command set was also open: its names lived only in an inline argparse list, and the
use-case lookup silently routed an unmapped command as ``devcase_case_design``.

So the command vocabulary is now a declared table (``COMMANDS`` / ``PURE_COMMANDS``
beside ``_USE_CASE_BY_COMMAND``) and this matrix is DERIVED from it: a fixture row is
required for every door, and a door added without one turns the suite red before any
sweep runs. Each provider-backed door is then driven through ``devcase_cli.main``
under the two answering fault modes and ``--no-llm``, and its degraded envelope and
usage-ledger reason are read back; each pure door is proven never to build a provider.
"""

from __future__ import annotations

import contextlib
import io
import json
import logging
import os
import tempfile
import unittest
from pathlib import Path
from typing import Any, Callable
from unittest import mock

from pipeline.jobfit import _cli
from pipeline.jobfit.devcase import devcase_cli
from pipeline.jobfit.llm.fault import FaultProvider


def _write(d: str, name: str, obj: object) -> str:
    path = Path(d) / name
    path.write_text(json.dumps(obj), encoding="utf-8")
    return str(path)


_CASE = {"title": "Mini API", "brief": "Build a small API.", "tasks": ["t1"]}
_ROLE = {"title": "Backend", "seniority": "medior", "roleFamily": "software_engineering", "mustHaves": ["Python"]}
_NEED = {"title": "Backend", "stack": ["Python"]}
_ANALYSIS = {"realStack": ["Python"], "trueComplexity": "medium"}
_COMMITS = [{"message": "wip"}]
_PROFILE = {
    "archetype": "student",
    "roleFamily": "software_engineering",
    "skillClaims": [{"skill": "Python", "provenance": "coursework"}],
}

# command -> argv tail builder. ONE row per door; the table is checked against
# devcase_cli.COMMANDS, so a new door without a row fails here, not in production.
_FIXTURES: dict[str, Callable[[str], list[str]]] = {
    "analyze-need": lambda d: ["--need-json", _write(d, "need.json", _NEED)],
    "design-artifacts": lambda d: [
        "--need-json", _write(d, "need.json", _NEED),
        "--analysis-json", _write(d, "analysis.json", _ANALYSIS),
    ],
    "reflect-commits": lambda d: ["--commits-json", _write(d, "commits.json", _COMMITS)],
    "evaluate-submission": lambda d: [
        "--commits-json", _write(d, "commits.json", _COMMITS),
        "--case-json", _write(d, "case.json", _CASE),
        "--role-json", _write(d, "role.json", _ROLE),
    ],
    "interview-scenario": lambda d: [
        "--case-json", _write(d, "case.json", _CASE),
        "--role-json", _write(d, "role.json", _ROLE),
    ],
    "materialize-seed": lambda d: [
        "--case-json", _write(d, "case.json", _CASE),
        "--role-json", _write(d, "role.json", _ROLE),
    ],
    "session-chat": lambda d: [
        "--case-json", _write(d, "case.json", _CASE),
        "--role-json", _write(d, "role.json", _ROLE),
        "--message", "Where do I start?",
    ],
    "baseline-solve": lambda d: [
        "--case-json", _write(d, "case.json", _CASE),
        "--role-json", _write(d, "role.json", _ROLE),
    ],
    "source": lambda d: [
        "--role-json", _write(d, "role.json", _ROLE),
        "--candidates-json", _write(d, "candidates.json", []),
    ],
    "observed-interview": lambda d: [
        "--case-json", _write(d, "case.json", _CASE),
        "--role-json", _write(d, "role.json", _ROLE),
        "--scorecard-json", _write(d, "scorecard.json", {}),
        "--profile-json", _write(d, "profile.json", _PROFILE),
    ],
    "observed-skills": lambda d: [
        "--case-json", _write(d, "case.json", _CASE),
        "--role-json", _write(d, "role.json", _ROLE),
        "--evaluation-json", _write(d, "evaluation.json", {"summary": "Handled it well."}),
        "--transfer-json", _write(d, "transfer.json", {"transferScore": 82, "transfers": ["Python"], "confidence": 0.8}),
        "--profile-json", _write(d, "profile.json", _PROFILE),
    ],
}


def _provider_backed() -> list[str]:
    return [c for c in devcase_cli.COMMANDS if c not in devcase_cli.PURE_COMMANDS]


def _last_json(stream: str) -> dict:
    lines = [ln for ln in stream.splitlines() if ln.strip()]
    return json.loads(lines[-1])


def _stamp_paths(value: Any, path: str = "result") -> list[str]:
    """Every place a provenance stamp survived inside the emitted artifact."""
    found: list[str] = []
    if isinstance(value, dict):
        for key, inner in value.items():
            if key in ("fallbackReason", "fallbackCode"):
                found.append(f"{path}.{key}")
            found.extend(_stamp_paths(inner, f"{path}.{key}"))
    elif isinstance(value, list):
        for i, inner in enumerate(value):
            found.extend(_stamp_paths(inner, f"{path}[{i}]"))
    return found


class _MatrixBase(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        # Every degraded step logs a WARNING by design (pinned elsewhere); the matrix
        # reads the envelope and the ledger, so the log lines are noise here.
        logging.disable(logging.CRITICAL)

    @classmethod
    def tearDownClass(cls) -> None:
        logging.disable(logging.NOTSET)

    def _drive(
        self, command: str, *, provider: object | None, no_llm: bool = False
    ) -> tuple[int, dict | None, dict | None, list[dict], mock.MagicMock]:
        """Run one door through devcase_cli.main with the ledger on; return
        (exit, stdout envelope, stderr envelope, ledger rows, the resolve_provider mock)."""
        with tempfile.TemporaryDirectory() as d:
            argv = [command, *_FIXTURES[command](d)]
            if no_llm:
                argv.append("--no-llm")
            ledger = Path(d) / "usage.ndjson"
            out, err = io.StringIO(), io.StringIO()
            with mock.patch.dict(os.environ, {"KP_LLM_USAGE_LOG": str(ledger)}, clear=False):
                with mock.patch.object(devcase_cli, "resolve_provider", return_value=provider) as resolve:
                    with contextlib.redirect_stdout(out), contextlib.redirect_stderr(err):
                        code = devcase_cli.main(argv)
            rows = (
                [json.loads(ln) for ln in ledger.read_text(encoding="utf-8").splitlines() if ln.strip()]
                if ledger.exists()
                else []
            )
        envelope = _last_json(out.getvalue()) if out.getvalue().strip() else None
        error = _last_json(err.getvalue()) if err.getvalue().strip() else None
        return code, envelope, error, rows, resolve


class CommandVocabularyTest(unittest.TestCase):
    def test_the_command_table_is_closed_over_parser_map_and_pure_set(self):
        commands = devcase_cli.COMMANDS
        pure = devcase_cli.PURE_COMMANDS
        routed = devcase_cli._USE_CASE_BY_COMMAND
        self.assertIsInstance(commands, tuple)
        self.assertIsInstance(pure, frozenset)
        self.assertEqual(len(commands), len(set(commands)), "a command is declared twice")
        self.assertEqual(set(commands), set(routed) | pure)
        self.assertFalse(set(routed) & pure, "a door is both provider-backed and pure")
        self.assertEqual(pure, frozenset({"source", "observed-interview", "observed-skills"}))

    def test_the_parser_reads_the_table(self):
        parser_choices = None
        real = devcase_cli.argparse.ArgumentParser.add_argument

        def spy(self, *args, **kwargs):
            nonlocal parser_choices
            if args and args[0] == "command":
                parser_choices = kwargs.get("choices")
            return real(self, *args, **kwargs)

        with mock.patch.object(devcase_cli.argparse.ArgumentParser, "add_argument", spy):
            with contextlib.redirect_stdout(io.StringIO()), contextlib.redirect_stderr(io.StringIO()):
                devcase_cli.main(["source"])  # fails on missing inputs; the parser is what we read
        self.assertEqual(parser_choices, list(devcase_cli.COMMANDS))

    def test_every_door_has_a_fixture_row(self):
        # The matrix below is derived from COMMANDS; a door with no row cannot hide.
        self.assertEqual(set(_FIXTURES), set(devcase_cli.COMMANDS))
        self.assertEqual(len(_provider_backed()), 8)


class FailClosedRoutingTest(_MatrixBase):
    def test_an_unrouted_provider_backed_command_is_an_engine_error(self):
        with mock.patch.dict(devcase_cli._USE_CASE_BY_COMMAND):
            del devcase_cli._USE_CASE_BY_COMMAND["baseline-solve"]
            code, envelope, error, rows, resolve = self._drive("baseline-solve", provider=None, no_llm=True)
        self.assertEqual(code, 1)
        self.assertIsNone(envelope, "an unrouted door must not emit a result")
        self.assertIsNotNone(error)
        self.assertEqual(error["code"], _cli.ERR_ENGINE)
        self.assertIn("baseline-solve", error["error"])
        # Nothing was metered under a borrowed use case.
        resolve.assert_not_called()
        self.assertEqual(rows, [])


class ProviderBackedMatrixTest(_MatrixBase):
    def _assert_degraded(self, mode: str, expected_reason: str) -> None:
        for command in _provider_backed():
            with self.subTest(command=command, mode=mode):
                code, envelope, error, rows, _resolve = self._drive(command, provider=FaultProvider(mode))
                self.assertEqual(code, 0, f"{command} exited {code}: {error}")
                assert envelope is not None
                per_step = envelope["perStepSources"]
                self.assertTrue(per_step)
                self.assertEqual(set(per_step.values()), {"deterministic"}, per_step)
                self.assertEqual(set(envelope.get("fallbackReason") or {}), set(per_step))
                det = [r for r in rows if r.get("source") == "deterministic"]
                self.assertEqual(len(det), len(per_step), f"one deterministic ledger line per step: {rows}")
                for row in det:
                    self.assertEqual(row.get("reason"), expected_reason, f"{command}: {row}")
                    self.assertEqual(row.get("use_case"), devcase_cli._USE_CASE_BY_COMMAND[command])
                self.assertEqual(_stamp_paths(envelope["result"]), [], "a stamp leaked into the emitted artifact")
                self.assertNotIn("fallbackCode", envelope, "the code is ledger-only")

    def test_malformed_answers_are_coded_unparseable_output_on_every_door(self):
        self._assert_degraded("malformed", "unparseable_output")

    def test_wrong_shape_answers_are_coded_unusable_output_on_every_door(self):
        self._assert_degraded("wrong_shape", "unusable_output")

    def test_no_llm_is_disabled_on_every_door_and_carries_no_reason_block(self):
        for command in _provider_backed():
            with self.subTest(command=command):
                code, envelope, error, rows, resolve = self._drive(command, provider=None, no_llm=True)
                self.assertEqual(code, 0, f"{command} exited {code}: {error}")
                assert envelope is not None
                resolve.assert_not_called()
                self.assertNotIn("fallbackReason", envelope)
                det = [r for r in rows if r.get("source") == "deterministic"]
                self.assertEqual(len(det), len(envelope["perStepSources"]))
                for row in det:
                    self.assertEqual(row.get("reason"), "disabled", f"{command}: {row}")
                    self.assertEqual(row.get("use_case"), devcase_cli._USE_CASE_BY_COMMAND[command])


class PureDoorTest(_MatrixBase):
    def test_a_pure_door_never_builds_a_provider_or_meters(self):
        for command in sorted(devcase_cli.PURE_COMMANDS):
            with self.subTest(command=command):
                code, envelope, error, rows, resolve = self._drive(command, provider=FaultProvider("malformed"))
                self.assertEqual(code, 0, f"{command} exited {code}: {error}")
                assert envelope is not None
                resolve.assert_not_called()
                self.assertEqual(rows, [])
                self.assertEqual(set(envelope["perStepSources"].values()), {"deterministic"})


if __name__ == "__main__":
    unittest.main()
