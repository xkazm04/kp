"""Displayed provenance never asserts evidence that was never recorded.

UAT 2026-07-20 (RECON-02, cs-jana-02, CS-L1-06). ``MatchResult`` used to emit
``matched_skill_provenance[s] = candidate.skill_provenance.get(s, provenance_default)``
where ``provenance_default`` is ``"professional"`` for every non-early-career
candidate. So a skill the candidate merely typed into a list — with nothing
recorded about how it was acquired — came back tagged ``professional``, the
JOINT-HIGHEST trust tier, and ``RecruiterCandidates``/``ComparisonCells``
rendered it as a confident PROFESSIONAL badge. That is not an omission; it is an
affirmative claim of verification the system never performed.

The emitted map is a DISPLAY channel: scoring reads ``candidate.skill_provenance``
and ``provenance_default`` directly (``matching.py`` score_skills / the dynamic
high-trust weighting), never this field. So making the display honest costs no
score movement, which these tests pin explicitly.

The chosen honest default is ``self_declared`` — the value every consumer ALREADY
falls back to when a skill is missing from the map (``prov[s] ?? "self_declared"``
in RecruiterCandidates, AnalysisSummaryModal and ComparisonCells). Python now
agrees with the UI instead of contradicting it, and no new locale key is needed.

FOLLOW-UP (later the same day): the separate, score-moving decision this file
predicted has since SHIPPED. ``taxonomy.DEFAULT_PROVENANCE`` is now
``self_declared`` too, and ``transform.build_match_candidate`` passes it for every
candidate rather than only early-career ones — so an unevidenced claim is
discounted (weight 0.4) instead of being credited at the joint-highest tier
alongside five years of production use. Because 1.0 x 0.4 = 0.4 sits under
``_MATCH_THRESHOLD`` (0.5), a bare exact claim now lands in ``unproven_skills``.
The tests below therefore state the professional tier EXPLICITLY wherever they
need the matched path; the two that are genuinely about the default have been
re-baselined onto the new contract, noted in their own docstrings.
"""

from __future__ import annotations

import unittest

from pipeline.jobfit.matching import MatchCandidate, score_job
from pipeline.jobfit.taxonomy import DEFAULT_PROVENANCE, PROVENANCE_WEIGHTS

from pipeline.jobfit.tests._helpers import mkjob


def _bau(**over) -> MatchCandidate:
    """An experienced (non-early-career) candidate — the population whose
    provenance_default USED to be ``professional`` and whose display was overstated.

    It now rides the shipped ``DEFAULT_PROVENANCE`` (``self_declared``) like every
    other candidate; callers that need the old full-credit behaviour pass
    ``provenance_default="professional"`` explicitly.
    """
    base = dict(
        skills=["Python", "Django"],
        seniority="senior",
        role_family="software_engineering",
        education_level="master",
        languages=["Czech", "English"],
        years_experience=8,
    )
    base.update(over)
    return MatchCandidate(**base)


