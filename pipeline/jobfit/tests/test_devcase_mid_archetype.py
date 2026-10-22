"""ADR 0027 S3 - the mid-strength archetype on the observed cast.

Before S3 the observed cast was strong or weak and nothing between, so the gamer watch
figure (strong minus the AI-no-verify cohort) had no middle to be read against. The
``ai_spot_check`` archetype is a partial verifier: it uses the assistant, reads the legacy
module and fixes the planted rate, but writes no test, asks for no check and ships the
supplied draft unreviewed. Pinned here:

  * it is on the observed cast and NOT on the commit cast (the commit cast is unchanged);
  * its judgment sits strictly between the non-verifiers and the verifiers;
  * its case score sits between weak and strong by the discrimination margin, and above
    the gamer, so the discrimination gate certifies a middle;
  * it enters neither fairness group, so the judgment gap |ai - non_ai| stays 0.0;
  * its watched evidence (one verification act, one caught planted defect) differs from a
    strong and a weak row's, which is what the recruiter-facing evidence ladder renders.
"""

from __future__ import annotations

import json
import sys
import unittest
from pathlib import Path

from pipeline.jobfit.devcase.evaluate import verification_acts
from pipeline.jobfit.devcase.submission_eval import MIN_DISCRIMINATION_MARGIN, run, run_one, signals
from pipeline.jobfit.devcase.submission_scenarios import BEHAVIORS, generate_submissions

MID = "ai_spot_check"
# The WATCHED evidence the TS evidence ladder is tested against (app/_lib/evidence-ladder/
# ladder.test.ts), one row per archetype. Pinned to the live cast below, so a cast change
# that the ladder test would no longer reflect fails here, not silently there.
FIXTURE = Path(__file__).resolve().parents[3] / "app" / "_lib" / "evidence-ladder" / "observed-cast.fixture.json"
FIXTURE_ROWS = ("careful_verifier", "ai_then_verify", MID, "big_bang_no_verify", "ai_no_verify")


def ladder_fixture() -> dict:
    scns = {s.planted["behavior"]: s for s in generate_submissions(len(BEHAVIORS), path="observed")}
    rows = {}
    for b in FIXTURE_ROWS:
        r = run_one(scns[b], None)
        oc = r.observed_checks
        rows[b] = {
            "expected": scns[b].planted["expected"],
            "bundle": {
                "tooling": {"signals": r.tooling.get("signals")},
                "observedChecks": {
                    "promptSignals": oc.get("promptSignals"),
                    "canaryOutcomes": [{k: c.get(k) for k in ("id", "status")} for c in oc.get("canaryOutcomes") or []],
                },
            },
        }
    return {
        "_generated": "python -m pipeline.jobfit.devcase.submission_eval observed cast (ADR 0027 S3): the observed evidence the WATCHED rung reads, one row per archetype; regenerate when the cast changes",
        "rows": rows,
    }


def _acts(row) -> int:
    checks = row.observed_checks or {}
    return verification_acts(row.tooling.get("signals"), checks.get("promptSignals"), checks.get("canaryOutcomes"))


class MidArchetypeCastTest(unittest.TestCase):
    def test_mid_is_observed_only(self):
        self.assertEqual(BEHAVIORS[MID]["expected"], "mid")
        self.assertEqual(BEHAVIORS[MID]["verifies"], "partial")
        observed = {s.planted["behavior"] for s in generate_submissions(48, path="observed")}
        commit = {s.planted["behavior"] for s in generate_submissions(48, path="commit")}
        self.assertIn(MID, observed)
        self.assertNotIn(MID, commit)

    def test_commit_cast_is_unchanged(self):
        # The six pre-S3 behaviours, in order, on every commit row.
        before = ["careful_verifier", "ai_then_verify", "tdd", "exploratory_reverts", "big_bang_no_verify", "ai_no_verify"]
        scns = generate_submissions(12, path="commit")
        self.assertEqual([s.planted["behavior"] for s in scns], before * 2)


class MidArchetypeScoringTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.sig = signals(run(generate_submissions(48, path="observed"), None))
        scns = {s.planted["behavior"]: s for s in generate_submissions(7, path="observed")}
        cls.rows = {b: run_one(s, None) for b, s in scns.items()}

    def test_judgment_sits_between_non_verifiers_and_verifiers(self):
        mid = self.rows[MID].judgment
        self.assertGreater(mid, self.rows["big_bang_no_verify"].judgment)
        self.assertLess(mid, self.rows["careful_verifier"].judgment)

    def test_case_score_sits_between_weak_and_strong(self):
        d = self.sig["discrimination"]
        self.assertEqual(d["status"], "pass", d)
        self.assertTrue(d["mid_between"], d)
        self.assertGreaterEqual(d["mid_mean"] - d["weak_mean"], MIN_DISCRIMINATION_MARGIN)
        self.assertGreaterEqual(d["strong_mean"] - d["mid_mean"], MIN_DISCRIMINATION_MARGIN)
        self.assertGreaterEqual(d["mid_gamer_margin"], MIN_DISCRIMINATION_MARGIN)

    def test_judgment_gap_stays_zero(self):
        f = self.sig["fairness"]
        self.assertEqual(f["status"], "pass", f)
        self.assertEqual(f["margins"]["ai_gap"], 0.0)
        # The partial verifier is in neither behaviour-matched group.
        n_mid = self.sig["discrimination"]["sample"]["mid"]
        s = f["sample"]
        self.assertEqual(s["verifiers"] + s["non_verifiers"] + n_mid, 48)

    def test_watched_evidence_is_distinct(self):
        # The ladder's WATCHED rung reads these: strong 2+, mid exactly 1, weak 0.
        self.assertGreaterEqual(_acts(self.rows["careful_verifier"]), 2)
        self.assertEqual(_acts(self.rows[MID]), 1)
        self.assertEqual(_acts(self.rows["big_bang_no_verify"]), 0)
        self.assertEqual(_acts(self.rows["ai_no_verify"]), 0)


class LadderFixtureParityTest(unittest.TestCase):
    def test_fixture_matches_the_live_cast(self):
        on_disk = json.loads(FIXTURE.read_text(encoding="utf-8"))
        self.assertEqual(
            on_disk,
            ladder_fixture(),
            "the ladder fixture drifted from the cast; regenerate: python -m pipeline.jobfit.tests.test_devcase_mid_archetype --write",
        )


if __name__ == "__main__":
    if "--write" in sys.argv:
        FIXTURE.write_text(json.dumps(ladder_fixture(), indent=2) + "\n", encoding="utf-8", newline="\n")
    else:
        unittest.main()
