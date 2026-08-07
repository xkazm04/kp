"""Direction 3: the memoized / dedup'd hot paths must be byte-identical to the
naive recomputation they replaced.

fairness_matrix now computes each candidate's scheme-independent dimensions once
and combines them with every scheme (n + n^2 cheap combines) instead of n^2 full
score_job calls; winnability scores each eligible candidate against the base job
once and reuses it for both the qualified count and the missing-skill map. These
tests recompute the SLOW way and assert every cell/figure matches — no algorithmic
change, just less repeated work.
"""

from __future__ import annotations

import unittest

from pipeline.jobfit.jobs import Job, JobRequirement
from pipeline.jobfit.matching import (
    MatchCandidate,
    fairness_matrix,
    propose_weights,
    resolve_weights,
    score_job,
)
from pipeline.jobfit.winnability import assess_winnability


def _job(**kw) -> Job:
    base = dict(
        id="job-1",
        title="Backend Engineer",
        company="Acme",
        location="Prague",
        seniority="senior",
        role_family="software_engineering",
        languages=["English"],
        requirements=[
            JobRequirement(skill="python", kind="must_have"),
            JobRequirement(skill="kafka", kind="must_have"),
            JobRequirement(skill="sql", kind="nice_to_have"),
        ],
    )
    base.update(kw)
    return Job(**base)


def _cand(label: str, skills: list[str], **kw) -> MatchCandidate:
    return MatchCandidate(label=label, skills=skills, role_family="software_engineering", **kw)


class FairnessMatrixIdentityTest(unittest.TestCase):
    def test_optimized_matrix_equals_naive_score_job_grid(self) -> None:
        job = _job()
        candidates = [
            _cand("A", ["python", "kafka", "sql"], seniority="senior"),
            _cand("B", ["python", "sql"], seniority="medior"),
            _cand("C", ["python", "kafka"], seniority="senior",
                  skill_provenance={"python": "professional", "kafka": "professional"}),
            _cand("D", ["java"], seniority="junior"),
        ]
        # Give each candidate a real (varied) proposed weight vector so schemes differ.
        pairs = [(c, propose_weights(c, job)[0]) for c in candidates]

        result = fairness_matrix(pairs, job)
        schemes = result["schemes"]

        # Naive ground truth: a full score_job per (candidate, scheme) cell.
        expected = [
            [score_job(c, job, weights=scheme).total for scheme in schemes]
            for c, _w in pairs
        ]
        self.assertEqual(result["matrix"], expected)
        # Diagonal ("own") and the derived mean/ranking follow from the identical matrix.
        self.assertEqual(result["own"], [expected[i][i] for i in range(len(pairs))])
        self.assertEqual(
            result["schemes"], [resolve_weights(c.archetype, w) for c, w in pairs]
        )


class WinnabilityIdentityTest(unittest.TestCase):
    def test_reused_base_scores_match_independent_recompute(self) -> None:
        pool = [
            _cand("flip1", ["python", "git", "sql"], seniority="medior"),
            _cand("flip2", ["python", "git", "sql"], seniority="medior"),
            _cand("has_kafka", ["python", "kafka", "git"], seniority="medior"),
            _cand("weak", ["java"], seniority="junior"),
        ]
        job = _job()
        out = assess_winnability(pool, job)

        # Independently recompute qualified against the base job the slow way.
        from pipeline.jobfit.matching import FIT_PROMISING_THRESHOLD, ko_filter

        elig = [c for c in pool if ko_filter(c, job)[0]]
        expected_qual = sum(
            1 for c in elig if score_job(c, job).total >= FIT_PROMISING_THRESHOLD
        )
        self.assertEqual(out["qualified"], expected_qual)
        self.assertEqual(out["eligible"], len(elig))
        # The missing-skill-driven must-have lever must reflect the same base scores.
        for m in out["looseMustHaves"]:
            recomputed_missing = sum(
                1 for c in elig if m["skill"] in set(score_job(c, job).missing_skills)
            )
            self.assertEqual(m["missingAmongEligible"], recomputed_missing)


if __name__ == "__main__":
    unittest.main()
