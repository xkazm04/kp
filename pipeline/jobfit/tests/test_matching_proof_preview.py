"""Scoring C6 and C6b: the proof weights (kp's default scorer since ADR 0027), measured
by the C5 twin-cast harness against the historical arithmetic (``proof=None``).

Each C6 verify target is one test, written at the scope's own number. A target the
levers do not reach stays at the scope's number as ``expectedFailure`` rather than
being loosened, and the frontier actually reached is pinned beside it. Should a later
change meet one, the unexpected success turns the suite red, and whoever did it moves
the target test out of expectedFailure.

C6 (2026-10-18) met neither the free-claim gain nor the best-job crossings: the
stuffed twin's claims also moved prerequisites and nice-to-haves, the BAU personal
keyword overlap, and the early-career potential velocity. C6b closed those three
leaks (tests/test_matching_c6b_leaks.py): the free-claim gain target is now met
(+13.6659 -> +1.2283). The best-job crossings target was restated by the operator
(2026-10-18, ADR 0027) as "at most 2 of 66, each a 1-point step" and is met at 2/66
(from 7/66): dropping bare claims from velocity would reach 0/66 but costs two
protected students their strong tier, so the cap stays. It is a passing ratchet.
"""

from __future__ import annotations

import socket
import subprocess
import unittest
from unittest import mock

from pipeline.jobfit.eval import matching_era_eval as E
from pipeline.jobfit.jobs import Job, JobRequirement
from pipeline.jobfit.matching import (
    PROOF_SCORER_STAMP,
    LEGACY_SCORER_VERSION,
    PROOF_PREVIEW_WEIGHTS,
    MatchCandidate,
    ProofReason,
    load_corpus,
    _DEFAULT_CORPUS,
    proof_scorer_version,
    score_job,
)
from pipeline.jobfit import registry

