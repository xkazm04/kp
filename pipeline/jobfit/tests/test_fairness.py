"""Enforce the v2 matching metrics + fairness probes in CI.

Reuses the deterministic eval (eval/matching_eval.py) so the same thresholds and
probes that produce the report also gate the test suite. No API key required.
"""

from __future__ import annotations

import unittest

from pipeline.jobfit.eval.matching_eval import (
    SCENARIOS,
    THRESHOLDS,
    Report,
    ScenarioResult,
    _senior_backend,
    _student_frontend,
    run,
)
from pipeline.jobfit.matching import fairness_matrix, load_corpus, match, propose_weights
from pipeline.jobfit.profile import Evidence
from pipeline.jobfit.transform import build_match_candidate


class GateHonestyTest(unittest.TestCase):
    """The gate must not pass vacuously on an UNMEASURED fairness axis (bug-ui-scan
    2026-06-20): entry_precision used to default to 1.0 when no early-career scenario
    measured it, turning a coverage gap into an accuracy PASS."""

    def _scenario(self, entry: float | None) -> ScenarioResult:
        return ScenarioResult(
            name="x", detected_archetype="bau", archetype_ok=True,
            entry_precision=entry, role_relevance_at5=1.0, top_total=5,
        )

    def test_unmeasured_entry_precision_is_omitted_not_1(self) -> None:
        # Only non-early-career scenarios → entry_precision was never measured.
        report = Report(scenarios=[self._scenario(None)], probes=[])
        self.assertNotIn("entry_precision", report.aggregate())  # never substitute 1.0

    def test_unmeasured_gated_metric_fails(self) -> None:
        # entry_precision is gated (THRESHOLDS) but unmeasured → must FAIL, not pass.
        report = Report(scenarios=[self._scenario(None)], probes=[])
        self.assertFalse(report.passes())

    def test_measured_entry_precision_is_reported(self) -> None:
        report = Report(scenarios=[self._scenario(1.0)], probes=[])
        self.assertEqual(report.aggregate().get("entry_precision"), 1.0)


class MatchingEvalTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.report = run()

    def test_metrics_meet_thresholds(self) -> None:
        agg = self.report.aggregate()
        for metric, threshold in THRESHOLDS.items():
            self.assertGreaterEqual(agg.get(metric, 0.0), threshold, f"{metric} below {threshold}")

    def test_archetypes_routed_correctly(self) -> None:
        for s in self.report.scenarios:
            with self.subTest(scenario=s.name):
                self.assertTrue(s.archetype_ok, f"{s.name} routed to {s.detected_archetype}")

    def test_early_career_matches_all_entry_eligible(self) -> None:
        for s in self.report.scenarios:
            if s.entry_precision is not None:
                with self.subTest(scenario=s.name):
                    self.assertEqual(s.entry_precision, 1.0, f"{s.name} returned a non-entry role")

    def test_fairness_probes_pass(self) -> None:
        for p in self.report.probes:
            with self.subTest(probe=p.name):
                self.assertTrue(p.passed, f"fairness probe failed: {p.name} — {p.detail}")

    def test_overall_passes(self) -> None:
        self.assertTrue(self.report.passes())

    def test_scenarios_span_non_tech_families(self) -> None:
        # The eval used to fixture EXCLUSIVELY on software_engineering / data_ai, so
        # the archetype -> weights -> confidence -> fairness interplay was measured on
        # tech only and a non-tech regression would ship green. Pin the coverage so it
        # cannot be quietly deleted back to tech-only.
        families = {s.profile.role_family for s in SCENARIOS}
        self.assertTrue(
            {"finance_accounting", "customer_support", "sales_marketing"} <= families,
            f"non-tech eval coverage lost: {sorted(families)}",
        )
        # …and the non-tech scenarios must span archetypes, not all be one shape.
        non_tech = {
            s.expected_archetype
            for s in SCENARIOS
            if s.profile.role_family not in ("software_engineering", "data_ai", "product_project")
        }
        self.assertTrue({"bau", "career_switcher"} <= non_tech, non_tech)



# Two CVs that differ ONLY in the writer's gender: the Czech feminine surname suffix
# (-ová), the gendered honorific (pan / paní), the gendered pronoun, and the
# gender-inflected Czech job title. Each pair is (masculine, feminine); the
# accent-stripped pair is what a lossy PDF extract actually produces, and the English
# pair pins that the axis is not Czech-only.
_GENDER_PAIRS = (
    ("Jan Novák", "Jana Nováková"),
    ("Jan Novak", "Jana Novakova"),          # accent-stripped (lossy extract)
    ("Ing. Jan Novák", "Ing. Jana Nováková"),
    ("John Smith", "Jane Smith"),
)
_GENDERED_PROSE = (
    ("pan Jan Novák; on byl vedoucí vývojář týmu", "paní Jana Nováková; ona byla vedoucí vývojářka týmu"),
    ("Mr Smith led the team; his work shipped", "Ms Smith led the team; her work shipped"),
)


