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
    score_personal,
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


class ScorePersonalOverlapTest(unittest.TestCase):
    """Description overlap is counted on whole, length-guarded words — not raw
    substrings — so short, ubiquitous tokens stop inflating personal fit
    (idea-c574596a-fix-substring-false-positives)."""

    @staticmethod
    def _personal(skills: list[str], description: str) -> float:
        # No job languages -> language coverage is a constant 1.0, isolating the
        # 0.5 * overlap term so any phantom hit shows up directly in the score.
        cand = MatchCandidate(skills=skills, seniority="senior", languages=["English"])
        job = mkjob(languages=[], description=description)
        return score_personal(cand, job)

    def test_short_tokens_do_not_match_as_substrings(self) -> None:
        # "go" in "good", "ai" in "training", "c" in "category" were all bogus
        # substring hits; length-guarded to nothing now -> pure 0.5 * lang_cov.
        self.assertEqual(self._personal(["Go", "AI", "C"], "Good engineers training for any category."), 0.5)

    def test_substring_inside_a_longer_word_is_not_a_hit(self) -> None:
        # "Rust" (len 4, survives the guard) must not match the "rust" in "trust".
        self.assertEqual(self._personal(["Rust"], "A team you can trust."), 0.5)

    def test_whole_word_skill_still_counts(self) -> None:
        # The same skill as a standalone word is a genuine overlap hit: one of five
        # -> overlap 0.2 -> 0.5 * 1.0 + 0.5 * 0.2.
        self.assertEqual(self._personal(["Rust"], "We build core services in Rust."), 0.6)


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


class MatchWeightOverrideTest(unittest.TestCase):
    """MAT1 — match() takes an optional recruiter weight override, resolved ONCE
    against the candidate's archetype and exposed (with the bounds) on the
    candidate block so the UI can seed bounded sliders."""

    def test_baseline_exposes_resolved_weights_and_bounds(self) -> None:
        job = mkjob(seniority="senior", languages=["English"])
        resp = match(SENIOR_PY, [job], limit=1)
        w = resp.candidate["weights"]
        bounds = resp.candidate["weightBounds"]
        self.assertEqual(set(w), {"skills", "career", "personal"})
        self.assertAlmostEqual(sum(w.values()), 1.0, places=3)  # resolved vector sums to 1
        # Each bound is a [min, max] pair the slider must respect, and the baseline
        # weight sits inside it.
        for k in ("skills", "career", "personal"):
            lo, hi = bounds[k]
            self.assertLessEqual(lo, w[k])
            self.assertLessEqual(w[k], hi)

    def test_override_is_clamped_to_bounds_and_renormalized(self) -> None:
        job = mkjob(seniority="senior", languages=["English"])
        # An adversarial all-into-skills proposal must be clamped to the ceiling and
        # the result must still sum to 1 within the bounds (never the raw 0.99).
        resp = match(SENIOR_PY, [job], limit=1, weights={"skills": 0.99, "career": 0.0, "personal": 0.0})
        w = resp.candidate["weights"]
        bounds = resp.candidate["weightBounds"]
        self.assertAlmostEqual(sum(w.values()), 1.0, places=3)
        self.assertLessEqual(w["skills"], bounds["skills"][1])
        self.assertGreaterEqual(w["personal"], bounds["personal"][0])

    def test_override_shifts_the_resolved_vector(self) -> None:
        # The deterministic contract: a skills-heavy override resolves to a higher
        # skills weight (and lower personal) than a personal-heavy one, so the
        # recruiter's intent is actually applied to the ranking. (Not a claim about
        # which TOTAL is higher — that depends on the candidate's dimension scores.)
        job = mkjob(seniority="senior", languages=["English"])
        skills_heavy = match(
            SENIOR_PY, [job], limit=1, weights={"skills": 0.6, "career": 0.2, "personal": 0.2}
        ).candidate["weights"]
        personal_heavy = match(
            SENIOR_PY, [job], limit=1, weights={"skills": 0.2, "career": 0.2, "personal": 0.6}
        ).candidate["weights"]
        self.assertGreater(skills_heavy["skills"], personal_heavy["skills"])
        self.assertGreater(personal_heavy["personal"], skills_heavy["personal"])
        # The headline total is a weighted sum of the same dimensions, so a shifted
        # vector generally produces a different score — confirm the override reaches it.
        same = match(SENIOR_PY, [job], limit=1).matches[0].total
        skewed = match(
            SENIOR_PY, [job], limit=1, weights={"skills": 0.6, "career": 0.2, "personal": 0.2}
        ).matches[0]
        self.assertEqual(skewed.score_breakdown[0].weight, round(100 * skills_heavy["skills"]))
        self.assertIsInstance(same, int)

    def test_malformed_override_falls_back_to_baseline(self) -> None:
        job = mkjob(seniority="senior", languages=["English"])
        baseline = match(SENIOR_PY, [job], limit=1).candidate["weights"]
        # An empty proposal is treated as "no override" -> archetype baseline.
        same = match(SENIOR_PY, [job], limit=1, weights={}).candidate["weights"]
        self.assertEqual(same, baseline)


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


class PotentialScoreClampTest(unittest.TestCase):
    """The 0-1 readiness contract is enforced at the MatchCandidate boundary so an
    out-of-range potential can't push `total` past 100 (clamp-out-of-range idea).
    The inline /api/match path forwards untrusted client JSON straight into
    MatchCandidate.model_validate, so the clamp must live on the model."""

    def test_above_range_potential_is_clamped_to_one(self) -> None:
        # Mirrors the untrusted inline /api/match path (camelCase alias, no limit-only validation).
        cand = MatchCandidate.model_validate(
            {"archetype": "student", "potentialScore": 9, "skills": ["Python"], "languages": ["English"]}
        )
        self.assertEqual(cand.potential_score, 1.0)

    def test_negative_potential_is_clamped_to_zero(self) -> None:
        self.assertEqual(MatchCandidate(archetype="student", potential_score=-3.0).potential_score, 0.0)

    def test_in_range_potential_is_unchanged(self) -> None:
        self.assertEqual(MatchCandidate(archetype="student", potential_score=0.7).potential_score, 0.7)

    def test_none_potential_stays_none(self) -> None:
        self.assertIsNone(MatchCandidate(archetype="student").potential_score)

    def test_out_of_range_potential_keeps_total_and_bar_within_0_100(self) -> None:
        # An adversarial readiness rides the early-career `career` slot verbatim; both
        # the headline total and the Potential breakdown bar must stay inside 0-100.
        job = mkjob(seniority="junior", description="Graduates welcome; training and mentoring provided.")
        cand = MatchCandidate.model_validate(
            {"archetype": "student", "potentialScore": 9, "skills": ["Python"], "languages": ["English"]}
        )
        m = score_job(cand, job)
        self.assertLessEqual(m.total, 100)
        self.assertGreaterEqual(m.total, 0)
        potential_bar = next(d for d in m.score_breakdown if d.key == "career")
        self.assertLessEqual(potential_bar.percent, 100)


if __name__ == "__main__":
    unittest.main()
