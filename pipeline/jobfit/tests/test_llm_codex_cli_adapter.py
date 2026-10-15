"""The Codex CLI engine (llm/adapters/codex_cli.py): a pin-only TextProvider over `codex exec`.

Pins, against a FAKE `codex` executable (a Python script behind a `codex.cmd` / `codex`
wrapper put first on PATH - the real spawn path, the Windows .cmd shim included):
- ``ProviderPin("codex_cli", model, effort)`` resolves the adapter; no routing row can reach
  it (it is pin-only: not in PROVIDER_CAPABILITIES, not in ADAPTERS), and a pin below a use
  case's capabilities (gig_brief needs the web) is refused;
- the argv: ``exec``, the model, the effort as ``-c model_reasoning_effort=<level>`` (no flag
  when the pin names none), ``--output-schema`` when a schema door was opened, the read-only
  sandbox with the shell tools disabled, ``--ephemeral``, ``-C`` an EMPTY temp dir that is
  never the repository, and the prompt on stdin (never argv);
- the answer is the last-message file (falling back to the event stream's last message);
  a reconnect notice on a turn that still answered is not a failure; tokens reach the
  ledger and the cost is null (unpriced), never 0;
- failures in the layer's vocabulary: a usage limit (not retried), an overloaded turn
  (retried, then a coded failure), a bad model (cli_error), no answer (empty_output), a
  timeout (deadline_exceeded, one spawn);
- policy: KP_OFFLINE seals it, a production deployment refuses it unless the CLI engines
  are unlocked, a missing binary is not_installed - each degrades gig_plan_cli to
  ``no_provider`` without spawning;
- gig_plan_cli end to end on the codex seat: the plan, its schema handed over, cost null.
No network, no key, no model.
"""

from __future__ import annotations

import json
import os
import stat
import subprocess
import sys
import tempfile
import unittest
from contextlib import ExitStack, contextmanager
from pathlib import Path
from typing import Any, Iterator
from unittest import mock

from pipeline.jobfit import gig_plan_cli
from pipeline.jobfit.llm import LLMError, ProviderPin, resolve_provider
from pipeline.jobfit.llm.adapters import ADAPTERS
from pipeline.jobfit.llm.adapters import codex_cli
from pipeline.jobfit.llm.adapters.codex_cli import CodexCliAdapter, parse_events
from pipeline.jobfit.llm.capabilities import PIN_ONLY_PROVIDER_CAPABILITIES, PROVIDER_CAPABILITIES, unsupported_caps
from pipeline.jobfit.llm.registry import probe_provider
from pipeline.jobfit.tests.test_role_research import _env, _ledger, _rows

REPO_ROOT = Path(__file__).resolve().parents[3]

# The fake `codex`: logs argv / stdin / cwd / the schema it was handed, then answers per
# FAKE_CODEX_MODE with the JSONL events `codex exec --json` prints (shapes probed against
# codex-cli 0.157.1 on 2026-09-30).
_FAKE = r'''
import json, os, sys

args = sys.argv[1:]
prompt = sys.stdin.read()

def value(flag):
    return args[args.index(flag) + 1] if flag in args else None

schema_path = value("--output-schema")
schema = None
if schema_path:
    with open(schema_path, encoding="utf-8") as f:
        schema = json.load(f)
log = os.environ.get("FAKE_CODEX_LOG")
if log:
    with open(log, "a", encoding="utf-8") as f:
        f.write(json.dumps({"argv": args, "stdin": prompt, "cwd": os.getcwd(), "schema": schema}) + "\n")

mode = os.environ.get("FAKE_CODEX_MODE", "ok")
answer = os.environ.get("FAKE_CODEX_ANSWER", '{"answer": "ok"}')
out = value("-o")

def emit(event):
    sys.stdout.write(json.dumps(event) + "\n")

emit({"type": "thread.started", "thread_id": "t-1"})
emit({"type": "turn.started"})
usage = {"type": "turn.completed", "usage": {"input_tokens": 1500, "cached_input_tokens": 0, "output_tokens": 40, "reasoning_output_tokens": 12}}

if mode in ("ok", "reconnect"):
    if mode == "reconnect":
        emit({"type": "error", "message": "Reconnecting... 1/5"})
    with open(out, "w", encoding="utf-8") as f:
        f.write(answer)
    emit({"type": "item.completed", "item": {"id": "item_0", "type": "agent_message", "text": answer}})
    emit(usage)
    sys.exit(0)
if mode == "events_only":
    emit({"type": "item.completed", "item": {"id": "item_0", "type": "agent_message", "text": answer}})
    emit(usage)
    sys.exit(0)
if mode == "empty":
    emit(usage)
    sys.exit(0)
messages = {
    "limit": "You've hit your usage limit. Try again later.",
    "overloaded": '{"type":"error","status":503,"error":{"message":"The server is overloaded"}}',
    "bad_model": '{"type":"error","status":400,"error":{"type":"invalid_request_error","message":"The model is not supported"}}',
}
message = messages.get(mode, "unknown failure")
emit({"type": "error", "message": message})
emit({"type": "turn.failed", "error": {"message": message}})
sys.exit(1)
'''


