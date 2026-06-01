from __future__ import annotations

import unittest

from pipeline.jobfit.matching import (
    KoReason,
    MatchCandidate,
    aggregate_ko_reasons,
    build_score_breakdown,
    ko_filter,
    match,
    score_career,
    score_job,
    score_skills,
)

from pipeline.jobfit.tests._helpers import (
    MIN_CONFIDENCE_SPREAD,
    PARTIAL_SKILL_SCORE,
    STRONG_SKILL_SCORE,
    mkjob,
)


SENIOR_PY = MatchCandidate(
    skills=["Python", "Django", "PostgreSQL", "AWS"],
    seniority="senior",
    role_family="software_engineering",
    education_level="master",
    languages=["Czech", "English"],
    years_experience=8,
)
JUNIOR = MatchCandidate(
    skills=["Python"],
    seniority="junior",
    role_family="software_engineering",
    education_level="bachelor",
    languages=["Czech", "English"],
)


class KoFilterTest(unittest.TestCase):
    def test_seniority_gap_blocks_junior_from_senior_only(self) -> None:
        job = mkjob(seniority="senior", description="Seasoned engineer to own the platform.")
        passed, reasons = ko_filter(JUNIOR, job)
        self.assertFalse(passed)
        self.assertTrue(any(r.key == "seniority" for r in reasons))

    def test_entry_eligible_role_bypasses_seniority_gap(self) -> None:
        job = mkjob(seniority="senior", description="Graduates welcome; training and mentoring provided.")
        passed, _ = ko_filter(JUNIOR, job)
        self.assertTrue(passed)

    def test_medior_to_senior_allowed(self) -> None:
        cand = MatchCandidate(seniority="medior", languages=["English"])
        job = mkjob(seniority="senior", description="Owns a service.")
        passed, _ = ko_filter(cand, job)
        self.assertTrue(passed)  # one-level stretch is allowed

    def test_education_floor(self) -> None:
        job = mkjob(min_education="master", languages=["English"])
        cand = MatchCandidate(seniority="senior", education_level="bachelor", languages=["English"])
        passed, reasons = ko_filter(cand, job)
        self.assertFalse(passed)
        self.assertTrue(any(r.key == "education" for r in reasons))

    def test_unknown_education_not_blocked(self) -> None:
        job = mkjob(min_education="master", languages=["English"])
        cand = MatchCandidate(seniority="senior", education_level="unknown", languages=["English"])
        passed, _ = ko_filter(cand, job)
        self.assertTrue(passed)

    def test_missing_language_blocks(self) -> None:
        job = mkjob(languages=["German"])
        passed, reasons = ko_filter(SENIOR_PY, job)
        self.assertFalse(passed)
        self.assertTrue(any(r.key == "language" for r in reasons))

    def test_empty_candidate_languages_are_lenient(self) -> None:
        job = mkjob(languages=["German"])
        cand = MatchCandidate(skills=["Python"], seniority="senior", languages=[])
        passed, _ = ko_filter(cand, job)
        self.assertTrue(passed)

    def test_work_mode_preference(self) -> None:
        job = mkjob(work_mode="onsite", languages=["English"])
        cand = MatchCandidate(seniority="senior", languages=["English"], preferred_work_modes=["remote", "hybrid"])
        passed, reasons = ko_filter(cand, job)
        self.assertFalse(passed)
        self.assertTrue(any(r.key == "work_mode" for r in reasons))


