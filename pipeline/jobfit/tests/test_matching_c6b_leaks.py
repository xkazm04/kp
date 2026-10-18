"""Scoring C6b, "close the leaks": three places a bare keyword claim still bought score
under the proof weights (ADR 0027) after C6 had discounted it on learnable must-haves.

Each leak is one STUFFED twin: the same person with a requirement added as a bare
``self_declared`` claim, scored under the default (proof) scorer against the base. The
legacy arithmetic (``proof=None``) is the control that shows the twin really gains there.

  (a) a prerequisite must-have and a nice-to-have (score_skills)
  (b) the BAU personal keyword overlap against the ad (score_personal)
  (c) the early-career potential score's learning velocity (transform.compute_potential),
      where bare claims are capped rather than dropped (see BARE_CLAIM_VELOCITY_CAP)
"""

from __future__ import annotations

import unittest

from pipeline.jobfit.jobs import Job, JobRequirement
from pipeline.jobfit.matching import (
    DEFAULT_PROOF_WEIGHTS,
    MatchCandidate,
    ProofReason,
    score_job,
    score_personal,
)
from pipeline.jobfit.profile import CandidateProfileV2, Evidence, SkillClaim
from pipeline.jobfit.transform import BARE_CLAIM_VELOCITY_CAP, build_match_candidate, compute_potential


def _job() -> Job:
    return Job(
        id="j-c6b",
        title="Data Engineer",
        company="Acme",
        location="Praha",
        requirements=[
            JobRequirement(skill="Python", kind="must_have", hardness="prerequisite"),
            JobRequirement(skill="Kafka", kind="must_have", hardness="prerequisite"),
            JobRequirement(skill="Terraform", kind="nice_to_have", hardness="learnable"),
            JobRequirement(skill="Airflow", kind="nice_to_have", hardness="prerequisite"),
        ],
    )


def _bau(provenance: dict[str, str]) -> MatchCandidate:
    return MatchCandidate(
        skills=list(provenance),
        skill_provenance=provenance,
        archetype="bau",
        provenance_default="self_declared",
    )


class LeakA_PrerequisiteAndNiceToHave(unittest.TestCase):
    """A bare claim on a prerequisite or a nice-to-have is discounted like a learnable one."""

    def _gain(self, added: str, *, proof) -> float:
        job = _job()
        base = score_job(_bau({"Python": "professional"}), job, proof=proof)
        stuffed = score_job(_bau({"Python": "professional", added: "self_declared"}), job, proof=proof)
        return stuffed.skills_score - base.skills_score

    def test_control_the_legacy_arithmetic_pays_for_the_bare_claims(self) -> None:
        for added in ("Kafka", "Terraform", "Airflow"):
            self.assertGreater(self._gain(added, proof=None), 0.0, added)

    def test_a_bare_claim_earns_at_most_the_discounted_fraction(self) -> None:
        for added in ("Kafka", "Terraform", "Airflow"):
            legacy, proof = self._gain(added, proof=None), self._gain(added, proof=DEFAULT_PROOF_WEIGHTS)
            self.assertLessEqual(proof, legacy * DEFAULT_PROOF_WEIGHTS.self_declared_requirement + 1e-4, added)

    def test_evidence_on_a_prerequisite_keeps_its_full_credit(self) -> None:
        job = _job()
        proven = {"Python": "professional", "Kafka": "professional"}
        self.assertEqual(
            score_job(_bau(proven), job).skills_score, score_job(_bau(proven), job, proof=None).skills_score
        )

    def test_each_discounted_requirement_carries_a_reasons_line(self) -> None:
        reasons: list[ProofReason] = []
        score_job(_bau({"Python": "professional", "Kafka": "self_declared", "Airflow": "self_declared"}), _job(), proof_reasons=reasons)
        discounted = {r.skill: r for r in reasons if r.code == "self_declared_discount"}
        self.assertEqual(set(discounted), {"Kafka", "Airflow"})
        self.assertIn("prerequisite must-have", discounted["Kafka"].text)
        self.assertIn("nice-to-have", discounted["Airflow"].text)
        for r in discounted.values():
            self.assertLess(r.preview_credit, r.base_credit)


def _ad() -> Job:
    # The ad names more keywords than it requires: personal overlap reads the whole text.
    return Job(
        id="j-c6b-ad",
        title="Data Engineer",
        company="Acme",
        location="Praha",
        description="You will build Python pipelines on Kafka and Spark, orchestrated with Airflow on Kubernetes.",
        requirements=[JobRequirement(skill="Python", kind="must_have", hardness="prerequisite")],
    )


