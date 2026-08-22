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


def _pairs(job: Job) -> list[tuple[MatchCandidate, dict[str, float] | None]]:
    """The (candidate, proposed-weights) pool the matrix is built from.

    AUDIT 2026-08-22 — every candidate here used to be the default ``bau``
    archetype and every proposal came from ``propose_weights``, which returned the
    SAME baseline vector for three of the four. ``fairness_matrix`` resolves each
    scheme with ``resolve_weights(c.archetype, w)`` — the archetype selects both the
    baseline (when a caller passes no proposal, which ``recruiter_cli`` does) and the
    clamp bounds — so the archetype was an UNMEASURED input to the reused key. This
    pool spans three archetypes AND both resolution branches:

      * ``S`` passes ``None``  -> the scheme IS ``weights_for(archetype)``;
      * ``W`` passes a raw vector below BAU's skills floor (0.35) but inside the
        switcher's (0.20) -> the CLAMP differs by archetype.
    """
    return [
        (_cand("A", ["python", "kafka", "sql"], seniority="senior"), None),
        (_cand("B", ["python", "sql"], seniority="medior"), None),
        (_cand("C", ["python", "kafka"], seniority="senior",
               skill_provenance={"python": "professional", "kafka": "professional"}), None),
        (_cand("D", ["java"], seniority="junior"), None),
        (_cand("S", ["python", "sql"], seniority="junior", archetype="student",
               potential_score=0.8, learning_signals=["thesis"]), None),
        (_cand("W", ["python", "kafka"], seniority="medior", archetype="career_switcher",
               potential_score=0.55, transferable_skills=["stakeholder communication"]),
         {"skills": 0.25, "career": 0.5, "personal": 0.25}),
    ]


def _resolved_pairs(job: Job) -> list[tuple[MatchCandidate, dict[str, float] | None]]:
    """``_pairs`` with each ``None`` proposal filled in by ``propose_weights`` —
    except ``S``, which deliberately stays ``None`` so the baseline branch of
    ``resolve_weights`` (the one that reads ``weights_for(archetype)`` directly) is
    exercised, exactly as ``recruiter_cli`` does for a candidate with no proposal."""
    out: list[tuple[MatchCandidate, dict[str, float] | None]] = []
    for c, w in _pairs(job):
        if w is None and c.label != "S":
            w = propose_weights(c, job)[0]
        out.append((c, w))
    return out


class FairnessMatrixIdentityTest(unittest.TestCase):
    def test_optimized_matrix_equals_naive_score_job_grid(self) -> None:
        job = _job()
        pairs = _resolved_pairs(job)

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

    def test_the_scheme_axis_is_not_degenerate(self) -> None:
        """Non-vacuity for the grid above: identical schemes make every column of the
        matrix identical, so a combine that ignored the scheme — or resolved every
        candidate's proposal against ONE hardcoded archetype — would still match the
        naive grid cell for cell.

        MUTATION THAT STAYED GREEN with the old all-bau pool: replacing
        ``resolve_weights(c.archetype, w)`` with ``resolve_weights("bau", w)`` inside
        ``fairness_matrix`` — i.e. scoring a student or a career switcher in group
        compare on the BAU yardstick — passed all 237 tests in this context.
        """
        job = _job()
        pairs = _resolved_pairs(job)
        schemes = fairness_matrix(pairs, job)["schemes"]
        distinct = {tuple(sorted(s.items())) for s in schemes}
        self.assertGreaterEqual(
            len(distinct), 3, f"the matrix fixture no longer spans distinct schemes: {schemes}"
        )
        archetypes = {c.archetype for c, _w in pairs}
        self.assertGreaterEqual(len(archetypes), 3, f"pool no longer spans archetypes: {archetypes}")
        # The archetype is load-bearing in BOTH resolution branches, so dropping it
        # from the key cannot be invisible.
        for (c, w), scheme in zip(pairs, schemes):
            with self.subTest(candidate=c.label):
                self.assertEqual(scheme, resolve_weights(c.archetype, w))
                if c.archetype != "bau":
                    self.assertNotEqual(
                        scheme,
                        resolve_weights("bau", w),
                        f"{c.label}'s scheme is indistinguishable from the BAU resolution — "
                        "this fixture cannot detect a dropped archetype",
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
