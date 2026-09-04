"""Honest CLI error-status mapping for profile_cli (idea-9da19793).

profile_cli used to wrap EVERY exception — including the pydantic ValidationError
from a malformed intake draft — in one handler that emitted status 500 / exit 1,
so /api/profile reported user-fixable bad input as an engine failure. These tests
pin the honest contract, mirroring test_automation_cli / test_devcase_cli:

  * a malformed intake draft -> exit 2, status 400, code "invalid_input"
  * malformed JSON           -> exit 2, status 400, code "invalid_input"
  * an unexpected fault       -> exit 1, status 500, code "engine_error"
  * valid input               -> exit 0, routed + scored profile on stdout
"""

import contextlib
import io
import json
import tempfile
import unittest
from pathlib import Path
from unittest import mock

from pipeline.jobfit import _cli, profile_cli


def _run(intake: str) -> tuple[int, str, str]:
    """Write `intake` to a temp file, run the CLI over it, return (code, out, err)."""
    out, err = io.StringIO(), io.StringIO()
    with tempfile.TemporaryDirectory() as d:
        path = Path(d) / "intake.json"
        path.write_text(intake, encoding="utf-8")
        with contextlib.redirect_stdout(out), contextlib.redirect_stderr(err):
            code = profile_cli.main(["--input-json", str(path)])
    return code, out.getvalue(), err.getvalue()


def _last_json(stream: str) -> dict:
    """The CLI emits one json.dumps line; parse the last non-empty line."""
    lines = [ln for ln in stream.splitlines() if ln.strip()]
    return json.loads(lines[-1])


class TestProfileCliErrorStatus(unittest.TestCase):
    def test_malformed_draft_is_400_invalid_input(self):
        # A draft that parses as JSON but isn't a valid CandidateProfileV2
        # (yearsExperience must be a number) raises pydantic ValidationError —
        # a ValueError subclass — so it's user-fixable 400, not a 500 fault.
        code, _out, err = _run(json.dumps({"profile": {"yearsExperience": "not-a-number"}}))
        self.assertEqual(code, 2)
        payload = _last_json(err)
        self.assertEqual(payload["status"], 400)
        self.assertEqual(payload["code"], "invalid_input")

    def test_malformed_json_is_400_invalid_input(self):
        # Bad JSON -> json.JSONDecodeError (a ValueError subclass) -> 400.
        code, _out, err = _run("{ this is not json")
        self.assertEqual(code, 2)
        payload = _last_json(err)
        self.assertEqual(payload["status"], 400)
        self.assertEqual(payload["code"], "invalid_input")

    def test_engine_failure_is_500_engine_error(self):
        # Valid input, but the normalizer blows up mid-run -> retry/escalate,
        # not editable input.
        with mock.patch(
            "pipeline.jobfit.profile_cli.normalize_profile", side_effect=RuntimeError("boom")
        ):
            code, _out, err = _run(json.dumps({"profile": {}}))
        self.assertEqual(code, 1)
        payload = _last_json(err)
        self.assertEqual(payload["status"], 500)
        self.assertEqual(payload["code"], "engine_error")
        self.assertIn("boom", payload["error"])

    def test_valid_input_returns_zero_with_routed_profile(self):
        code, out, _err = _run(json.dumps({"profile": {}, "signals": {}}))
        self.assertEqual(code, 0)
        payload = _last_json(out)
        self.assertIn("profile", payload)
        self.assertIn("archetype", payload)
        self.assertIn("completeness", payload)

    def test_routing_reasons_ship_a_localizable_twin(self):
        # The panel renders the ROUTER's explanation; `reasons` is English prose, so
        # the wire also carries `reasonCodes` ({kind, params}) for the catalogs — one
        # code per reason, same order. Without this key the cs/de/fr reader gets the
        # English sentence, which is the defect it closes.
        code, out, _err = _run(json.dumps({"profile": {}, "signals": {"isEnrolled": True}}))
        self.assertEqual(code, 0)
        payload = _last_json(out)
        self.assertEqual(len(payload["reasonCodes"]), len(payload["reasons"]))
        self.assertEqual(payload["reasonCodes"][0]["kind"], "signal_enrolled")


class TestProfileCliSpeaksTheSharedVocabulary(unittest.TestCase):
    """profile_cli used to declare its own ERR_* literals and hand-roll the envelope.

    It now imports the words from `_cli` and prints through `emit_error`, which is what
    let it leave the shrinking LOCAL_ERR_HOLDOUTS ratchet in test_cli_error_envelope.
    These are the non-vacuity checks for that removal.
    """

    def test_it_declares_no_local_error_words_of_its_own(self) -> None:
        # An identity check is impossible once the literals are gone, so assert the
        # absence directly: a re-declared ERR_* is how a lone typo ships a code that
        # resolves to no errors.<CODE> catalog key in any of the four locales.
        source = Path(profile_cli.__file__).read_text(encoding="utf-8")
        self.assertNotRegex(source, r'(?m)^ERR_[A-Z_]+\s*=\s*"')

    def test_every_code_it_emits_is_in_the_shared_set(self) -> None:
        _rc, _out, bad_json = _run("{ not json")
        with mock.patch("pipeline.jobfit.profile_cli.normalize_profile", side_effect=RuntimeError("boom")):
            _rc2, _out2, fault = _run(json.dumps({"profile": {}}))
        for stream in (bad_json, fault):
            self.assertIn(_last_json(stream)["code"], _cli.ERROR_CODES)

    def test_the_envelope_is_the_single_line_the_bridge_parses(self) -> None:
        # parseStderrError reads the LAST line of stderr only.
        _rc, _out, err = _run(json.dumps({"profile": {"displayName": "Věra", "yearsExperience": "x"}}))
        self.assertEqual(len([ln for ln in err.splitlines() if ln.strip()]), 1)

    def test_one_replaced_stream_does_not_crash_the_cli(self) -> None:
        # The open-coded reconfigure pair this CLI carried tested sys.stdout and then
        # called sys.stderr.reconfigure unconditionally, so a harness capturing only
        # one stream died with an AttributeError before line one. configure_stdio
        # guards each stream separately; _run replaces BOTH, so also assert the
        # single-stream case the old form actually broke on.
        buf = io.StringIO()
        with contextlib.redirect_stderr(buf):  # stdout real, stderr replaced
            profile_cli.configure_stdio()
        self.assertEqual(buf.getvalue(), "")


if __name__ == "__main__":
    unittest.main()
