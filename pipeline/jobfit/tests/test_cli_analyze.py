"""The flagship analysis entry point: its error envelope, its stream framing, its locale.

``pipeline.jobfit.cli`` is the CLI every CV analysis goes through — and it had no test
at all. Three things went unpinned because of that:

  * its failure envelope carried ``{error, status}`` and NO ``code``, so
    ``python-runner.parseStderrError`` guessed one back out of the status and a client
    mistake reached the browser looking exactly like an engine outage;
  * ``--stream`` framed its errors a THIRD way (an SSE ``error`` event) that could not
    carry a code even in principle, so the two framings could drift silently;
  * ``--lang`` was stamped into the persisted pipeline-log record verbatim, so
    ``cs-CZ`` / ``CS`` / a typo each became a distinct value in data later reads group
    on — canonical data keyed on something that was never canonical.

Pinned here, with `analyze` mocked: the engine itself is out of scope, the BOUNDARY is
what these tests are about.
"""

from __future__ import annotations

import contextlib
import io
import json
import unittest
from pathlib import Path
from unittest import mock

from pipeline.jobfit import _cli, cli


class _ByteStdout(io.StringIO):
    """A stdout stand-in with the ``.buffer`` ``_emit_event`` writes raw bytes to.

    The SSE framing deliberately bypasses text mode (Windows would translate "\\n" to
    "\\r\\n" and break the "\\n\\n" event separator), so a plain StringIO cannot capture
    it. No ``reconfigure``, which is also what makes ``configure_stdio`` skip it.
    """

    def __init__(self) -> None:
        super().__init__()
        self.buffer = io.BytesIO()

    def events(self) -> list[dict]:
        raw = self.buffer.getvalue().decode("utf-8")
        return [json.loads(chunk[len("data: ") :]) for chunk in raw.split("\n\n") if chunk.strip()]


def _run(argv: list[str], analyze_side_effect=None, analyze_return=None):
    """Run cli.main with `analyze` mocked; return (exit code, stdout, stderr, mock)."""
    out, err = _ByteStdout(), io.StringIO()
    stub = mock.Mock(side_effect=analyze_side_effect, return_value=analyze_return)
    with contextlib.redirect_stdout(out), contextlib.redirect_stderr(err):
        with mock.patch.object(cli, "analyze", stub):
            code = cli.main(argv)
    return code, out, err.getvalue(), stub


def _last_json(stream: str) -> dict:
    lines = [ln for ln in stream.splitlines() if ln.strip()]
    return json.loads(lines[-1])


class AnalyzeCliErrorEnvelopeTest(unittest.TestCase):
    """One vocabulary, chosen at the raise site, on the plain (non-stream) framing."""

    def test_a_bad_argument_is_a_400_the_form_can_act_on(self) -> None:
        rc, _out, err, _ = _run(["cv.pdf"], analyze_side_effect=ValueError("Unsupported file type: .rtf"))
        env = _last_json(err)
        self.assertEqual((env["status"], env["code"]), (400, "invalid_input"))
        self.assertIn("Unsupported file type", env["error"])
        self.assertEqual(rc, 2, "a client mistake exits 2 (parseStderrError's non-JSON fallback)")

    def test_an_engine_fault_is_a_500_that_still_names_a_code(self) -> None:
        # The regression this file exists for: the old envelope had no `code` key at
        # all, so every failure resolved to the same generic sentence on screen.
        rc, _out, err, _ = _run(["cv.pdf"], analyze_side_effect=RuntimeError("provider blew up"))
        env = _last_json(err)
        self.assertEqual((env["status"], env["code"]), (500, "engine_error"))
        self.assertEqual(rc, 1)

    def test_a_raise_site_code_survives_to_the_envelope(self) -> None:
        rc, _out, err, _ = _run(["cv.pdf"], analyze_side_effect=_cli.not_found("job not found: j-9"))
        env = _last_json(err)
        self.assertEqual((env["status"], env["code"]), (404, "not_found"))
        self.assertEqual(rc, 1)

    def test_every_code_it_can_emit_is_in_the_shared_vocabulary(self) -> None:
        # Non-vacuity for the three above: a word outside ERROR_CODES resolves to no
        # errors.<CODE> catalog key and would reach the reader as raw English.
        for exc in (ValueError("x"), RuntimeError("y"), _cli.not_found("z")):
            _rc, _out, err, _ = _run(["cv.pdf"], analyze_side_effect=exc)
            self.assertIn(_last_json(err)["code"], _cli.ERROR_CODES)

    def test_the_envelope_is_one_line_of_unescaped_utf8(self) -> None:
        # parseStderrError reads the LAST line of stderr.
        _rc, _out, err, _ = _run(["cv.pdf"], analyze_side_effect=ValueError("nepodporovaný typ"))
        self.assertEqual(len([ln for ln in err.splitlines() if ln.strip()]), 1)
        self.assertIn("nepodporovaný", err)


