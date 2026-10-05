"""NEED_TO_ROLE probe (pipeline/jobfit/eval/need_to_role_probe.py).

The probe is a MEASUREMENT of key goal 2 ("hire-from-need composes a role from a
stated need"): how many of the intake scenarios reach a complete role through
brief -> rubric -> JD draft, keyless. These tests pin what makes the reading
trustworthy rather than the reading itself:

* the denominator is read from the scenarios file, never hardcoded;
* an incomplete scenario names the first stage it stopped at;
* missing input exits non-zero and prints NO number (never a 0);
* the run touches no network and reads no provider key.
"""

from __future__ import annotations

import contextlib
import io
import json
import os
import socket
import tempfile
import unittest
import unittest.mock
from pathlib import Path

from pipeline.jobfit.eval import need_to_role_probe as probe
from pipeline.jobfit.eval.intake_eval import load_scenarios


def _run(argv: list[str]) -> tuple[int, str, str]:
    out, err = io.StringIO(), io.StringIO()
    with contextlib.redirect_stdout(out), contextlib.redirect_stderr(err):
        code = probe.main(argv)
    return code, out.getvalue(), err.getvalue()


def _write_scenarios(directory: str, scenarios: list[dict]) -> str:
    path = Path(directory) / "scenarios.json"
    path.write_text(json.dumps({"version": 1, "scenarios": scenarios}), encoding="utf-8")
    return str(path)


class DenominatorTest(unittest.TestCase):
    def test_denominator_is_the_scenario_count_in_the_real_file(self) -> None:
        expected = len(load_scenarios())
        self.assertGreater(expected, 0)
        code, out, _ = _run(["--json"])
        self.assertEqual(code, 0)
        reading = json.loads(out)
        self.assertEqual(reading["denominator"], expected)
        self.assertLessEqual(reading["value"], reading["denominator"])

    def test_text_output_leads_with_the_n_over_N_reading(self) -> None:
        expected = len(load_scenarios())
        code, out, _ = _run([])
        self.assertEqual(code, 0)
        self.assertRegex(out.splitlines()[0], rf"^NEED_TO_ROLE = \d+/{expected}$")

    def test_denominator_follows_the_file_not_a_constant(self) -> None:
        three = load_scenarios()[:3]
        with tempfile.TemporaryDirectory() as tmp:
            code, out, _ = _run(["--json", "--scenarios", _write_scenarios(tmp, three)])
        self.assertEqual(code, 0)
        self.assertEqual(json.loads(out)["denominator"], 3)


class StageAttributionTest(unittest.TestCase):
    def test_a_scenario_with_no_must_have_is_incomplete_at_brief(self) -> None:
        # Answers that state nothing screenable: the deterministic agent has no
        # must-have to capture, so the brief core is absent.
        empty = {
            "name": "states_nothing",
            "lang": "en",
            "family": "software_engineering",
            "dealbreakers": [],
            "golden_answers": ["I don't know yet.", "Not sure, honestly.", "Whatever you think."],
            "expect": {},
        }
        with tempfile.TemporaryDirectory() as tmp:
            code, out, _ = _run(["--json", "--scenarios", _write_scenarios(tmp, [empty])])
        self.assertEqual(code, 0)
        reading = json.loads(out)
        self.assertEqual(reading["value"], 0)
        self.assertEqual(reading["denominator"], 1)
        self.assertEqual(len(reading["failures"]), 1)
        failure = reading["failures"][0]
        self.assertEqual(failure["scenario"], "states_nothing")
        self.assertEqual(failure["stage"], "brief")
        self.assertTrue(failure["reason"])

    def test_incomplete_scenarios_are_named_in_the_text_output(self) -> None:
        empty = {
            "name": "states_nothing",
            "lang": "en",
            "family": "software_engineering",
            "dealbreakers": [],
            "golden_answers": ["I don't know yet."],
            "expect": {},
        }
        good = load_scenarios(["power_unit_backfill"])
        with tempfile.TemporaryDirectory() as tmp:
            code, out, _ = _run(["--scenarios", _write_scenarios(tmp, [*good, empty])])
        self.assertEqual(code, 0)
        self.assertTrue(out.startswith("NEED_TO_ROLE = 1/2"))
        self.assertIn("states_nothing", out)
        self.assertIn("brief", out)

    def test_stage_breakdown_names_every_stage_and_the_jd_scope(self) -> None:
        code, out, _ = _run(["--json"])
        self.assertEqual(code, 0)
        reading = json.loads(out)
        self.assertEqual(set(reading["stages"]), {"brief", "rubric", "jd"})
        for stage in reading["stages"].values():
            self.assertIn("measured", stage)
        self.assertTrue(reading["stages"]["jd"]["measured"])
        # What the JD stage does NOT run is declared, not implied.
        self.assertTrue(any(u["stage"] == "jd_markdown" for u in reading["unmeasured"]))


