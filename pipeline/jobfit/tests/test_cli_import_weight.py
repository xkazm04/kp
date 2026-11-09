"""Importing a hot CLI must not pull in a heavy SDK, nor run pydantic's plugin scan.

ADR 0003 spawns the pipeline per request, so every module a CLI imports at module
top is paid on EVERY request, before any work. Two costs were removed and this file
keeps them removed (measured with ``node scripts/perf/python-import-time.mjs``):

* ``gemini.py`` imported the google-genai SDK at module top (~600 ms: aiohttp, httpx
  and a large pydantic type module). It sits on the import path of the CV-analysis
  CLI and the market-salary CLI, so every analysis paid for it even when the provider
  was Claude CLI or the run was keyless. The SDK is now imported on first use.
* pydantic scans every installed distribution's entry points for plugins the first
  time it builds a model (~50 ms on a machine with ~580 distributions). kp declares
  no pydantic plugin; ``pipeline/jobfit/__init__.py`` turns the scan off.

Each probe runs in a FRESH interpreter (``sys.modules`` of this test process is
polluted by every other test) with ``PYDANTIC_DISABLE_PLUGINS`` removed from its
environment, so the package's own default is what is tested.
"""

from __future__ import annotations

import json
import os
import subprocess
import sys
import unittest
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[3]

# The entry points the app spawns on interactive routes (profile, match, extract,
# analysis, intake, companion, matrix, winnability, reasoning) plus the two that
# reached the Gemini SDK through gemini.py, and two task-runner CLIs.
HOT_CLIS = (
    "pipeline.jobfit.profile_cli",
    "pipeline.jobfit.match_cli",
    "pipeline.jobfit.extract_cli",
    "pipeline.jobfit.cli",
    "pipeline.jobfit.intake_cli",
    "pipeline.jobfit.companion_cli",
    "pipeline.jobfit.matrix_cli",
    "pipeline.jobfit.winnability_cli",
    "pipeline.jobfit.reasoning_cli",
    "pipeline.jobfit.market_salary_cli",
    "pipeline.jobfit.automation_cli",
    "pipeline.jobfit.devcase.devcase_cli",
)

# Modules no CLI may load merely by being imported. Each is either an LLM/HTTP SDK
# that only one code path needs, or a heavy library none of these CLIs needs at top.
HEAVY = (
    "google.genai",
    "aiohttp",
    "httpx",
    "requests",
    "openai",
    "anthropic",
    "numpy",
    "pypdf",
    "fitz",
)

_PROBE = """
import importlib, json, sys
target = sys.argv[1]
importlib.import_module(target)
if len(sys.argv) > 2:
    getattr(sys.modules[target], sys.argv[2])
loader = sys.modules.get("pydantic.plugin._loader")
print(json.dumps({
    "heavy": [m for m in %r if m in sys.modules],
    "pydantic": "pydantic" in sys.modules,
    "plugin_scan_ran": None if loader is None else loader._plugins is not None,
}))
""" % (list(HEAVY),)


def _env() -> dict[str, str]:
    env = {k: v for k, v in os.environ.items() if k != "PYDANTIC_DISABLE_PLUGINS"}
    env["PYTHONUTF8"] = "1"
    return env


def _probe(target: tuple[str, ...]) -> dict:
    proc = subprocess.run(
        [sys.executable, "-c", _PROBE, *target],
        cwd=REPO_ROOT,
        env=_env(),
        capture_output=True,
        text=True,
        encoding="utf-8",
        timeout=120,
    )
    if proc.returncode != 0:
        raise AssertionError(f"importing {target[0]} failed (exit {proc.returncode}): {proc.stderr.strip()[-600:]}")
    return json.loads(proc.stdout.strip().splitlines()[-1])


def _probe_many(targets: list[tuple[str, ...]]) -> dict[tuple[str, ...], dict]:
    """One fresh interpreter per target, a few at a time, each report parsed."""
    with ThreadPoolExecutor(max_workers=4) as pool:
        return dict(zip(targets, pool.map(_probe, targets)))


class CliImportWeightTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.reports = _probe_many([(m,) for m in HOT_CLIS])

    def test_no_hot_cli_imports_a_heavy_module(self) -> None:
        for mod in HOT_CLIS:
            with self.subTest(cli=mod):
                self.assertEqual(
                    self.reports[(mod,)]["heavy"],
                    [],
                    f"`import {mod}` loaded a heavy module at import time. Move that import into "
                    "the function that needs it (see gemini._genai for the pattern).",
                )

    def test_pydantic_plugin_scan_never_runs(self) -> None:
        loaded = [m for m in HOT_CLIS if self.reports[(m,)]["pydantic"]]
        # Most hot CLIs build pydantic models at import; if none did, this test would
        # be vacuous, so say so instead of passing.
        self.assertGreaterEqual(len(loaded), 5, "expected most hot CLIs to import pydantic")
        for mod in loaded:
            with self.subTest(cli=mod):
                self.assertFalse(
                    self.reports[(mod,)]["plugin_scan_ran"],
                    f"`import {mod}` ran pydantic's entry-point plugin scan; "
                    "pipeline/jobfit/__init__.py must set PYDANTIC_DISABLE_PLUGINS before any model is built.",
                )

    def test_the_probe_can_see_the_sdk(self) -> None:
        # The control: touching gemini.genai DOES load the SDK, so an empty `heavy`
        # list above means "not imported", not "the probe cannot see it".
        try:
            import google.genai  # noqa: F401
        except ImportError:  # pragma: no cover - requirements.txt pins google-genai
            self.fail("google-genai is a declared dependency (requirements.txt) and must be importable")
        report = _probe_many([("pipeline.jobfit.gemini", "genai")])[("pipeline.jobfit.gemini", "genai")]
        self.assertIn("google.genai", report["heavy"])


if __name__ == "__main__":
    unittest.main()
