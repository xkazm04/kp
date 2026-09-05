"""Run the unittest suite and fail when it is silently weaker than it looks.

Two tripwires, both for failures that leave a green run:

1. SKIPS. `python -m unittest` reports `OK (skipped=N)` and exits 0 even when a
   *critical* test never ran (a removed fixture, an unset env var). This wrapper
   prints a per-test skip summary and holds the count between a CEILING and a
   FLOOR, so a newly-skipping test trips CI instead of disappearing AND a
   tolerated skip that quietly started running is recorded instead of leaving a
   free slot the next silent skip can move into. Neither direction is fixed by
   the gate; both are fixed by editing the number deliberately.
2. HERMETICITY. `tests/__init__.py` installs two layers so no test can emit to a
   real LightTrack server or read a developer's `.env.local`. Nothing tests THAT
   guard: deleting either layer leaves every test in the suite passing (verified
   by mutation, 2026-08-22) while the run starts POSTing real LLM telemetry into
   whatever project the developer has configured. :func:`_hermeticity_problems`
   checks both layers are installed BEFORE the suite is allowed to certify
   anything.

3. COST. The suite is ~150 modules and takes minutes, and until now the run said
   only its own total: `Ran 2324 tests in 288.082s`. A total cannot be acted on —
   nobody could name which module owned it, so the slow ones were never found and
   never budgeted. `--timings` (KP_TEST_TIMINGS=1, and set in CI) charges every
   test's wall time to its MODULE and prints the ten most expensive, so the next
   agent starts from a name instead of a number. It reports; it does not gate —
   the budget in docs/development/testing-and-evaluation.md is the human half.

    python -m pipeline.jobfit.tests.run_gated     # gated run
    python -m ...run_gated --timings              # + the ten slowest modules
    ALLOW_SKIP=1 python -m ...run_gated           # local override (no keys)
    KP_SKIP_BASELINE=6 python -m ...run_gated      # deliberately raise the bar

Covers the Python unittest suite; the Playwright e2e suite has its own
key-gated skip (and its own deterministic stubs).
"""
from __future__ import annotations

import os
import sys
import time
import unittest
from collections import defaultdict
from pathlib import Path

# THE CEILING. Skips we knowingly tolerate in a keyless CI: the live Claude-CLI
# smoke, the Gemini-key PDF test, the two personal-CV fixtures that are not in the
# repo, and the interview-eval grounded bridge (spawns node + better-sqlite3,
# which the Python-only CI job does not install). The derivation site by site —
# including the skip sites in the tree that do NOT fire, and why — is the comment
# beside `KP_SKIP_BASELINE` in .github/workflows/ci.yml.
# Bump this DELIBERATELY (with a comment) when a new tolerated skip is added.
SKIP_BASELINE = int(os.getenv("KP_SKIP_BASELINE", "5"))

# THE FLOOR, and why it is not simply the ceiling. Exactly one tolerated skip is
# ENVIRONMENT-conditional rather than unconditional: test_interview_eval's
# grounded DB-fixture bridge skips where node_modules is absent (CI's Python-only
# job) and RUNS in a full developer checkout. The other four skip everywhere — an
# env var CI never sets, and three fixtures deliberately not in the repo. So the
# count is legitimately SKIP_BASELINE in CI and SKIP_BASELINE - 1 locally, and a
# floor set at the ceiling would fail every developer's run.
#
# Below the floor is the failure this half exists for, and it had gone unnoticed
# since the baseline was first written: a tolerated skip started running again (a
# fixture landed, a key appeared) and nobody lowered the number, so the ceiling
# now carries spare room a NEW silent skip can take without tripping anything. The
# message names the number to record.
ENV_CONDITIONAL_SKIPS = 1

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


# How many of the slowest modules the report names. Ten is the number that fits on
# a screen and, on the run this was written against, covers the tail that matters:
# the top ten owned well over half the wall clock while the other ~140 modules were
# noise. Reporting all of them would be a second way of saying "288s".
SLOWEST_MODULES_REPORTED = 10


