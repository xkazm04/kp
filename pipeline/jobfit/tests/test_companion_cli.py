"""One companion turn end to end, with the provider stubbed.

What is worth pinning here is the CONTRACT the route consumes and the property
the design exists for: the operator's own words reach disk as an episode before
the model is ever called, so a provider timeout cannot lose them - that is the
one failure mode the disk-first ordering is for. Candi's half is written only
when she actually said something: a deterministic turn is answered but not
remembered, so outage prose never becomes recallable memory.
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

    def test_a_dead_provider_still_answers_honestly_and_still_logs_the_operator(self):
        with mock.patch.object(companion_cli, "resolve_provider", return_value=_DeadProvider()):
            payload = companion_cli.run_turn(dict(TURN))
        self.assertEqual(payload["source"], "deterministic")
        self.assertEqual(payload["reply"], companion_cli.UNREACHABLE_REPLY["en"])
        self.assertIn("TimeoutError", payload["fallbackReason"])
        # The operator's half survives the outage; Candi's apology is not memory.
        self.assertEqual(len(payload["episodePaths"]), 1)
        self.assertTrue(payload["episodePaths"][0].endswith("_user.md"))

    def test_a_deterministic_turn_records_the_operator_but_never_the_outage_prose(self):
        """A degraded turn is ANSWERED, not REMEMBERED.

        "I could not reach a model just now" is not something Candi knows; it is
        the absence of anything to know. Writing it as an episode made outage
        prose permanently recallable, competing with real memory a week later
        (surface_recall drops echoes and same-day commands, not this). The
        operator's own message still lands - the person said it, and losing their
        words to a provider timeout is exactly the failure the disk-first
        ordering exists to prevent.
        """
        with mock.patch.object(companion_cli, "resolve_provider", return_value=_DeadProvider()):
            payload = companion_cli.run_turn(dict(TURN, message="the platform rubric is wrong"))
        self.assertEqual(payload["source"], "deterministic")
        self.assertEqual(len(payload["episodePaths"]), 1)
        self.assertTrue(payload["episodePaths"][0].endswith("_user.md"))
        written = "\n".join(
            (brain.brain_root() / rel).read_text(encoding="utf-8") for rel in payload["episodePaths"]
        )
        self.assertIn("the platform rubric is wrong", written)
        self.assertNotIn(companion_cli.UNREACHABLE_REPLY["en"], written)
        # Nothing on disk carries the outage prose, so it can never be recalled.
        for note in brain.brain_root().rglob("*_assistant.md"):
            self.assertNotIn(companion_cli.UNREACHABLE_REPLY["en"], note.read_text(encoding="utf-8"))

    def test_recall_from_an_earlier_turn_reaches_the_next_prompt(self):
        brain.append_episode("user", "The platform devcase needs a rubric.", "kp-workspace")
        provider = _Provider()
        turn = dict(TURN, message="what about the rubric?")
        with mock.patch.object(companion_cli, "resolve_provider", return_value=provider):
            payload = companion_cli.run_turn(turn)
        self.assertTrue(payload["recallUsed"])
        self.assertIn("rubric", provider.prompt or "")

    # -- consent (WP4) -------------------------------------------------------
    #
    # The dock works before the operator has agreed to Candi keeping a memory;
    # it just works MEMORYLESS. The hard property is that a memory-off turn does
    # not create the tree it was refused - every ordinary reader in the brain
    # module goes through ensure_brain(), so "read the constitution" would have
    # been enough to birth it.

    def test_a_memory_off_turn_never_touches_the_brain(self):
        provider = _Provider()
        with mock.patch.object(companion_cli, "resolve_provider", return_value=provider):
            payload = companion_cli.run_turn(dict(TURN, memory=False))
        self.assertEqual(payload["reply"], "Four candidates are waiting on you.")
        self.assertFalse(payload["memoryEnabled"])
        self.assertEqual(payload["episodePaths"], [])
        self.assertEqual(payload["recallUsed"], [])
        # Nothing on disk: not the tree, not the index, not an episode.
        self.assertFalse(brain.brain_root().exists())
        # She is still Candi - the shipped constitution stood in for the file.
        self.assertIn("kp-constitution v1", provider.system or "")
        self.assertIn("unreviewed", provider.prompt or "")

    def test_a_memory_off_turn_cannot_recall_what_is_already_there(self):
        brain.append_episode("user", "The platform devcase needs a rubric.", "kp-workspace")
        provider = _Provider()
        with mock.patch.object(companion_cli, "resolve_provider", return_value=provider):
            payload = companion_cli.run_turn(dict(TURN, message="what about the rubric?", memory=False))
        self.assertEqual(payload["recallUsed"], [])
        self.assertNotIn("rubric", (provider.prompt or "").split("<<<OPERATOR_MESSAGE>>>")[0])

    def test_an_absent_memory_key_still_means_yes(self):
        """The consent authority is the CALLER, and every pre-WP4 caller omits
        the key. Absent must therefore keep the historical behaviour exactly."""
        with mock.patch.object(companion_cli, "resolve_provider", return_value=_Provider()):
            payload = companion_cli.run_turn(dict(TURN))
        self.assertTrue(payload["memoryEnabled"])
        self.assertEqual(len(payload["episodePaths"]), 2)

    def test_the_probe_door_reports_without_creating(self):
        with mock.patch("sys.argv", ["companion_cli", "--probe"]):
            with mock.patch("builtins.print") as printed:
                code = companion_cli.main()
        self.assertEqual(code, 0)
        emitted = json.loads(printed.call_args.args[0])
        self.assertFalse(emitted["present"])
        self.assertEqual(emitted["episodes"], 0)
        self.assertFalse(brain.brain_root().exists())

    def test_the_birth_door_creates_once_and_is_idempotent(self):
        def birth():
            with mock.patch("sys.argv", ["companion_cli", "--birth"]):
                with mock.patch("builtins.print") as printed:
                    self.assertEqual(companion_cli.main(), 0)
                    return json.loads(printed.call_args.args[0])

        first = birth()
        self.assertEqual(sorted(first["born"]), ["constitution.md", "identity.md"])
        self.assertTrue(first["present"])
        self.assertEqual(first["constitutionOrigin"], "kp")
        second = birth()
        self.assertEqual(second["born"], [])
        self.assertTrue(second["present"])

    def test_the_operators_own_message_never_comes_back_as_a_memory(self):
        """The round-5 finding, end to end. ``run_turn`` appends the message as
        an episode BEFORE it recalls, so raw BM25 hands that sentence straight
        back as its own top hit. Nothing in `recallUsed` may be the message."""
        provider = _Provider()
        message = "Please prepare a digest of the workspace for me"
        with mock.patch.object(companion_cli, "resolve_provider", return_value=provider):
            payload = companion_cli.run_turn(dict(TURN, message=message))
        self.assertNotIn(message, [h["excerpt"] for h in payload["recallUsed"]])
        self.assertNotIn(message, (provider.prompt or "").split("<<<OPERATOR_MESSAGE>>>")[0])

    def test_recall_ships_a_short_insight_beside_the_excerpt(self):
        brain.append_episode(
            "assistant",
            "Sixteen decisions were waiting on you. Channels hold 17 open items and 5 jobs need a look.",
            "kp-workspace",
        )
        provider = _Provider()
        with mock.patch.object(companion_cli, "resolve_provider", return_value=provider):
            payload = companion_cli.run_turn(dict(TURN, message="how many decisions are waiting"))
        hit = next(h for h in payload["recallUsed"] if "Sixteen decisions" in h["excerpt"])
        self.assertEqual(hit["insight"], "Sixteen decisions were waiting on you.")
        self.assertLessEqual(len(hit["insight"]), 90)

    def test_the_prompt_asks_her_to_weave_memory_in_rather_than_quote_it(self):
        provider = _Provider()
        with mock.patch.object(companion_cli, "resolve_provider", return_value=provider):
            companion_cli.run_turn(dict(TURN))
        self.assertIn("Never block-quote the past back", provider.system or "")

    def test_a_reply_carrying_blocks_ships_them_beside_clean_prose(self):
        completion = (
            "Two roles carry the load.\n\n"
            '```kp:table\n{"title": "Load", "columns": [{"key": "role", "label": "Role"}], '
            '"rows": [{"role": "Platform"}, {"role": "Data"}]}\n```\n\n'
            "```kp:chart\nnot json\n```"
        )
        with mock.patch.object(companion_cli, "resolve_provider", return_value=_Provider(completion)):
            payload = companion_cli.run_turn(dict(TURN))
        # The prose the operator reads never contains a fence, and the block that
        # could not be parsed is COUNTED rather than swallowed or raised.
        self.assertEqual(payload["reply"], "Two roles carry the load.")
        self.assertEqual(payload["blockErrors"], 1)
        self.assertEqual(len(payload["blocks"]), 1)
        self.assertEqual(payload["blocks"][0]["type"], "table")
        self.assertEqual(payload["source"], "llm")
        # A rendered block is still something Candi said: the episode names it, so
        # "what did you show me?" is answerable next week.
        assistant = (brain.brain_root() / payload["episodePaths"][1]).read_text(encoding="utf-8")
        self.assertIn("Load", assistant)

    def test_a_blocks_only_completion_still_says_something(self):
        completion = '```kp:table\n{"columns": [{"key": "role", "label": "Role"}], "rows": [{"role": "Platform"}]}\n```'
        with mock.patch.object(companion_cli, "resolve_provider", return_value=_Provider(completion)):
            payload = companion_cli.run_turn(dict(TURN))
        self.assertEqual(payload["reply"], companion_cli.BLOCKS_ONLY_LEAD["en"])
        self.assertEqual(len(payload["blocks"]), 1)

    def test_a_prose_only_turn_reports_no_blocks_at_all(self):
        with mock.patch.object(companion_cli, "resolve_provider", return_value=_Provider()):
            payload = companion_cli.run_turn(dict(TURN))
        self.assertEqual(payload["blocks"], [])
        self.assertEqual(payload["blockErrors"], 0)

    def test_the_prompt_teaches_the_block_syntax_and_the_register(self):
        provider = _Provider()
        with mock.patch.object(companion_cli, "resolve_provider", return_value=provider):
            companion_cli.run_turn(dict(TURN))
        system = provider.system or ""
        self.assertIn("```kp:table", system)
        self.assertIn("```kp:chart", system)
        self.assertIn("Never restate the question", system)

    # -- the spoken channel (V1) ---------------------------------------------
    #
    # Every reply is dual-channel, so the property under test is that
    # `voiceReply` is ALWAYS there and always speakable — whatever the model did
    # or failed to do. A dock that has to check whether a turn can be spoken
    # before offering to speak it is a dock with two states too many.

    def test_a_model_written_voice_section_is_used_and_never_shown(self):
        completion = (
            "Twenty nine decisions are waiting on you, twelve more than yesterday. "
            "Two of them sit at the offer stage.\n\n"
            "<<<VOICE>>>\n29 decisions are waiting - twelve more than yesterday. "
            "Clear the offer-stage two first.\n<<<END_VOICE>>>"
        )
        with mock.patch.object(companion_cli, "resolve_provider", return_value=_Provider(completion)):
            payload = companion_cli.run_turn(dict(TURN))
        self.assertEqual(payload["voiceReply"]["source"], "model")
        self.assertEqual(
            payload["voiceReply"]["text"],
            "29 decisions are waiting - twelve more than yesterday. Clear the offer-stage two first.",
        )
        # The markers and the section never reach the transcript, the episode, or
        # the eye — the operator reads prose and is offered a button.
        self.assertNotIn("VOICE", payload["reply"])
        self.assertTrue(payload["reply"].startswith("Twenty nine decisions"))
        assistant = (brain.brain_root() / payload["episodePaths"][1]).read_text(encoding="utf-8")
        self.assertNotIn("<<<", assistant)

    def test_a_reply_with_no_voice_section_derives_one_without_a_second_call(self):
        completion = (
            "Four candidates are waiting on you. Two of them sit at the offer stage. "
            "The rest are screening and can wait until Friday."
        )
        provider = _Provider(completion)
        with mock.patch.object(companion_cli, "resolve_provider", return_value=provider) as resolve:
            payload = companion_cli.run_turn(dict(TURN))
        self.assertEqual(payload["voiceReply"]["source"], "derived")
        self.assertEqual(
            payload["voiceReply"]["text"],
            "Four candidates are waiting on you. Two of them sit at the offer stage.",
        )
        # One completion, not two: the derivation is mechanical by design.
        resolve.assert_called_once()

    def test_a_spoken_line_always_fits_one_synthesis_chunk(self):
        spoken = "The platform role is the one that needs you first. " * 12
        completion = f"Short prose.\n<<<VOICE>>>{spoken}<<<END_VOICE>>>"
        with mock.patch.object(companion_cli, "resolve_provider", return_value=_Provider(completion)):
            payload = companion_cli.run_turn(dict(TURN))
        self.assertLessEqual(len(payload["voiceReply"]["text"]), companion_cli.MAX_VOICE_CHARS)

    def test_a_blocks_only_reply_still_has_something_to_say_out_loud(self):
        completion = (
            '```kp:table\n{"columns": [{"key": "role", "label": "Role"}], "rows": [{"role": "Platform"}]}\n```'
        )
        with mock.patch.object(companion_cli, "resolve_provider", return_value=_Provider(completion)):
            payload = companion_cli.run_turn(dict(TURN))
        self.assertEqual(payload["voiceReply"]["text"], companion_cli.BLOCKS_ONLY_LEAD["en"])
        self.assertEqual(payload["voiceReply"]["source"], "derived")

    def test_a_dead_provider_speaks_the_hand_written_degraded_line(self):
        with mock.patch.object(companion_cli, "resolve_provider", return_value=_DeadProvider()):
            payload = companion_cli.run_turn(dict(TURN, locale="cs"))
        self.assertEqual(payload["voiceReply"]["text"], companion_cli.UNREACHABLE_VOICE["cs"])
        self.assertEqual(payload["voiceReply"]["source"], "derived")

    def test_the_prompt_teaches_the_voice_section_as_a_separate_composition(self):
        provider = _Provider()
        with mock.patch.object(companion_cli, "resolve_provider", return_value=provider):
            companion_cli.run_turn(dict(TURN))
        system = provider.system or ""
        self.assertIn("<<<VOICE>>>", system)
        self.assertIn("<<<END_VOICE>>>", system)
        self.assertIn("never point at the screen", system.lower())

    def test_the_digest_carries_the_same_spoken_channel(self):
        completion = "Two roles need you today.\n\n<<<VOICE>>>\nTwo roles need you today.\n<<<END_VOICE>>>"
        with mock.patch.object(companion_cli, "resolve_provider", return_value=_Provider(completion)):
            payload = companion_cli.run_digest(dict(TURN))
        self.assertEqual(payload["voiceReply"], {"text": "Two roles need you today.", "source": "model"})
        self.assertEqual(payload["reply"], "Two roles need you today.")

    def test_the_digest_derives_a_spoken_line_when_the_model_omits_one(self):
        provider = _Provider("Two roles need you today. The platform role has been open for 31 days.")
        with mock.patch.object(companion_cli, "resolve_provider", return_value=provider):
            payload = companion_cli.run_digest(dict(TURN))
        self.assertEqual(payload["voiceReply"]["source"], "derived")
        self.assertEqual(
            payload["voiceReply"]["text"],
            "Two roles need you today. The platform role has been open for 31 days.",
        )
        self.assertIn("voice section", provider.prompt or "")

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
