"""Both documented ways to launch a headless analysis script actually launch it.

``scripts/_common.py`` claimed since it was written that "both ``python
scripts/analyze.py ...`` and ``python -m scripts.analyze ...`` work". Only the
first one did. The scripts import their shared helpers as ``from _common import
...``, which resolves only when ``scripts/`` is on ``sys.path`` — Python puts it
there for a file invocation (the script's own directory) but not for ``-m``,
where ``sys.path[0]`` is the repository root. So the module form died with
``ModuleNotFoundError: No module named '_common'`` at import time, before argv
was parsed, and nothing noticed because nothing ran it.

``scripts/__init__.py`` now puts the directory on the path when the package is
imported, so the claim is true. This file is what keeps it true: it launches
every script BOTH ways in a real subprocess, from the repository root, with
``--help``, which reaches the imports and the argparse wiring without needing a
CV, a key, or a network.

Run with::

    python -m unittest pipeline.jobfit.tests.test_scripts_entrypoints
"""

from __future__ import annotations

import subprocess
import sys
import unittest
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[3]
SCRIPTS = REPO_ROOT / "scripts"

# Every script in scripts/ that imports the shared helpers, i.e. every script both
# forms have to carry. Derived rather than listed, so a sixth one is covered the
# day it lands instead of the day someone remembers this file.
ENTRYPOINTS = sorted(
    p.stem
    for p in SCRIPTS.glob("*.py")
    if not p.stem.startswith("_") and "from _common import" in p.read_text(encoding="utf-8")
)


def _run(argv: list[str]) -> subprocess.CompletedProcess[str]:
    return subprocess.run(
        [sys.executable, *argv, "--help"],
        cwd=REPO_ROOT,
        capture_output=True,
        text=True,
        timeout=120,
    )


class ScriptEntrypointTests(unittest.TestCase):
    def test_the_scripts_are_discovered_at_all(self) -> None:
        # A glob that silently matched nothing would make every test below vacuous.
        self.assertGreaterEqual(len(ENTRYPOINTS), 4, f"found only {ENTRYPOINTS}")
        self.assertIn("analyze", ENTRYPOINTS)

    def test_file_form_runs(self) -> None:
        for name in ENTRYPOINTS:
            with self.subTest(script=name):
                res = _run([str(SCRIPTS / f"{name}.py")])
                self.assertEqual(res.returncode, 0, f"python scripts/{name}.py --help failed:\n{res.stderr}")
                self.assertIn("usage:", res.stdout)

    def test_module_form_runs(self) -> None:
        # THE REGRESSION. Before scripts/__init__.py this failed for every script
        # with ModuleNotFoundError: No module named '_common'.
        for name in ENTRYPOINTS:
            with self.subTest(script=name):
                res = _run(["-m", f"scripts.{name}"])
                self.assertNotIn("No module named '_common'", res.stderr)
                self.assertEqual(res.returncode, 0, f"python -m scripts.{name} --help failed:\n{res.stderr}")
                self.assertIn("usage:", res.stdout)

    def test_both_forms_expose_the_same_interface(self) -> None:
        # If the two forms ever diverge (a different argparse wiring reached through
        # a different import path), the help text is where it shows first.
        for name in ENTRYPOINTS:
            with self.subTest(script=name):
                as_file = _run([str(SCRIPTS / f"{name}.py")]).stdout
                as_module = _run(["-m", f"scripts.{name}"]).stdout
                # The program name legitimately differs; the options must not.
                self.assertEqual(
                    as_file.split("\n\n", 1)[-1].strip(),
                    as_module.split("\n\n", 1)[-1].strip(),
                    f"scripts/{name}.py offers a different interface than -m scripts.{name}",
                )


if __name__ == "__main__":
    unittest.main()
