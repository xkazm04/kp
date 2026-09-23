"""Run the unittest suite and fail when it is silently weaker than it looks.

Two tripwires, both for failures that leave a green run:

1. SKIPS. `python -m unittest` reports `OK (skipped=N)` and exits 0 even when a
   *critical* test never ran (a removed fixture, an unset env var). This wrapper
   judges skips by IDENTITY against `skip-register.json` beside it: a skip the
   register does not name is refused BY NAME, and a register entry that ran is
   named as stale with the exact edit that retires it. The old count band
   (ceiling KP_SKIP_BASELINE, floor one environment-conditional slot below) is
   kept as a second lock, so the register can only tighten what the count gate
   accepted. See :func:`evaluate_skips`.
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
    # a new tolerated skip = a skip-register.json entry + KP_SKIP_BASELINE in ci.yml

Covers the Python unittest suite; the Playwright e2e suite has its own
key-gated skip (and its own deterministic stubs).
"""
from __future__ import annotations

import json
import os
import sys
import time
import unittest
from collections import defaultdict
from dataclasses import dataclass, field
from pathlib import Path

# THE CEILING. Skips we knowingly tolerate in a keyless CI. WHICH tests those are
# is no longer a comment: it is `skip-register.json` beside this file, one entry
# per test id with its `why` and its `when`, and the register's length must EQUAL
# this number. So adding a tolerated skip costs two edits — a register entry and a
# raised KP_SKIP_BASELINE in .github/workflows/ci.yml — and the second one is what
# the review:constitution lens blocks (`skip-baseline-raised`). Deliberately.
SKIP_BASELINE = int(os.getenv("KP_SKIP_BASELINE", "4"))

# THE FLOOR, and why it can sit below the ceiling. A tolerated skip may be
# ENVIRONMENT-conditional rather than unconditional: it skips in CI's Python-only
# job and RUNS in a full developer checkout, so the count is legitimately
# SKIP_BASELINE in CI and SKIP_BASELINE - ENV_CONDITIONAL_SKIPS locally. Today there
# is none: the one there was (test_interview_eval's grounded DB-fixture bridge,
# which needed node_modules) went away when the interview eval started reading a
# committed brief snapshot instead of spawning node, so floor == ceiling and every
# run must skip exactly the four `always` entries.
#
# Below the floor is the failure this half exists for: a tolerated skip started
# running again (a fixture landed, a key appeared) and nobody lowered the number,
# so the ceiling carries spare room a NEW silent skip can take without tripping
# anything. The message names the number to record.
#
# The register must mark EXACTLY this many entries `env-conditional`. Without that
# rule, flipping an entry from `always` to `env-conditional` is a one-word JSON
# edit that lets a run with a tolerated skip missing pass — a run the floor below
# refuses. The number lives HERE, in gate-policy code, not in the register.
ENV_CONDITIONAL_SKIPS = 0

TESTS_DIR = Path(__file__).resolve().parent
REPO_ROOT = TESTS_DIR.parents[2]

REGISTER_PATH = TESTS_DIR / "skip-register.json"
REGISTER_NAME = "pipeline/jobfit/tests/skip-register.json"
CI_FILE = ".github/workflows/ci.yml"
# The same bar test-quarantine.json holds a node quarantine's `why` to.
MIN_WHY_CHARS = 20
WHEN_VALUES = ("always", "env-conditional")


@dataclass
class SkipVerdict:
    """The skip half of the run's verdict: an exit code and the lines that explain it."""

    code: int
    lines: list[str] = field(default_factory=list)


def load_register(path: Path = REGISTER_PATH) -> list[dict]:
    """Read the committed skip register. A missing or malformed file raises."""
    data = json.loads(path.read_text(encoding="utf-8"))
    skips = data.get("skips") if isinstance(data, dict) else None
    if not isinstance(skips, list):
        raise ValueError(f"{REGISTER_NAME} has no `skips` list")
    return skips


