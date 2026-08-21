"""Phase D7 — CI gate for the submission-evaluation eval (deterministic path).

Locks the two invariants at the heart of the Dev extension: code is assumed LLM-generated,
so the score must (a) track verification/judgment, never AI use [FAIRNESS], and (b) separate
strong submissions from weak ones, catching the AI-no-verify gamer [DISCRIMINATION].

Also pins the gate THRESHOLDS: each pass needs a meaningful margin over a minimum per-group
sample, else the gate withholds a verdict — 'inconclusive' for a thin-but-present cohort, or
'not_evaluable' for an EMPTY cohort / no surviving rows (no data at all). Only fail and
inconclusive exit --strict non-zero; not_evaluable does not (idea-e8517e0e: a gate that was
VIOLATED must be distinguishable from one that simply had no data to evaluate).
"""

import contextlib
import io
import unittest

from pipeline.jobfit.devcase.submission_eval import (
    MIN_DISCRIMINATION_MARGIN,
    MIN_GROUP_N,
    MIN_VERIFY_MARGIN,
    Row,
    discrimination,
    fairness,
    main,
    run,
    signals,
)
from pipeline.jobfit.devcase.submission_scenarios import generate_submissions


def _row(rid, *, verifies, usesAI=False, expected="strong", behavior="x", judgment=50):
    """Minimal evaluated Row for unit-testing the gate maths directly."""
    return Row(
        id=rid,
        label=rid,
        planted={"verifies": verifies, "usesAI": usesAI, "expected": expected, "behavior": behavior},
        source="deterministic",
        evaluation={"dimensionScores": {"judgment": judgment}},
    )


def _llm_row(rid, *, usesAI, verifies, flags, behavior="x", expected="strong", judgment=50, source="llm"):
    """An LLM-path Row that can carry over-reliance flags in `tooling`. The deterministic
    landscape never assigns flags (assess_tooling hardcodes []), so the only way to exercise
    the over-reliance invariant is to construct rows from the flag-assigning (LLM) path."""
    return Row(
        id=rid,
        label=rid,
        planted={"verifies": verifies, "usesAI": usesAI, "expected": expected, "behavior": behavior},
        source=source,
        tooling={"overRelianceFlags": list(flags)},
        evaluation={"dimensionScores": {"judgment": judgment}},
    )


