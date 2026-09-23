"""The Claude CLI folded under ``TextProvider`` (challenge-r07 llm-layer/A).

The CLI is the engine every local install and every keyless-dev run actually
uses, and until this fold it was the one provider that did not run the shared
layer in ``llm/base.py``: no repair re-prompt, no retry on an overloaded
envelope, and a timeout with no subtype, so the durable ledger filed it under
the catch-all ``provider_error``. These cases pin the fold against a STUBBED
SPAWN (``subprocess.run`` inside ``claude_cli``), so "exactly N spawns" counts
real child processes the engine would have started, not method calls.
"""

from __future__ import annotations

import json
import os
import subprocess
import tempfile
import unittest
from contextlib import ExitStack, contextmanager
from pathlib import Path
from typing import Any, Iterator
from unittest import mock

from pipeline.jobfit import claude_cli
from pipeline.jobfit.llm import degradation, monitor
from pipeline.jobfit.llm.base import LLMError, TextProvider
from pipeline.jobfit.llm.config import ENV_VAR

_POLICY_ENV = ("NODE_ENV", "KP_ALLOW_CLI_ENGINE", "KP_OFFLINE", "ANTHROPIC_API_KEY", "ANTHROPIC_AUTH_TOKEN", ENV_VAR)


def _envelope(result: str, *, is_error: bool = False, cost: float | None = 0.0123) -> str:
    body: dict[str, Any] = {
        "type": "result",
        "subtype": "success",
        "is_error": is_error,
        "result": result,
        "duration_ms": 850,
        "num_turns": 1,
        "session_id": "s-1",
        "usage": {"input_tokens": 120, "output_tokens": 30, "cache_read_input_tokens": 7},
    }
    if cost is not None:
        body["total_cost_usd"] = cost
    return json.dumps(body)


class _Spawn:
    """A scripted ``subprocess.run``: each call pops one step (an envelope string
    or an exception) and is counted."""

    def __init__(self, steps: list[Any]) -> None:
        self.steps = list(steps)
        self.calls = 0

    def __call__(self, args: Any, **kwargs: Any) -> subprocess.CompletedProcess:
        self.calls += 1
        step = self.steps.pop(0)
        if isinstance(step, BaseException):
            raise step
        return subprocess.CompletedProcess(args, 0, stdout=step, stderr="")


@contextmanager
def _env(**values: str) -> Iterator[None]:
    with mock.patch.dict(os.environ, {}, clear=False):
        for key in _POLICY_ENV:
            os.environ.pop(key, None)
        os.environ.update(values)
        yield


@contextmanager
def _stubbed(spawn: _Spawn) -> Iterator[None]:
    with ExitStack() as stack:
        stack.enter_context(mock.patch.object(claude_cli.subprocess, "run", spawn))
        stack.enter_context(mock.patch.object(claude_cli.shutil, "which", return_value="/usr/bin/claude"))
        stack.enter_context(mock.patch.object(claude_cli, "_warn_on_version_drift", lambda _exe: None))
        # the retry backoff is real wall-clock sleep; the deadline arithmetic is not
        stack.enter_context(mock.patch("pipeline.jobfit.llm.base.time.sleep", lambda _s: None))
        yield


@contextmanager
def _ledger() -> Iterator[Path]:
    monitor.reset()
    with tempfile.TemporaryDirectory() as d:
        path = Path(d) / "usage.ndjson"
        with mock.patch.dict(os.environ, {"KP_LLM_USAGE_LOG": str(path)}, clear=False):
            os.environ.pop("LIGHTTRACK_URL", None)
            yield path
    monitor.reset()


def _rows(path: Path) -> list[dict[str, Any]]:
    if not path.exists():
        return []
    return [json.loads(line) for line in path.read_text(encoding="utf-8").splitlines() if line.strip()]


def _adapter(**kwargs: Any) -> Any:
    from pipeline.jobfit.llm.adapters.claude_cli import ClaudeCliAdapter

    kwargs.setdefault("timeout", 120)
    kwargs.setdefault("use_case", "match_reasoning")
    return ClaudeCliAdapter(**kwargs)


class ResolutionTest(unittest.TestCase):
    """Case 1 — every door to the CLI hands out the adapter."""

    def test_default_row_and_probe_resolve_to_the_adapter(self) -> None:
        from pipeline.jobfit.llm import resolve_provider
        from pipeline.jobfit.llm.registry import probe_provider

        with _env():
            default = resolve_provider("match_reasoning")
        with _env(**{ENV_VAR: json.dumps({"useCases": {"match_reasoning": {"provider": "claude_cli"}}})}):
            row = resolve_provider("match_reasoning")
        with _env():
            probe = probe_provider("claude_cli")
        for provider in (default, row, probe):
            self.assertIsInstance(provider, TextProvider)
            self.assertEqual(provider.name, "claude_cli")


class RepairTest(unittest.TestCase):
    """Case 2 — the repair re-prompt now reaches the default engine."""

    def test_prose_then_json_is_repaired_in_two_spawns(self) -> None:
        spawn = _Spawn([_envelope("Sure! Here is the answer you asked for."), _envelope('{"ok": true}')])
        with _env(), _stubbed(spawn):
            payload = _adapter().complete_json("Return {\"ok\": true}")
        self.assertEqual(payload, {"ok": True})
        self.assertEqual(spawn.calls, 2)


