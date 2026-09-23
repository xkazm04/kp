"""The gated runner's skip verdict, judged by IDENTITY rather than by count.

``run_gated.evaluate_skips`` is pure, so every branch of the verdict is pinned here
without running the suite: a skip the register does not name, a register entry that
went stale, an environment-conditional entry that legitimately ran, and the register
integrity rules checked before the suite starts. The count band that used to be the
whole gate is kept as a SECOND lock (case 9) so the register is a strict tighten:
nothing the count gate refused becomes acceptable.
"""
from __future__ import annotations

import json
import os
import unittest
from unittest import mock

from pipeline.jobfit.tests import run_gated

P = "pipeline.jobfit.tests.test_fake."
A, B, C, D, E, Y = (P + name for name in ("A", "B", "C", "D", "E", "Y"))
WHY = "a reason long enough to count as an explanation"


def entry(test_id: str, when: str = "always", why: str = WHY) -> dict:
    return {"id": test_id, "when": when, "why": why, "condition": "a condition"}


# The env-conditional MECHANISM stays policy code even though the committed register no
# longer uses it (the interview-eval grounded bridge became a committed snapshot, so its
# skip went away and ENV_CONDITIONAL_SKIPS is 0). The fixtures below model a register WITH
# one env-conditional slot, so they pass that count explicitly rather than inheriting the
# committed default.
ENV = 1


def ci_register() -> list[dict]:
    """A register with one environment-conditional entry and four always."""
    return [entry(A, "env-conditional"), entry(B), entry(C), entry(D), entry(E)]


def skipped(*ids: str) -> list[tuple[str, str]]:
    return [(test_id, f"reason for {test_id.rsplit('.', 1)[-1]}") for test_id in ids]


def text(verdict) -> str:
    return "\n".join(verdict.lines)


class EvaluateSkipsTest(unittest.TestCase):
    def test_1_registered_skip_is_tolerated_with_its_why(self) -> None:
        verdict = run_gated.evaluate_skips(
            skipped(A), [entry(A, why="the live CLI smoke needs a key CI never has")], 1,
            env_conditional=0,
        )
        self.assertEqual(verdict.code, 0, text(verdict))
        self.assertIn(A, text(verdict))
        self.assertIn("the live CLI smoke needs a key CI never has", text(verdict))

    def test_2_substitution_inside_the_count_band_is_named(self) -> None:
        # B (always) stopped skipping and a brand-new Y took its slot: the count is
        # still 5, inside today's 4-5 band, so the count gate alone said nothing.
        verdict = run_gated.evaluate_skips(skipped(A, C, D, E, Y), ci_register(), 5, env_conditional=ENV)
        self.assertEqual(verdict.code, 1)
        out = text(verdict)
        self.assertIn(Y, out)
        self.assertIn("reason for Y", out)
        self.assertIn("not in pipeline/jobfit/tests/skip-register.json", out)

    def test_3_local_hole_env_conditional_ran_and_a_new_skip_took_the_slot(self) -> None:
        # A full checkout: the env-conditional A runs (count 4) and a new Y skips
        # (count 5 <= ceiling). Today's band exits 0 on exactly this run.
        verdict = run_gated.evaluate_skips(skipped(B, C, D, E, Y), ci_register(), 5, env_conditional=ENV)
        self.assertEqual(verdict.code, 1)
        self.assertIn(Y, text(verdict))
        self.assertIn("not in pipeline/jobfit/tests/skip-register.json", text(verdict))

    def test_4_stale_always_entry_names_the_exact_edit(self) -> None:
        verdict = run_gated.evaluate_skips(skipped(A, C, D, E), ci_register(), 5, env_conditional=ENV)
        self.assertEqual(verdict.code, 1)
        self.assertIn(
            f"stale register entry {B} ran - delete it and set KP_SKIP_BASELINE to 4 "
            "in .github/workflows/ci.yml",
            text(verdict),
        )

    def test_5_env_conditional_entry_that_ran_is_a_note_not_a_failure(self) -> None:
        verdict = run_gated.evaluate_skips(skipped(B, C, D, E), ci_register(), 5, env_conditional=ENV)
        self.assertEqual(verdict.code, 0, text(verdict))
        self.assertIn(A, text(verdict))
        self.assertIn("ran", text(verdict))

    def test_6_register_length_must_equal_the_baseline(self) -> None:
        problems = run_gated.register_problems(ci_register(), 6, env_conditional=ENV)
        self.assertTrue(problems)
        self.assertTrue(any("5" in p and "6" in p for p in problems), problems)
        verdict = run_gated.evaluate_skips(skipped(A, B, C, D, E), ci_register(), 6, env_conditional=ENV)
        self.assertEqual(verdict.code, 1)

    def test_7_dead_or_unexplained_entries_are_refused(self) -> None:
        discovered = {A, B, C, D, E}
        dead = ci_register()[:4] + [entry(P + "Gone")]
        problems = run_gated.register_problems(dead, 5, discovered, env_conditional=ENV)
        self.assertTrue(any("dead" in p and P + "Gone" in p for p in problems), problems)

        short = ci_register()[:4] + [entry(E, why="too short")]
        problems = run_gated.register_problems(short, 5, discovered, env_conditional=ENV)
        self.assertTrue(any("unexplained" in p and E in p for p in problems), problems)

        self.assertEqual(run_gated.register_problems(ci_register(), 5, discovered, env_conditional=ENV), [])

    def test_8_allow_skip_overrides_the_verdict(self) -> None:
        verdict = run_gated.evaluate_skips(
            skipped(Y), ci_register(), 5, allow_skip=True, env_conditional=ENV
        )
        self.assertEqual(verdict.code, 0)

    def test_8_hermeticity_tripwire_still_runs_first(self) -> None:
        with mock.patch.dict(os.environ, {"ALLOW_SKIP": "1"}), mock.patch.object(
            run_gated, "_hermeticity_problems", return_value=["layer gone"]
        ), mock.patch.object(
            run_gated.unittest.TestLoader, "discover", side_effect=AssertionError("ran")
        ), mock.patch("sys.stderr"):
            self.assertEqual(run_gated.main([]), 1)

    def test_9_the_count_floor_stays_a_second_lock(self) -> None:
        # Two entries marked env-conditional, both running: count 3 = baseline - 2.
        # Today's floor (baseline - 1) refuses that run; the register must too.
        register = [entry(A, "env-conditional"), entry(B, "env-conditional"),
                    entry(C), entry(D), entry(E)]
        problems = run_gated.register_problems(register, 5, env_conditional=ENV)
        self.assertTrue(any("env-conditional" in p for p in problems), problems)
        verdict = run_gated.evaluate_skips(skipped(C, D, E), register, 5, env_conditional=ENV)
        self.assertEqual(verdict.code, 1)
        self.assertIn("< floor 4", text(verdict))

    def test_9_duplicate_ids_are_refused(self) -> None:
        # Five rows, four distinct tests: the length check alone would pass.
        register = [entry(A, "env-conditional"), entry(B), entry(B), entry(C), entry(D)]
        problems = run_gated.register_problems(register, 5, env_conditional=ENV)
        self.assertTrue(any("duplicate" in p and B in p for p in problems), problems)
        verdict = run_gated.evaluate_skips(skipped(A, B, C, D), register, 5, env_conditional=ENV)
        self.assertEqual(verdict.code, 1)

    def test_9_the_ceiling_still_holds(self) -> None:
        verdict = run_gated.evaluate_skips(skipped(A, B, C, D, E, Y), ci_register(), 5, env_conditional=ENV)
        self.assertEqual(verdict.code, 1)
        self.assertIn("> ceiling 5", text(verdict))


