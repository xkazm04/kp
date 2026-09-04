"""The pipeline logger: it never raises, and its PII artifacts are contained.

This module had NO tests — a grep for ``write_prompt_artifact``,
``append_pipeline_log``, ``prompts_enabled`` or ``StageTimer`` across the suite
found nothing — while carrying the two properties most expensive to get wrong:

  * **Swallow, never raise.** Every function here runs inside a paid analysis. A
    read-only ``tmp``, a full disk or a name the platform rejects must cost a log
    line, not the request. Nothing enforced that; a future edit could add a
    raising path and no test would notice until an analysis died in production.
  * **The prompt artifacts are a candidate's whole CV on disk.** They were
    written with the process umask (world-readable under the common 0022) and
    never removed. They are now owner-only and swept on ``KP_LOG_PROMPTS_TTL_H``
    — and with that variable unset they are, explicitly, NEVER swept. That last
    sentence is a documented fact, so it is pinned here too.

Also pinned: the artifact NAME. The module docstring promised
``tmp/prompts/<request_id>.json`` while the writer emitted
``<request_id>-<suffix>``, so an operator following the doc found an empty
directory. The test names the real shape.

Everything here writes into a per-test temp directory; nothing touches ``tmp/``.
"""

from __future__ import annotations

import json
import os
import stat
import tempfile
import time
import unittest
from pathlib import Path
from unittest import mock

from pipeline.jobfit import logger


class _TempLogDir(unittest.TestCase):
    """Redirect the module's directory constants at a fresh temp dir per test."""

    def setUp(self) -> None:
        self._tmp = tempfile.TemporaryDirectory(prefix="kp-logger-test-")
        self.root = Path(self._tmp.name)
        patches = [
            mock.patch.object(logger, "LOG_DIR", self.root),
            mock.patch.object(logger, "PIPELINE_LOG", self.root / "pipeline.log"),
            mock.patch.object(logger, "PROMPT_DIR", self.root / "prompts"),
        ]
        for patch in patches:
            patch.start()
            self.addCleanup(patch.stop)
        self.addCleanup(self._tmp.cleanup)

    def enable_prompts(self, **extra: str) -> None:
        env = {"KP_LOG_PROMPTS": "1", **extra}
        patch = mock.patch.dict(os.environ, env, clear=False)
        patch.start()
        self.addCleanup(patch.stop)


class RequestIdTest(unittest.TestCase):
    def test_a_request_id_is_16_hex_chars_and_not_a_counter(self) -> None:
        first, second = logger.new_request_id(), logger.new_request_id()
        for value in (first, second):
            self.assertEqual(len(value), 16)
            int(value, 16)  # raises if it is not hex
        self.assertNotEqual(first, second)


class PipelineLogTest(_TempLogDir):
    def test_one_json_line_per_entry_with_a_utc_timestamp(self) -> None:
        logger.append_pipeline_log({"request_id": "abc", "total_ms": 12})
        logger.append_pipeline_log({"request_id": "def", "total_ms": 34})
        lines = (self.root / "pipeline.log").read_text(encoding="utf-8").strip().split("\n")
        self.assertEqual(len(lines), 2)
        first = json.loads(lines[0])
        self.assertEqual(first["request_id"], "abc")
        self.assertTrue(first["ts"].endswith("Z"), first["ts"])

    def test_a_non_serializable_value_is_stringified_not_raised(self) -> None:
        logger.append_pipeline_log({"error": ValueError("boom")})
        record = json.loads((self.root / "pipeline.log").read_text(encoding="utf-8").strip())
        self.assertIn("boom", record["error"])

    def test_an_unwritable_log_never_breaks_the_request(self) -> None:
        with mock.patch.object(Path, "open", side_effect=OSError("read-only fs")):
            logger.append_pipeline_log({"request_id": "abc"})  # must not raise

    def test_an_uncreatable_directory_never_breaks_the_request(self) -> None:
        with mock.patch.object(Path, "mkdir", side_effect=PermissionError("denied")):
            logger.append_pipeline_log({"request_id": "abc"})  # must not raise


