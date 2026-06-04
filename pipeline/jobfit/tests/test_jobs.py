from __future__ import annotations

import unittest

from pipeline.jobfit.jobs import (
    Job,
    compute_entry_profile,
    ingest_raw_ad,
    normalize_job,
    _reinterpret_must,
    _requirements_from,
)


SE_JUNIOR = {
    "title": "Junior Frontend Developer",
    "company": "Acme s.r.o.",
    "location": "Praha",
    "work_mode": "hybrid",
    "employment_type": "full-time",
    "seniority": "junior",
    "role_family": "software_engineering",
    "languages": ["Czech", "English"],
    "min_years_experience": 0,
    "min_education": "bachelor",
    "description": "Join our team; mentoring and training provided for graduates.",
    "requirements": [
        {"skill": "React", "kind": "must_have", "hardness": "prerequisite"},
        {"skill": "TypeScript", "kind": "must_have", "hardness": "learnable"},
        {"skill": "k8s", "kind": "nice_to_have", "hardness": "learnable"},
    ],
}


class NormalizeTest(unittest.TestCase):
    def test_basic_shape(self) -> None:
        job = normalize_job(SE_JUNIOR)
        self.assertIsInstance(job, Job)
        self.assertEqual(job.role_family, "software_engineering")
        self.assertEqual(job.seniority, "junior")
        self.assertEqual(job.work_mode, "hybrid")
        self.assertEqual(job.salary_band, [45000, 70000])  # SE junior anchor band

    def test_requirement_terms_resolved(self) -> None:
        job = normalize_job(SE_JUNIOR)
        by_skill = {r.skill: r for r in job.requirements}
        self.assertEqual(by_skill["React"].term_id, "react")
        self.assertEqual(by_skill["k8s"].term_id, "kubernetes")  # alias resolution

    def test_invalid_enum_values_default(self) -> None:
        raw = {**SE_JUNIOR, "work_mode": "lunar", "seniority": "wizard"}
        job = normalize_job(raw)
        self.assertEqual(job.work_mode, "onsite")
        self.assertEqual(job.seniority, "medior")

    def test_string_requirements_default_kind_hardness(self) -> None:
        reqs = _requirements_from(["Python", "SQL"])
        self.assertEqual([r.kind for r in reqs], ["must_have", "must_have"])
        self.assertEqual([r.hardness for r in reqs], ["prerequisite", "prerequisite"])

    def test_role_family_fallback_when_missing(self) -> None:
        raw = {**SE_JUNIOR}
        raw.pop("role_family")
        job = normalize_job(raw)
        self.assertIn(job.role_family, {"software_engineering", "data_ai", "product_project"})
        self.assertEqual(job.role_family, "software_engineering")

    def test_id_slug_from_title(self) -> None:
        raw = {**SE_JUNIOR}
        raw.pop("title", None)
        raw["title"] = "Senior Data Engineer (Brno)"
        job = normalize_job(raw)
        self.assertTrue(job.id)
        self.assertNotIn(" ", job.id)


class EntryProfileTest(unittest.TestCase):
    def test_junior_is_entry_eligible_and_friendly(self) -> None:
        job = normalize_job(SE_JUNIOR)
        ep = job.entry_profile
        assert ep is not None
        self.assertTrue(ep.is_entry_eligible)
        self.assertGreaterEqual(ep.graduate_friendliness, 0.7)
        self.assertIn("TypeScript", ep.trainable_gaps)

    def test_senior_only_low_friendliness(self) -> None:
        ep = compute_entry_profile(
            seniority="senior",
            employment_type="full-time",
            min_years=5,
            requirements=_requirements_from(
                [{"skill": "Go", "kind": "must_have", "hardness": "prerequisite"}]
            ),
            description="We need a seasoned engineer to own our platform.",
        )
        self.assertFalse(ep.is_entry_eligible)
        self.assertLessEqual(ep.graduate_friendliness, 0.15)

    def test_entry_signal_in_description_overrides_seniority(self) -> None:
        ep = compute_entry_profile(
            seniority="medior",
            employment_type="full-time",
            min_years=2,
            requirements=_requirements_from(["Java"]),
            description="Absolventi vítáni; nabízíme zaškolení a mentoring.",
        )
        self.assertTrue(ep.is_entry_eligible)

    def test_reinterpret_strips_years_and_seniority(self) -> None:
        out = _reinterpret_must("3+ years of React")
        self.assertNotRegex(out, r"\d")
        self.assertIn("React", out)
        self.assertTrue(out.lower().startswith("demonstrated foundation"))


