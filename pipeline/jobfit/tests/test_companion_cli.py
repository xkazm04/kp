"""One companion turn end to end, with the provider stubbed.

What is worth pinning here is the CONTRACT the route consumes and the property
the design exists for: both halves of the exchange reach disk as episodes even
when the model does not answer. A turn that lost the operator's own words to a
provider timeout would be the one failure mode the disk-first ordering is for.
"""

from __future__ import annotations

import json
import os
import tempfile
import unittest
from pathlib import Path
from unittest import mock

from pipeline.jobfit import companion_cli
from pipeline.jobfit import companion_brain as brain


class _Completion:
    def __init__(self, text: str) -> None:
        self.text = text


class _Provider:
    def __init__(self, text: str = "Four candidates are waiting on you.") -> None:
        self._text = text
        self.system: str | None = None
        self.prompt: str | None = None

    def available(self) -> bool:
        return True

    def complete(self, prompt: str, system: str | None = None) -> _Completion:
        self.prompt = prompt
        self.system = system
        return _Completion(self._text)


class _DeadProvider(_Provider):
    def complete(self, prompt: str, system: str | None = None):
        raise TimeoutError("the model never answered")


TURN = {
    "workspace_id": "workspace",
    "session_id": "cthread-1",
    "message": "What needs me today?",
    "transcript": [{"role": "user", "content": "hello"}, {"role": "assistant", "content": "hello back"}],
    "grounding": {"attention": {"unreviewed": 4}},
    "locale": "en",
}


class CompanionCliTestCase(unittest.TestCase):
    def setUp(self) -> None:
        self._tmp = tempfile.TemporaryDirectory()
        self._saved = {k: os.environ.get(k) for k in ("PERSONAS_HOME", "KP_DB_PATH", "PERSONAS_DB_PATH")}
        os.environ["PERSONAS_HOME"] = self._tmp.name
        # Both optional index lanes point at nothing: the turn must still work.
        os.environ["KP_DB_PATH"] = str(Path(self._tmp.name) / "absent" / "kp.sqlite")
        os.environ["PERSONAS_DB_PATH"] = str(Path(self._tmp.name) / "absent" / "personas_data.db")

    def tearDown(self) -> None:
        for key, value in self._saved.items():
            if value is None:
                os.environ.pop(key, None)
            else:
                os.environ[key] = value
        self._tmp.cleanup()

    def test_a_turn_answers_and_logs_both_halves(self):
        provider = _Provider()
        with mock.patch.object(companion_cli, "resolve_provider", return_value=provider) as resolve:
            payload = companion_cli.run_turn(dict(TURN))
        resolve.assert_called_once()
        self.assertEqual(resolve.call_args.args[0], "assistant")
        self.assertEqual(payload["reply"], "Four candidates are waiting on you.")
        self.assertEqual(payload["source"], "llm")
        self.assertEqual(len(payload["episodePaths"]), 2)
        self.assertTrue(payload["episodePaths"][0].endswith("_user.md"))
        self.assertTrue(payload["episodePaths"][1].endswith("_assistant.md"))
        for rel in payload["episodePaths"]:
            self.assertTrue((brain.brain_root() / rel).is_file())
        # Constitution and identity ARE the system prompt; the grounding rides in
        # the user prompt, never the other way around.
        self.assertIn("kp-constitution v1", provider.system or "")
        self.assertIn("About the operator", provider.system or "")
        self.assertIn("unreviewed", provider.prompt or "")

    def test_a_dead_provider_still_answers_honestly_and_still_logs(self):
        with mock.patch.object(companion_cli, "resolve_provider", return_value=_DeadProvider()):
            payload = companion_cli.run_turn(dict(TURN))
        self.assertEqual(payload["source"], "deterministic")
        self.assertEqual(payload["reply"], companion_cli.UNREACHABLE_REPLY["en"])
        self.assertIn("TimeoutError", payload["fallbackReason"])
        self.assertEqual(len(payload["episodePaths"]), 2)

    def test_recall_from_an_earlier_turn_reaches_the_next_prompt(self):
        brain.append_episode("user", "The platform devcase needs a rubric.", "kp-workspace")
        provider = _Provider()
        turn = dict(TURN, message="what about the rubric?")
        with mock.patch.object(companion_cli, "resolve_provider", return_value=provider):
            payload = companion_cli.run_turn(turn)
        self.assertTrue(payload["recallUsed"])
        self.assertIn("rubric", provider.prompt or "")

    def test_an_empty_message_is_a_400_not_a_turn(self):
        with self.assertRaises(ValueError):
            companion_cli.run_turn(dict(TURN, message="   "))

    def test_the_locale_reaches_the_language_directive(self):
        provider = _Provider()
        with mock.patch.object(companion_cli, "resolve_provider", return_value=provider):
            companion_cli.run_turn(dict(TURN, locale="cs"))
        self.assertIn("Czech", provider.system or "")

    def test_the_cli_entry_point_reads_turn_json_and_prints_one_line(self):
        workdir = Path(self._tmp.name) / "work"
        workdir.mkdir()
        (workdir / "turn.json").write_text(json.dumps(TURN), encoding="utf-8")
        with mock.patch.object(companion_cli, "resolve_provider", return_value=_Provider()):
            with mock.patch("sys.argv", ["companion_cli", "--workdir", str(workdir)]):
                with mock.patch("builtins.print") as printed:
                    code = companion_cli.main()
        self.assertEqual(code, 0)
        self.assertEqual(printed.call_count, 1)
        emitted = json.loads(printed.call_args.args[0])
        self.assertEqual(emitted["reply"], "Four candidates are waiting on you.")


if __name__ == "__main__":
    unittest.main()
