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