@contextmanager
def fake_codex(mode: str = "ok", answer: Any = None) -> Iterator[Path]:
    """A `codex` first on PATH that answers per ``mode``; yields the call log's path."""
    with tempfile.TemporaryDirectory(prefix="fake-codex-") as d, ExitStack() as stack:
        root = Path(d)
        script = root / "fake_codex.py"
        script.write_text(_FAKE, encoding="utf-8")
        if os.name == "nt":
            (root / "codex.cmd").write_text(f'@"{sys.executable}" "{script}" %*\r\n', encoding="utf-8")
        else:
            wrapper = root / "codex"
            wrapper.write_text(f'#!/bin/sh\nexec "{sys.executable}" "{script}" "$@"\n', encoding="utf-8")
            wrapper.chmod(wrapper.stat().st_mode | stat.S_IEXEC)
        log = root / "calls.jsonl"
        env = {
            "PATH": f"{root}{os.pathsep}{os.environ.get('PATH', '')}",
            "FAKE_CODEX_LOG": str(log),
            "FAKE_CODEX_MODE": mode,
            "FAKE_CODEX_ANSWER": answer if isinstance(answer, str) else json.dumps(answer if answer is not None else {"answer": "ok"}),
        }
        stack.enter_context(mock.patch.dict(os.environ, env, clear=False))
        # base.complete sleeps between transient retries; keep the suite fast.
        stack.enter_context(mock.patch("pipeline.jobfit.llm.base.time.sleep", lambda _s: None))
        yield log


def calls(log: Path) -> list[dict[str, Any]]:
    if not log.exists():
        return []
    return [json.loads(line) for line in log.read_text(encoding="utf-8").splitlines() if line.strip()]


def pinned(effort: str | None = "max", use_case: str = "gig_plan", timeout: int = 60) -> CodexCliAdapter:
    provider = resolve_provider(use_case, timeout=timeout, pin=ProviderPin("codex_cli", "gpt-6-astra", effort))
    assert isinstance(provider, CodexCliAdapter)
    return provider


PLAN = {
    "summary": "Fix the typo, check the page, send the file.",
    "steps": [
        {"title": "Find the typo", "doneWhen": "The misspelled word and its line are named."},
        {"title": "Fix it", "doneWhen": "The corrected HTML file contains the right spelling."},
        {"title": "Check the page", "doneWhen": "A diff shows only that word changed."},
        {"title": "Deliver", "doneWhen": "The corrected file is attached to the reply."},
    ],
    "decisions": ["Change nothing else on the page."],
    "risks": ["The client may mean another word."],
    "effortHours": {"min": 0.5, "max": 1},
    "questions": [],
}

PLAN_REQUEST: dict[str, Any] = {
    "seat": "gpt",
    "provider": "codex_cli",
    "model": "gpt-6-astra",
    "effort": "max",
    "gig": {"title": "Fix a typo on a static site", "arena": "freelance", "url": "https://example.org/g", "reward": "$20", "deadlineAt": None},
    "brief": {"category": "Web · Static site", "difficulty": "very_hard", "effort": None, "markdown": "## What the gig is\nOne word.", "challenges": []},
    "pages": [{"url": "https://example.org/g", "title": "t", "text": "One word on our About page is misspelled."}],
}


class RoutingTest(unittest.TestCase):
    def test_a_pin_resolves_the_adapter_with_its_model_and_effort(self):
        with _env():
            provider = pinned("max")
        self.assertEqual((provider.name, provider.model, provider.effort, provider.use_case), ("codex_cli", "gpt-6-astra", "max", "gig_plan"))

    def test_it_is_pin_only(self):
        self.assertNotIn("codex_cli", PROVIDER_CAPABILITIES, "no Models row may route to it")
        self.assertNotIn("codex_cli", ADAPTERS)
        self.assertIn("codex_cli", PIN_ONLY_PROVIDER_CAPABILITIES)
        with _env(), self.assertRaises(LLMError):
            probe_provider("codex_cli")
        config = json.dumps({"useCases": {"gig_plan": {"provider": "codex_cli"}}})
        with _env(KP_LLM_CONFIG=config), self.assertRaises(LLMError):
            resolve_provider("gig_plan")

    def test_a_pin_below_the_use_case_is_refused(self):
        self.assertEqual(unsupported_caps("gig_plan", "codex_cli"), frozenset())
        self.assertIn("web_research", unsupported_caps("gig_brief", "codex_cli"))
        with _env(), self.assertRaises(LLMError):
            resolve_provider("gig_brief", pin=ProviderPin("codex_cli", "gpt-6-astra"))

    def test_the_model_is_a_closed_shape(self):
        for bad in ("gpt & calc", "", "GPT 6"):
            with self.subTest(model=bad), self.assertRaises(ValueError):
                CodexCliAdapter(model=bad)


