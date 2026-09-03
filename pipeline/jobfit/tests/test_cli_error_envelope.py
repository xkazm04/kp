"""The engine's failure envelope: it names its own code, and both sides agree on the words.

Before this, ``_cli.emit_error`` printed ``{error, status: 500}`` for every failure and
``app/_lib/python-runner.ts`` GUESSED a code back out of the status. So "job not found"
(the recruiter picked a job the corpus no longer carries — remedy: pick another) and a
genuine engine fault reached the browser as the same anonymous 500, and the routes'
``matrixEngineAnswer`` could only answer both with the same generic sentence.

Pinned here:
  * the code is chosen at the RAISE site (``not_found`` / ``invalid_input`` / CliError);
  * an un-annotated exception is still classified honestly (bad JSON and pydantic
    validation are the caller's input, 400, not an engine fault);
  * the vocabulary is spelled identically in ``_cli.ERROR_CODES`` and the TS runner's
    ``PYTHON_ERROR_CODES`` — a code added on one side alone is a code the client can
    never resolve to an ``errors.<CODE>`` catalog key;
  * every CLI in the family that declares its own ``ERR_*`` literals uses these words.
"""

from __future__ import annotations

import io
import json
import re
import unittest
from contextlib import redirect_stderr
from pathlib import Path

from pydantic import BaseModel, ValidationError

from pipeline.jobfit import _cli

REPO_ROOT = Path(__file__).resolve().parents[3]
PYTHON_RUNNER_TS = REPO_ROOT / "app" / "_lib" / "python-runner.ts"


def capture(exc: Exception, **kwargs: object) -> dict:
    """Run emit_error and return the parsed envelope it printed to stderr."""
    buf = io.StringIO()
    with redirect_stderr(buf):
        rc = _cli.emit_error(exc, **kwargs)  # type: ignore[arg-type]
    assert rc == 1, "emit_error must return the process exit code 1"
    return json.loads(buf.getvalue().strip())


class RaiseSiteCodeTest(unittest.TestCase):
    def test_not_found_is_a_404_the_caller_can_act_on(self) -> None:
        env = capture(_cli.not_found("job not found: j-9"))
        self.assertEqual(env["code"], "not_found")
        self.assertEqual(env["status"], 404)
        self.assertEqual(env["error"], "job not found: j-9")

    def test_invalid_input_is_a_400(self) -> None:
        env = capture(_cli.invalid_input("weights must be an object"))
        self.assertEqual((env["code"], env["status"]), ("invalid_input", 400))

    def test_an_unannotated_exception_is_an_engine_error(self) -> None:
        env = capture(RuntimeError("segfault-ish"))
        self.assertEqual((env["code"], env["status"]), ("engine_error", 500))

    def test_unparseable_json_is_the_callers_input_not_an_engine_fault(self) -> None:
        # match_cli's --weights / --input-json path raises this on a malformed payload.
        try:
            json.loads("{not json")
        except json.JSONDecodeError as exc:
            env = capture(exc)
        self.assertEqual((env["code"], env["status"]), ("invalid_input", 400))

    def test_a_pydantic_validation_error_is_a_400(self) -> None:
        # load_candidate_arg's MatchCandidate.model_validate on a bad CV extraction.
        class M(BaseModel):
            n: int

        try:
            M.model_validate({"n": "not-a-number"})
        except ValidationError as exc:
            env = capture(exc)
        self.assertEqual((env["code"], env["status"]), ("invalid_input", 400))

    def test_a_timeout_is_named_as_one(self) -> None:
        env = capture(TimeoutError("provider did not answer"))
        self.assertEqual((env["code"], env["status"]), ("timeout", 504))

    def test_an_explicit_override_still_wins(self) -> None:
        env = capture(RuntimeError("x"), status=429, code="not_found")
        self.assertEqual((env["code"], env["status"]), ("not_found", 429))

    def test_a_typod_code_fails_loudly_at_construction(self) -> None:
        # A code the catalogs don't carry would ride to the browser as an unresolvable
        # key; that is a programming error, so it must never reach the wire.
        with self.assertRaises(ValueError):
            _cli.CliError("x", code="nope_not_a_code")

    def test_the_envelope_is_one_line_of_utf8_json(self) -> None:
        # parseStderrError reads the LAST line of stderr, so a multi-line envelope
        # (or an \\uXXXX-escaped Czech message) breaks the bridge.
        buf = io.StringIO()
        with redirect_stderr(buf):
            _cli.emit_error(_cli.not_found("úloha nenalezena: vývojář"))
        printed = buf.getvalue()
        self.assertEqual(len(printed.strip().splitlines()), 1)
        self.assertIn("vývojář", printed)


class VocabularySyncTest(unittest.TestCase):
    """The words themselves, in lockstep across the boundary and across the CLIs."""

    def test_error_codes_is_the_closed_set_the_status_map_covers(self) -> None:
        self.assertEqual(set(_cli.ERROR_CODES), set(_cli._STATUS_FOR_CODE))
        self.assertEqual(len(_cli.ERROR_CODES), len(set(_cli.ERROR_CODES)), "duplicate code")

    def test_the_ts_runner_declares_the_same_vocabulary(self) -> None:
        source = PYTHON_RUNNER_TS.read_text(encoding="utf-8")
        match = re.search(r"PYTHON_ERROR_CODES\s*=\s*\[([^\]]*)\]", source)
        self.assertIsNotNone(match, f"no PYTHON_ERROR_CODES literal in {PYTHON_RUNNER_TS}")
        ts_codes = set(re.findall(r'"([a-z_]+)"', match.group(1)))
        self.assertEqual(
            ts_codes,
            set(_cli.ERROR_CODES),
            "python-runner.ts and _cli.py disagree on the engine's failure vocabulary — "
            "a code added on one side alone resolves to no errors.<CODE> catalog key.",
        )

    def test_the_ts_runner_derives_every_code_it_declares(self) -> None:
        # Non-vacuity: the shared list is only worth something if codeForStatus can
        # actually produce each word (otherwise a code is declared and never reachable).
        source = PYTHON_RUNNER_TS.read_text(encoding="utf-8")
        body = source[source.index("function codeForStatus") :]
        body = body[: body.index("\n}")]
        for code in _cli.ERROR_CODES:
            self.assertIn(f'"{code}"', body, f"codeForStatus never yields {code!r}")

    def test_the_sibling_clis_spell_the_codes_the_same_way(self) -> None:
        # Seven CLIs predate the shared scaffold and declare their own ERR_* literals.
        # They are not required to import from _cli, but they ARE required to agree on
        # the strings — a lone "notfound" would defeat the whole contract.
        pkg = REPO_ROOT / "pipeline" / "jobfit"
        seen: dict[str, set[str]] = {}
        for path in sorted(pkg.rglob("*_cli.py")):
            for name, value in re.findall(r'^(ERR_[A-Z_]+)\s*=\s*"([^"]+)"', path.read_text(encoding="utf-8"), re.M):
                seen.setdefault(name, set()).add(value)
        self.assertTrue(seen, "no ERR_* declarations found — did the CLIs move?")
        for name, values in seen.items():
            self.assertEqual(len(values), 1, f"{name} is spelled {sorted(values)} in different CLIs")
            self.assertIn(
                next(iter(values)),
                _cli.ERROR_CODES,
                f"{name} carries a word outside _cli.ERROR_CODES",
            )


if __name__ == "__main__":
    unittest.main()
