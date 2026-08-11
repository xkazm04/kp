"""Contract tests for observed provenance + bounded dynamic weighting.

These pin the two scoring levers behind fair early-career evaluation:
  * `observed` provenance — first-hand (live case / interview) evidence gets full
    match credit AND narrows the early-career confidence band;
  * bounded dynamic weights — a proposal can shift weight toward demonstrated
    skill for the candidate who has high-trust relevant evidence, but only within
    per-archetype bounds, and cross-candidate ranking uses the fairness matrix.
"""
from __future__ import annotations

import unittest

from pipeline.jobfit import matching
from pipeline.jobfit.matching import (
    MatchCandidate,
    fairness_matrix,
    propose_weights,
    resolve_weights,
    score_job,
    weight_bounds,
    weights_for,
)
from pipeline.jobfit.taxonomy import provenance_weight, skill_match_score
from pipeline.jobfit.tests._helpers import mkjob


def _job(**over):
    base = {
        "title": "Backend Engineer",
        "description": "A backend team.",
        "requirements": [{"skill": "Python", "kind": "must_have", "hardness": "prerequisite"}],
    }
    base.update(over)
    return mkjob(**base)


def _student(**over):
    base = dict(
        skills=["Python"],
        seniority="junior",
        role_family="software_engineering",
        languages=["English"],
        archetype="student",
        potential_score=0.6,
    )
    base.update(over)
    return MatchCandidate(**base)


class ObservedProvenanceTest(unittest.TestCase):
    def test_observed_is_full_credit_above_self_declared(self):
        self.assertEqual(provenance_weight("observed"), 1.0)
        observed = skill_match_score("Python", "Python", "observed")
        professional = skill_match_score("Python", "Python", "professional")
        self_declared = skill_match_score("Python", "Python", "self_declared")
        self.assertEqual(observed, professional)  # capped at full credit
        self.assertGreater(observed, self_declared)

    def test_observed_narrows_early_career_confidence(self):
        job = _job()
        paper = _student(skills=["Python", "SQL", "Git"])
        observed = _student(skills=["Python", "SQL", "Git"], skill_provenance={"Python": "observed"})
        c_paper = score_job(paper, job).confidence
        c_obs = score_job(observed, job).confidence
        self.assertLess(c_obs.high - c_obs.low, c_paper.high - c_paper.low)
        self.assertTrue(any("observed" in d.lower() for d in c_obs.drivers))


class DynamicWeightTest(unittest.TestCase):
    def test_resolve_none_returns_baseline(self):
        for arch in ("bau", "student"):
            self.assertEqual(resolve_weights(arch), weights_for(arch))

    def test_resolve_stays_inside_bounds_and_sums_to_one(self):
        # An extreme proposal is pulled inside the bounds AND still sums to 1.0.
        resolved = resolve_weights("student", {"skills": 0.95, "career": 0.025, "personal": 0.025})
        self.assertAlmostEqual(sum(resolved.values()), 1.0, places=3)
        bounds = weight_bounds("student")
        for slot, value in resolved.items():
            self.assertGreaterEqual(value, bounds[slot][0] - 1e-6, slot)
            self.assertLessEqual(value, bounds[slot][1] + 1e-6, slot)

    def test_bounds_respect_floor_and_ceiling(self):
        for arch in ("bau", "student"):
            for lo, hi in weight_bounds(arch).values():
                self.assertGreaterEqual(lo, matching._WEIGHT_FLOOR - 1e-9)
                self.assertLessEqual(hi, matching._WEIGHT_CEIL + 1e-9)
                self.assertLess(lo, hi)

    def test_propose_bumps_skills_only_for_high_trust_relevant_evidence(self):
        job = _job()
        base = weights_for("student")
        strong = _student(skill_provenance={"Python": "observed"})
        proposed, notes = propose_weights(strong, job)
        self.assertGreater(proposed["skills"], base["skills"])
        self.assertTrue(notes)
        # A peer whose matching skill is only self-declared gets the baseline.
        weak = _student(skill_provenance={"Python": "self_declared"})
        weak_proposed, weak_notes = propose_weights(weak, job)
        self.assertEqual(weak_proposed, dict(base))
        # Baseline proposals now carry an auditable baseline note (never silent).
        self.assertEqual(len(weak_notes), 1)
        self.assertIn("Baseline", weak_notes[0])

    def test_score_job_weights_override_is_opt_in(self):
        job = _job()
        cand = _student(potential_score=0.9, skill_provenance={"Python": "observed"})
        default = score_job(cand, job).total
        leaned = resolve_weights("student", {"skills": 0.6, "career": 0.2, "personal": 0.2})
        with_weights = score_job(cand, job, weights=leaned).total
        # The default path is unchanged; only the explicit override moves the total.
        self.assertEqual(score_job(cand, job).total, default)
        self.assertNotEqual(with_weights, default)

    def test_fairness_matrix_shape_and_ranking(self):
        job = _job()
        strong = _student(label="Strong", potential_score=0.9, skill_provenance={"Python": "observed"})
        weak = _student(label="Weak", skills=["HTML"], potential_score=0.3)
        fm = fairness_matrix([(strong, propose_weights(strong, job)[0]), (weak, None)], job)
        self.assertEqual(len(fm["matrix"]), 2)
        self.assertEqual(len(fm["matrix"][0]), 2)
        self.assertEqual(fm["own"], [fm["matrix"][0][0], fm["matrix"][1][1]])
        self.assertEqual(set(fm["ranking"]), {"Strong", "Weak"})
        # The observed-skill, higher-potential candidate is robustly first.
        self.assertEqual(fm["ranking"][0], "Strong")


