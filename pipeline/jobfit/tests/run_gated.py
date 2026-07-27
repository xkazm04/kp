"""Run the unittest suite and fail when too many tests are silently skipped.

`python -m unittest` reports `OK (skipped=N)` and exits 0 even when a *critical*
test never ran (a removed fixture, an unset env var). This wrapper prints a
per-test skip summary and fails when the skip count exceeds a known baseline,
so a newly-skipping test trips CI instead of disappearing into a green run.

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


def main() -> int:
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