class GraduateFriendlinessGoldenTest(unittest.TestCase):
    """Locks graduate_friendliness for representative junior/medior/senior specs so
    the score bands — which order the opportunities a zero-experience student sees —
    can't drift silently. Every constant exercised here is justified in
    docs/GRADUATE_FRIENDLINESS.md; keep the doc, these values, and the formula in
    pipeline/jobfit/jobs.compute_entry_profile in sync on any deliberate change.
    """

    def _score(self, *, seniority, min_years, requirements, description, employment_type="full-time"):
        return compute_entry_profile(
            seniority=seniority,
            employment_type=employment_type,
            min_years=min_years,
            requirements=_requirements_from(requirements),
            description=description,
        )

    def test_junior_welcoming_scores_max(self) -> None:
        # 0.5 (junior) + 0.2 (years<=1) + 0.1 (1/2 must-haves learnable) + 0.2
        # (early-career language) = 1.0.
        ep = self._score(
            seniority="junior",
            min_years=0,
            requirements=[
                {"skill": "React", "kind": "must_have", "hardness": "prerequisite"},
                {"skill": "TypeScript", "kind": "must_have", "hardness": "learnable"},
                {"skill": "k8s", "kind": "nice_to_have", "hardness": "learnable"},
            ],
            description="Join our team; mentoring and training provided for graduates.",
        )
        self.assertEqual(ep.graduate_friendliness, 1.0)
        self.assertTrue(ep.is_entry_eligible)
        self.assertEqual(ep.trainable_gaps, ["TypeScript"])

    def test_medior_no_stated_years_plain_ad_is_capped(self) -> None:
        # Non-junior ad with no stated years assumes 3.0 (the conservative default),
        # so it isn't entry-eligible and the raw 0.3 is capped to the 0.15 ceiling.
        ep = self._score(
            seniority="medior",
            min_years=None,
            requirements=[
                {"skill": "Python", "kind": "must_have", "hardness": "prerequisite"},
                {"skill": "Docker", "kind": "must_have", "hardness": "learnable"},
            ],
            description="We need someone to own our backend services.",
        )
        self.assertEqual(ep.graduate_friendliness, 0.15)
        self.assertFalse(ep.is_entry_eligible)

    def test_medior_one_year_required_is_entry_midrange(self) -> None:
        # years<=1 opens the gate: 0.2 (medior) + 0.2 (years<=1) + 0.1 (1/2 learnable) = 0.5.
        ep = self._score(
            seniority="medior",
            min_years=1,
            requirements=[
                {"skill": "Python", "kind": "must_have", "hardness": "prerequisite"},
                {"skill": "Docker", "kind": "must_have", "hardness": "learnable"},
            ],
            description="We need someone to own our backend services.",
        )
        self.assertEqual(ep.graduate_friendliness, 0.5)
        self.assertTrue(ep.is_entry_eligible)

    def test_senior_only_floors_at_zero(self) -> None:
        # No seniority/years/learnable/signal credit -> 0.0; not entry, stays 0.0.
        ep = self._score(
            seniority="senior",
            min_years=5,
            requirements=[{"skill": "Go", "kind": "must_have", "hardness": "prerequisite"}],
            description="We need a seasoned engineer to own our platform.",
        )
        self.assertEqual(ep.graduate_friendliness, 0.0)
        self.assertFalse(ep.is_entry_eligible)

    def test_learnable_must_ratio_scales_the_score(self) -> None:
        # The learnable term is 0.2 * (learnable / all must-haves). On an otherwise
        # identical entry-eligible junior ad (0.5 junior + 0.2 years, no signal),
        # it moves the total from 0.7 (all prerequisite) to 0.9 (all learnable).
        base = dict(
            seniority="junior",
            min_years=0,
            description="We build payment systems for our platform team.",
        )
        all_prereq = self._score(
            **base,
            requirements=[
                {"skill": "Go", "kind": "must_have", "hardness": "prerequisite"},
                {"skill": "Rust", "kind": "must_have", "hardness": "prerequisite"},
            ],
        )
        half_learnable = self._score(
            **base,
            requirements=[
                {"skill": "Go", "kind": "must_have", "hardness": "prerequisite"},
                {"skill": "Rust", "kind": "must_have", "hardness": "learnable"},
            ],
        )
        all_learnable = self._score(
            **base,
            requirements=[
                {"skill": "Go", "kind": "must_have", "hardness": "learnable"},
                {"skill": "Rust", "kind": "must_have", "hardness": "learnable"},
            ],
        )
        self.assertEqual(all_prereq.graduate_friendliness, 0.7)
        self.assertEqual(half_learnable.graduate_friendliness, 0.8)
        self.assertEqual(all_learnable.graduate_friendliness, 0.9)


class FakeProvider:
    def __init__(self, payload: dict) -> None:
        self.payload = payload
        self.seen_prompt: str | None = None

    def complete_json(self, prompt: str, *, system: str | None = None):
        self.seen_prompt = prompt
        return self.payload


class IngestTest(unittest.TestCase):
    def test_ingest_raw_ad_uses_provider(self) -> None:
        provider = FakeProvider(SE_JUNIOR)
        job = ingest_raw_ad("Some prose posting about a junior FE role...", provider=provider)
        self.assertEqual(job.title, "Junior Frontend Developer")
        self.assertIn("Some prose posting", provider.seen_prompt or "")

    def test_ingest_empty_rejected(self) -> None:
        with self.assertRaises(ValueError):
            ingest_raw_ad("  ", provider=FakeProvider(SE_JUNIOR))


if __name__ == "__main__":
    unittest.main()