class PromptArtifactTest(_TempLogDir):
    def test_off_by_default_nothing_is_written(self) -> None:
        with mock.patch.dict(os.environ, {"KP_LOG_PROMPTS": ""}, clear=False):
            logger.write_prompt_artifact("r1", "prompt.txt", "a whole CV")
        self.assertFalse((self.root / "prompts").exists())

    def test_the_name_is_request_id_dash_suffix_as_documented(self) -> None:
        self.enable_prompts()
        logger.write_prompt_artifact("r1", "prompt.txt", "a whole CV")
        self.assertEqual(
            sorted(p.name for p in (self.root / "prompts").iterdir()), ["r1-prompt.txt"]
        )

    def test_the_content_round_trips_including_diacritics(self) -> None:
        self.enable_prompts()
        logger.write_prompt_artifact("r1", "prompt.txt", "Přeložit životopis")
        written = (self.root / "prompts" / "r1-prompt.txt").read_text(encoding="utf-8")
        self.assertEqual(written, "Přeložit životopis")

    def test_the_artifact_is_created_owner_only(self) -> None:
        # Asserted at the SYSCALL, not only on the resulting stat: Windows (and
        # FAT / some network mounts) does not enforce POSIX modes, so a
        # mode-only assertion would silently pass there while a regression to
        # write_text() — umask-controlled, world-readable under the common 0022
        # — went unnoticed. The mode is additionally verified where the OS keeps
        # it, so both halves of "owner-only" are covered on the platform that
        # can prove it.
        self.enable_prompts()
        real_open = os.open
        seen: list[int] = []

        def recording(path: object, flags: int, mode: int = 0o777) -> int:
            seen.append(mode)
            return real_open(path, flags, mode)

        with mock.patch.object(os, "open", recording):
            logger.write_prompt_artifact("r1", "prompt.txt", "a whole CV")
        self.assertEqual(seen, [0o600])
        if os.name != "nt":
            mode = (self.root / "prompts" / "r1-prompt.txt").stat().st_mode
            self.assertEqual(stat.S_IMODE(mode), 0o600)

    def test_an_overwrite_does_not_inherit_a_wider_mode(self) -> None:
        # O_CREAT applies the mode only to a NEW file; the explicit chmod after
        # the write is what keeps a pre-existing (world-readable) artifact safe.
        self.enable_prompts()
        prompts = self.root / "prompts"
        prompts.mkdir()
        stale = prompts / "r1-prompt.txt"
        stale.write_text("old", encoding="utf-8")
        os.chmod(stale, 0o666)
        logger.write_prompt_artifact("r1", "prompt.txt", "new")
        self.assertEqual(stale.read_text(encoding="utf-8"), "new")
        if os.name != "nt":
            self.assertEqual(stat.S_IMODE(stale.stat().st_mode), 0o600)

    def test_an_unwritable_artifact_never_breaks_the_request(self) -> None:
        self.enable_prompts()
        with mock.patch.object(os, "open", side_effect=OSError("no space left")):
            logger.write_prompt_artifact("r1", "prompt.txt", "a whole CV")  # must not raise


