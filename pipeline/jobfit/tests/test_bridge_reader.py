"""The CLI tests' reader IS the bridge's reader.

Every CLI in this package exists to be read by one program, app/_lib/python-runner.ts:
``parsePythonJson`` scans stdout back for the last JSON object or array (skipping
trailing interpreter chatter and bare scalars), ``parseStderrError`` takes the error
envelope from the last non-empty stderr line and derives a code from the status and
the exit-2 rule. The CLI suites used to parse output their own way — whole-stdout
``json.loads(out or "{}")`` (an EMPTY stdout read as ``{}``), a strict last line, an
inline re-parse of stderr — so they asserted on a reader production does not run.

``_helpers.run_cli`` now reads through a port of those two functions. This module pins
the port to the original: it runs ``fixtures/bridge_read_cases.json`` through the
port, and app/_lib/python-runner-bridge-cases.test.ts runs the SAME rows through the
real TS readers. A reader changed on one side only turns one of the two suites red.
"""

from __future__ import annotations

import json
import sys
import unittest
from pathlib import Path

from pipeline.jobfit import _cli
from pipeline.jobfit.tests._helpers import (
    BridgeReadError,
    CliRun,
    read_stderr_envelope,
    read_stdout_payload,
    run_cli,
)

CASES = json.loads(
    (Path(__file__).resolve().parent / "fixtures" / "bridge_read_cases.json").read_text(encoding="utf-8")
)


class CaseTableTest(unittest.TestCase):
    def test_the_table_is_non_trivial_on_both_streams(self) -> None:
        # Mirrors the TS suite's non-vacuity check: an emptied table is green over nothing.
        self.assertGreaterEqual(len(CASES["stdout"]), 10)
        self.assertGreaterEqual(len(CASES["stderr"]), 15)

    def test_every_stdout_row_reads_as_the_bridge_reads_it(self) -> None:
        for row in CASES["stdout"]:
            with self.subTest(row["name"]):
                if row["expect"].get("error"):
                    with self.assertRaises(BridgeReadError):
                        read_stdout_payload(row["stdout"])
                else:
                    self.assertEqual(read_stdout_payload(row["stdout"]), row["expect"]["payload"])

    def test_every_stderr_row_reads_as_the_bridge_reads_it(self) -> None:
        for row in CASES["stderr"]:
            with self.subTest(row["name"]):
                self.assertEqual(read_stderr_envelope(row["stderr"], row["exit"]), row["expect"]["envelope"])


class ReaderEdgesTest(unittest.TestCase):
    def test_trailing_chatter_does_not_break_the_read(self) -> None:
        # Whole-stdout json.loads raised JSONDecodeError on exactly these bytes.
        self.assertEqual(read_stdout_payload('{"a":1}\nResourceWarning: unclosed file'), {"a": 1})

    def test_a_scalar_or_an_empty_stdout_is_a_read_failure_never_an_empty_object(self) -> None:
        for stdout in ("42", ""):
            with self.subTest(stdout=stdout), self.assertRaises(BridgeReadError):
                read_stdout_payload(stdout)

    def test_the_envelope_is_the_last_non_empty_stderr_line(self) -> None:
        env = read_stderr_envelope(
            'DeprecationWarning: x\n{"error":"job not found: j","status":404,"code":"not_found"}', 1
        )
        self.assertEqual(env, {"message": "job not found: j", "status": 404, "code": "not_found"})

    def test_code_derivation_and_the_exit_2_rule(self) -> None:
        self.assertEqual(read_stderr_envelope('{"error":"e","status":404}', 1)["code"], "not_found")
        self.assertEqual(read_stderr_envelope('{"error":"e","status":400,"code":"  "}', 1)["code"], "invalid_input")
        self.assertEqual(read_stderr_envelope("usage: bad", 2), {"message": "usage: bad", "status": 400, "code": "invalid_input"})
        self.assertEqual(read_stderr_envelope("boom", 1), {"message": "boom", "status": 500, "code": "engine_error"})


def _noisy_main(argv: list[str]) -> int:
    # A CLI whose result is followed by shutdown chatter, as a real interpreter prints it.
    print('{"a":1}')
    print("ResourceWarning: unclosed file")
    return 0


def _echo_file_main(argv: list[str]) -> int:
    # Reads the --input-json file run_cli wrote and echoes it back.
    path = argv[argv.index("--input-json") + 1]
    print(Path(path).read_text(encoding="utf-8"))
    return 0


def _silent_main(argv: list[str]) -> int:
    return 0


def _rogue_code_main(argv: list[str]) -> int:
    print(json.dumps({"error": "slow down", "status": 429, "code": "rate_limited"}), file=sys.stderr)
    return 1


def _argparse_main(argv: list[str]) -> int:
    print("usage: x [-h]", file=sys.stderr)
    raise SystemExit(2)


class RunCliTest(unittest.TestCase):
    def test_a_trailing_warning_does_not_fail_a_successful_run(self) -> None:
        run = run_cli(_noisy_main, [])
        self.assertIsInstance(run, CliRun)
        self.assertEqual((run.code, run.payload, run.envelope), (0, {"a": 1}, None))

    def test_files_are_written_and_substituted_into_argv(self) -> None:
        run = run_cli(_echo_file_main, ["--input-json", "@in.json"], files={"in.json": {"k": [1, 2]}})
        self.assertEqual(run.payload, {"k": [1, 2]})
        # A str is written verbatim — how a test hands a CLI malformed JSON.
        self.assertEqual(run_cli(_echo_file_main, ["--input-json", "@in.json"], files={"in.json": '{"raw":true}'}).payload, {"raw": True})

    def test_a_successful_run_with_no_payload_fails_at_read_time(self) -> None:
        # The bridge throws here; `out.getvalue() or "{}"` used to read it as {}.
        with self.assertRaises(BridgeReadError):
            run_cli(_silent_main, [])

    def test_an_envelope_code_outside_the_vocabulary_fails_at_read_time_named(self) -> None:
        self.assertNotIn("rate_limited", _cli.ERROR_CODES)
        with self.assertRaises(BridgeReadError) as ctx:
            run_cli(_rogue_code_main, [])
        self.assertIn("rate_limited", str(ctx.exception))
        # …and a test that means to pin such a code can say so.
        run = run_cli(_rogue_code_main, [], check_codes=False)
        self.assertEqual(run.envelope["code"], "rate_limited")
        self.assertEqual(run.raw_envelope, {"error": "slow down", "status": 429, "code": "rate_limited"})

    def test_system_exit_is_the_process_exit_code(self) -> None:
        run = run_cli(_argparse_main, [])
        self.assertEqual(run.code, 2)
        self.assertEqual(run.envelope, {"message": "usage: x [-h]", "status": 400, "code": "invalid_input"})
        self.assertIsNone(run.raw_envelope)


if __name__ == "__main__":
    unittest.main()
