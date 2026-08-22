"""Run the unittest suite and fail when it is silently weaker than it looks.

Two tripwires, both for failures that leave a green run:

1. SKIPS. `python -m unittest` reports `OK (skipped=N)` and exits 0 even when a
   *critical* test never ran (a removed fixture, an unset env var). This wrapper
   prints a per-test skip summary and fails when the skip count exceeds a known
   baseline, so a newly-skipping test trips CI instead of disappearing.
2. HERMETICITY. `tests/__init__.py` installs two layers so no test can emit to a
   real LightTrack server or read a developer's `.env.local`. Nothing tests THAT
   guard: deleting either layer leaves every test in the suite passing (verified
   by mutation, 2026-08-22) while the run starts POSTing real LLM telemetry into
   whatever project the developer has configured. :func:`_hermeticity_problems`
   checks both layers are installed BEFORE the suite is allowed to certify
   anything.

    python -m pipeline.jobfit.tests.run_gated     # gated run
    ALLOW_SKIP=1 python -m ...run_gated           # local override (no keys)
    KP_SKIP_BASELINE=6 python -m ...run_gated      # deliberately raise the bar

Covers the Python unittest suite; the Playwright e2e suite has its own
key-gated skip (and its own deterministic stubs).
"""
from __future__ import annotations

import os
import sys
import unittest
from pathlib import Path

# Skips we knowingly tolerate in a keyless CI: the live Claude-CLI smoke, the
# Gemini-key PDF test, the two personal-CV fixtures that are not in the repo, and
# the interview-eval grounded bridge (spawns node + better-sqlite3, which the
# Python-only CI job does not install).
# Bump this DELIBERATELY (with a comment) when a new tolerated skip is added.
SKIP_BASELINE = int(os.getenv("KP_SKIP_BASELINE", "5"))

TESTS_DIR = Path(__file__).resolve().parent
REPO_ROOT = TESTS_DIR.parents[2]


def _hermeticity_problems() -> list[str]:
    """Verify the suite-wide no-network guard in ``tests/__init__.py`` is installed.

    Both layers are identified by ORIGIN, not by presence: the stub class and the
    neutralised ``load_dotenv`` are defined in the tests package, so a real SDK or the
    genuine dotenv function fails the identity check even though the attribute exists.
    """
    import pipeline.jobfit.tests as tests_pkg  # importing installs both layers

    problems: list[str] = []
    if os.getenv("LIGHTTRACK_URL"):
        problems.append(
            "LIGHTTRACK_URL is still set after importing the tests package — layer 1 "
            "(env neutralisation) is gone; this run would emit telemetry."
        )
    stub = sys.modules.get("lighttrack")
    if getattr(getattr(stub, "LightTrack", None), "__module__", None) != tests_pkg.__name__:
        problems.append(
            "the `lighttrack` SDK is not the suite's no-network stub — layer 2 is gone; "
            "any test that sets LIGHTTRACK_URL itself would POST to a real server."
        )
    try:
        import dotenv
    except ImportError:  # dotenv is optional; gemini degrades without it
        pass
    else:
        if getattr(dotenv.load_dotenv, "__module__", None) != tests_pkg.__name__:
            problems.append(
                "dotenv.load_dotenv is not neutralised — a developer's .env.local can flip "
                "telemetry on mid-test and invalidate the env-gating assertions."
            )
    return problems


def main() -> int:
    hermeticity = _hermeticity_problems()
    if hermeticity:
        sys.stderr.write("\nTRIPWIRE: the test suite's hermeticity guard is not intact:\n")
        for problem in hermeticity:
            sys.stderr.write(f"  - {problem}\n")
        sys.stderr.write(
            "Restore the layers in pipeline/jobfit/tests/__init__.py before trusting this run.\n"
        )
        return 1

    loader = unittest.TestLoader()
    suite = loader.discover(str(TESTS_DIR), top_level_dir=str(REPO_ROOT))
    result = unittest.TextTestRunner(verbosity=1).run(suite)

    if result.skipped:
        sys.stderr.write(f"\nSkipped {len(result.skipped)} test(s):\n")
        for test, reason in result.skipped:
            sys.stderr.write(f"  - {test.id()} :: {reason}\n")

    if not result.wasSuccessful():
        return 1
    if os.getenv("ALLOW_SKIP") == "1":
        return 0
    if len(result.skipped) > SKIP_BASELINE:
        sys.stderr.write(
            f"\nTRIPWIRE: {len(result.skipped)} skipped > baseline {SKIP_BASELINE}. "
            "A critical test may be silently skipping. Investigate, then either fix the "
            "cause, set ALLOW_SKIP=1 for a local run, or raise KP_SKIP_BASELINE deliberately.\n"
        )
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