class PromptRetentionTest(_TempLogDir):
    def _aged_artifact(self, name: str, hours_old: float) -> Path:
        prompts = self.root / "prompts"
        prompts.mkdir(exist_ok=True)
        path = prompts / name
        path.write_text("a whole CV", encoding="utf-8")
        old = time.time() - hours_old * 3600
        os.utime(path, (old, old))
        return path

    def test_with_the_ttl_unset_artifacts_are_never_swept(self) -> None:
        # The documented default, stated as such in the module docstring: no
        # retention at all until an operator opts in.
        with mock.patch.dict(os.environ, {"KP_LOG_PROMPTS_TTL_H": ""}, clear=False):
            ancient = self._aged_artifact("old-prompt.txt", hours_old=10_000)
            self.assertIsNone(logger.prompt_ttl_hours())
            self.assertEqual(logger.sweep_prompt_artifacts(), 0)
        self.assertTrue(ancient.exists())

    def test_the_ttl_removes_only_what_has_aged_out(self) -> None:
        old = self._aged_artifact("old-prompt.txt", hours_old=48)
        fresh = self._aged_artifact("fresh-prompt.txt", hours_old=1)
        with mock.patch.dict(os.environ, {"KP_LOG_PROMPTS_TTL_H": "24"}, clear=False):
            self.assertEqual(logger.sweep_prompt_artifacts(), 1)
        self.assertFalse(old.exists())
        self.assertTrue(fresh.exists())

    def test_a_write_sweeps_before_it_writes(self) -> None:
        old = self._aged_artifact("old-prompt.txt", hours_old=48)
        self.enable_prompts(KP_LOG_PROMPTS_TTL_H="24")
        logger.write_prompt_artifact("r2", "prompt.txt", "a whole CV")
        self.assertFalse(old.exists())
        self.assertTrue((self.root / "prompts" / "r2-prompt.txt").exists())

    def test_a_malformed_or_non_positive_ttl_is_treated_as_unset(self) -> None:
        # A broken number must not silently delete everything, and must not look
        # like a retention policy that is not one.
        for raw in ("banana", "0", "-5"):
            with self.subTest(raw=raw):
                with mock.patch.dict(os.environ, {"KP_LOG_PROMPTS_TTL_H": raw}, clear=False):
                    self.assertIsNone(logger.prompt_ttl_hours())
                    self.assertEqual(logger.sweep_prompt_artifacts(), 0)

    def test_a_sweep_over_a_missing_directory_is_zero_not_an_error(self) -> None:
        with mock.patch.dict(os.environ, {"KP_LOG_PROMPTS_TTL_H": "24"}, clear=False):
            self.assertEqual(logger.sweep_prompt_artifacts(), 0)

    def test_one_unremovable_artifact_does_not_abort_the_sweep(self) -> None:
        self._aged_artifact("a-prompt.txt", hours_old=48)
        self._aged_artifact("b-prompt.txt", hours_old=48)
        real_unlink = Path.unlink
        calls = {"n": 0}

        def flaky(self_path: Path, *args: object, **kwargs: object) -> None:
            calls["n"] += 1
            if calls["n"] == 1:
                raise PermissionError("locked by another process")
            real_unlink(self_path, *args, **kwargs)

        with mock.patch.dict(os.environ, {"KP_LOG_PROMPTS_TTL_H": "24"}, clear=False):
            with mock.patch.object(Path, "unlink", flaky):
                self.assertEqual(logger.sweep_prompt_artifacts(), 1)


class StageTimerTest(unittest.TestCase):
    def test_it_records_a_millisecond_duration_under_the_stage_name(self) -> None:
        timings: dict[str, int] = {}
        with logger.StageTimer(timings, "extract"):
            time.sleep(0.02)
        self.assertIn("extract", timings)
        self.assertGreaterEqual(timings["extract"], 15)

    def test_a_raising_body_still_records_its_stage(self) -> None:
        # The stage that FAILED is the one an operator most wants a duration for.
        timings: dict[str, int] = {}
        with self.assertRaises(ValueError):
            with logger.StageTimer(timings, "analyze"):
                raise ValueError("boom")
        self.assertIn("analyze", timings)

    def test_stages_accumulate_into_one_sink(self) -> None:
        timings: dict[str, int] = {}
        with logger.StageTimer(timings, "extract"):
            pass
        with logger.StageTimer(timings, "score"):
            pass
        self.assertEqual(sorted(timings), ["extract", "score"])


if __name__ == "__main__":  # pragma: no cover
    unittest.main()