def register_problems(
    register: list[dict],
    baseline: int,
    discovered_ids: set[str] | None = None,
    *,
    env_conditional: int = ENV_CONDITIONAL_SKIPS,
) -> list[str]:
    """Integrity rules the register must meet BEFORE the suite may certify anything.

    ``discovered_ids`` enables the dead-entry check (an id no discovered test has);
    it is optional so the rules are testable without discovering the suite.
    """
    problems: list[str] = []
    ids: list[str] = []
    for index, raw in enumerate(register):
        row = raw if isinstance(raw, dict) else {}
        test_id = row.get("id")
        if not isinstance(test_id, str) or not test_id:
            problems.append(f"entry #{index + 1} has no `id`")
            continue
        ids.append(test_id)
        why = row.get("why")
        if not isinstance(why, str) or len(why.strip()) < MIN_WHY_CHARS:
            problems.append(
                f"unexplained register entry {test_id}: `why` must say, in at least "
                f"{MIN_WHY_CHARS} characters, why this skip is tolerated"
            )
        if row.get("when") not in WHEN_VALUES:
            problems.append(
                f"register entry {test_id} has `when` {row.get('when')!r}; "
                f"expected one of {', '.join(WHEN_VALUES)}"
            )
        if discovered_ids is not None and test_id not in discovered_ids:
            problems.append(
                f"dead register entry {test_id}: no discovered test has this id - "
                f"delete it and set KP_SKIP_BASELINE to {baseline - 1} in {CI_FILE}"
            )
    duplicates = sorted({test_id for test_id in ids if ids.count(test_id) > 1})
    for test_id in duplicates:
        problems.append(
            f"duplicate register entry {test_id}: one test id, one entry - a repeat "
            "would let the register's length match the baseline with fewer tests"
        )
    if len(register) != baseline:
        problems.append(
            f"{REGISTER_NAME} has {len(register)} entries but KP_SKIP_BASELINE is "
            f"{baseline} - they must be equal (the baseline lives in {CI_FILE})"
        )
    conditional = sum(
        1 for row in register if isinstance(row, dict) and row.get("when") == "env-conditional"
    )
    if conditional != env_conditional:
        problems.append(
            f"{REGISTER_NAME} marks {conditional} entries env-conditional but run_gated.py "
            f"tolerates exactly {env_conditional} (ENV_CONDITIONAL_SKIPS)"
        )
    return problems