class SpawnTest(unittest.TestCase):
    def test_the_argv_the_stdin_and_the_neutral_cwd(self):
        with _env(), fake_codex("ok") as log:
            provider = pinned("max").with_output_schema({"type": "object", "properties": {}, "required": [], "additionalProperties": False})
            result = provider.complete("Say ok.", system="Be brief.")
            [call] = calls(log)
            cwd_listing = os.listdir(call["argv"][call["argv"].index("-C") + 1])
        args = call["argv"]
        self.assertEqual(args[0], "exec")
        self.assertEqual(args[args.index("-m") + 1], "gpt-6-astra")
        self.assertEqual(args[args.index("-c") + 1], "model_reasoning_effort=max")
        self.assertEqual(args[args.index("--sandbox") + 1], "read-only")
        self.assertEqual([args[i + 1] for i, a in enumerate(args) if a == "--disable"], ["shell_tool", "unified_exec"])
        for flag in ("--skip-git-repo-check", "--ephemeral", "--json", "--output-schema", "-o"):
            self.assertIn(flag, args)
        self.assertEqual(args[-1], "-", "the prompt travels on stdin")
        self.assertNotIn("Say ok.", " ".join(args))
        self.assertEqual(call["stdin"], "<system>\nBe brief.\n</system>\n\nSay ok.")
        self.assertEqual(call["schema"], {"type": "object", "properties": {}, "required": [], "additionalProperties": False})
        cwd = args[args.index("-C") + 1]
        self.assertEqual(os.path.realpath(call["cwd"]), os.path.realpath(cwd))
        self.assertNotEqual(os.path.realpath(cwd), os.path.realpath(str(REPO_ROOT)), "never the repository (its AGENTS.md)")
        self.assertEqual(cwd_listing, [], "the neutral cwd stays empty: the schema and the answer live elsewhere")
        self.assertEqual(result.text, '{"answer": "ok"}')

    def test_no_effort_means_no_flag_and_no_door_means_no_schema(self):
        with _env(), fake_codex("ok") as log:
            pinned(None).complete("Say ok.")
            args = calls(log)[0]["argv"]
        self.assertNotIn("-c", args)
        self.assertNotIn("--output-schema", args)

    def test_the_schema_door_is_a_copy(self):
        with _env():
            base = pinned()
        bound = base.with_output_schema({"type": "object"})
        self.assertIsNone(base.output_schema)
        self.assertEqual(bound.output_schema, {"type": "object"})


class AnswerTest(unittest.TestCase):
    def test_tokens_reach_the_ledger_and_the_cost_is_unpriced(self):
        with _env(), fake_codex("ok", answer=PLAN), _ledger() as ledger:
            payload = pinned().complete_json("Plan it.", expected_keys=("summary", "steps"))
            rows = _rows(ledger)
        self.assertEqual(payload, PLAN)
        self.assertEqual(len(rows), 1)
        row = rows[0]
        self.assertEqual((row["provider"], row["model"], row["use_case"], row["outcome"]), ("codex_cli", "gpt-6-astra", "gig_plan", "ok"))
        self.assertEqual((row["input_tokens"], row["output_tokens"]), (1500, 40))
        self.assertIsNone(row["cost_usd"], "tokens, not dollars: unpriced, never 0")

    def test_the_event_stream_is_the_fallback_answer(self):
        with _env(), fake_codex("events_only", answer="plain answer"):
            self.assertEqual(pinned().complete("x").text, "plain answer")

    def test_a_reconnect_notice_on_an_answered_turn_is_not_a_failure(self):
        with _env(), fake_codex("reconnect", answer="fine"):
            self.assertEqual(pinned().complete("x").text, "fine")

    def test_parse_events_skips_noise(self):
        stdout = "banner\n{not json\n" + json.dumps({"type": "item.completed", "item": {"type": "agent_message", "text": "a"}}) + "\n[1]\n"
        self.assertEqual(parse_events(stdout), {"text": "a", "usage": {}, "error": None})


