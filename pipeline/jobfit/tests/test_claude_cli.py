from __future__ import annotations

import os
import subprocess
import unittest
from contextlib import contextmanager
from unittest import mock

from pipeline.jobfit import claude_cli
from pipeline.jobfit.claude_cli import (
    ClaudeCliError,
    ClaudeCliProvider,
    _extract_json,
)

SUCCESS_ENVELOPE = (
    '{"type":"result","subtype":"success","is_error":false,'
    '"result":"pong","duration_ms":1234,"num_turns":1,'
    '"session_id":"abc","total_cost_usd":0.01,"usage":{"output_tokens":4}}'
)


@contextmanager
def patched_cli(stdout: str = "", stderr: str = "", returncode: int = 0, which: str | None = "claude"):
    """Patch subprocess.run (recording the call) and shutil.which so tests run offline."""
    calls: dict[str, object] = {}

    def runner(args, **kwargs):
        calls["args"] = args
        calls["kwargs"] = kwargs
        return subprocess.CompletedProcess(args, returncode, stdout=stdout, stderr=stderr)

    with mock.patch("pipeline.jobfit.claude_cli.subprocess.run", runner), mock.patch(
        "pipeline.jobfit.claude_cli.shutil.which", return_value=which
    ):
        yield calls


class CompleteTest(unittest.TestCase):
    def test_success_parses_result(self) -> None:
        with patched_cli(SUCCESS_ENVELOPE) as calls:
            res = ClaudeCliProvider().complete("say pong")
        self.assertEqual(res.text, "pong")
        self.assertEqual(res.num_turns, 1)
        self.assertEqual(res.session_id, "abc")
        self.assertAlmostEqual(res.cost_usd, 0.01)
        self.assertEqual(calls["args"][:4], ["claude", "-p", "--output-format", "json"])
        self.assertEqual(calls["kwargs"]["input"], "say pong")

    def test_model_flag_added(self) -> None:
        with patched_cli(SUCCESS_ENVELOPE) as calls:
            ClaudeCliProvider(model="haiku").complete("hi")
        args = calls["args"]
        self.assertIn("--model", args)
        self.assertEqual(args[args.index("--model") + 1], "haiku")

    def test_system_is_prepended(self) -> None:
        with patched_cli(SUCCESS_ENVELOPE) as calls:
            ClaudeCliProvider().complete("the task", system="be terse")
        sent = calls["kwargs"]["input"]
        self.assertIn("be terse", sent)
        self.assertIn("the task", sent)

    def test_empty_prompt_rejected(self) -> None:
        with self.assertRaises(ValueError):
            ClaudeCliProvider().complete("   ")

    def test_error_subtype_raises(self) -> None:
        envelope = '{"type":"result","subtype":"error_max_turns","is_error":true,"result":"nope"}'
        with patched_cli(envelope):
            with self.assertRaises(ClaudeCliError) as ctx:
                ClaudeCliProvider().complete("x")
        self.assertEqual(ctx.exception.subtype, "error_max_turns")

    def test_empty_output_raises(self) -> None:
        with patched_cli(""):
            with self.assertRaises(ClaudeCliError):
                ClaudeCliProvider().complete("x")

    def test_non_json_output_raises(self) -> None:
        with patched_cli("not json at all"):
            with self.assertRaises(ClaudeCliError):
                ClaudeCliProvider().complete("x")

    def test_unresolvable_command_raises(self) -> None:
        with patched_cli(SUCCESS_ENVELOPE, which=None):
            with self.assertRaises(ClaudeCliError):
                ClaudeCliProvider(command="nope-claude").complete("x")

    def test_subprocess_file_not_found_raises(self) -> None:
        def boom(*a, **k):
            raise FileNotFoundError()

        with mock.patch("pipeline.jobfit.claude_cli.subprocess.run", boom), mock.patch(
            "pipeline.jobfit.claude_cli.shutil.which", return_value="claude"
        ):
            with self.assertRaises(ClaudeCliError):
                ClaudeCliProvider().complete("x")

    def test_timeout_raises(self) -> None:
        def slow(*a, **k):
            raise subprocess.TimeoutExpired(cmd="claude", timeout=1)

        with mock.patch("pipeline.jobfit.claude_cli.subprocess.run", slow), mock.patch(
            "pipeline.jobfit.claude_cli.shutil.which", return_value="claude"
        ):
            with self.assertRaises(ClaudeCliError):
                ClaudeCliProvider().complete("x")


class ModeSeamTest(unittest.TestCase):
    """R1: mode is a closed vocabulary; generate runs in a neutral temp cwd."""

    def test_generate_spawns_in_neutral_temp_cwd_not_callers(self) -> None:
        # The regression this pins: spawned from kp's repo root, the CLI's
        # CLAUDE.md auto-discovery folded kp's own agent instructions into
        # every batch prompt. Generate mode must therefore NEVER inherit the
        # caller's cwd.
        with patched_cli(SUCCESS_ENVELOPE) as calls:
            ClaudeCliProvider().complete("x")
        spawn_cwd = calls["kwargs"]["cwd"]
        self.assertIsNotNone(spawn_cwd)
        self.assertNotEqual(os.path.abspath(spawn_cwd), os.path.abspath(os.getcwd()))
        self.assertTrue(os.path.isdir(spawn_cwd))
        self.assertEqual(os.listdir(spawn_cwd), [])  # neutral = empty
        self.assertEqual(spawn_cwd, claude_cli._neutral_cwd())  # per-process, reused

    def test_repo_scan_mode_spawns_in_the_bound_repo(self) -> None:
        with patched_cli(SUCCESS_ENVELOPE) as calls:
            ClaudeCliProvider().with_repo_access("/repo").complete("x")
        self.assertEqual(calls["kwargs"]["cwd"], "/repo")

    def test_with_repo_access_flips_the_mode(self) -> None:
        provider = ClaudeCliProvider()
        bound = provider.with_repo_access("/repo")
        self.assertEqual(provider.mode, "generate")  # original untouched
        self.assertEqual(bound.mode, "repo_scan")

    def test_unknown_mode_rejected(self) -> None:
        with self.assertRaises(ValueError):
            ClaudeCliProvider(mode="yolo-mode")

    def test_repo_scan_mode_not_constructible_directly(self) -> None:
        # with_repo_access is the one door — it validates the read-only triple.
        with self.assertRaises(ValueError):
            ClaudeCliProvider(mode="repo_scan")

    def test_stance_kwargs_refused_at_construction(self) -> None:
        # The constructor-bypass hole the mode seam closes: pairing a repo cwd
        # with a write-capable permission mode without with_repo_access.
        for kwargs in (
            {"cwd": "/repo"},
            {"permission_mode": "acceptEdits"},
            {"allowed_tools": ("Read",)},
            {"disallowed_tools": ("Write",)},
        ):
            with self.assertRaises(ValueError, msg=f"kwargs={kwargs}"):
                ClaudeCliProvider(**kwargs)