class MatchedProvenanceHonestyTest(unittest.TestCase):
    def test_unrecorded_skill_is_not_displayed_as_professional(self) -> None:
        """The regression: a merely-listed skill must not come back 'professional'."""
        job = mkjob(requirements=[{"skill": "Python", "kind": "must_have", "hardness": "prerequisite"}])
        # The professional tier is explicit so the skill still reaches matched_skills
        # (the display map only covers matched skills). What is under test is the
        # DISPLAY value for a skill with nothing recorded, not the scoring default.
        result = score_job(_bau(provenance_default="professional"), job)
        self.assertIn("Python", result.matched_skill_provenance)
        self.assertNotEqual(
            result.matched_skill_provenance["Python"],
            "professional",
            "a skill with no recorded provenance must never be displayed as professionally evidenced",
        )
        self.assertEqual(result.matched_skill_provenance["Python"], "self_declared")

    def test_recorded_provenance_is_passed_through_untouched(self) -> None:
        """Only the DEFAULT changes — a genuinely recorded tier still displays as itself."""
        job = mkjob(requirements=[{"skill": "Python", "kind": "must_have", "hardness": "prerequisite"}])
        cand = _bau(skill_provenance={"Python": "professional"})
        self.assertEqual(score_job(cand, job).matched_skill_provenance["Python"], "professional")

    def test_observed_provenance_survives(self) -> None:
        """`observed` is minted only by the live-case / interview producers — the
        highest-trust stamp must never be flattened by the honest default."""
        job = mkjob(requirements=[{"skill": "Python", "kind": "must_have", "hardness": "prerequisite"}])
        cand = _bau(skill_provenance={"Python": "observed"})
        self.assertEqual(score_job(cand, job).matched_skill_provenance["Python"], "observed")

    def test_display_honesty_is_independent_of_the_scoring_tier(self) -> None:
        """The emitted map is display-only: scoring reads skill_provenance +
        provenance_default directly, so the DISPLAY value neither depends on nor
        reports the tier scoring actually applied.

        RE-BASELINED. This test originally pinned score-neutrality by asserting
        ``DEFAULT_PROVENANCE == "professional"`` — i.e. that the display fix had not
        touched the scoring contract. That assertion is now obsolete: the scoring
        default has since moved to ``self_declared`` (see the module docstring), and
        it moved on purpose. The invariant the test actually existed to protect is
        untouched and is now stated directly: for a skill with NOTHING recorded, the
        displayed tier is the constant ``self_declared`` at EVERY provenance_default,
        while the SCORE is not. Display honesty therefore remains free of — and no
        evidence for — whatever the scoring default happens to be.
        """
        job = mkjob(requirements=[{"skill": "Python", "kind": "must_have", "hardness": "prerequisite"}])

        # At the full-credit tier the claim reaches matched_skills...
        professional = score_job(_bau(provenance_default="professional"), job)
        self.assertEqual(PROVENANCE_WEIGHTS["professional"], 1.0)
        self.assertIn("Python", professional.matched_skills)
        self.assertGreater(professional.total, 0)
        # ...yet the display still refuses to claim evidence never recorded.
        self.assertEqual(professional.matched_skill_provenance["Python"], "self_declared")

        # The shipped default is now the honest tier, and it is a DISCOUNT: the same
        # candidate scores strictly lower. The display value above did not depend on
        # that in either direction — which is exactly the display/score separation.
        self.assertEqual(DEFAULT_PROVENANCE, "self_declared")
        self.assertLess(PROVENANCE_WEIGHTS[DEFAULT_PROVENANCE], 1.0)
        at_default = score_job(_bau(), job)
        self.assertLess(at_default.total, professional.total)

    def test_provenance_default_gates_matched_vs_unproven_not_just_the_label(self) -> None:
        """Why the SCORING default is a separate, score-moving decision.

        Discovered while pinning the display fix: `provenance_default` is not a
        cosmetic tier, it decides whether a claimed skill lands in `matched_skills`
        at all. At the professional default (weight 1.0) the must-have MATCHES; flip
        the same candidate to a self_declared default (0.4) and the identical claim
        drops below the match threshold into `unproven_skills` instead.

        So "make the score treat unevidenced claims honestly" is NOT the one-line
        change the display fix above was — it moves candidates between matched and
        unproven, which moves totals, shortlists and auto-reject outcomes. Pinned
        here so that consequence is visible to whoever picks that work up.

        That work has since been picked up: ``self_declared`` is now the SHIPPED
        default, so the second half of this test is no longer a hypothetical — it is
        current production behaviour, and the professional side is what now has to be
        asked for explicitly. The contract under test is unchanged.
        """
        job = mkjob(requirements=[{"skill": "Python", "kind": "must_have", "hardness": "prerequisite"}])
        at_professional = score_job(_bau(provenance_default="professional"), job)
        self.assertIn("Python", at_professional.matched_skills)
        at_self_declared = score_job(_bau(provenance_default="self_declared"), job)
        self.assertNotIn("Python", at_self_declared.matched_skills)
        self.assertIn("Python", at_self_declared.unproven_skills)


if __name__ == "__main__":
    unittest.main()