class FailureTest(unittest.TestCase):
    def _fails(self, mode: str) -> tuple[BaseException, int]:
        with _env(), fake_codex(mode) as log:
            with self.assertRaises(LLMError) as caught:
                pinned().complete("x")
            return caught.exception, len(calls(log))

    def test_a_usage_limit_is_coded_and_not_retried(self):
        exc, n = self._fails("limit")
        self.assertEqual((exc.subtype, n), ("usage_limit", 1))

    def test_an_overloaded_turn_is_retried_then_coded(self):
        exc, n = self._fails("overloaded")
        self.assertEqual(n, 3, "the base loop retries a transient failure inside the deadline")
        self.assertIsNone(exc.subtype)
        self.assertIn("overloaded", str(exc))

    def test_a_bad_model_is_a_cli_error(self):
        exc, n = self._fails("bad_model")
        self.assertEqual((exc.subtype, n), ("cli_error", 1))

    def test_no_answer_is_empty_output(self):
        exc, _ = self._fails("empty")
        self.assertEqual(exc.subtype, "empty_output")

    def test_a_timeout_is_one_spawn_and_deadline_exceeded(self):
        spawned: list[Any] = []

        def slow(args: Any, **kwargs: Any) -> None:
            spawned.append(args)
            raise subprocess.TimeoutExpired(args, kwargs.get("timeout") or 0)

        with _env(), fake_codex("ok"), mock.patch.object(codex_cli.subprocess, "run", slow):
            with self.assertRaises(LLMError) as caught:
                pinned().complete("x")
        self.assertEqual((caught.exception.subtype, len(spawned)), ("deadline_exceeded", 1))


class PolicyTest(unittest.TestCase):
    def _plan_without_spawning(self, **env: str) -> tuple[dict[str, Any], list[dict[str, Any]], list[dict[str, Any]]]:
        with _env(**env), fake_codex("ok", answer=PLAN) as log, _ledger() as ledger:
            out = gig_plan_cli.plan(PLAN_REQUEST)
            rows = _rows(ledger)
            spawned = calls(log)
        return out, rows, spawned

    def test_offline_seals_it(self):
        out, rows, spawned = self._plan_without_spawning(KP_OFFLINE="1")
        self.assertEqual((out["source"], out["fallbackReason"]), ("deterministic", "no_provider"))
        self.assertEqual([r.get("reason") for r in rows], ["offline_policy"])
        self.assertEqual(spawned, [])

    def test_production_refuses_the_consumer_seat_unless_unlocked(self):
        out, rows, spawned = self._plan_without_spawning(NODE_ENV="production")
        self.assertEqual(out["fallbackReason"], "no_provider")
        self.assertEqual([r.get("reason") for r in rows], ["consumer_terms_policy"])
        self.assertEqual(spawned, [])
        # availability() resolves the binary: stand one in, a runner has no `codex` on PATH.
        with _env(NODE_ENV="production", KP_ALLOW_CLI_ENGINE="1"), fake_codex("ok"):
            self.assertEqual(pinned().availability(), (True, None))

    def test_a_missing_binary_is_not_installed(self):
        with _env(), mock.patch.object(codex_cli.shutil, "which", return_value=None), mock.patch.object(codex_cli.os.path, "isfile", return_value=False), _ledger() as ledger:
            out = gig_plan_cli.plan(PLAN_REQUEST)
            rows = _rows(ledger)
        self.assertEqual(out["fallbackReason"], "no_provider")
        self.assertEqual([r.get("reason") for r in rows], ["not_installed"])


class GigPlanEndToEndTest(unittest.TestCase):
    def test_the_codex_seat_plans_with_its_schema_and_no_cost(self):
        with _env(), fake_codex("ok", answer=PLAN) as log, _ledger() as ledger:
            out = gig_plan_cli.plan(PLAN_REQUEST)
            rows = _rows(ledger)
            [call] = calls(log)
        self.assertEqual((out["source"], out["fallbackReason"]), ("llm", None), out)
        self.assertEqual((out["seat"], out["model"], out["effort"], out["costUsd"]), ("gpt", "gpt-6-astra", "max", None))
        self.assertEqual(len(out["result"]["steps"]), 4)
        self.assertEqual(call["schema"], gig_plan_cli.SCHEMA)
        self.assertIn("Plan the gig in the fenced region below", call["stdin"])
        self.assertEqual([(r["provider"], r["model"]) for r in rows], [("codex_cli", "gpt-6-astra")])


if __name__ == "__main__":
    unittest.main()
