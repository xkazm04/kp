"""Every refusal in the Gemini seam names its cause, and the boundary hears it.

Before this, all nine raise sites in ``gemini.py`` were bare ``RuntimeError``s
carrying English prose only. Three consequences, all of them real:

  * a caller could not branch. "You have no key" (operator config), "KP_OFFLINE
    forbids this call" (a permanent, deliberate refusal) and "the model answered
    with prose" (retry / degrade) were the same exception with a different
    sentence — while the sibling CLI adapter has told them apart via
    ``ClaudeCliError.subtype`` since it shipped;
  * the process boundary heard nothing. ``_cli.emit_error`` classifies an
    un-annotated exception as ``engine_error``/500, so "set GEMINI_API_KEY"
    reached the browser as the generic "the engine failed, try again";
  * the only way to test for a specific failure was to match on prose.

Pinned here: the subtype vocabulary is closed and validated at construction;
each raise site carries the right one; the CLI code each maps to is the one the
route can act on; and ``GeminiError`` is still a ``RuntimeError``, so every
existing ``except RuntimeError`` around a Gemini call catches what it did before.

Everything here is offline — no key, no client, no network.
"""

from __future__ import annotations

import io
import json
import unittest
from contextlib import redirect_stderr
from unittest import mock

from pipeline.jobfit import _cli, gemini
from pipeline.jobfit.gemini import GEMINI_SUBTYPES, GeminiError


def _envelope(exc: Exception) -> dict:
    """The JSON the CLI boundary prints for this exception."""
    buf = io.StringIO()
    with redirect_stderr(buf):
        _cli.emit_error(exc)
    return json.loads(buf.getvalue().strip())


class GeminiErrorTypeTest(unittest.TestCase):
    def test_it_is_still_a_runtime_error_so_existing_catches_hold(self) -> None:
        # gemini._parse_truncated and several callers catch RuntimeError; typing
        # the error must not quietly stop those from firing.
        self.assertIsInstance(GeminiError("x", subtype="empty_response"), RuntimeError)

    def test_an_unknown_subtype_fails_loudly_at_construction(self) -> None:
        # A typo'd subtype would leave a caller's branch silently dead forever.
        with self.assertRaises(ValueError):
            GeminiError("x", subtype="typo_here")

    def test_every_subtype_maps_to_a_code_the_boundary_speaks(self) -> None:
        for subtype in GEMINI_SUBTYPES:
            with self.subTest(subtype=subtype):
                err = GeminiError("x", subtype=subtype)
                self.assertIn(err.code, _cli.ERROR_CODES)
                self.assertEqual(_envelope(err)["code"], err.code)

    def test_an_operator_fixable_refusal_is_a_400_not_an_engine_fault(self) -> None:
        env = _envelope(GeminiError("no key", subtype="missing_key"))
        self.assertEqual((env["code"], env["status"]), ("invalid_input", 400))

    def test_a_model_side_failure_is_an_engine_error(self) -> None:
        env = _envelope(GeminiError("prose", subtype="unparseable_json"))
        self.assertEqual((env["code"], env["status"]), ("engine_error", 500))

    def test_a_bare_runtime_error_would_still_be_an_anonymous_500(self) -> None:
        # The behaviour this change replaces, kept visible so the value of the
        # typed error is not re-litigated from memory.
        env = _envelope(RuntimeError("Set GEMINI_API_KEY or GOOGLE_API_KEY …"))
        self.assertEqual((env["code"], env["status"]), ("engine_error", 500))


class RaiseSiteSubtypeTest(unittest.TestCase):
    """Each refusal in the module raises the subtype that names what happened."""

    def test_a_missing_key_says_missing_key(self) -> None:
        with mock.patch.object(gemini, "load_local_env", lambda: None):
            with mock.patch.dict("os.environ", {}, clear=True):
                with self.assertRaises(GeminiError) as ctx:
                    gemini.get_gemini_api_key()
        self.assertEqual(ctx.exception.subtype, "missing_key")

    def test_the_offline_seal_says_offline_refused(self) -> None:
        with mock.patch.dict("os.environ", {"KP_OFFLINE": "1"}, clear=False):
            with self.assertRaises(GeminiError) as ctx:
                gemini._assert_egress_allowed()
        self.assertEqual(ctx.exception.subtype, "offline_refused")
        # A deliberate refusal the operator can undo — not an engine fault.
        self.assertEqual(ctx.exception.code, _cli.ERR_INVALID_INPUT)

    def test_prose_instead_of_json_says_unparseable_json(self) -> None:
        with self.assertRaises(GeminiError) as ctx:
            gemini._parse_json("I'm afraid I can't answer that.")
        self.assertEqual(ctx.exception.subtype, "unparseable_json")

    def test_a_body_cut_at_the_token_cap_says_output_truncated(self) -> None:
        with self.assertRaises(GeminiError) as ctx:
            gemini._parse_truncated('{"score": 8', ("score", "summary"), 16000)
        self.assertEqual(ctx.exception.subtype, "output_truncated")
        # The remedy is the caller's (raise the cap / shorten the input), so the
        # route may render it: 400, not the generic engine failure.
        self.assertEqual(ctx.exception.code, _cli.ERR_INVALID_INPUT)

    def test_truncation_recovery_still_wins_over_the_error(self) -> None:
        # The typed error must not have swallowed the salvage path: a body cut
        # after the last needed key is still recovered, not raised.
        recovered = gemini._parse_truncated(
            '{"score": 80, "summary": "strong", "trail', ("score", "summary"), 16000
        )
        self.assertEqual(recovered["score"], 80)


class SubtypeVocabularyTest(unittest.TestCase):
    def test_the_vocabulary_is_a_closed_set_with_no_duplicates(self) -> None:
        self.assertEqual(len(set(GEMINI_SUBTYPES)), len(GEMINI_SUBTYPES))

    def test_every_declared_subtype_has_a_cli_code(self) -> None:
        self.assertEqual(set(gemini._SUBTYPE_CLI_CODE), set(GEMINI_SUBTYPES))


if __name__ == "__main__":  # pragma: no cover
    unittest.main()
