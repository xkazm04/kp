"""ADR 0027 (Decision 2026-10-18): the proof weights are kp's DEFAULT scorer.

Pins the three things the adoption owes the product path: ``score_job`` with no
``proof=`` argument runs the proof weights, ``proof=None`` still runs the historical
arithmetic (so the C5 harness can measure before/after), and every result carries a
scorer version that tells the two apart and fits the TS side's SCORER_VERSION_RE.
"""

from __future__ import annotations

import re
import unittest

from pipeline.jobfit.jobs import Job, JobRequirement
from pipeline.jobfit.matching import (
    LEGACY_SCORER_VERSION,
    PROOF_PREVIEW_WEIGHTS,
    MatchCandidate,
    proof_scorer_version,
    score_job,
)

SCORER_VERSION_RE = re.compile(r"^[a-z0-9][a-z0-9._-]{0,39}$")


def _job() -> Job:
    return Job(
        id="j-default",
        title="Data Engineer",
        company="Acme",
        location="Praha",
        requirements=[
            JobRequirement(skill="Python", kind="must_have", hardness="prerequisite"),
            JobRequirement(skill="Docker", kind="must_have", hardness="learnable"),
        ],
    )


def _cand() -> MatchCandidate:
    prov = {"Python": "professional", "Docker": "self_declared"}
    return MatchCandidate(skills=list(prov), skill_provenance=prov, archetype="bau", provenance_default="self_declared")


class ProofIsTheDefaultTests(unittest.TestCase):
    def test_default_call_runs_the_proof_weights(self) -> None:
        explicit = score_job(_cand(), _job(), proof=PROOF_PREVIEW_WEIGHTS)
        self.assertEqual(score_job(_cand(), _job()), explicit)
        self.assertNotEqual(score_job(_cand(), _job()).total, score_job(_cand(), _job(), proof=None).total)

    def test_proof_none_is_the_historical_arithmetic(self) -> None:
        legacy = score_job(_cand(), _job(), proof=None)
        self.assertEqual(legacy.scorer_version, LEGACY_SCORER_VERSION)

    def test_scorer_version_distinguishes_old_from_proof(self) -> None:
        default = score_job(_cand(), _job()).scorer_version
        self.assertIn(proof_scorer_version(), default)
        self.assertNotEqual(default, LEGACY_SCORER_VERSION)
        for v in (default, LEGACY_SCORER_VERSION, proof_scorer_version()):
            self.assertRegex(v, SCORER_VERSION_RE)


if __name__ == "__main__":
    unittest.main()
