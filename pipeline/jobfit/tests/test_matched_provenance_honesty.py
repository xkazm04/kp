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
"""

from __future__ import annotations

import unittest

from pipeline.jobfit.matching import MatchCandidate, score_job
from pipeline.jobfit.taxonomy import DEFAULT_PROVENANCE, PROVENANCE_WEIGHTS

from pipeline.jobfit.tests._helpers import mkjob


def _bau(**over) -> MatchCandidate:
    """An experienced (non-early-career) candidate — the population whose
    provenance_default is ``professional`` and whose display was overstated."""
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
        result = score_job(_bau(), job)
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

    def test_display_honesty_does_not_move_the_score(self) -> None:
        """The emitted map is display-only: scoring reads skill_provenance +
        provenance_default directly, so this fix must be score-neutral. If this
        ever fails, the change stopped being cosmetic and needs re-baselining."""
        job = mkjob(requirements=[{"skill": "Python", "kind": "must_have", "hardness": "prerequisite"}])
        cand = _bau()
        result = score_job(cand, job)
        # provenance_default is still professional for BAU (the SCORING contract),
        # even though nothing is displayed as professional.
        self.assertEqual(cand.provenance_default, DEFAULT_PROVENANCE)
        self.assertEqual(DEFAULT_PROVENANCE, "professional")
        # The full-credit weight is what scoring actually applied.
        self.assertEqual(PROVENANCE_WEIGHTS[cand.provenance_default], 1.0)
        self.assertGreater(result.total, 0)

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
        here so that consequence is visible to whoever picks that work up."""
        job = mkjob(requirements=[{"skill": "Python", "kind": "must_have", "hardness": "prerequisite"}])
        at_professional = score_job(_bau(), job)
        self.assertIn("Python", at_professional.matched_skills)
        at_self_declared = score_job(_bau(provenance_default="self_declared"), job)
        self.assertNotIn("Python", at_self_declared.matched_skills)
        self.assertIn("Python", at_self_declared.unproven_skills)


if __name__ == "__main__":
    unittest.main()
