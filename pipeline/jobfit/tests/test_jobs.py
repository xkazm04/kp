from __future__ import annotations

import unittest

from pipeline.jobfit.jobs import (
    DEFAULT_POLICY,
    Job,
    compute_entry_profile,
    ingest_raw_ad,
    normalize_job,
    _EXTRACTION_PROMPT,
    _EXTRACTION_SYSTEM,
    _reinterpret_must,
    _requirements_from,
)
from pipeline.jobfit.taxonomy import ROLE_FAMILY_SET, role_band


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

# The SE-junior anchor band is ISPV-calibrated (data/salary_benchmarks.json) and
# shifts when the salary blend changes, so assert against the live anchor rather
# than a hardcoded number that would drift out of date.
SE_JUNIOR_BAND = list(role_band("software_engineering", "junior"))


class NormalizeTest(unittest.TestCase):
    def test_basic_shape(self) -> None:
        job = normalize_job(SE_JUNIOR)
        self.assertIsInstance(job, Job)
        self.assertEqual(job.role_family, "software_engineering")
        self.assertEqual(job.seniority, "junior")
        self.assertEqual(job.work_mode, "hybrid")
        self.assertEqual(job.salary_band, SE_JUNIOR_BAND)  # SE junior anchor band (ISPV-calibrated, data/salary_benchmarks.json)

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
        # An off-taxonomy value never stated a valid token, so it is a phantom default
        # (and SE_JUNIOR states no pay, so the anchor band is a phantom too).
        self.assertEqual(job.defaulted_fields, ["work_mode", "seniority", "salary_band"])

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


class DefaultedFieldsTest(unittest.TestCase):
    """A fully-stated ad records no phantom defaults; a row that fell back to a
    locale default flags exactly the fields it assumed, so matching/market-stats can
    tell a stated "Praha"/"medior" from one normalize_job invented."""

    def test_fully_stated_record_has_no_defaults(self) -> None:
        # SE_JUNIOR states company/location/work_mode/seniority explicitly; add the
        # stated pay range so the salary anchor phantom doesn't fire either.
        raw = {**SE_JUNIOR, "salary_min": 65000, "salary_max": 85000}
        self.assertEqual(normalize_job(raw).defaulted_fields, [])

    def test_missing_fields_are_recorded_and_filled_from_policy(self) -> None:
        raw = {**SE_JUNIOR}
        for field in ("company", "location", "work_mode", "seniority"):
            raw.pop(field, None)
        job = normalize_job(raw)
        # Reported in DEFAULT_POLICY order, stamped with the policy values, plus the
        # computed salary anchor phantom last (no pay stated).
        self.assertEqual(
            job.defaulted_fields, ["company", "location", "work_mode", "seniority", "salary_band"]
        )
        self.assertEqual(job.company, DEFAULT_POLICY["company"])
        self.assertEqual(job.location, DEFAULT_POLICY["location"])
        self.assertEqual(job.work_mode, DEFAULT_POLICY["work_mode"])
        self.assertEqual(job.seniority, DEFAULT_POLICY["seniority"])

    def test_blank_strings_count_as_missing(self) -> None:
        raw = {**SE_JUNIOR, "company": "   ", "location": ""}
        job = normalize_job(raw)
        self.assertIn("company", job.defaulted_fields)
        self.assertIn("location", job.defaulted_fields)
        self.assertNotIn("work_mode", job.defaulted_fields)  # stated "hybrid"

    def test_stated_value_equal_to_default_is_not_flagged(self) -> None:
        # An ad that actually says onsite/medior must read as STATED, not phantom.
        raw = {**SE_JUNIOR, "work_mode": "onsite", "seniority": "medior"}
        job = normalize_job(raw)
        self.assertEqual(job.work_mode, "onsite")
        self.assertEqual(job.seniority, "medior")
        self.assertNotIn("work_mode", job.defaulted_fields)
        self.assertNotIn("seniority", job.defaulted_fields)

    def test_defaulted_fields_survives_serialization_round_trip(self) -> None:
        raw = {**SE_JUNIOR, "salary_min": 65000, "salary_max": 85000}
        raw.pop("company", None)
        dumped = normalize_job(raw).model_dump(by_alias=True)
        self.assertEqual(dumped["defaultedFields"], ["company"])
        self.assertEqual(Job.model_validate(dumped).defaulted_fields, ["company"])