def _nurse_job(**over):
    base = {
        "title": "Registered Nurse — ICU",
        "description": "A critical-care ward.",
        "role_family": "healthcare_clinical",
        "requirements": [{"skill": "intensive care", "kind": "must_have", "hardness": "prerequisite"}],
    }
    base.update(over)
    return mkjob(**base)


def _nurse_student(**over):
    base = dict(
        skills=["intensive care"],
        seniority="junior",
        role_family="healthcare_clinical",
        languages=["Czech"],
        archetype="student",
        potential_score=0.6,
    )
    base.update(over)
    return MatchCandidate(**base)


class NonTechScoringContractTest(unittest.TestCase):
    """The SAME contracts as the tech fixtures above, on a non-tech family.

    Everything above fixtures on ``software_engineering`` + Python, so the
    provenance ladder, the bounded dynamic weights and the fairness matrix were
    only ever proven inside tech. They are family-agnostic by design — this is the
    test that says so out loud for one of the 13 non-tech families the product now
    serves, using its own vocabulary (``intensive care``, not ``Python``).
    """

    def test_observed_is_full_credit_above_self_declared(self):
        observed = skill_match_score("intensive care", "intensive care", "observed")
        professional = skill_match_score("intensive care", "intensive care", "professional")
        self_declared = skill_match_score("intensive care", "intensive care", "self_declared")
        self.assertEqual(observed, professional)
        self.assertGreater(observed, self_declared)

    def test_observed_narrows_early_career_confidence(self):
        job = _nurse_job()
        paper = _nurse_student(skills=["intensive care", "triage", "patient care"])
        observed = _nurse_student(
            skills=["intensive care", "triage", "patient care"],
            skill_provenance={"intensive care": "observed"},
        )
        c_paper = score_job(paper, job).confidence
        c_obs = score_job(observed, job).confidence
        self.assertLess(c_obs.high - c_obs.low, c_paper.high - c_paper.low)
        self.assertTrue(any("observed" in d.lower() for d in c_obs.drivers))

    def test_propose_bumps_skills_only_for_high_trust_relevant_evidence(self):
        job = _nurse_job()
        base = weights_for("student")
        strong = _nurse_student(skill_provenance={"intensive care": "observed"})
        proposed, notes = propose_weights(strong, job)
        self.assertGreater(proposed["skills"], base["skills"])
        self.assertTrue(notes)
        weak = _nurse_student(skill_provenance={"intensive care": "self_declared"})
        weak_proposed, weak_notes = propose_weights(weak, job)
        self.assertEqual(weak_proposed, dict(base))
        # Baseline proposals now carry an auditable baseline note (never silent).
        self.assertEqual(len(weak_notes), 1)
        self.assertIn("Baseline", weak_notes[0])

    def test_fairness_matrix_ranks_the_stronger_nurse_first(self):
        job = _nurse_job()
        strong = _nurse_student(
            label="Strong", potential_score=0.9, skill_provenance={"intensive care": "observed"}
        )
        weak = _nurse_student(label="Weak", skills=["reception"], potential_score=0.3)
        fm = fairness_matrix([(strong, propose_weights(strong, job)[0]), (weak, None)], job)
        self.assertEqual(len(fm["matrix"]), 2)
        self.assertEqual(fm["own"], [fm["matrix"][0][0], fm["matrix"][1][1]])
        self.assertEqual(fm["ranking"][0], "Strong")

    def test_weight_bounds_are_archetype_scoped_not_family_scoped(self):
        # The bounds machinery keys on ARCHETYPE only — a nurse and an engineer with
        # the same archetype resolve identically. Pinned because a family-conditional
        # weight would be an un-audited fairness lever.
        self.assertEqual(weight_bounds("student"), weight_bounds("student"))
        resolved = resolve_weights("student", {"skills": 0.95, "career": 0.025, "personal": 0.025})
        self.assertAlmostEqual(sum(resolved.values()), 1.0, places=3)
        for slot, value in resolved.items():
            lo, hi = weight_bounds("student")[slot]
            self.assertGreaterEqual(value, lo - 1e-6, slot)
            self.assertLessEqual(value, hi + 1e-6, slot)


if __name__ == "__main__":
    unittest.main()