class TestSubmissionEval(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.rows = run(generate_submissions(48), provider=None)  # deterministic, no Claude CLI
        cls.sig = signals(cls.rows)

    def test_reliability_is_perfect(self):
        failures = [(r.id, r.issues) for r in self.rows if not r.reliable]
        self.assertEqual(self.sig["reliability"], 1.0, failures)

    def test_fairness_gate_passes(self):
        self.assertEqual(self.sig["fairness"]["status"], "pass", self.sig["fairness"])
        self.assertTrue(self.sig["fairness"]["passed"], self.sig["fairness"])

    def test_no_over_reliance_invented_from_tool_use(self):
        # Baseline only: the deterministic landscape CAN'T invent flags (assess_tooling
        # hardcodes []), so this passes vacuously. The teeth — the invariant actually
        # FAILING on an invented flag — live in TestOverRelianceInvariant (the LLM path).
        self.assertTrue(self.sig["fairness"]["no_invented_overreliance"])
        self.assertEqual(self.sig["fairness"]["overreliance_violations"], [])

    def test_verification_is_rewarded_by_a_meaningful_margin(self):
        f = self.sig["fairness"]
        # verifiers (incl. AI-heavy ones) lead non-verifiers on judgment by >= the bar
        self.assertTrue(f["verify_rewarded"])
        self.assertGreaterEqual(f["margins"]["verify_lead"], MIN_VERIFY_MARGIN)
        # ai-verifiers are not penalised for AI use (non-inferiority holds)
        self.assertTrue(f["ai_not_penalised"])

    def test_discrimination_gate_passes_by_a_meaningful_margin(self):
        # strong out-scores weak AND the AI-no-verify gamer by >= the bar
        d = self.sig["discrimination"]
        self.assertEqual(d["status"], "pass", d)
        self.assertTrue(d["passed"], d)
        self.assertGreaterEqual(d["margin"], MIN_DISCRIMINATION_MARGIN)
        self.assertGreaterEqual(d["gamer_margin"], MIN_DISCRIMINATION_MARGIN)
        self.assertTrue(d["gamer_below_strong"])

    def test_small_sample_is_inconclusive_not_pass(self):
        # at --count 12 the ai-verifier and gamer groups fall below MIN_GROUP_N but are
        # still PRESENT (2 rows each), so the margin-based gates are 'inconclusive' — a
        # thin sample, distinct from 'not_evaluable' (an empty cohort, see below)
        sig = signals(run(generate_submissions(12), provider=None))
        self.assertEqual(sig["fairness"]["status"], "inconclusive", sig["fairness"])
        self.assertEqual(sig["discrimination"]["status"], "inconclusive", sig["discrimination"])
        self.assertFalse(sig["fairness"]["passed"])
        self.assertFalse(sig["discrimination"]["passed"])
        self.assertIsNone(sig["fairness"]["ai_not_penalised"])
        self.assertIsNone(sig["discrimination"]["gamer_below_strong"])
        # inconclusive is NOT not_evaluable: there was data, just too little of it
        self.assertIsNone(sig["fairness"]["not_evaluable_reason"])
        self.assertIsNone(sig["discrimination"]["not_evaluable_reason"])
        # the thin sub-cohorts are still flagged with a minimum-cohort-size warning
        self.assertTrue(sig["fairness"]["cohort_warnings"])
        self.assertTrue(sig["discrimination"]["cohort_warnings"])

    def test_near_tie_fails_fairness(self):
        # verifiers lead non-verifiers by 1 pt — below MIN_VERIFY_MARGIN, so NOT a pass
        rows = [_row(f"v{i}", verifies=True, usesAI=True, judgment=50) for i in range(MIN_GROUP_N)]
        rows += [_row(f"n{i}", verifies=False, judgment=49) for i in range(MIN_GROUP_N)]
        f = fairness(rows)
        self.assertFalse(f["verify_rewarded"])  # 1-pt lead < 5-pt bar -> fails
        # ai_not_penalised compares AI-verifiers against NON-AI VERIFIERS (behaviour-matched
        # peers), not against non-verifiers. Every verifier in this fixture uses AI, so that
        # control cohort is EMPTY and the sub-check correctly withholds a verdict.
        self.assertIsNone(f["ai_not_penalised"])
        self.assertEqual(f["status"], "fail")
        self.assertFalse(f["passed"])

    def test_near_tie_fails_discrimination(self):
        # strong leads weak by 3 pts — below MIN_DISCRIMINATION_MARGIN, so NOT a pass
        # (no gamer rows here: the gamer group is also tagged expected="weak", so mixing
        # it in would skew the weak mean — isolate the strong-vs-weak margin instead)
        rows = [_row(f"s{i}", verifies=True, expected="strong", judgment=40) for i in range(MIN_GROUP_N)]
        rows += [_row(f"w{i}", verifies=False, expected="weak", judgment=37) for i in range(MIN_GROUP_N)]
        d = discrimination(rows)
        self.assertFalse(d["strong_beats_weak"])  # 3-pt margin < 5-pt bar -> fails
        self.assertEqual(d["status"], "fail")
        self.assertFalse(d["passed"])

    def test_non_it_landscape_is_well_formed(self):
        # the harness generalizes to non-IT domains (structure holds; LLM path scores quality)
        rows = run(generate_submissions(40, domain="mixed"), provider=None)
        self.assertEqual(signals(rows)["reliability"], 1.0)
        self.assertTrue({r.planted["domain"] for r in rows} >= {"it", "marketing", "finance"})


class TestOverRelianceInvariant(unittest.TestCase):
    """idea-258555e5 — the over-reliance fairness invariant must test the path that ASSIGNS
    flags (the LLM path), never the deterministic path that hardcodes none. The old check
    (`source=="deterministic" and overRelianceFlags`) was vacuously True: deterministic rows
    never carry a flag, and the LLM rows that can were excluded by the guard. These cases give
    the invariant teeth — it can now actually FAIL when a flag is invented from tool use.

    Principle (reflect.py's prompt): flag over-reliance ONLY from concrete evidence (a large
    unverified dump), NEVER from tool use itself. So a flag is "from tool use alone" when an AI
    user is flagged while a behaviour-matched non-AI peer (same verification habit, same dump
    evidence) is not — the only thing that differs is that AI was used."""

    def test_flag_on_tool_use_without_verification_is_caught(self):
        # THE regression the requirement calls for: an AI candidate who did NOT verify is
        # flagged for over-reliance, while the behaviour-matched NON-AI candidate (also no
        # verification) is NOT — so the flag tracks AI use, not the behaviour. Tool use
        # without verification must not, by itself, produce a flag; the gate must catch it.
        rows = [
            _llm_row("ai-nv", usesAI=True, verifies=False, behavior="ai_no_verify", expected="weak", flags=["leaned on the assistant"]),
            _llm_row("base-nv", usesAI=False, verifies=False, behavior="big_bang_no_verify", expected="weak", flags=[]),
        ]
        f = fairness(rows)
        self.assertFalse(f["no_invented_overreliance"])
        self.assertEqual(f["overreliance_violations"], ["ai-nv"])
        self.assertEqual(f["status"], "fail")  # a broken hard invariant fails the whole gate
        self.assertFalse(f["passed"])

    def test_flag_on_ai_verifier_is_caught(self):
        # An AI user who VERIFIED has no unverified-dump basis, so any over-reliance flag is
        # from tool use alone — caught even though a clean non-AI verifier peer exists.
        rows = [
            _llm_row("ai-v", usesAI=True, verifies=True, behavior="ai_then_verify", flags=["used an AI assistant"]),
            _llm_row("base-v", usesAI=False, verifies=True, behavior="careful_verifier", flags=[]),
        ]
        f = fairness(rows)
        self.assertFalse(f["no_invented_overreliance"])
        self.assertIn("ai-v", f["overreliance_violations"])
        self.assertEqual(f["status"], "fail")

    def test_flag_shared_with_non_ai_peer_is_fair(self):
        # Both the AI and the non-AI non-verifier dumps are flagged: the flag tracks the
        # SHARED behaviour (a large unverified dump), not the AI. That is the legitimate use
        # of an over-reliance flag and must NOT trip the gate.
        rows = [
            _llm_row("ai-nv", usesAI=True, verifies=False, behavior="ai_no_verify", expected="weak", flags=["large unverified dump"]),
            _llm_row("base-nv", usesAI=False, verifies=False, behavior="big_bang_no_verify", expected="weak", flags=["large unverified dump"]),
        ]
        f = fairness(rows)
        self.assertTrue(f["no_invented_overreliance"])
        self.assertEqual(f["overreliance_violations"], [])

    def test_clean_tool_use_without_verification_passes(self):
        # The fair outcome: tool use without verification produced NO flag. Invariant holds.
        rows = [
            _llm_row("ai-nv", usesAI=True, verifies=False, behavior="ai_no_verify", expected="weak", flags=[]),
            _llm_row("base-nv", usesAI=False, verifies=False, behavior="big_bang_no_verify", expected="weak", flags=[]),
        ]
        f = fairness(rows)
        self.assertTrue(f["no_invented_overreliance"])

    def test_deterministic_rows_with_flags_are_not_judged(self):
        # Scoping: the invariant judges the flag-assigning (LLM) path only. A flag on a
        # deterministic row (which the real fallback never produces) is out of scope, so it
        # must not be read as a violation — that is the bug this requirement fixes, inverted.
        rows = [_llm_row("det", usesAI=True, verifies=True, flags=["x"], source="deterministic")]
        f = fairness(rows)
        self.assertTrue(f["no_invented_overreliance"])
        self.assertEqual(f["overreliance_violations"], [])


class TestAiPenaltyControlGroup(unittest.TestCase):
    """The AI check must compare AI-verifiers against BEHAVIOUR-MATCHED peers.

    Until 2026-08-21 it measured them against non-VERIFIERS, which folds in the
    verification lead the gate above deliberately rewards — so an evaluator that
    genuinely docked AI users sailed through, and the reported ai_gap was really
    the verification lead re-measured."""

    def test_a_real_ai_penalty_fails_the_gate(self):
        # Otherwise-identical verifiers, docked 20 judgment pts for using AI.
        rows = [_row(f"p{i}", verifies=True, usesAI=False, judgment=90) for i in range(MIN_GROUP_N)]
        rows += [_row(f"a{i}", verifies=True, usesAI=True, judgment=70) for i in range(MIN_GROUP_N)]
        rows += [_row(f"n{i}", verifies=False, judgment=70) for i in range(MIN_GROUP_N)]
        f = fairness(rows)
        # The old cohort made this pass: ai_verifiers 70 vs non_verifiers 70 -> gap 0.
        self.assertFalse(f["ai_not_penalised"], f)
        self.assertEqual(f["margins"]["ai_gap"], -20.0)
        self.assertEqual(f["status"], "fail")
        # ...while the verification gate still legitimately passes on the same rows,
        # which is exactly why the two comparisons must not share a control group.
        self.assertTrue(f["verify_rewarded"])

    def test_ai_gap_is_the_peer_gap_not_the_verification_lead(self):
        # AI-verifiers sit at their non-AI peers' level; non-verifiers sit far below.
        # A gap measured against non-verifiers would read +30; the true AI effect is 0.
        rows = [_row(f"p{i}", verifies=True, usesAI=False, judgment=80) for i in range(MIN_GROUP_N)]
        rows += [_row(f"a{i}", verifies=True, usesAI=True, judgment=80) for i in range(MIN_GROUP_N)]
        rows += [_row(f"n{i}", verifies=False, judgment=50) for i in range(MIN_GROUP_N)]
        f = fairness(rows)
        self.assertEqual(f["margins"]["ai_gap"], 0.0)
        self.assertTrue(f["ai_not_penalised"])
        self.assertEqual(f["sample"]["non_ai_verifiers"], MIN_GROUP_N)


class TestTinyCohortAiComparison(unittest.TestCase):
    def test_tiny_count_with_both_ai_cohorts_is_inconclusive(self):
        # --count 3 gives 1 ai-verifier vs 2 non-AI verifiers: data on BOTH sides but
        # below MIN_GROUP_N, which is "inconclusive" (thin), not "not_evaluable" (empty).
        sig = signals(run(generate_submissions(3), provider=None))
        f = sig["fairness"]
        self.assertEqual(f["status"], "inconclusive", f)
        self.assertEqual(f["sample"]["ai_verifiers"], 1)
        self.assertEqual(f["sample"]["non_ai_verifiers"], 2)


class TestNotEvaluableState(unittest.TestCase):
    """idea-e8517e0e — an EMPTY cohort (no data) must read as 'not_evaluable', distinct from
    a true 'fail' (a measured violation) and from 'inconclusive' (a thin-but-present sample).
    Conflating no-data with a violation produced spurious red CI for tiny/all-errored runs."""

    def test_tiny_count_yields_empty_cohorts_and_is_not_evaluable(self):
        # --count 1 picks one behaviour (a non-AI verifier), so non_verifiers, ai_verifiers,
        # weak and gamer cohorts are all EMPTY (0 rows) — no data to compare against.
        # NOTE: --count 3 no longer lands here. Since the AI check's control group became the
        # behaviour-matched NON-AI verifier, 3 rows give 1 ai-verifier vs 2 non-AI verifiers —
        # thin but PRESENT, which is "inconclusive" by this module's own definitions. Pinned
        # by test_tiny_count_with_both_ai_cohorts_is_inconclusive below.
        sig = signals(run(generate_submissions(1), provider=None))
        f, d = sig["fairness"], sig["discrimination"]
        self.assertEqual(f["status"], "not_evaluable", f)
        self.assertEqual(d["status"], "not_evaluable", d)
        self.assertFalse(f["passed"])
        self.assertFalse(d["passed"])
        # the reason names the empty cohort(s) and the warning flags the small sizes
        self.assertIn("non_verifiers", f["not_evaluable_reason"])
        self.assertIn("weak", d["not_evaluable_reason"])
        self.assertIn("gamer", d["not_evaluable_reason"])
        self.assertTrue(any("non_verifiers" in w for w in f["cohort_warnings"]))

    def test_all_errored_run_is_not_evaluable_not_violation(self):
        # every scenario errored -> no surviving rows -> nothing to evaluate. The gate must
        # NOT report this as an unfair/non-discriminating evaluator (a fail).
        rows = [
            Row(id=f"e{i}", label="e", planted={"verifies": True, "expected": "strong"}, source="error", issues=["raised: X"])
            for i in range(6)
        ]
        f, d = fairness(rows), discrimination(rows)
        self.assertEqual(f["status"], "not_evaluable")
        self.assertEqual(d["status"], "not_evaluable")
        self.assertIn("no evaluable rows", f["not_evaluable_reason"])
        self.assertIn("no evaluable rows", d["not_evaluable_reason"])

    def test_real_violation_still_fails_not_skipped(self):
        # guardrail: a near-tie over a FULL sample is a measured violation -> 'fail', never
        # downgraded to not_evaluable just because verdicts are negative.
        rows = [_row(f"s{i}", verifies=True, expected="strong", judgment=40) for i in range(MIN_GROUP_N)]
        rows += [_row(f"w{i}", verifies=False, expected="weak", judgment=37) for i in range(MIN_GROUP_N)]
        d = discrimination(rows)
        self.assertEqual(d["status"], "fail")
        self.assertIsNone(d["not_evaluable_reason"])


class TestStrictExitCodes(unittest.TestCase):
    """--strict must exit non-zero on fail/inconclusive but ZERO on not_evaluable: a run with
    no data can't certify fairness, but it isn't a violation either — no spurious red CI."""

    def _run_main(self, argv):
        buf = io.StringIO()
        with contextlib.redirect_stdout(buf), contextlib.redirect_stderr(buf):
            code = main(argv)
        return code, buf.getvalue()

    def test_not_evaluable_does_not_fail_strict(self):
        # --count 1 -> every compared cohort empty -> not_evaluable; reliability is still 100%
        # (1 clean deterministic row), so --strict must return 0. (Was --count 3 before the AI
        # control group became the non-AI verifier; 3 rows now yield a thin-but-present 1-vs-2
        # AI comparison, i.e. inconclusive, which --strict correctly DOES fail.)
        code, out = self._run_main(["--count", "1", "--no-llm", "--strict"])
        self.assertEqual(code, 0, out)

    def test_inconclusive_still_fails_strict(self):
        # --count 12 -> thin (present) sub-cohorts -> inconclusive -> still a --strict failure
        # (the gate may only certify what it actually measured).
        code, out = self._run_main(["--count", "12", "--no-llm", "--strict"])
        self.assertEqual(code, 1, out)


if __name__ == "__main__":
    unittest.main()