class AnalyzeCliStreamFramingTest(unittest.TestCase):
    """`--stream` delivers its error as an EVENT — and now names the same code."""

    def test_the_error_event_carries_the_status_and_the_code(self) -> None:
        rc, out, err, _ = _run(["cv.pdf", "--stream"], analyze_side_effect=RuntimeError("gemini down"))
        events = out.events()
        self.assertEqual([e["type"] for e in events], ["error"])
        self.assertEqual((events[0]["status"], events[0]["code"]), (500, "engine_error"))
        self.assertEqual(events[0]["message"], "gemini down")
        self.assertEqual(err.strip(), "", "the stream framing answers on stdout, not stderr")
        self.assertEqual(rc, 0, "the error was DELIVERED; a non-zero exit would double-report it")

    def test_a_client_mistake_streams_as_a_400(self) -> None:
        _rc, out, _err, _ = _run(["cv.pdf", "--stream"], analyze_side_effect=ValueError("no text found"))
        self.assertEqual((out.events()[0]["status"], out.events()[0]["code"]), (400, "invalid_input"))

    def test_the_two_framings_agree_on_the_code_for_the_same_fault(self) -> None:
        # The whole point of routing both through one _fail(): the SSE consumer and
        # the stderr consumer must never learn different things about one failure.
        exc = _cli.not_found("job not found: j-9")
        _rc, _out, err, _ = _run(["cv.pdf"], analyze_side_effect=exc)
        _rc2, out2, _err2, _ = _run(["cv.pdf", "--stream"], analyze_side_effect=exc)
        plain, streamed = _last_json(err), out2.events()[0]
        self.assertEqual((plain["code"], plain["status"]), (streamed["code"], streamed["status"]))

    def test_progress_and_result_still_frame_as_sse_events(self) -> None:
        # Non-vacuity: the happy path's framing is unchanged by the error work.
        def _emit_stages(*_a, progress=None, **_kw):
            progress("gemini", "active")
            return {"slug": "x"}

        _rc, out, _err, _ = _run(["cv.pdf", "--stream"], analyze_side_effect=_emit_stages)
        events = out.events()
        self.assertEqual([e["type"] for e in events], ["stage", "result"])
        self.assertEqual(events[-1]["data"], {"slug": "x"})


class AnalyzeCliLangNormalizationTest(unittest.TestCase):
    """A locale is canonicalised at the BOUNDARY, once."""

    def test_a_regional_tag_reaches_the_engine_as_its_primary_subtag(self) -> None:
        _rc, _out, _err, stub = _run(["cv.pdf", "--lang", "cs-CZ"], analyze_return={})
        self.assertEqual(stub.call_args.kwargs["lang"], "cs")

    def test_an_upper_case_code_is_lowered(self) -> None:
        _rc, _out, _err, stub = _run(["cv.pdf", "--lang", "CS"], analyze_return={})
        self.assertEqual(stub.call_args.kwargs["lang"], "cs")

    def test_an_unsupported_code_falls_back_to_the_default_rather_than_riding_raw(self) -> None:
        _rc, _out, _err, stub = _run(["cv.pdf", "--lang", "kl-KL"], analyze_return={})
        self.assertEqual(stub.call_args.kwargs["lang"], "en")

    def test_the_supported_locales_pass_through_unchanged(self) -> None:
        for code in ("en", "cs", "de", "fr"):
            _rc, _out, _err, stub = _run(["cv.pdf", "--lang", code], analyze_return={})
            self.assertEqual(stub.call_args.kwargs["lang"], code)


class PersistedLangIsCanonicalTest(unittest.TestCase):
    """…and what we STORE matches what we asked for.

    The pipeline-log record is read back for cost/locale reporting; a raw "cs-CZ" there
    is a second value for one language that every later group-by has to know about.
    """

    def _logged_lang(self, lang: str) -> str:
        from pipeline.jobfit import pipeline as pipeline_mod

        captured: list[dict] = []
        with mock.patch.object(pipeline_mod, "append_pipeline_log", captured.append):
            with contextlib.suppress(Exception):
                # A path that doesn't exist fails in the first stage; the `finally`
                # still writes the record, which is the line under test.
                pipeline_mod.analyze_cv(Path("does-not-exist.pdf"), lang=lang)
        self.assertTrue(captured, "analyze_cv must log its record even on a failure")
        return captured[-1]["lang"]

    def test_a_regional_request_is_stored_as_its_canonical_code(self) -> None:
        self.assertEqual(self._logged_lang("cs-CZ"), "cs")

    def test_an_upper_case_request_is_stored_lowered(self) -> None:
        self.assertEqual(self._logged_lang("CS"), "cs")

    def test_a_canonical_request_is_stored_verbatim(self) -> None:
        self.assertEqual(self._logged_lang("de"), "de")


if __name__ == "__main__":
    unittest.main()
