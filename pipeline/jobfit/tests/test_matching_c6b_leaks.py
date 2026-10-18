"""Scoring C6b, "close the leaks": three places a bare keyword claim still bought score
under the proof weights (ADR 0027) after C6 had discounted it on learnable must-haves.

Each leak is one STUFFED twin: the same person with a requirement added as a bare
``self_declared`` claim, scored under the default (proof) scorer against the base. The
legacy arithmetic (``proof=None``) is the control that shows the twin really gains there.

  (a) a prerequisite must-have and a nice-to-have (score_skills)
  (b) the BAU personal keyword overlap against the ad (score_personal)
  (c) the early-career potential score's learning velocity (transform.compute_potential)
"""

from __future__ import annotations

import unittest

from pipeline.jobfit.jobs import Job, JobRequirement
from pipeline.jobfit.matching import (
    DEFAULT_PROOF_WEIGHTS,
    MatchCandidate,
    ProofReason,
    score_job,
)


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


if __name__ == "__main__":
    unittest.main()