class ScoringTest(unittest.TestCase):
    def test_skills_score_and_matched(self) -> None:
        job = mkjob(
            requirements=[
                {"skill": "Python", "kind": "must_have", "hardness": "prerequisite"},
                {"skill": "Django", "kind": "must_have", "hardness": "prerequisite"},
                {"skill": "Kubernetes", "kind": "nice_to_have", "hardness": "learnable"},
            ]
        )
        score, matched, missing, strength = score_skills(SENIOR_PY, job)
        self.assertIn("Python", matched)
        self.assertIn("Django", matched)
        self.assertGreater(score, STRONG_SKILL_SCORE)
        # Kubernetes is only nice-to-have and unmatched, so it must NOT be a missing must-have.
        self.assertNotIn("Kubernetes", missing)
        # Every matched skill carries a strength in (0, 1]; an exact possession is 1.0.
        self.assertEqual(set(strength), set(matched))
        self.assertEqual(strength["Python"], 1.0)

    def test_hierarchy_partial_match_counts(self) -> None:
        # Candidate knows Next.js; role wants React -> specialization implies it.
        cand = MatchCandidate(skills=["Next.js"], seniority="medior", languages=["English"])
        job = mkjob(requirements=[{"skill": "React", "kind": "must_have", "hardness": "prerequisite"}])
        score, matched, _, strength = score_skills(cand, job)
        self.assertIn("React", matched)
        self.assertGreater(score, PARTIAL_SKILL_SCORE)
        # A taxonomy/sibling hit is a PARTIAL match: strength below an exact 1.0.
        self.assertLess(strength["React"], 1.0)

    def test_missing_must_have_listed(self) -> None:
        cand = MatchCandidate(skills=["Python"], seniority="senior", languages=["English"])
        job = mkjob(requirements=[{"skill": "Go", "kind": "must_have", "hardness": "prerequisite"}])
        _, _, missing, _ = score_skills(cand, job)
        self.assertIn("Go", missing)

    def test_career_same_family_beats_different(self) -> None:
        same = score_career(SENIOR_PY, mkjob(role_family="software_engineering", seniority="senior"))
        diff = score_career(SENIOR_PY, mkjob(role_family="data_ai", seniority="senior"))
        self.assertGreater(same, diff)


class ScoreBreakdownTest(unittest.TestCase):
    def test_breakdown_is_normalized_and_weight_aware(self) -> None:
        dims = build_score_breakdown("bau", skills=1.0, career=1.0, personal=0.5)
        self.assertEqual([d.key for d in dims], ["skills", "career", "personal"])
        # BAU weights (50/35/15) emitted as 0-100 percentages that sum to 100.
        self.assertEqual([d.weight for d in dims], [50, 35, 15])
        self.assertEqual(sum(d.weight for d in dims), 100)
        # percent is the raw 0-1 score scaled to 0-100; contribution = percent x weight.
        self.assertEqual([d.percent for d in dims], [100, 100, 50])
        self.assertEqual([d.contribution for d in dims], [50.0, 35.0, 7.5])

    def test_contributions_track_the_total(self) -> None:
        # The breakdown sums to the same total the scorer reports (within rounding),
        # so the bars reconstruct the headline number instead of drifting from it.
        job = mkjob(
            seniority="senior",
            languages=["English"],
            requirements=[{"skill": "Python", "kind": "must_have", "hardness": "prerequisite"}],
        )
        m = score_job(SENIOR_PY, job)
        self.assertEqual(len(m.score_breakdown), 3)
        self.assertAlmostEqual(sum(d.contribution for d in m.score_breakdown), m.total, delta=1.0)

    def test_labels_follow_the_archetype(self) -> None:
        # Early-career renames the slots (career -> Potential, personal -> Fit) so the
        # bar labels match what each slot actually measures for that profile.
        bau = [d.label for d in build_score_breakdown("bau", 0.5, 0.5, 0.5)]
        student = [d.label for d in build_score_breakdown("student", 0.5, 0.5, 0.5)]
        self.assertEqual(bau, ["Skills", "Career", "Personal"])
        self.assertEqual(student, ["Foundation", "Potential", "Fit"])


