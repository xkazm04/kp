"""The action half of a companion reply: parsing, teaching, and the digest leg.

Three properties, in the order they matter:

1. **Nothing here knows an action's name.** The catalog crosses the process
   boundary in ``turn.json``; the prompt addendum and the fence validator are both
   built from it. So the tests below ship a SYNTHETIC catalog and assert the
   behaviour follows it — a test that hardcoded ``run_analysis`` would pass just as
   happily if this module had grown its own list, which is the exact drift the
   catalog exists to prevent.
2. **A malformed proposal never reaches the operator, and never crashes a turn.**
   Unknown id, missing required param, bad JSON, an unterminated fence, one past
   the cap: dropped and counted, the same contract the block half keeps.
3. **The digest is the same door with nobody on the other side of it** — one
   metered call, one assistant episode, prose plus the same optional blocks and
   proposals.
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
from pipeline.jobfit.companion_blocks import MAX_ACTIONS, split_reply_actions


# A synthetic catalog, deliberately NOT the real one: these tests pin the
# derivation, not the v1 action set (app/_lib/companion-actions.test.ts pins that
# side). If a name from the product leaked into this module, this fixture would
# stop being able to prove anything.
CATALOG = [
    {
        "id": "do_thing",
        "description": "Do the thing the operator asked about. It proposes only.",
        "params": [
            {"name": "target", "required": True, "doc": "what to do it to"},
            {"name": "note", "required": False, "doc": "an optional aside"},
        ],
    },
    {
        "id": "do_nothing",
        "description": "An action that takes no parameters at all.",
        "params": [],
    },
]


def fenced(body: str) -> str:
    return f"```kp:action\n{body}\n```"


class SplitReplyActionsTestCase(unittest.TestCase):
    def test_a_valid_proposal_leaves_clean_prose_behind(self):
        prose, actions, dropped = split_reply_actions(
            f'I would re-check that.\n\n{fenced(json.dumps({"id": "do_thing", "params": {"target": "x"}}))}',
            CATALOG,
        )
        self.assertNotIn("```", prose)
        self.assertIn("I would re-check that.", prose)
        self.assertEqual(dropped, 0)
        self.assertEqual(actions, [{"id": "do_thing", "params": {"target": "x"}}])

    def test_an_action_with_no_params_is_valid(self):
        _, actions, dropped = split_reply_actions(fenced('{"id": "do_nothing"}'), CATALOG)
        self.assertEqual(actions, [{"id": "do_nothing", "params": {}}])
        self.assertEqual(dropped, 0)

    def test_an_unknown_id_is_dropped_and_counted(self):
        _, actions, dropped = split_reply_actions(fenced('{"id": "delete_everything", "params": {}}'), CATALOG)
        self.assertEqual(actions, [])
        self.assertEqual(dropped, 1)

    def test_a_missing_required_param_is_dropped_and_counted(self):
        _, actions, dropped = split_reply_actions(fenced('{"id": "do_thing", "params": {"note": "hi"}}'), CATALOG)
        self.assertEqual(actions, [])
        self.assertEqual(dropped, 1)

    def test_an_undeclared_param_is_stripped_rather_than_carried(self):
        _, actions, _ = split_reply_actions(
            fenced('{"id": "do_thing", "params": {"target": "x", "smuggled": "y"}}'), CATALOG
        )
        self.assertEqual(actions, [{"id": "do_thing", "params": {"target": "x"}}])

    def test_a_non_string_param_value_is_refused(self):
        # A number reads as a plausible value and is not one: every parameter
        # crosses into a stored row and then into an executor that expects text.
        _, actions, dropped = split_reply_actions(fenced('{"id": "do_thing", "params": {"target": 42}}'), CATALOG)
        self.assertEqual(actions, [{"id": "do_thing", "params": {"target": "42"}}])
        self.assertEqual(dropped, 0)
        _, actions, dropped = split_reply_actions(
            fenced('{"id": "do_thing", "params": {"target": {"a": 1}}}'), CATALOG
        )
        self.assertEqual(actions, [])
        self.assertEqual(dropped, 1)

    def test_bad_json_and_a_dangling_fence_are_dropped_not_raised(self):
        _, actions, dropped = split_reply_actions(fenced("not json at all"), CATALOG)
        self.assertEqual((actions, dropped), ([], 1))
        prose, actions, dropped = split_reply_actions('Here.\n\n```kp:action\n{"id": "do_thing"', CATALOG)
        self.assertEqual(actions, [])
        self.assertEqual(dropped, 1)
        self.assertNotIn("```", prose)
        self.assertIn("Here.", prose)

    def test_at_most_two_proposals_survive_and_the_rest_are_counted(self):
        one = fenced(json.dumps({"id": "do_thing", "params": {"target": "a"}}))
        reply = "\n\n".join([one] * (MAX_ACTIONS + 2))
        _, actions, dropped = split_reply_actions(reply, CATALOG)
        self.assertEqual(len(actions), MAX_ACTIONS)
        self.assertEqual(dropped, 2)

    def test_an_absent_catalog_makes_every_proposal_invalid(self):
        # A caller that ships no catalog did not ask for an actor. The safe
        # default is that nothing proposes, not that everything is accepted.
        for absent in (None, [], "not a list", {}):
            _, actions, dropped = split_reply_actions(fenced('{"id": "do_thing", "params": {"target": "x"}}'), absent)
            self.assertEqual(actions, [], f"catalog {absent!r} should validate nothing")
            self.assertEqual(dropped, 1)

    def test_action_fences_do_not_disturb_the_block_fences(self):
        from pipeline.jobfit.companion_blocks import split_reply_blocks

        table = '```kp:table\n{"columns": [{"key": "r", "label": "Role"}], "rows": [{"r": "Platform"}]}\n```'
        raw = f"Two things.\n\n{table}\n\n{fenced(json.dumps({'id': 'do_nothing'}))}"
        prose, actions, action_dropped = split_reply_actions(raw, CATALOG)
        prose, blocks, block_dropped = split_reply_blocks(prose)
        self.assertEqual(len(actions), 1)
        self.assertEqual(len(blocks), 1)
        # The two drop counts stay SEPARATE facts: "she proposed something
        # unrunnable" and "she drew something unrenderable" are different problems.
        self.assertEqual((action_dropped, block_dropped), (0, 0))
        self.assertEqual(prose, "Two things.")


class _Completion:
    def __init__(self, text: str) -> None:
        self.text = text


class _Provider:
    def __init__(self, text: str = "Nothing needs you right now.") -> None:
        self._text = text
        self.system: str | None = None
        self.prompt: str | None = None

    def available(self) -> bool:
        return True

    def complete(self, prompt: str, system: str | None = None) -> _Completion:
        self.prompt = prompt
        self.system = system
        return _Completion(self._text)


TURN = {
    "workspace_id": "workspace",
    "session_id": "cthread-1",
    "message": "Should we re-check Novak?",
    "transcript": [],
    "grounding": {"attention": {"decisions": 4}, "pipeline": {"topRoles": [{"role": "Platform engineer"}]}},
    "locale": "en",
    "actions": CATALOG,
}


class BrainTempDirTestCase(unittest.TestCase):
    """Every turn writes episodes to disk, so each test gets its own brain root
    and both optional index lanes are pointed at nothing — the same isolation
    test_companion_cli.py uses."""

    def setUp(self) -> None:
        self._tmp = tempfile.TemporaryDirectory()
        self._saved = {k: os.environ.get(k) for k in ("PERSONAS_HOME", "KP_DB_PATH", "PERSONAS_DB_PATH")}
        os.environ["PERSONAS_HOME"] = self._tmp.name
        os.environ["KP_DB_PATH"] = str(Path(self._tmp.name) / "absent" / "kp.sqlite")
        os.environ["PERSONAS_DB_PATH"] = str(Path(self._tmp.name) / "absent" / "personas_data.db")

    def tearDown(self) -> None:
        for key, value in self._saved.items():
            if value is None:
                os.environ.pop(key, None)
            else:
                os.environ[key] = value
        self._tmp.cleanup()


class CatalogRoundTripTestCase(BrainTempDirTestCase):
    def test_the_shipped_catalog_reaches_the_prompt_verbatim(self):
        provider = _Provider()
        with mock.patch.object(companion_cli, "resolve_provider", return_value=provider):
            companion_cli.run_turn(dict(TURN))
        system = provider.system or ""
        # Every id, every description and every param doc from the SHIPPED catalog
        # is in the teaching. This is the round trip the design turns on: the
        # prompt cannot name an action the validator has not been given.
        for entry in CATALOG:
            self.assertIn(entry["id"], system)
            self.assertIn(entry["description"], system)
            for param in entry["params"]:
                self.assertIn(param["doc"], system)
        self.assertIn("```kp:action", system)
        self.assertIn("You never perform one", system)

    def test_a_turn_that_ships_no_catalog_teaches_no_action_at_all(self):
        provider = _Provider()
        turn = dict(TURN)
        turn.pop("actions")
        with mock.patch.object(companion_cli, "resolve_provider", return_value=provider):
            payload = companion_cli.run_turn(turn)
        self.assertNotIn("kp:action", provider.system or "")
        self.assertEqual(payload["actions"], [])

    def test_a_proposed_action_rides_out_beside_clean_prose(self):
        completion = (
            "I would re-check her.\n\n"
            f'{fenced(json.dumps({"id": "do_thing", "params": {"target": "Novak"}}))}\n\n'
            f"{fenced('not json')}"
        )
        with mock.patch.object(companion_cli, "resolve_provider", return_value=_Provider(completion)):
            payload = companion_cli.run_turn(dict(TURN))
        self.assertEqual(payload["reply"], "I would re-check her.")
        self.assertEqual(payload["actions"], [{"id": "do_thing", "params": {"target": "Novak"}}])
        self.assertEqual(payload["actionErrors"], 1)
        self.assertEqual(payload["blocks"], [])

    def test_a_completion_that_was_only_a_proposal_still_says_something(self):
        # The transcript stores prose, and a bare Accept button under a blank
        # bubble reads as a bug.
        completion = fenced(json.dumps({"id": "do_nothing"}))
        with mock.patch.object(companion_cli, "resolve_provider", return_value=_Provider(completion)):
            payload = companion_cli.run_turn(dict(TURN))
        self.assertEqual(payload["reply"], companion_cli.BLOCKS_ONLY_LEAD["en"])
        self.assertEqual(len(payload["actions"]), 1)


class DigestTestCase(BrainTempDirTestCase):
    DIGEST = {
        "workspace_id": "workspace",
        "session_id": "cthread-1",
        "digest": True,
        "grounding": {
            "attention": {"decisions": 4},
            "pipeline": {"topRoles": [{"role": "Platform engineer"}, {"role": "Data analyst"}]},
            "openProposals": [{"id": "cprop-1", "summary": "run_analysis: runAnalysis"}],
        },
        "locale": "en",
        "actions": CATALOG,
    }

    def test_the_digest_answers_without_a_message_and_logs_one_episode(self):
        provider = _Provider("Four decisions are waiting. Platform is the bottleneck.")
        with mock.patch.object(companion_cli, "resolve_provider", return_value=provider) as resolve:
            payload = companion_cli.run_digest(dict(self.DIGEST))
        # ONE metered leg, same brain door, same use case as a reply.
        resolve.assert_called_once()
        self.assertEqual(resolve.call_args.args[0], "assistant")
        self.assertEqual(payload["reply"], "Four decisions are waiting. Platform is the bottleneck.")
        self.assertEqual(payload["source"], "llm")
        # Exactly ONE episode, and it is Candi's: nobody spoke, so writing a user
        # episode would put words in the operator's mouth in a store their own
        # recall reads back.
        self.assertEqual(len(payload["episodePaths"]), 1)
        self.assertTrue(payload["episodePaths"][0].endswith("_assistant.md"))
        self.assertTrue((brain.brain_root() / payload["episodePaths"][0]).is_file())

    def test_the_digest_is_told_what_a_digest_is_and_can_still_propose(self):
        provider = _Provider(f'Here is today.\n\n{fenced(json.dumps({"id": "do_nothing"}))}')
        with mock.patch.object(companion_cli, "resolve_provider", return_value=provider):
            payload = companion_cli.run_digest(dict(self.DIGEST))
        system = provider.system or ""
        self.assertIn("Nobody asked you a question", system)
        self.assertIn("```kp:action", system)
        # The open queue is grounding, so the digest can refer to it.
        self.assertIn("cprop-1", provider.prompt or "")
        self.assertEqual(payload["actions"], [{"id": "do_nothing", "params": {}}])

    def test_the_digest_recalls_against_the_studio_rather_than_a_fixed_phrase(self):
        brain.append_episode("user", "The Platform engineer search is stuck at screening.", "kp-workspace")
        provider = _Provider()
        with mock.patch.object(companion_cli, "resolve_provider", return_value=provider):
            payload = companion_cli.run_digest(dict(self.DIGEST))
        # The query is built from the board's own busiest roles, so what it
        # remembers moves with what the studio holds.
        self.assertTrue(payload["recallUsed"])
        self.assertIn("Platform", provider.prompt or "")

    def test_a_dead_provider_digest_is_answered_but_never_remembered(self):
        class _Dead(_Provider):
            def complete(self, prompt, system=None):
                raise TimeoutError("the model never answered")

        with mock.patch.object(companion_cli, "resolve_provider", return_value=_Dead()):
            payload = companion_cli.run_digest(dict(self.DIGEST))
        self.assertEqual(payload["source"], "deterministic")
        self.assertEqual(payload["reply"], companion_cli.UNREACHABLE_REPLY["en"])
        self.assertEqual(payload["actions"], [])
        # A deterministic reply is ANSWERED, not REMEMBERED, and the digest leg
        # has no operator message to preserve either - so it writes nothing.
        self.assertEqual(payload["episodePaths"], [])

    def test_the_cli_entry_point_routes_digest_and_needs_no_message(self):
        workdir = Path(self._tmp.name) / "work"
        workdir.mkdir()
        (workdir / "turn.json").write_text(json.dumps(self.DIGEST), encoding="utf-8")
        with mock.patch.object(companion_cli, "resolve_provider", return_value=_Provider()):
            with mock.patch("sys.argv", ["companion_cli", "--workdir", str(workdir), "--digest"]):
                with mock.patch("builtins.print") as printed:
                    code = companion_cli.main()
        self.assertEqual(code, 0)
        emitted = json.loads(printed.call_args.args[0])
        self.assertEqual(emitted["reply"], "Nothing needs you right now.")
        self.assertEqual(emitted["actions"], [])


if __name__ == "__main__":
    unittest.main()