class GenderNeutralityTest(unittest.TestCase):
    """AUDIT 2026-08-22 — the fairness axis this file never measured.

    The four probes above cover pedigree, socioeconomic background, language and
    monotonicity. GENDER was absent, and the candidate's name reaches the matcher
    (``build_match_candidate`` sets ``label=profile.display_name`` and copies the CV
    prose into ``experience_highlights``) — so a gender-coded token is physically
    present in the scored payload, unlike ``education_detail``, which the pedigree
    probe proves is dropped.

    MUTATION THAT STAYED GREEN: a four-point penalty in ``matching.score_job`` for a
    candidate whose label ends in the Czech feminine surname suffix ``-ová`` — i.e.
    every Czech woman scored 4 points below an otherwise byte-identical man — left all
    233 tests in this context passing. That is the same defect shape as the ``-ová``
    penalty on the CV headline score found earlier in this sweep.

    The invariant: gender-coded text in the candidate payload must move NOTHING. Both
    deterministic ranking engines are covered — ``match()`` (which routes through
    ``score_job``) and ``fairness_matrix()`` (which bypasses ``score_job`` for
    ``_score_dimensions``/``_weighted_total``), because a penalty planted in either one
    alone is invisible to the other.
    """

    @classmethod
    def setUpClass(cls) -> None:
        cls.jobs = load_corpus()
        assert cls.jobs, "job corpus is empty — gender neutrality cannot be measured"

    def _profile(self, builder, name: str, prose: str | None = None):
        profile = builder()
        profile.display_name = name
        if prose is not None:
            profile.evidence = [
                *profile.evidence,
                Evidence(kind="job", title=prose, text=prose),
            ]
        return build_match_candidate(profile)

    def _ranking(self, candidate) -> list[tuple[str, int]]:
        return [(m.job_id, m.total) for m in match(candidate, self.jobs, limit=50).matches]

    def test_gendered_name_does_not_move_the_ranking(self) -> None:
        for builder in (_student_frontend, _senior_backend):
            for masculine, feminine in _GENDER_PAIRS:
                with self.subTest(builder=builder.__name__, pair=(masculine, feminine)):
                    self.assertEqual(
                        self._ranking(self._profile(builder, masculine)),
                        self._ranking(self._profile(builder, feminine)),
                        f"the ranking changed between {masculine!r} and {feminine!r} — "
                        "the candidate's gender moved the score",
                    )

    def test_gendered_prose_in_the_cv_does_not_move_the_ranking(self) -> None:
        # Honorifics, pronouns and gender-inflected role titles ride into
        # experience_highlights verbatim, so they are scored text too.
        for masculine, feminine in _GENDERED_PROSE:
            with self.subTest(pair=(masculine, feminine)):
                self.assertEqual(
                    self._ranking(self._profile(_senior_backend, "Candidate", masculine)),
                    self._ranking(self._profile(_senior_backend, "Candidate", feminine)),
                    f"gendered CV prose moved the score: {masculine!r} vs {feminine!r}",
                )

    def test_naming_a_candidate_at_all_does_not_move_the_ranking(self) -> None:
        # Control on the same axis: an unnamed candidate and a named one must score
        # identically, so "no name" is not itself an advantage or a penalty.
        anonymous = self._ranking(self._profile(_senior_backend, "Candidate"))
        for _masculine, feminine in _GENDER_PAIRS:
            with self.subTest(name=feminine):
                self.assertEqual(anonymous, self._ranking(self._profile(_senior_backend, feminine)))

    def test_gender_neutral_in_the_group_ranking_engine_too(self) -> None:
        # fairness_matrix does NOT call score_job — it recombines _score_dimensions
        # with each scheme's weights — so it needs its own assertion or a penalty
        # planted on that path stays invisible.
        job = self.jobs[0]
        pairs_m = []
        pairs_f = []
        for builder, (masculine, feminine) in zip(
            (_student_frontend, _senior_backend, _senior_backend), _GENDER_PAIRS
        ):
            cm = self._profile(builder, masculine)
            cf = self._profile(builder, feminine)
            pairs_m.append((cm, propose_weights(cm, job)[0]))
            pairs_f.append((cf, propose_weights(cf, job)[0]))
        res_m = fairness_matrix(pairs_m, job)
        res_f = fairness_matrix(pairs_f, job)
        self.assertEqual(res_m["matrix"], res_f["matrix"], "the group-compare matrix is gender-sensitive")
        self.assertEqual(res_m["own"], res_f["own"])


if __name__ == "__main__":
    unittest.main()