class SalaryProvenanceTest(unittest.TestCase):
    """A pay range the ad actually STATED (salary_min/salary_max) is honored —
    never replaced by the taxonomy anchor; an ad that stated none anchors AND
    records the "salary_band" phantom, so a posting/campaign can never advertise
    the market estimate as the employer's stated salary."""

    def test_stated_band_is_honored_and_not_defaulted(self) -> None:
        raw = {**SE_JUNIOR, "salary_min": 65000, "salary_max": 85000}
        job = normalize_job(raw)
        self.assertEqual(job.salary_band, [65000, 85000])
        self.assertNotIn("salary_band", job.defaulted_fields)

    def test_stated_band_rounds_to_the_shared_money_step(self) -> None:
        # The shared salary_band invariant applies: never spuriously precise.
        raw = {**SE_JUNIOR, "salary_min": 47300, "salary_max": 61800}
        job = normalize_job(raw)
        self.assertEqual(job.salary_band, [45000, 60000])
        self.assertNotIn("salary_band", job.defaulted_fields)

    def test_no_stated_salary_anchors_and_records_the_phantom(self) -> None:
        # SE_JUNIOR states no pay → anchor band, flagged as a phantom default.
        job = normalize_job(SE_JUNIOR)
        self.assertEqual(job.salary_band, SE_JUNIOR_BAND)  # SE junior anchor band (ISPV-calibrated, data/salary_benchmarks.json)
        self.assertIn("salary_band", job.defaulted_fields)

    def test_garbage_stated_band_falls_back_to_the_anchor(self) -> None:
        # Non-positive figures form no usable band → anchor + phantom provenance.
        raw = {**SE_JUNIOR, "salary_min": -1, "salary_max": 0}
        job = normalize_job(raw)
        self.assertEqual(job.salary_band, SE_JUNIOR_BAND)
        self.assertIn("salary_band", job.defaulted_fields)

    def test_half_stated_band_falls_back_to_the_anchor(self) -> None:
        # A lone figure ("od 65 000") is not a usable band — keep the anchor
        # rather than fabricating a min==max range the ad never stated.
        raw = {**SE_JUNIOR, "salary_min": 65000, "salary_max": None}
        job = normalize_job(raw)
        self.assertEqual(job.salary_band, SE_JUNIOR_BAND)
        self.assertIn("salary_band", job.defaulted_fields)


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

    def test_entry_signal_is_gender_symmetric_in_czech(self) -> None:
        # Czech marks gender in the noun itself, and _ENTRY_SIGNALS is matched as
        # substrings: the masculine-only surface form "začátečník" withheld the
        # early-career signal from the SAME ad written in the feminine
        # ("začátečnice"). is_entry_eligible is a hard knockout for early-career
        # candidates in matching.ko_filter, so the feminine ad rejected every
        # student it was welcoming. Stems must survive gender AND inflection.
        def profile(description: str):
            return compute_entry_profile(
                seniority="medior",
                employment_type="full-time",
                min_years=None,
                requirements=_requirements_from(["Excel"]),
                description=description,
            )

        masculine = profile("Hledáme začátečníky do týmu.")
        feminine = profile("Hledáme začátečnice do týmu.")
        self.assertTrue(masculine.is_entry_eligible)
        self.assertTrue(feminine.is_entry_eligible, "feminine Czech ad lost the entry signal")
        self.assertEqual(masculine.graduate_friendliness, feminine.graduate_friendliness)
        # Oblique cases too ("nováčka", not just the nominative "nováček").
        self.assertTrue(profile("Přijmeme nováčka do týmu.").is_entry_eligible)
        # …without over-matching: an ad welcoming nobody early-career stays out.
        self.assertFalse(profile("Vhodné pro účetní se zkušeností v oboru.").is_entry_eligible)

    def test_reinterpret_strips_years_and_seniority(self) -> None:
        out = _reinterpret_must("3+ years of React")
        self.assertNotRegex(out, r"\d")
        self.assertIn("React", out)
        self.assertTrue(out.lower().startswith("demonstrated foundation"))