class ApiKeyEnvTest(unittest.TestCase):
    def test_api_key_stripped_by_default(self) -> None:
        with mock.patch.dict(os.environ, {"ANTHROPIC_API_KEY": "sk-live-xxx"}, clear=False):
            with patched_cli(SUCCESS_ENVELOPE) as calls:
                ClaudeCliProvider().complete("x")
        self.assertNotIn("ANTHROPIC_API_KEY", calls["kwargs"]["env"])

    def test_api_key_kept_when_disabled(self) -> None:
        with mock.patch.dict(os.environ, {"ANTHROPIC_API_KEY": "sk-live-xxx"}, clear=False):
            with patched_cli(SUCCESS_ENVELOPE) as calls:
                ClaudeCliProvider(strip_api_key=False).complete("x")
        self.assertEqual(calls["kwargs"]["env"].get("ANTHROPIC_API_KEY"), "sk-live-xxx")


class JsonTest(unittest.TestCase):
    def test_complete_json_parses_fenced(self) -> None:
        envelope = (
            '{"type":"result","subtype":"success","is_error":false,'
            '"result":"```json\\n{\\"a\\": 1}\\n```"}'
        )
        with patched_cli(envelope):
            obj = ClaudeCliProvider().complete_json("give me json")
        self.assertEqual(obj, {"a": 1})

    def test_extract_json_variants(self) -> None:
        self.assertEqual(_extract_json('{"x": 1}'), {"x": 1})
        self.assertEqual(_extract_json("prefix text {\"x\": 1} suffix"), {"x": 1})
        self.assertEqual(_extract_json("```json\n[1, 2, 3]\n```"), [1, 2, 3])
        with self.assertRaises(ValueError):
            _extract_json("no json here")

    def test_extract_json_prefers_last_value_over_echoed_example(self) -> None:
        # Few-shot prompts make the model echo the example object before the real
        # answer. The old first-value behaviour returned the echo; we want the last.
        echoed = 'Example: {"title": "EXAMPLE", "ok": false}\nAnswer: {"title": "Real", "ok": true}'
        self.assertEqual(_extract_json(echoed), {"title": "Real", "ok": True})

    def test_extract_json_expected_keys_pins_the_answer(self) -> None:
        # A trailing non-answer object must not win when expected_keys identify the real one.
        text = '{"role": "Backend", "score": 80}\nNote: thanks! {"disclaimer": "n/a"}'
        self.assertEqual(
            _extract_json(text, expected_keys=["role", "score"]),
            {"role": "Backend", "score": 80},
        )

    def test_extract_json_handles_prose_brace_before_real_json(self) -> None:
        # A stray brace in prose must be skipped, not latched onto.
        text = 'Here {placeholder} is the result: {"value": 42}'
        self.assertEqual(_extract_json(text), {"value": 42})


class MapTest(unittest.TestCase):
    def test_map_preserves_order(self) -> None:
        with patched_cli(SUCCESS_ENVELOPE):
            out = ClaudeCliProvider().map(["a", "b", "c"], max_workers=2)
        self.assertEqual(len(out), 3)
        self.assertTrue(all(r.text == "pong" for r in out))

    def test_map_collects_errors(self) -> None:
        calls = {"n": 0}

        def flaky(args, **kwargs):
            calls["n"] += 1
            stdout = "garbage" if calls["n"] == 2 else SUCCESS_ENVELOPE
            return subprocess.CompletedProcess(args, 0, stdout=stdout, stderr="")

        with mock.patch("pipeline.jobfit.claude_cli.subprocess.run", flaky), mock.patch(
            "pipeline.jobfit.claude_cli.shutil.which", return_value="claude"
        ):
            out = ClaudeCliProvider().map(["a", "b", "c"], max_workers=1)
        self.assertIsInstance(out[1], ClaudeCliError)
        self.assertEqual(out[0].text, "pong")
        self.assertEqual(out[2].text, "pong")


class LiveSmokeTest(unittest.TestCase):
    @unittest.skipUnless(
        os.getenv("KP_CLAUDE_CLI_LIVE") == "1",
        "live test; set KP_CLAUDE_CLI_LIVE=1 to run against the real CLI",
    )
    def test_real_cli_pong(self) -> None:
        provider = ClaudeCliProvider(timeout=120)
        if not provider.available():
            self.skipTest("claude CLI not on PATH")
        res = provider.complete("Reply with exactly one word: pong")
        self.assertIn("pong", res.text.lower())


if __name__ == "__main__":
    unittest.main()