# The C5 baseline (the historical arithmetic, proof=None) the proof weights are read against.
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
            cls.report = E.run(legacy=True)
        cls.pv = cls.report["results"]
        cls.cmp = cls.report["legacy"]["comparison"]

    # -- the six C6 targets -------------------------------------------------

    def test_target_free_claim_gain_at_most_2(self) -> None:
        # Met by C6b (2026-10-18): out of expectedFailure.
        self.assertLessEqual(self.pv["free_claim_gain"], 2.0)

    def test_frontier_free_claim_gain(self) -> None:
        # Reached: +18.3801 (legacy) -> +13.6659 (C6) -> +3.0495 (C6b leak a: bare claims on
        # prerequisites and nice-to-haves discounted) -> +2.0505 (leak b: the personal keyword
        # overlap gated) -> +1.2283 (leak c: bare claims capped in potential velocity).
        # Re-pin deliberately if the scorer moves.
        self.assertEqual(self.pv["free_claim_gain"], 1.2283)
        self.assertLess(self.pv["free_claim_gain"], BASE_FREE_CLAIM_GAIN)

    def test_target_free_claim_crossings_at_best_job_at_most_2_of_66(self) -> None:
        # Operator decision 2026-10-18 (ADR 0027): keep the velocity cap; at most 2 of 66,
        # each a 1-point step over a tier line.
        tc = self.pv["tier_crossings"]
        self.assertEqual(tc["best_job_pairs"], 66)
        self.assertLessEqual(tc["free_claim_at_best_job"], 2)
        self.assertEqual(len(tc["best_job_listed"]), tc["free_claim_at_best_job"])
        for c in tc["best_job_listed"]:
            step = c["to_total"] - c["from_total"]
            self.assertLessEqual(step, 1, f"{c['candidate']}@{c['job']} crosses by {step} points")

    def test_frontier_free_claim_crossings_at_best_job(self) -> None:
        # Reached: 9/66 (legacy) -> 7/66 (C6) -> 3/66 (C6b leak a) -> 3/66 (leak b) -> 2/66
        # (leak c). The two left are +1-point steps over a tier line (cand-031 @ job-018
        # 69 -> 70, cand-061 @ job-114 54 -> 55), both students on career_shift. Dropping
        # bare claims from velocity outright reaches 0/66 but costs two students their
        # strong tier at their best job, which the protected-cohort target forbids.
        tc = self.pv["tier_crossings"]
        self.assertEqual((tc["free_claim_at_best_job"], tc["best_job_pairs"]), (2, 66))

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

    def test_protected_tier_changes_are_pinned_and_each_carries_its_reasons(self) -> None:
        changes = self.cmp["protected_tier_changes"]
        by_arch = {a: sum(1 for c in changes if c["archetype"] == a) for a in ("student", "career_switcher")}
        self.assertEqual(by_arch, {"student": 13, "career_switcher": 3})
        self.assertFalse([c for c in changes if c["at_best_job"]])
        for c in changes:
            self.assertTrue(c["reasons"], c)

    def test_target_every_changed_score_has_a_reason(self) -> None:
        self.assertGreater(self.cmp["changed_scores"], 0)
        self.assertEqual(self.cmp["changed_without_reason"], 0)
        self.assertEqual(E.integrity_failures(self.report), [])

    # -- what the preview is ------------------------------------------------

    def test_proof_weights_read_hardness(self) -> None:
        # The legacy arithmetic ignores hardness (learnable lift > prerequisite lift).
        h = self.pv["hardness"]
        self.assertLess(h["learnable_lift_per_requirement"], h["prerequisite_lift_per_requirement"])

    def test_lambda_below_one_and_a_bare_claim_keeps_some_credit(self) -> None:
        self.assertLess(PROOF_PREVIEW_WEIGHTS.learnable_must_weight, 1.0)
        self.assertGreater(PROOF_PREVIEW_WEIGHTS.self_declared_learnable, 0.0)
        self.assertLess(PROOF_PREVIEW_WEIGHTS.self_declared_learnable, 1.0)

    def test_the_report_carries_both_scorer_stamps(self) -> None:
        self.assertEqual(self.report["stamp"], "SYNTHETIC")
        version = self.report["scorer_version"]
        self.assertTrue(version.endswith("+" + proof_scorer_version()))
        legacy = self.report["legacy"]["scorer_version"]
        self.assertTrue(legacy.endswith("+" + LEGACY_SCORER_VERSION))
        self.assertNotEqual(version, legacy)
        self.assertIn("proof weights (the default, ADR 0027)", E._format(self.report))

    def test_legacy_path_is_unchanged(self) -> None:
        # The legacy half of a --legacy report is the C5 baseline, unmoved by the adoption.
        r = self.report["legacy"]["results"]
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

    def test_proof_none_is_the_historical_scorer(self) -> None:
        cand, job = self._cand({"Python": "professional", "Docker": "self_declared"}), self._job()
        legacy = score_job(cand, job, proof=None, proof_reasons=[])
        self.assertEqual(legacy.scorer_version, LEGACY_SCORER_VERSION)
        self.assertGreater(legacy.skills_score, score_job(cand, job).skills_score)

    def test_one_reasons_line_per_learnable_must_have(self) -> None:
        # Docker: a bare claim (discounted). Figma: not held at all (its gap weighs less).
        cand = self._cand({"Python": "professional", "Docker": "self_declared"})
        _result, reasons = _preview(cand, self._job())
        # Terraform (a nice-to-have) is reached only by the bare Docker claim's adjacency,
        # which C6b (leak a) discounts too: its line is the discount, never a weight.
        self.assertEqual([r.skill for r in reasons], ["Docker", "Figma", "Terraform"])
        docker, figma, terraform = reasons
        self.assertEqual(terraform.code, "self_declared_discount")
        self.assertIn("nice-to-have", terraform.text)
        self.assertEqual(terraform.base_weight, terraform.preview_weight)
        self.assertEqual(docker.code, "self_declared_discount")
        self.assertLess(docker.preview_credit, docker.base_credit)
        self.assertEqual(figma.code, "learnable_weight")
        self.assertEqual((figma.base_credit, figma.preview_credit), (0.0, 0.0))
        self.assertIn("missing", figma.text)
        self.assertEqual((figma.base_weight, figma.preview_weight), (1.0, PROOF_PREVIEW_WEIGHTS.learnable_must_weight))
        for r in reasons:
            self.assertIn(r.skill, r.text)
        self.assertTrue(proof_scorer_version().startswith(PROOF_SCORER_STAMP + "-lam"))

    def test_bare_claim_on_a_learnable_must_pays_less_than_proof(self) -> None:
        job = self._job()
        claimed, _ = _preview(self._cand({"Python": "professional", "Docker": "self_declared"}), job)
        proven, _ = _preview(self._cand({"Python": "professional", "Docker": "professional"}), job)
        base_claimed = score_job(self._cand({"Python": "professional", "Docker": "self_declared"}), job, proof=None)
        self.assertLess(claimed.skills_score, base_claimed.skills_score)
        self.assertGreater(proven.total, claimed.total)
        # The discounted claim stays a claim: unproven, never re-labelled missing.
        self.assertIn("Docker", claimed.unproven_skills)
        self.assertNotIn("Docker", claimed.missing_skills)

    def test_a_posting_with_no_learnable_must_is_untouched_when_evidenced(self) -> None:
        job = Job(
            id="j-pre",
            title="Engineer",
            company="Acme",
            location="Praha",
            requirements=[JobRequirement(skill="Python", kind="must_have", hardness="prerequisite")],
        )
        cand = self._cand({"Python": "professional"})
        result, reasons = _preview(cand, job)
        self.assertEqual(reasons, [])
        self.assertEqual(result, score_job(cand, job))
        self.assertEqual(result.total, score_job(cand, job, proof=None).total)
        # C6b (leak a): before proof-weights.2 a bare claim here was untouched too.
        bare, bare_reasons = _preview(self._cand({"Python": "self_declared"}), job)
        self.assertEqual([(r.skill, r.code) for r in bare_reasons], [("Python", "self_declared_discount")])
        self.assertLess(bare.skills_score, score_job(self._cand({"Python": "self_declared"}), job, proof=None).skills_score)

    def test_preview_report_is_deterministic(self) -> None:
        records, jobs = E.load_candidates()[:8], load_corpus(_DEFAULT_CORPUS)[:15]
        a = E.run(records, jobs, legacy=True)
        b = E.run(records, jobs, legacy=True)
        self.assertEqual(a["fingerprint"], b["fingerprint"])
        self.assertNotEqual(a["fingerprint"], E.run(records, jobs)["fingerprint"])


if __name__ == "__main__":
    unittest.main()
