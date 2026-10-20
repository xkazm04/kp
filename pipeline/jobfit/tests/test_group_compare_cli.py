"""The comparison CLI's contract with the Next.js bridge.

``group_compare_cli`` was the last CLI in the family still hand-rolling its own
scaffolding: an inline stdout/stderr reconfigure (which died with an AttributeError
whenever a harness replaced one stream and not the other), a bare
``{"error", "status": 500}`` envelope with no ``code`` — so python-runner.ts had to guess
one back out of the status and a malformed payload reached the recruiter as "the engine
failed" — an un-normalised ``--lang``, and no statement anywhere of which language the
narrative it emitted was actually written in.

Pinned here:
  * the failure envelope names its own code (``invalid_input`` for the caller's payload);
  * ``--lang`` is normalised, so ``cs-CZ`` / ``CS`` reach the prompt as ``cs``;
  * ``narrativeLang`` states the language of the TEXT, not of the request — the
    deterministic synthesis is English-only, so a ``--lang cs`` fallback answers ``en``
    and the modal's honest "shown in English" note can fire;
  * stdio configuration goes through the shared ``_cli.configure_stdio``.
"""

from __future__ import annotations

import unittest
from unittest import mock

from pipeline.jobfit import group_compare_cli
from pipeline.jobfit.tests._helpers import CliRun, run_cli

CONTEXT = {
    "roleTitle": "Backend Engineer",
    "candidates": [
        {
            "label": "Alice",
            "archetype": "bau",
            "seniority": "senior",
            "total": 82,
            "matchedSkills": ["Python"],
            "missingSkills": [],
            "verdict": "Strong senior backend fit.",
        },
        {
            "label": "Bob",
            "archetype": "bau",
            "seniority": "medior",
            "total": 58,
            "matchedSkills": [],
            "missingSkills": ["Python"],
            "verdict": "Promising but thin on the stack.",
        },
    ],
}


def _run(argv: list[str], payload: object = CONTEXT) -> CliRun:
    """group_compare_cli over ``payload`` (a str is written verbatim), read as the bridge reads it."""
    return run_cli(group_compare_cli.main, argv + ["--input-json", "@compare.json"], files={"compare.json": payload})


class ErrorEnvelopeTest(unittest.TestCase):
    def test_a_non_object_payload_is_a_400_the_caller_can_act_on(self) -> None:
        run = _run(["--no-llm"], ["not", "an", "object"])
        self.assertEqual(run.code, 1)
        envelope = run.envelope
        self.assertEqual(envelope["code"], "invalid_input")
        self.assertEqual(envelope["status"], 400)

    def test_unparseable_json_is_also_the_callers_input(self) -> None:
        run = _run(["--no-llm"], "{not json")
        self.assertEqual(run.code, 1)
        envelope = run.envelope
        # `_cli._classify` reads a JSONDecodeError honestly — 400, not an engine fault.
        self.assertEqual((envelope["code"], envelope["status"]), ("invalid_input", 400))

    def test_the_envelope_carries_a_code_at_all(self) -> None:
        # Non-vacuity for the two above: the pre-change CLI printed {error, status:500}
        # with NO `code` key, which is what forced the TS side to guess.
        # raw_envelope is what the CLI WROTE — the bridge's envelope always has a code.
        self.assertIn("code", _run(["--no-llm"], 42).raw_envelope)


class NarrativeLanguageTest(unittest.TestCase):
    def _payload(self, argv: list[str]) -> dict:
        run = _run(argv)
        self.assertEqual(run.code, 0, run.stderr)
        return run.payload

    def test_a_deterministic_fallback_states_english_whatever_was_asked(self) -> None:
        payload = self._payload(["--no-llm", "--lang", "cs"])
        self.assertEqual(payload["source"], "deterministic")
        # The synthesis is built from English literals in group_compare.py — saying
        # "cs" here is what let a shared, persisted payload pass English prose off as
        # localized (the per-match path has stated this since MAT1).
        self.assertEqual(payload["narrativeLang"], "en")

    def test_an_llm_answer_is_in_the_requested_language(self) -> None:
        class Ok:
            def complete_json(self, prompt, *, system=None, expected_keys=None):  # noqa: ANN001
                return {
                    "headline": "**Alice** vede.",
                    "keyPoints": ["**Alice** má **82** bodů."],
                    "recommendation": "Posunout **Alice**.",
                }

        with mock.patch.object(group_compare_cli, "resolve_provider", lambda *_a, **_k: Ok()), \
             mock.patch.object(group_compare_cli, "provider_availability", lambda _p: (True, None)):
            payload = self._payload(["--lang", "cs"])
        self.assertEqual(payload["source"], "llm")
        self.assertEqual(payload["narrativeLang"], "cs")

    def test_an_unsupported_or_regional_lang_is_normalised(self) -> None:
        class Ok:
            def complete_json(self, prompt, *, system=None, expected_keys=None):  # noqa: ANN001
                return {"headline": "**Alice** vede.", "keyPoints": ["**Alice** má **82** bodů."]}

        with mock.patch.object(group_compare_cli, "resolve_provider", lambda *_a, **_k: Ok()), \
             mock.patch.object(group_compare_cli, "provider_availability", lambda _p: (True, None)):
            self.assertEqual(self._payload(["--lang", "cs-CZ"])["narrativeLang"], "cs")
            # …and a language the engine does not speak falls back to the default
            # rather than reaching language_directive as an unknown name.
            self.assertEqual(self._payload(["--lang", "klingon"])["narrativeLang"], "en")

    def test_the_prompt_version_still_rides_along(self) -> None:
        self.assertTrue(self._payload(["--no-llm"])["promptVersion"])


class SharedScaffoldTest(unittest.TestCase):
    def test_stdio_goes_through_the_shared_helper(self) -> None:
        seen: list[bool] = []
        with mock.patch.object(group_compare_cli, "configure_stdio", lambda: seen.append(True)):
            _run(["--no-llm"])
        self.assertEqual(seen, [True])


class DescentReasonTest(unittest.TestCase):
    def test_a_mid_flight_failure_reaches_the_ledger_named(self) -> None:
        class Boom:
            def complete_json(self, prompt, *, system=None, expected_keys=None):  # noqa: ANN001
                raise TimeoutError("timed out after 120s")

        recorded: list[tuple[str, object]] = []
        with mock.patch.object(group_compare_cli, "resolve_provider", lambda *_a, **_k: Boom()), \
             mock.patch.object(group_compare_cli, "provider_availability", lambda _p: (True, None)), \
             mock.patch.object(
                 group_compare_cli,
                 "emit_deterministic",
                 lambda use_case, *, reason=None: recorded.append((use_case, reason)),
             ):
            run = _run([])
        self.assertEqual(run.code, 0)
        self.assertEqual(run.payload["source"], "deterministic")
        # Before this the availability gate passed, so `descent` stayed None and the
        # ledger recorded the one descent an operator can act on with no reason at all.
        self.assertEqual(recorded, [("group_compare", "TimeoutError: timed out after 120s")])


if __name__ == "__main__":
    unittest.main()
