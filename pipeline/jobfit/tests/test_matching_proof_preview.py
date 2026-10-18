"""Scoring C6: the proof-weights PREVIEW, measured by the C5 twin-cast harness.

The preview (``score_job(..., proof=PROOF_PREVIEW_WEIGHTS)``, ``--preview`` on the harness) weighs
a learnable must-have at lambda < 1 and credits a bare self-declared claim on one
at a fraction of today's credit. It is opt-in: the default scorer and the C5 pinned
baseline must not move.

Each C6 verify target is one test, written at the scope's own number. Two of them
are NOT reached by the preview's levers, and they stay at the scope's number as
``expectedFailure`` rather than being loosened; the frontier actually reached is
pinned beside each. Should a later change meet one, the unexpected success turns
the suite red, and whoever did it moves the target test out of expectedFailure.

Why the two are out of reach (measured on this harness, 2026-10-18): the stuffed
twin claims every missing requirement, prerequisites and nice-to-haves included,
and the claims also move two dimensions C6 does not touch — the BAU personal
keyword overlap against the ad, and the early-career potential score, which counts
claimed skills (transform.compute_potential). Even crediting EVERY self-declared
claim at zero left a +2.23 free-claim gain and 4/66 best-job crossings.
"""

from __future__ import annotations

import socket
import subprocess
import unittest
from unittest import mock

from pipeline.jobfit.eval import matching_era_eval as E
from pipeline.jobfit.jobs import Job, JobRequirement
from pipeline.jobfit.matching import (
    PROOF_PREVIEW_STAMP,
    PROOF_PREVIEW_WEIGHTS,
    MatchCandidate,
    ProofReason,
    load_corpus,
    _DEFAULT_CORPUS,
    proof_scorer_version,
    score_job,
)
from pipeline.jobfit import registry

# The C5 baseline the preview is read against (test_matching_era_eval.py pins it).
BASE_FREE_CLAIM_GAIN = 18.3801
BASE_PROOF_PREMIUM = 24.703
NAME_AXES = ("czech_gender_pair", "english_gender_pair", "czech_vs_english_male", "czech_vs_english_female")


def _preview(cand: MatchCandidate, job: Job):
    reasons: list[ProofReason] = []
    return score_job(cand, job, proof=PROOF_PREVIEW_WEIGHTS, proof_reasons=reasons), reasons


def _forbidden(*_a, **_k):
    raise AssertionError("keyless run touched the network or spawned a process")


class ProofPreviewHarnessTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        with mock.patch.object(socket.socket, "connect", _forbidden), mock.patch.object(
            socket, "create_connection", _forbidden
        ), mock.patch.object(subprocess, "Popen", _forbidden):
            cls.report = E.run(preview=PROOF_PREVIEW_WEIGHTS)
        cls.pv = cls.report["preview"]["results"]
        cls.cmp = cls.report["preview"]["comparison"]

    # -- the six C6 targets -------------------------------------------------

    @unittest.expectedFailure
    def test_target_free_claim_gain_at_most_2(self) -> None:
        self.assertLessEqual(self.pv["free_claim_gain"], 2.0)

    def test_frontier_free_claim_gain(self) -> None:
        # Reached: +13.6659, down from +18.3801. Re-pin deliberately if the preview moves.
        self.assertEqual(self.pv["free_claim_gain"], 13.6659)
        self.assertLess(self.pv["free_claim_gain"], BASE_FREE_CLAIM_GAIN)

    @unittest.expectedFailure
    def test_target_no_free_claim_crossing_at_best_job(self) -> None:
        self.assertEqual(self.pv["tier_crossings"]["free_claim_at_best_job"], 0)

    def test_frontier_free_claim_crossings_at_best_job(self) -> None:
        # Reached: 7/66, down from 9/66.
        tc = self.pv["tier_crossings"]
        self.assertEqual((tc["free_claim_at_best_job"], tc["best_job_pairs"]), (7, 66))

    def test_target_proof_premium_not_below_today(self) -> None:
        self.assertGreaterEqual(self.pv["proof_premium"], BASE_PROOF_PREMIUM)

    def test_target_name_deltas_zero(self) -> None:
        for key in NAME_AXES:
            self.assertEqual(self.pv["neutrality"][key]["max_abs"], 0, key)
            self.assertEqual(self.pv["neutrality"][key]["nonzero"], 0, key)

    def test_target_no_protected_tier_loss_at_best_job(self) -> None:
        self.assertEqual(set(self.cmp["protected_archetypes"]), {"student", "career_switcher"})
        self.assertEqual(tuple(self.cmp["protected_archetypes"]), registry.early_career_archetypes())
        self.assertEqual(self.cmp["protected_tier_losses_at_best_job"], [])

    def test_target_every_changed_score_has_a_reason(self) -> None:
        self.assertGreater(self.cmp["changed_scores"], 0)
        self.assertEqual(self.cmp["changed_without_reason"], 0)
        self.assertEqual(E.integrity_failures(self.report), [])

    # -- what the preview is ------------------------------------------------

    def test_preview_reads_hardness(self) -> None:
        # Today the scorer ignores hardness (learnable lift > prerequisite lift).
        h = self.pv["hardness"]
        self.assertLess(h["learnable_lift_per_requirement"], h["prerequisite_lift_per_requirement"])

    def test_lambda_below_one_and_a_bare_claim_keeps_some_credit(self) -> None:
        self.assertLess(PROOF_PREVIEW_WEIGHTS.learnable_must_weight, 1.0)
        self.assertGreater(PROOF_PREVIEW_WEIGHTS.self_declared_learnable, 0.0)
        self.assertLess(PROOF_PREVIEW_WEIGHTS.self_declared_learnable, 1.0)

    def test_preview_carries_its_own_stamp(self) -> None:
        self.assertEqual(self.report["stamp"], "SYNTHETIC")
        version = self.report["preview"]["scorer_version"]
        self.assertTrue(version.startswith(self.report["scorer_version"] + "+" + PROOF_PREVIEW_STAMP))
        self.assertNotEqual(version, self.report["scorer_version"])
        self.assertIn("proof-weights PREVIEW", E._format(self.report))

    def test_default_path_is_unchanged(self) -> None:
        # The base half of a --preview report is the C5 baseline, unmoved.
        r = self.report["results"]
        self.assertEqual(r["free_claim_gain"], BASE_FREE_CLAIM_GAIN)
        self.assertEqual(r["proof_premium"], BASE_PROOF_PREMIUM)
        self.assertEqual(r["tier_crossings"]["free_claim_at_best_job"], 9)