class LeakB_PersonalKeywordOverlap(unittest.TestCase):
    """A bare skill claim no longer earns BAU personal-fit credit for naming the ad's words."""

    BASE = {"Python": "professional"}
    STUFFED = {"Python": "professional", "Kafka": "self_declared", "Spark": "self_declared", "Kubernetes": "self_declared"}

    def test_control_the_legacy_overlap_pays_for_the_bare_keywords(self) -> None:
        legacy = lambda prov: score_job(_bau(prov), _ad(), proof=None).personal_score  # noqa: E731
        self.assertGreater(legacy(self.STUFFED), legacy(self.BASE))

    def test_the_stuffed_twin_gains_at_most_the_discounted_fraction(self) -> None:
        job = _ad()
        legacy_gain = score_job(_bau(self.STUFFED), job, proof=None).personal_score - score_job(_bau(self.BASE), job, proof=None).personal_score
        proof_gain = score_job(_bau(self.STUFFED), job).personal_score - score_job(_bau(self.BASE), job).personal_score
        self.assertLessEqual(proof_gain, legacy_gain * DEFAULT_PROOF_WEIGHTS.self_declared_requirement + 1e-4)

    def test_evidenced_keywords_keep_their_overlap(self) -> None:
        proven = {k: "professional" for k in self.STUFFED}
        job = _ad()
        self.assertEqual(score_job(_bau(proven), job).personal_score, score_job(_bau(proven), job, proof=None).personal_score)

    def test_traits_are_not_claims_and_keep_their_overlap(self) -> None:
        cand = MatchCandidate(skills=[], traits=["Kafka"], archetype="bau", provenance_default="self_declared")
        self.assertEqual(score_job(cand, _ad()).personal_score, score_job(cand, _ad(), proof=None).personal_score)

    def test_the_primitive_stays_the_historical_arithmetic(self) -> None:
        cand = _bau(self.STUFFED)
        self.assertEqual(score_personal(cand, _ad()), score_job(cand, _ad(), proof=None).personal_score)

    def test_the_withheld_overlap_carries_a_reasons_line(self) -> None:
        reasons: list[ProofReason] = []
        score_job(_bau(self.STUFFED), _ad(), proof_reasons=reasons)
        overlap = [r for r in reasons if r.code == "self_declared_overlap"]
        self.assertEqual(len(overlap), 1)
        for skill in ("Kafka", "Spark", "Kubernetes"):
            self.assertIn(skill, overlap[0].text)
        self.assertLess(overlap[0].preview_credit, overlap[0].base_credit)

    def test_no_reasons_line_when_nothing_was_withheld(self) -> None:
        reasons: list[ProofReason] = []
        score_job(_bau(self.BASE), _ad(), proof_reasons=reasons)
        self.assertEqual([r for r in reasons if r.code == "self_declared_overlap"], [])


def _student(*bare: str) -> CandidateProfileV2:
    return CandidateProfileV2(
        archetype="student",
        role_family="data_ai",
        education_level="bachelor",
        languages=["English"],
        skill_claims=[SkillClaim(skill="SQL", provenance="coursework"), *(SkillClaim(skill=s) for s in bare)],
        evidence=[Evidence(kind="project", title="Course project", skills=["Python", "Pandas"])],
    )


STUFFING = ("Kafka", "Spark", "Airflow", "dbt", "Docker", "Kubernetes", "Terraform", "Scala")


class LeakC_PotentialVelocity(unittest.TestCase):
    """A list of bare skill claims no longer buys an early-career candidate learning velocity:
    between them they add at most BARE_CLAIM_VELOCITY_CAP skills of breadth."""

    def test_control_the_legacy_velocity_counts_the_bare_claims(self) -> None:
        legacy = lambda p: compute_potential(p, count_bare_claims=True)[0]  # noqa: E731
        self.assertGreater(legacy(_student(*STUFFING)), legacy(_student()))

    def test_the_stuffed_twin_gains_no_more_than_the_cap(self) -> None:
        self.assertEqual(BARE_CLAIM_VELOCITY_CAP, 1)
        capped = compute_potential(_student(*STUFFING[:BARE_CLAIM_VELOCITY_CAP]))
        self.assertEqual(compute_potential(_student(*STUFFING)), capped)
        base, stuffed = build_match_candidate(_student()), build_match_candidate(_student(*STUFFING))
        self.assertLessEqual(stuffed.potential_score - base.potential_score, 0.25 * BARE_CLAIM_VELOCITY_CAP / 8 + 1e-3)

    def test_one_bare_claim_beside_evidence_still_counts(self) -> None:
        # The seed students' shape (one bare claim each): dropping it cost two a tier.
        self.assertGreater(compute_potential(_student("Kafka"))[0], compute_potential(_student())[0])

    def test_a_claim_with_any_evidence_still_counts(self) -> None:
        claimed = _student()
        backed = claimed.model_copy(
            update={"skill_claims": [*claimed.skill_claims, SkillClaim(skill="Kafka", provenance="personal_project")]}
        )
        self.assertGreater(compute_potential(backed)[0], compute_potential(claimed)[0])

    def test_the_career_slot_reads_the_gated_potential_and_says_why(self) -> None:
        cand, job = build_match_candidate(_student(*STUFFING)), _job()
        reasons: list[ProofReason] = []
        proof = score_job(cand, job, proof_reasons=reasons)
        legacy = score_job(cand, job, proof=None)
        self.assertEqual(proof.career_score, cand.potential_score)
        self.assertGreater(legacy.career_score, proof.career_score)
        velocity = [r for r in reasons if r.code == "self_declared_velocity"]
        self.assertEqual(len(velocity), 1)
        self.assertEqual((velocity[0].base_credit, velocity[0].preview_credit), (legacy.career_score, proof.career_score))
        self.assertIn("learning velocity", velocity[0].text)

    def test_within_the_cap_no_change_no_reasons_line(self) -> None:
        cand, job = build_match_candidate(_student("Kafka")), _job()
        reasons: list[ProofReason] = []
        self.assertEqual(score_job(cand, job, proof_reasons=reasons).career_score, score_job(cand, job, proof=None).career_score)
        self.assertEqual([r for r in reasons if r.code == "self_declared_velocity"], [])
        self.assertIsNone(cand.bare_claim_potential_score)


if __name__ == "__main__":
    unittest.main()