class _TimingResult(unittest.TextTestResult):
    """A ``TextTestResult`` that also charges each test's wall time to its module.

    Charging to the MODULE rather than the test is deliberate: a module is the unit
    a person can act on (it is what you delete, split, mark, or hand to an agent),
    and it is also where the expensive things live — an import that spawns a
    subprocess, a class-level fixture, a sleep in setUp — none of which belong to
    any single test method. ``startTest``/``stopTest`` bracket setUp/tearDown too,
    so the number is the cost of RUNNING the module, not of its assertions.
    """

    def __init__(self, *args, **kwargs) -> None:
        super().__init__(*args, **kwargs)
        self.module_seconds: dict[str, float] = defaultdict(float)
        self.module_tests: dict[str, int] = defaultdict(int)
        self._started_at = 0.0

    def startTest(self, test) -> None:  # noqa: N802 - unittest's casing
        self._started_at = time.perf_counter()
        super().startTest(test)

    def stopTest(self, test) -> None:  # noqa: N802 - unittest's casing
        super().stopTest(test)
        elapsed = time.perf_counter() - self._started_at
        # A load error is reported as a _FailedTest whose module is unittest's own
        # loader shim; charge it to the module it failed to import instead, which is
        # the id's leading dotted path.
        module = getattr(test, "__module__", None) or test.id().rsplit(".", 2)[0]
        self.module_seconds[module] += elapsed
        self.module_tests[module] += 1


def _write_timings(result: unittest.TestResult, out) -> None:
    """Print the slowest modules. Never raises: a report is not worth failing a run."""
    seconds = getattr(result, "module_seconds", None)
    if not seconds:
        return
    tests = getattr(result, "module_tests", {})
    total = sum(seconds.values())
    ranked = sorted(seconds.items(), key=lambda kv: kv[1], reverse=True)[:SLOWEST_MODULES_REPORTED]
    covered = sum(value for _, value in ranked)
    share = (covered / total * 100) if total else 0.0
    print(
        f"\nSlowest {len(ranked)} modules "
        f"({covered:.1f}s of {total:.1f}s charged, {share:.0f}%):",
        file=out,
    )
    for module, value in ranked:
        short = module.rsplit(".", 1)[-1]
        print(f"  {value:7.2f}s  {tests.get(module, 0):4d} tests  {short}", file=out)


def _timings_requested(argv: list[str]) -> bool:
    """Opt-in by flag or by env, so CI can turn it on without editing a call site."""
    return "--timings" in argv or os.getenv("KP_TEST_TIMINGS") == "1"


def main(argv: list[str] | None = None) -> int:
    argv = list(sys.argv[1:] if argv is None else argv)
    timings = _timings_requested(argv)
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
    runner = unittest.TextTestRunner(
        verbosity=1, resultclass=_TimingResult if timings else None
    )
    result = runner.run(suite)
    if timings:
        _write_timings(result, sys.stderr)

    skipped = len(result.skipped)
    floor = max(0, SKIP_BASELINE - ENV_CONDITIONAL_SKIPS)
    # Reported unconditionally. A run that skipped NOTHING is as much a fact about
    # this suite as one that skipped four, and only one of the two used to be said.
    sys.stderr.write(f"\nSkipped {skipped} test(s); tolerated {floor}-{SKIP_BASELINE}.\n")
    for test, reason in result.skipped:
        sys.stderr.write(f"  - {test.id()} :: {reason}\n")

    if not result.wasSuccessful():
        return 1
    if os.getenv("ALLOW_SKIP") == "1":
        return 0
    if skipped > SKIP_BASELINE:
        sys.stderr.write(
            f"\nTRIPWIRE: {skipped} skipped > ceiling {SKIP_BASELINE}. "
            "A critical test may be silently skipping. Investigate, then either fix the "
            "cause, set ALLOW_SKIP=1 for a local run, or raise KP_SKIP_BASELINE deliberately.\n"
        )
        return 1
    if skipped < floor:
        sys.stderr.write(
            f"\nTRIPWIRE: {skipped} skipped < floor {floor} (ceiling {SKIP_BASELINE}, of which "
            f"{ENV_CONDITIONAL_SKIPS} is environment-conditional). A tolerated skip is running "
            "again — good news, and the reason to record it: the ceiling now carries "
            f"{floor - skipped} slot(s) a new silent skip could take without tripping anything. "
            f"Set KP_SKIP_BASELINE to {skipped + ENV_CONDITIONAL_SKIPS} in .github/workflows/ci.yml "
            "and strike the site from the derivation comment beside it.\n"
        )
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