class ProofPreviewUnitTests(unittest.TestCase):
    def _job(self) -> Job:
        return Job(
            id="j-c6",
            title="Data Engineer",
            company="Acme",
            location="Praha",
            requirements=[
                JobRequirement(skill="Python", kind="must_have", hardness="prerequisite"),
                JobRequirement(skill="Docker", kind="must_have", hardness="learnable"),
                JobRequirement(skill="Figma", kind="must_have", hardness="learnable"),
                JobRequirement(skill="Terraform", kind="nice_to_have", hardness="learnable"),
            ],
        )

    def _cand(self, provenance: dict[str, str]) -> MatchCandidate:
        return MatchCandidate(
            skills=list(provenance),
            skill_provenance=provenance,
            archetype="bau",
            provenance_default="self_declared",
        )

    def test_default_call_is_the_historical_scorer(self) -> None:
        cand, job = self._cand({"Python": "professional", "Docker": "self_declared"}), self._job()
        self.assertEqual(score_job(cand, job), score_job(cand, job, proof=None, proof_reasons=[]))

    def test_one_reasons_line_per_learnable_must_have(self) -> None:
        # Docker: a bare claim (discounted). Figma: not held at all (its gap weighs less).
        cand = self._cand({"Python": "professional", "Docker": "self_declared"})
        _result, reasons = _preview(cand, self._job())
        self.assertEqual([r.skill for r in reasons], ["Docker", "Figma"])
        docker, figma = reasons
        self.assertEqual(docker.code, "self_declared_discount")
        self.assertLess(docker.preview_credit, docker.base_credit)
        self.assertEqual(figma.code, "learnable_weight")
        self.assertEqual((figma.base_credit, figma.preview_credit), (0.0, 0.0))
        self.assertIn("missing", figma.text)
        self.assertEqual((figma.base_weight, figma.preview_weight), (1.0, PROOF_PREVIEW_WEIGHTS.learnable_must_weight))
        for r in reasons:
            self.assertIn(r.skill, r.text)
        self.assertTrue(proof_scorer_version().startswith(PROOF_PREVIEW_STAMP + "+lambda="))

    def test_bare_claim_on_a_learnable_must_pays_less_than_proof(self) -> None:
        job = self._job()
        claimed, _ = _preview(self._cand({"Python": "professional", "Docker": "self_declared"}), job)
        proven, _ = _preview(self._cand({"Python": "professional", "Docker": "professional"}), job)
        base_claimed = score_job(self._cand({"Python": "professional", "Docker": "self_declared"}), job)
        self.assertLess(claimed.skills_score, base_claimed.skills_score)
        self.assertGreater(proven.total, claimed.total)
        # The discounted claim stays a claim: unproven, never re-labelled missing.
        self.assertIn("Docker", claimed.unproven_skills)
        self.assertNotIn("Docker", claimed.missing_skills)

    def test_a_posting_with_no_learnable_must_is_untouched(self) -> None:
        job = Job(
            id="j-pre",
            title="Engineer",
            company="Acme",
            location="Praha",
            requirements=[JobRequirement(skill="Python", kind="must_have", hardness="prerequisite")],
        )
        cand = self._cand({"Python": "self_declared"})
        result, reasons = _preview(cand, job)
        self.assertEqual(reasons, [])
        self.assertEqual(result, score_job(cand, job))

    def test_preview_report_is_deterministic(self) -> None:
        records, jobs = E.load_candidates()[:8], load_corpus(_DEFAULT_CORPUS)[:15]
        a = E.run(records, jobs, preview=PROOF_PREVIEW_WEIGHTS)
        b = E.run(records, jobs, preview=PROOF_PREVIEW_WEIGHTS)
        self.assertEqual(a["fingerprint"], b["fingerprint"])
        self.assertNotEqual(a["fingerprint"], E.run(records, jobs)["fingerprint"])


if __name__ == "__main__":
    unittest.main()