class TimeoutTest(unittest.TestCase):
    """Case 3 — a CLI timeout is a coded deadline, not the catch-all."""

    def test_timeout_is_deadline_exceeded_after_exactly_one_spawn(self) -> None:
        spawn = _Spawn([subprocess.TimeoutExpired(cmd="claude", timeout=120)])
        with _env(), _ledger() as path, _stubbed(spawn):
            with self.assertRaises(LLMError) as ctx:
                _adapter().complete("hello")
            rows = _rows(path)
        self.assertEqual(spawn.calls, 1)
        self.assertEqual(ctx.exception.subtype, "deadline_exceeded")
        self.assertEqual(degradation.classify(ctx.exception), "provider_timeout")
        self.assertEqual(len(rows), 1)
        self.assertEqual(rows[0]["outcome"], "failed")
        self.assertEqual(rows[0]["reason"], "provider_timeout")


class TransientRetryTest(unittest.TestCase):
    """Case 4 — an overloaded envelope retries inside the deadline; a usage limit does not."""

    def test_overloaded_twice_then_success_takes_three_spawns(self) -> None:
        spawn = _Spawn([
            _envelope("Overloaded", is_error=True),
            _envelope("Overloaded", is_error=True),
            _envelope("fine"),
        ])
        with _env(), _stubbed(spawn):
            result = _adapter().complete("hello")
        self.assertEqual(result.text, "fine")
        self.assertEqual(spawn.calls, 3)

    def test_usage_limit_is_permanent(self) -> None:
        spawn = _Spawn([_envelope("Claude AI usage limit reached|1760000000", is_error=True), _envelope("never")])
        with _env(), _stubbed(spawn):
            with self.assertRaises(LLMError):
                _adapter().complete("hello")
        self.assertEqual(spawn.calls, 1)


class LedgerParityTest(unittest.TestCase):
    """Case 5 — one success, one ledger line, byte-parity with MonitoredClaudeCli's."""

    def test_success_line_names_the_engine_and_the_envelope_cost(self) -> None:
        spawn = _Spawn([_envelope("answer", cost=0.0123)])
        with _env(), _ledger() as path, _stubbed(spawn):
            _adapter(model=None, use_case="automation").complete("hello")
            rows = _rows(path)
        self.assertEqual(len(rows), 1)
        row = rows[0]
        self.assertEqual(row["provider"], "claude_cli")
        self.assertEqual(row["model"], "claude-cli-default")
        self.assertEqual(row["cost_usd"], 0.0123)
        self.assertEqual(row["use_case"], "automation")
        self.assertEqual(row["outcome"], "ok")
        self.assertEqual((row["input_tokens"], row["output_tokens"], row["cached_tokens"]), (120, 30, 7))


class DescentReasonTest(unittest.TestCase):
    """Case 6 — the policy vetoes keep their descent reasons through the fold."""

    def test_consumer_terms_and_offline_reasons_unchanged(self) -> None:
        from pipeline.jobfit.llm import resolve_provider
        from pipeline.jobfit.llm.adapters import GeminiProvider

        with _env(NODE_ENV="production"), mock.patch.object(GeminiProvider, "available", lambda self: False), \
                mock.patch.object(claude_cli.shutil, "which", return_value="/usr/bin/claude"):
            provider = resolve_provider("match_reasoning")
            self.assertIsInstance(provider, TextProvider)
            self.assertEqual(provider.availability(), (False, "consumer_terms_policy"))
        with _env(KP_OFFLINE="1"), mock.patch.object(claude_cli.shutil, "which", return_value="/usr/bin/claude"):
            provider = resolve_provider("match_reasoning")
            self.assertIsInstance(provider, TextProvider)
            self.assertEqual(provider.availability(), (False, "offline_policy"))


class RepoAccessTest(unittest.TestCase):
    """Case 7 — the with_repo_access door survives the fold, deny list included."""

    def test_bind_provider_to_repo_binds_the_inner_cli(self) -> None:
        from pipeline.jobfit.repo_scan import bind_provider_to_repo

        adapter = _adapter()
        with tempfile.TemporaryDirectory() as root:
            bound = bind_provider_to_repo(adapter, root)
            self.assertIsInstance(bound, TextProvider)
            self.assertIsNot(bound, adapter)
            self.assertEqual(bound.cli.mode, "repo_scan")
            self.assertEqual(bound.cli.cwd, root)
            self.assertIn("--settings", bound.extra_args)
            self.assertIn("--settings", bound.cli.cli_args())
            # the registry's instance keeps no repo binding it never asked for
            self.assertEqual(adapter.cli.mode, "generate")
            self.assertNotIn("--settings", adapter.extra_args)


class MapErrorSkipTest(unittest.TestCase):
    """Case 8 — judges skip an adapter's LLMError explicitly, never via res.json()."""

    def _error(self) -> LLMError:
        err = LLMError("boom", provider="claude_cli")
        err.json = mock.Mock(return_value={"score": 5})  # type: ignore[attr-defined]
        return err

    def test_devcase_run_judge_skips_llm_error(self) -> None:
        from pipeline.jobfit.devcase.llm_judge import run_judge

        err = self._error()
        ok = mock.Mock()
        ok.json.return_value = {"score": 4}
        provider = mock.Mock()
        provider.map.return_value = [err, ok]
        seen: list[Any] = []
        run_judge(["a", "b"], lambda item: f"p-{item}", lambda item, payload: seen.append(item), provider)
        err.json.assert_not_called()
        self.assertEqual(seen, ["b"])

    def test_eval_apply_judgements_skips_llm_error(self) -> None:
        from pipeline.jobfit.eval.judging import apply_judgements

        class Row:
            quality: int | None = None
            quality_issues: list[str] = []

        err = self._error()
        rows = [Row()]
        self.assertEqual(apply_judgements(rows, [err]), 0)
        err.json.assert_not_called()
        self.assertIsNone(rows[0].quality)


if __name__ == "__main__":
    unittest.main()