def evaluate_skips(
    skipped: list[tuple[str, str]],
    register: list[dict],
    baseline: int,
    discovered_ids: set[str] | None = None,
    *,
    env_conditional: int = ENV_CONDITIONAL_SKIPS,
    allow_skip: bool = False,
) -> SkipVerdict:
    """Judge a run's skips by identity against the register, then by count.

    ``skipped`` is ``(test id, skip reason)`` per skip. Refused: a register that
    breaks its own rules, a skip the register does not name, an ``always`` entry
    that ran (stale), and — the second lock, kept from the count gate — a count
    above ``baseline`` or below ``baseline - env_conditional``. An
    ``env-conditional`` entry that ran is a note, never a failure.
    """
    if allow_skip:
        return SkipVerdict(0, ["ALLOW_SKIP=1: the skip verdict is overridden for this run."])

    lines: list[str] = []
    failed = False
    problems = register_problems(
        register, baseline, discovered_ids, env_conditional=env_conditional
    )
    if problems:
        failed = True
        lines.append(f"TRIPWIRE: {REGISTER_NAME} is not valid:")
        lines.extend(f"  - {problem}" for problem in problems)

    by_id = {row["id"]: row for row in register if isinstance(row, dict) and isinstance(row.get("id"), str)}
    skipped_ids = {test_id for test_id, _ in skipped}

    tolerated = [(test_id, reason) for test_id, reason in skipped if test_id in by_id]
    if tolerated:
        lines.append("Tolerated (in the register):")
        lines.extend(f"  - {test_id} :: {by_id[test_id].get('why', '')}" for test_id, _ in tolerated)

    for test_id, reason in skipped:
        if test_id not in by_id:
            failed = True
            lines.append(
                f"TRIPWIRE: unexpected skip {test_id} :: {reason} - not in {REGISTER_NAME}. "
                "Fix the cause so it runs; tolerating it instead takes a register entry AND "
                f"a raised KP_SKIP_BASELINE in {CI_FILE}, which review blocks by design."
            )

    for test_id, row in by_id.items():
        if test_id in skipped_ids:
            continue
        if row.get("when") == "env-conditional":
            lines.append(
                f"Note: env-conditional register entry {test_id} ran in this environment "
                f"({row.get('condition', 'see the register')}) - expected, not a failure."
            )
        else:
            failed = True
            lines.append(
                f"TRIPWIRE: stale register entry {test_id} ran - delete it and set "
                f"KP_SKIP_BASELINE to {baseline - 1} in {CI_FILE}"
            )

    count = len(skipped)
    floor = max(0, baseline - env_conditional)
    if count > baseline:
        failed = True
        lines.append(f"TRIPWIRE: {count} skipped > ceiling {baseline}.")
    if count < floor:
        failed = True
        lines.append(
            f"TRIPWIRE: {count} skipped < floor {floor} (ceiling {baseline}, of which "
            f"{env_conditional} is environment-conditional) - the ceiling now carries "
            f"{floor - count} slot(s) a new silent skip could take. Retire the entries "
            f"named stale above from {REGISTER_NAME} and lower KP_SKIP_BASELINE to match."
        )
    return SkipVerdict(1 if failed else 0, lines)


def _discovered_ids(suite: unittest.TestSuite) -> set[str]:
    """Every test id the loader found, flattened out of the nested suites."""
    ids: set[str] = set()
    for item in suite:
        if isinstance(item, unittest.TestSuite):
            ids |= _discovered_ids(item)
        else:
            ids.add(item.id())
    return ids


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

    try:
        register = load_register()
    except (OSError, ValueError) as exc:  # json.JSONDecodeError is a ValueError
        sys.stderr.write(f"\nTRIPWIRE: cannot read {REGISTER_NAME}: {exc}\n")
        return 1

    loader = unittest.TestLoader()
    suite = loader.discover(str(TESTS_DIR), top_level_dir=str(REPO_ROOT))
    discovered = _discovered_ids(suite)
    # Checked BEFORE the run, so a dead, duplicate or unexplained entry is a red
    # build even on a run where every skip matches — the only run those rot on.
    problems = register_problems(register, SKIP_BASELINE, discovered)
    if problems:
        sys.stderr.write(f"\nTRIPWIRE: {REGISTER_NAME} is not valid:\n")
        for problem in problems:
            sys.stderr.write(f"  - {problem}\n")
        return 1

    runner = unittest.TextTestRunner(
        verbosity=1, resultclass=_TimingResult if timings else None
    )
    result = runner.run(suite)
    if timings:
        _write_timings(result, sys.stderr)

    skipped = [(test.id(), str(reason)) for test, reason in result.skipped]
    floor = max(0, SKIP_BASELINE - ENV_CONDITIONAL_SKIPS)
    # Reported unconditionally. A run that skipped NOTHING is as much a fact about
    # this suite as one that skipped four, and only one of the two used to be said.
    sys.stderr.write(f"\nSkipped {len(skipped)} test(s); tolerated {floor}-{SKIP_BASELINE}.\n")
    for test_id, reason in skipped:
        sys.stderr.write(f"  - {test_id} :: {reason}\n")

    if not result.wasSuccessful():
        return 1
    verdict = evaluate_skips(
        skipped, register, SKIP_BASELINE, discovered,
        allow_skip=os.getenv("ALLOW_SKIP") == "1",
    )
    for line in verdict.lines:
        sys.stderr.write(f"{line}\n")
    return verdict.code


if __name__ == "__main__":
    raise SystemExit(main())