class MainRefusesABadRegisterBeforeTheSuiteRuns(unittest.TestCase):
    def test_invalid_register_exits_before_running(self) -> None:
        suite = unittest.TestSuite()
        with mock.patch.object(run_gated, "_hermeticity_problems", return_value=[]), \
                mock.patch.object(run_gated, "load_register", return_value=ci_register()), \
                mock.patch.object(run_gated.unittest.TestLoader, "discover", return_value=suite), \
                mock.patch.object(run_gated.unittest.TextTestRunner, "run",
                                  side_effect=AssertionError("suite ran")), \
                mock.patch("sys.stderr"):
            # none of A..E is a discovered id -> dead entries, refused pre-run
            self.assertEqual(run_gated.main([]), 1)


class CommittedRegisterTest(unittest.TestCase):
    """The committed register satisfies its own rules against the real baseline."""

    def test_committed_register_is_valid(self) -> None:
        register = run_gated.load_register()
        self.assertEqual(run_gated.register_problems(register, run_gated.SKIP_BASELINE), [])

    def test_committed_register_matches_ci_baseline(self) -> None:
        ci = (run_gated.REPO_ROOT / ".github" / "workflows" / "ci.yml").read_text(encoding="utf-8")
        self.assertIn(f'KP_SKIP_BASELINE: "{len(run_gated.load_register())}"', ci)

    def test_committed_register_has_no_env_conditional_entry(self) -> None:
        # The one env-conditional skip (the interview-eval grounded DB-fixture bridge) is
        # gone: the eval reads a committed brief snapshot, so the test runs everywhere and
        # the tolerated band is exactly KP_SKIP_BASELINE, with no floor below it.
        register = run_gated.load_register()
        self.assertEqual(run_gated.ENV_CONDITIONAL_SKIPS, 0)
        self.assertEqual([r["id"] for r in register if r.get("when") == "env-conditional"], [])
        self.assertEqual(len(register), 4)
        self.assertNotIn("TestGroundedBridge", json.dumps(register))
        ci = (run_gated.REPO_ROOT / ".github" / "workflows" / "ci.yml").read_text(encoding="utf-8")
        self.assertIn('KP_SKIP_BASELINE: "4"', ci)

    def test_committed_register_is_json_with_a_skips_list(self) -> None:
        data = json.loads(run_gated.REGISTER_PATH.read_text(encoding="utf-8"))
        self.assertIsInstance(data["skips"], list)


if __name__ == "__main__":
    unittest.main()
