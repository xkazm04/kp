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

from pipeline.jobfit import profile_cli


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


if __name__ == "__main__":
    unittest.main()