class MissingInputTest(unittest.TestCase):
    def _assert_refuses(self, argv: list[str]) -> None:
        code, out, err = _run(argv)
        self.assertNotEqual(code, 0)
        self.assertEqual(out, "", f"a refusal must print no reading, printed: {out!r}")
        self.assertNotIn("NEED_TO_ROLE", out)
        self.assertTrue(err.strip(), "a refusal says why on stderr")

    def test_missing_scenarios_file_exits_non_zero_and_prints_no_number(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            self._assert_refuses(["--scenarios", str(Path(tmp) / "nope.json")])
            self._assert_refuses(["--json", "--scenarios", str(Path(tmp) / "nope.json")])

    def test_unparseable_scenarios_file_refuses(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            bad = Path(tmp) / "bad.json"
            bad.write_text("{not json", encoding="utf-8")
            self._assert_refuses(["--json", "--scenarios", str(bad)])

    def test_empty_scenarios_file_refuses_rather_than_reading_zero_of_zero(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            self._assert_refuses(["--json", "--scenarios", _write_scenarios(tmp, [])])

    def test_a_stage_module_that_fails_to_import_refuses(self) -> None:
        with unittest.mock.patch.object(probe, "_import_stages", side_effect=ImportError("rolerubric gone")):
            self._assert_refuses(["--json"])


class KeylessNetworkFreeTest(unittest.TestCase):
    def test_no_network_call_and_no_key_read_with_every_api_key_unset(self) -> None:
        calls: list[str] = []

        def _refuse(*args, **kwargs):
            calls.append(repr(args)[:80])
            raise AssertionError("the probe attempted a network call")

        clean = {k: v for k, v in os.environ.items() if not k.upper().endswith("_API_KEY")}
        with unittest.mock.patch.dict(os.environ, clean, clear=True), \
                unittest.mock.patch.object(socket.socket, "connect", _refuse), \
                unittest.mock.patch.object(socket, "create_connection", _refuse), \
                unittest.mock.patch.object(socket, "getaddrinfo", _refuse), \
                unittest.mock.patch("http.client.HTTPConnection.connect", _refuse), \
                unittest.mock.patch("http.client.HTTPSConnection.connect", _refuse), \
                unittest.mock.patch("urllib.request.urlopen", _refuse):
            self.assertFalse([k for k in os.environ if k.upper().endswith("_API_KEY")])
            code, out, _ = _run(["--json"])
        self.assertEqual(calls, [])
        self.assertEqual(code, 0)
        self.assertEqual(json.loads(out)["denominator"], len(load_scenarios()))

    def test_probe_never_resolves_a_provider(self) -> None:
        with unittest.mock.patch("pipeline.jobfit.llm.registry.resolve_provider") as resolve:
            code, _, _ = _run(["--json"])
        self.assertEqual(code, 0)
        resolve.assert_not_called()


if __name__ == "__main__":
    unittest.main()