class GraduateFriendlinessGoldenTest(unittest.TestCase):
    """Locks graduate_friendliness for representative junior/medior/senior specs so
    the score bands — which order the opportunities a zero-experience student sees —
    can't drift silently. Every constant exercised here is justified in
    docs/features/matching/README.md; keep the doc, these values, and the formula in
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


# Non-tech ads the OLD parser could never emit: the extraction prompt hard-capped
# role_family to software_engineering|data_ai|product_project, so a nurse/legal/
# trades posting was forced into a wrong tech family. These records carry the family
# the un-capped parser is now allowed to return.
NURSE = {
    "title": "Registered Nurse — ICU",
    "company": "Fakultní nemocnice",
    "location": "Brno",
    "work_mode": "onsite",
    "seniority": "medior",
    "role_family": "healthcare_clinical",
    "languages": ["Czech"],
    "min_education": "bachelor",
    "description": "Provide intensive nursing care; medication administration; patient monitoring.",
    "requirements": [
        {"skill": "Patient care", "kind": "must_have", "hardness": "prerequisite"},
        {"skill": "Medication administration", "kind": "must_have", "hardness": "prerequisite"},
    ],
}
LEGAL = {
    "title": "Compliance Officer",
    "company": "Retail Bank a.s.",
    "location": "Praha",
    "work_mode": "hybrid",
    "seniority": "senior",
    "role_family": "legal_compliance",
    "languages": ["Czech", "English"],
    "min_education": "master",
    "description": "Own AML/KYC compliance; regulatory reporting; policy governance.",
    "requirements": [
        {"skill": "Regulatory compliance", "kind": "must_have", "hardness": "prerequisite"},
        {"skill": "AML", "kind": "must_have", "hardness": "learnable"},
    ],
}
TRADES = {
    "title": "Industrial Electrician",
    "company": "Výrobní závod",
    "location": "Plzeň",
    "work_mode": "onsite",
    "seniority": "medior",
    "role_family": "skilled_trades",
    "languages": ["Czech"],
    "description": "Install and maintain industrial electrical systems; troubleshoot faults.",
    "requirements": [
        {"skill": "Electrical installation", "kind": "must_have", "hardness": "prerequisite"},
        {"skill": "Fault diagnosis", "kind": "must_have", "hardness": "learnable"},
    ],
}


class NonTechIngestTest(unittest.TestCase):
    """The parser is no longer capped to the three tech families (Direction 1): the
    prompt enumerates every taxonomy family, the system prompt is not tech/Czech-
    locked, and a non-tech ad keeps its correct role_family through normalize_job
    (with a real anchor salary band for that family)."""

    def test_system_prompt_is_not_tech_or_czech_locked(self) -> None:
        self.assertNotIn("Czech tech market", _EXTRACTION_SYSTEM)
        self.assertIn("any industry", _EXTRACTION_SYSTEM)

    def test_prompt_offers_the_full_family_catalog_not_a_tech_triplet(self) -> None:
        # The old literal enum was exactly these three, pipe-joined, and nothing else.
        self.assertNotIn(
            '"role_family": "software_engineering|data_ai|product_project"', _EXTRACTION_PROMPT
        )
        for fam in ("healthcare_clinical", "legal_compliance", "skilled_trades", "general_professional"):
            self.assertIn(fam, _EXTRACTION_PROMPT, f"prompt omits family {fam!r}")

    def test_nurse_legal_trades_ingest_with_correct_family(self) -> None:
        for raw, expected in ((NURSE, "healthcare_clinical"), (LEGAL, "legal_compliance"), (TRADES, "skilled_trades")):
            with self.subTest(family=expected):
                job = ingest_raw_ad(f"prose for {expected}", provider=FakeProvider(raw))
                self.assertIn(expected, ROLE_FAMILY_SET)
                self.assertEqual(job.role_family, expected)
                # A non-tech family still anchors a real market salary band + flags it.
                self.assertEqual(len(job.salary_band), 2)
                self.assertIn("salary_band", job.defaulted_fields)


class IngestTest(unittest.TestCase):
    def test_ingest_raw_ad_uses_provider(self) -> None:
        provider = FakeProvider(SE_JUNIOR)
        job = ingest_raw_ad("Some prose posting about a junior FE role...", provider=provider)
        self.assertEqual(job.title, "Junior Frontend Developer")
        self.assertIn("Some prose posting", provider.seen_prompt or "")

    def test_ingest_empty_rejected(self) -> None:
        with self.assertRaises(ValueError):
            ingest_raw_ad("  ", provider=FakeProvider(SE_JUNIOR))

    def test_ingest_asks_for_and_honors_stated_salary(self) -> None:
        # The extraction prompt must carry the salary keys (or stated pay is
        # discarded before normalize_job ever sees it), and a stated range must
        # land on the Job unflagged.
        provider = FakeProvider({**SE_JUNIOR, "salary_min": 65000, "salary_max": 85000})
        job = ingest_raw_ad("Nabízíme 65 000–85 000 Kč/měsíc...", provider=provider)
        self.assertIn('"salary_min"', provider.seen_prompt or "")
        self.assertEqual(job.salary_band, [65000, 85000])
        self.assertNotIn("salary_band", job.defaulted_fields)


if __name__ == "__main__":
    unittest.main()