class MatchTest(unittest.TestCase):
    def test_ranking_and_meta(self) -> None:
        good = mkjob(
            title="Senior Python Engineer",
            role_family="software_engineering",
            seniority="senior",
            languages=["English"],
            requirements=[
                {"skill": "Python", "kind": "must_have", "hardness": "prerequisite"},
                {"skill": "Django", "kind": "must_have", "hardness": "prerequisite"},
            ],
        )
        weak = mkjob(
            title="Senior PM",
            role_family="product_project",
            seniority="senior",
            languages=["English"],
            requirements=[
                {"skill": "product management", "kind": "must_have", "hardness": "prerequisite"},
                {"skill": "stakeholder management", "kind": "must_have", "hardness": "prerequisite"},
            ],
        )
        # SENIOR_PY (Czech/English) is KO'd from a German-only role.
        blocked = mkjob(title="German-only role", seniority="senior", languages=["German"])

        resp = match(SENIOR_PY, [good, weak, blocked], limit=10)
        ids = [m.job_id for m in resp.matches]
        self.assertEqual(resp.meta["koFiltered"], 1)  # the German-only role
        self.assertEqual(resp.matches[0].title, "Senior Python Engineer")
        self.assertEqual(len(ids), 2)
        self.assertGreater(resp.matches[0].total, resp.matches[1].total)

    def test_confidence_band_widens_for_thin_profile(self) -> None:
        thin = MatchCandidate(skills=["Python"], seniority="junior", education_level="unknown", languages=[])
        job = mkjob(seniority="junior", description="Graduates welcome.")
        resp = match(thin, [job], limit=1)
        m = resp.matches[0]
        self.assertGreater(m.confidence.high - m.confidence.low, MIN_CONFIDENCE_SPREAD)
        # A wide band must surface the reasons it is wide, not just the numbers.
        self.assertEqual(m.confidence.level, "wide")
        self.assertIn("Education level unknown", m.confidence.drivers)
        self.assertIn("No languages listed", m.confidence.drivers)

    def test_confidence_band_is_tight_with_no_drivers(self) -> None:
        strong = MatchCandidate(
            skills=["Python", "Django", "PostgreSQL"],
            seniority="senior",
            education_level="master",
            languages=["English"],
        )
        job = mkjob(seniority="senior")
        resp = match(strong, [job], limit=1)
        m = resp.matches[0]
        self.assertEqual(m.confidence.level, "tight")
        self.assertEqual(m.confidence.drivers, [])

    def test_empty_result_explains_itself_via_ko_reasons(self) -> None:
        # SENIOR_PY (Czech/English) is KO'd from a German-only role -> 0 matches.
        resp = match(SENIOR_PY, [mkjob(title="DE-only", seniority="senior", languages=["German"])], limit=10)
        self.assertEqual(len(resp.matches), 0)
        self.assertEqual(resp.meta["koFiltered"], 1)
        reasons = resp.meta["koReasons"]
        self.assertEqual(reasons[0]["key"], "language")
        self.assertEqual(reasons[0]["count"], 1)
        self.assertTrue(reasons[0]["label"])  # candidate-facing clause is populated


class AggregateKoReasonsTest(unittest.TestCase):
    @staticmethod
    def _r(key: str) -> KoReason:
        # Reasons carry their category key from ko_filter; detail is irrelevant to rollup.
        return KoReason(key=key, detail=key)  # type: ignore[arg-type]

    def test_buckets_by_category_and_ranks_by_count(self) -> None:
        lists = [
            [self._r("language")],
            [self._r("language"), self._r("education")],
            [self._r("seniority")],
            [self._r("language")],
        ]
        agg = aggregate_ko_reasons(lists)
        by_key = {r["key"]: r["count"] for r in agg}
        self.assertEqual(by_key["language"], 3)
        self.assertEqual(by_key["education"], 1)
        self.assertEqual(by_key["seniority"], 1)
        self.assertEqual(agg[0]["key"], "language")  # most common blocker leads

    def test_counts_a_category_once_per_job(self) -> None:
        # A role missing two languages is still ONE role blocked on language.
        agg = aggregate_ko_reasons([[self._r("language"), self._r("language")]])
        self.assertEqual(len(agg), 1)
        self.assertEqual(agg[0]["count"], 1)

    def test_label_is_presentation_clause_for_key(self) -> None:
        # The key is authoritative; the label is a pure presentation clause.
        agg = aggregate_ko_reasons([[self._r("language")]])
        self.assertEqual(agg[0]["label"], "required a language not in the profile")

    def test_caps_to_top_n(self) -> None:
        lists = [
            [self._r("language")],
            [self._r("seniority")],
            [self._r("education")],
            [self._r("work_mode")],
            [self._r("early_career")],
        ]
        self.assertEqual(len(aggregate_ko_reasons(lists, top=3)), 3)


if __name__ == "__main__":
    unittest.main()
