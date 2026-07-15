"""Direction 2: the partial-match machinery is alive OUTSIDE tech.

Before this, all 129 skill-category terms voted into the three tech families, so
``score_skills`` fell back to raw string equality (0.0 or 1.0) for every non-tech
role. These tests prove a bank/compliance JD+CV pair now earns GRADUATED skill
credit through the new taxonomy hierarchy — a related-but-not-identical skill
scores strictly between 0 and 1 via a ``parents`` edge.
"""

from __future__ import annotations

import unittest

from pipeline.jobfit import taxonomy as tax
from pipeline.jobfit.matching import MatchCandidate, score_skills
from pipeline.jobfit.tests._helpers import mkjob


class NonTechHierarchyTest(unittest.TestCase):
    def test_kyc_is_a_specialization_of_aml(self) -> None:
        # kyc -> aml edge authored in taxonomy.json.
        self.assertIn("aml", tax.ancestors("kyc"))
        self.assertTrue(tax.is_subset_of("kyc", "aml"))

    def test_specialization_scores_high_partial(self) -> None:
        # Candidate did KYC; role wants AML. KYC implies AML competence -> 0.9.
        score = tax.term_match_score("kyc", "aml")
        self.assertGreater(score, 0.0)
        self.assertLess(score, 1.0)
        self.assertAlmostEqual(score, 0.9)

    def test_generalization_scores_low_partial(self) -> None:
        # Candidate did broad AML; role wants specifically KYC -> foundation only, 0.55.
        score = tax.term_match_score("aml", "kyc")
        self.assertGreater(score, 0.0)
        self.assertLess(score, 1.0)
        self.assertAlmostEqual(score, 0.55)

    def test_surface_forms_resolve_bilingually(self) -> None:
        # Both an English and a Czech surface form reach the same term.
        self.assertEqual(tax.resolve_term("know your customer"), "kyc")
        self.assertEqual(tax.resolve_term("poznej svého klienta"), "kyc")
        self.assertEqual(tax.resolve_term("fakturace"), "invoicing")


class BankComplianceScoreSkillsTest(unittest.TestCase):
    """End-to-end score_skills on a synthetic bank compliance officer."""

    def _candidate(self, skills: list[str]) -> MatchCandidate:
        return MatchCandidate(
            skills=skills,
            seniority="senior",
            role_family="finance_accounting",
            languages=["Czech", "English"],
            years_experience=6,
        )

    def test_related_skill_earns_graduated_credit(self) -> None:
        # CV: officer who ran KYC and sanctions screening (Czech surface forms).
        cand = self._candidate(["poznej svého klienta", "sankční prověřování"])
        # JD: AML must-have (a broader requirement the CV specializes).
        job = mkjob(
            role_family="finance_accounting",
            requirements=[{"skill": "anti-money laundering", "kind": "must_have", "hardness": "prerequisite"}],
        )
        score, matched, missing, strength, _unproven = score_skills(cand, job)
        # Graduated: strictly between a miss (0) and an exact match (1).
        self.assertGreater(score, 0.0)
        self.assertLess(score, 1.0)
        self.assertIn("anti-money laundering", matched)
        self.assertNotIn("anti-money laundering", missing)
        self.assertLess(strength["anti-money laundering"], 1.0)

    def test_unrelated_nontech_skill_is_a_true_miss(self) -> None:
        # An officer with only invoicing experience makes NO claim to AML.
        cand = self._candidate(["fakturace"])
        job = mkjob(
            role_family="finance_accounting",
            requirements=[{"skill": "aml", "kind": "must_have", "hardness": "prerequisite"}],
        )
        score, matched, missing, _, _unproven = score_skills(cand, job)
        self.assertEqual(score, 0.0)
        self.assertIn("aml", missing)

    def test_exact_nontech_match_is_full_credit(self) -> None:
        cand = self._candidate(["kyc"])
        job = mkjob(
            role_family="finance_accounting",
            requirements=[{"skill": "kyc", "kind": "must_have", "hardness": "prerequisite"}],
        )
        score, matched, _, strength, _unproven = score_skills(cand, job)
        self.assertAlmostEqual(score, 1.0)
        self.assertEqual(strength["kyc"], 1.0)


class LegalComplianceGraduatedCreditTest(unittest.TestCase):
    """Direction 1: the legal_compliance skill graph grants graduated credit."""

    def test_hierarchy_edges_exist(self) -> None:
        # Authored parent chains: pep_screening -> sanctions_screening -> aml,
        # internal_controls -> regulatory_compliance.
        self.assertIn("sanctions_screening", tax.ancestors("pep_screening"))
        self.assertIn("regulatory_compliance", tax.ancestors("internal_controls"))

    def test_specialization_scores_high_partial(self) -> None:
        # Candidate ran PEP screening; role wants (broader) sanctions screening.
        score = tax.term_match_score("pep_screening", "sanctions_screening")
        self.assertAlmostEqual(score, 0.9)

    def test_related_legal_skill_earns_graduated_credit(self) -> None:
        cand = MatchCandidate(
            skills=["prověření pep"],  # Czech surface for pep_screening
            seniority="senior", role_family="legal_compliance",
            languages=["Czech", "English"], years_experience=6,
        )
        job = mkjob(
            role_family="legal_compliance",
            requirements=[{"skill": "sanctions screening", "kind": "must_have", "hardness": "prerequisite"}],
        )
        score, matched, missing, strength, _unproven = score_skills(cand, job)
        self.assertGreater(score, 0.0)
        self.assertLess(score, 1.0)
        self.assertIn("sanctions screening", matched)
        self.assertNotIn("sanctions screening", missing)
        self.assertLess(strength["sanctions screening"], 1.0)

    def test_finance_legal_vote_sharing_no_duplicate_ids(self) -> None:
        # kyc/aml live in finance and are cross-voted (not duplicated) into legal.
        by_id = {t["id"]: t for t in tax._TERMS}
        for tid in ("aml", "kyc", "sanctions_screening"):
            votes = by_id[tid].get("role_family_votes", {})
            self.assertIn("finance_accounting", votes)
            self.assertIn("legal_compliance", votes)
        ids = [t["id"] for t in tax._TERMS]
        self.assertEqual(len(ids), len(set(ids)), "duplicate term ids")


class HrPeopleGraduatedCreditTest(unittest.TestCase):
    """Direction 1: the hr_people skill graph grants graduated credit."""

    def test_hierarchy_edges_exist(self) -> None:
        self.assertIn("recruiting", tax.ancestors("sourcing"))
        self.assertIn("learning_development", tax.ancestors("lms_admin"))

    def test_generalization_scores_low_partial(self) -> None:
        # Candidate did broad recruiting; role wants specifically sourcing.
        score = tax.term_match_score("recruiting", "sourcing")
        self.assertAlmostEqual(score, 0.55)

    def test_related_hr_skill_earns_graduated_credit(self) -> None:
        cand = MatchCandidate(
            skills=["vyhledávání kandidátů"],  # Czech surface for sourcing
            seniority="medior", role_family="hr_people",
            languages=["Czech", "English"], years_experience=4,
        )
        job = mkjob(
            role_family="hr_people",
            requirements=[{"skill": "recruiting", "kind": "must_have", "hardness": "prerequisite"}],
        )
        score, matched, missing, strength, _unproven = score_skills(cand, job)
        self.assertGreater(score, 0.0)
        self.assertLess(score, 1.0)
        self.assertIn("recruiting", matched)
        self.assertLess(strength["recruiting"], 1.0)

    def test_bilingual_surface_forms_resolve(self) -> None:
        self.assertEqual(tax.resolve_term("nábor"), "recruiting")
        self.assertEqual(tax.resolve_term("odměňování a benefity"), "compensation_benefits")


class HealthcareGraduatedCreditTest(unittest.TestCase):
    """Phase 3: the healthcare_clinical skill graph grants graduated credit and the
    unproven-reason machinery reports 'adjacency' for a near-miss sibling."""

    def test_hierarchy_edges_exist(self) -> None:
        # Authored chains: icu/emergency nursing -> nursing_practice;
        # advanced_life_support -> basic_life_support -> clinical_care.
        self.assertIn("nursing_practice", tax.ancestors("icu_nursing"))
        self.assertIn("basic_life_support", tax.ancestors("advanced_life_support"))

    def test_specialization_scores_high_partial(self) -> None:
        # Candidate ran ICU nursing; role wants (broader) nursing practice.
        self.assertAlmostEqual(tax.term_match_score("icu_nursing", "nursing_practice"), 0.9)

    def test_bilingual_surface_forms_resolve(self) -> None:
        self.assertEqual(tax.resolve_term("intenzivní péče"), "icu_nursing")
        self.assertEqual(tax.resolve_term("urgentní péče"), "emergency_nursing")
        self.assertEqual(tax.resolve_term("podávání léků"), "medication_administration")

    def test_sibling_near_miss_scores_0_4_and_classifies_adjacency(self) -> None:
        # CV: ICU nurse (Czech surface). JD: emergency nursing must-have — a sibling
        # under nursing_practice, so it scores the documented 0.4 (below threshold)
        # and lands in the unproven bucket tagged "adjacency", NOT "missing".
        self.assertAlmostEqual(tax.term_match_score("icu_nursing", "emergency_nursing"), 0.4)
        cand = MatchCandidate(
            skills=["intenzivní péče"],  # icu_nursing
            seniority="senior", role_family="healthcare_clinical",
            languages=["Czech", "English"], years_experience=7,
        )
        job = mkjob(
            role_family="healthcare_clinical",
            requirements=[{"skill": "emergency nursing", "kind": "must_have", "hardness": "prerequisite"}],
        )
        score, matched, missing, strength, unproven = score_skills(cand, job)
        self.assertAlmostEqual(score, 0.4)
        self.assertNotIn("emergency nursing", matched)
        self.assertNotIn("emergency nursing", strength)
        self.assertNotIn("emergency nursing", missing)  # near-miss, not a true gap
        self.assertEqual(unproven["emergency nursing"]["reason"], "adjacency")

    def test_specialization_earns_graduated_credit(self) -> None:
        cand = MatchCandidate(
            skills=["intenzivní péče"],  # icu_nursing, a specialization
            seniority="senior", role_family="healthcare_clinical",
            languages=["Czech", "English"], years_experience=7,
        )
        job = mkjob(
            role_family="healthcare_clinical",
            requirements=[{"skill": "nursing", "kind": "must_have", "hardness": "prerequisite"}],
        )
        score, matched, missing, strength, _unproven = score_skills(cand, job)
        self.assertGreater(score, 0.0)
        self.assertLess(score, 1.0)
        self.assertIn("nursing", matched)
        self.assertNotIn("nursing", missing)
        self.assertLess(strength["nursing"], 1.0)

    def test_unrelated_clinical_skill_is_a_true_miss(self) -> None:
        cand = MatchCandidate(
            skills=["fyzioterapie"],  # physiotherapy — no claim to nursing
            seniority="senior", role_family="healthcare_clinical",
            languages=["Czech"], years_experience=7,
        )
        job = mkjob(
            role_family="healthcare_clinical",
            requirements=[{"skill": "icu_nursing", "kind": "must_have", "hardness": "prerequisite"}],
        )
        score, _matched, missing, _strength, _unproven = score_skills(cand, job)
        self.assertEqual(score, 0.0)
        self.assertIn("icu_nursing", missing)


class SkilledTradesGraduatedCreditTest(unittest.TestCase):
    """Phase 3: the skilled_trades skill graph grants graduated credit and reports
    'adjacency' for a near-miss sibling."""

    def test_hierarchy_edges_exist(self) -> None:
        # mig/tig/arc welding are siblings under welding; cnc_machining -> machining.
        self.assertIn("welding", tax.ancestors("mig_welding"))
        self.assertIn("machining", tax.ancestors("cnc_machining"))

    def test_bilingual_surface_forms_resolve(self) -> None:
        self.assertEqual(tax.resolve_term("svařování mig"), "mig_welding")
        self.assertEqual(tax.resolve_term("elektroinstalace"), "electrical_work")
        self.assertEqual(tax.resolve_term("frézování"), "milling")

    def test_sibling_near_miss_scores_0_4_and_classifies_adjacency(self) -> None:
        # CV: MIG welder (Czech surface). JD: TIG welding must-have — a sibling under
        # welding, scoring 0.4 and classified "adjacency".
        self.assertAlmostEqual(tax.term_match_score("mig_welding", "tig_welding"), 0.4)
        cand = MatchCandidate(
            skills=["svařování mig"],  # mig_welding
            seniority="medior", role_family="skilled_trades",
            languages=["Czech"], years_experience=5,
        )
        job = mkjob(
            role_family="skilled_trades",
            requirements=[{"skill": "tig welding", "kind": "must_have", "hardness": "prerequisite"}],
        )
        score, matched, missing, strength, unproven = score_skills(cand, job)
        self.assertAlmostEqual(score, 0.4)
        self.assertNotIn("tig welding", matched)
        self.assertNotIn("tig welding", missing)
        self.assertEqual(unproven["tig welding"]["reason"], "adjacency")

    def test_specialization_earns_graduated_credit(self) -> None:
        cand = MatchCandidate(
            skills=["cnc obrábění"],  # cnc_machining, a specialization of machining
            seniority="medior", role_family="skilled_trades",
            languages=["Czech"], years_experience=5,
        )
        job = mkjob(
            role_family="skilled_trades",
            requirements=[{"skill": "machining", "kind": "must_have", "hardness": "prerequisite"}],
        )
        score, matched, _missing, strength, _unproven = score_skills(cand, job)
        self.assertGreater(score, 0.0)
        self.assertLess(score, 1.0)
        self.assertIn("machining", matched)
        self.assertLess(strength["machining"], 1.0)


class CreativeDesignGraduatedCreditTest(unittest.TestCase):
    """Phase 4 (last-families): the creative_design skill graph grants graduated
    credit and reports 'adjacency' for a near-miss sibling."""

    def test_hierarchy_edges_exist(self) -> None:
        # wireframing/prototyping are siblings under ux_design; ui_design -> ux_design.
        self.assertIn("ux_design", tax.ancestors("wireframing"))
        self.assertIn("ux_design", tax.ancestors("ui_design"))

    def test_bilingual_surface_forms_resolve(self) -> None:
        self.assertEqual(tax.resolve_term("drátěné modely"), "wireframing")
        self.assertEqual(tax.resolve_term("typografie"), "typography")
        self.assertEqual(tax.resolve_term("firemní identita"), "brand_identity")
        # A proper-noun tool is bilingual_exempt (identical in CZ + EN JDs).
        self.assertEqual(tax.resolve_term("figma"), "figma")

    def test_sibling_near_miss_scores_0_4_and_classifies_adjacency(self) -> None:
        # CV: wireframing (Czech surface). JD: prototyping must-have — a sibling under
        # ux_design, scoring the documented 0.4 and classified "adjacency", NOT missing.
        self.assertAlmostEqual(tax.term_match_score("wireframing", "prototyping"), 0.4)
        cand = MatchCandidate(
            skills=["drátěné modely"],  # wireframing
            seniority="medior", role_family="creative_design",
            languages=["Czech", "English"], years_experience=4,
        )
        job = mkjob(
            role_family="creative_design",
            requirements=[{"skill": "prototyping", "kind": "must_have", "hardness": "prerequisite"}],
        )
        score, matched, missing, strength, unproven = score_skills(cand, job)
        self.assertAlmostEqual(score, 0.4)
        self.assertNotIn("prototyping", matched)
        self.assertNotIn("prototyping", missing)
        self.assertEqual(unproven["prototyping"]["reason"], "adjacency")

    def test_specialization_earns_graduated_credit(self) -> None:
        cand = MatchCandidate(
            skills=["ui design"],  # ui_design, a specialization of ux_design
            seniority="medior", role_family="creative_design",
            languages=["Czech", "English"], years_experience=4,
        )
        job = mkjob(
            role_family="creative_design",
            requirements=[{"skill": "ux design", "kind": "must_have", "hardness": "prerequisite"}],
        )
        score, matched, _missing, strength, _unproven = score_skills(cand, job)
        self.assertGreater(score, 0.0)
        self.assertLess(score, 1.0)
        self.assertIn("ux design", matched)
        self.assertLess(strength["ux design"], 1.0)


class LifeSciencesGraduatedCreditTest(unittest.TestCase):
    """Phase 4 (last-families): the life_sciences_research skill graph grants
    graduated credit and reports 'adjacency' for a near-miss sibling. These new
    skill terms strengthen life-sci routing without disturbing the data_ai boundary
    (the `scientist` skill term still votes data_ai; the merge was deliberately not
    done)."""

    def test_hierarchy_edges_exist(self) -> None:
        # hplc/gas_chromatography are siblings under chromatography; qpcr -> pcr.
        self.assertIn("chromatography", tax.ancestors("hplc"))
        self.assertIn("pcr", tax.ancestors("qpcr"))

    def test_bilingual_surface_forms_resolve(self) -> None:
        self.assertEqual(tax.resolve_term("chromatografie"), "chromatography")
        self.assertEqual(tax.resolve_term("kvantitativní pcr"), "qpcr")
        self.assertEqual(tax.resolve_term("buněčné kultury"), "cell_culture")

    def test_sibling_near_miss_scores_0_4_and_classifies_adjacency(self) -> None:
        # CV: HPLC (Czech surface). JD: gas chromatography must-have — a sibling under
        # chromatography, scoring 0.4 and classified "adjacency".
        self.assertAlmostEqual(tax.term_match_score("hplc", "gas_chromatography"), 0.4)
        cand = MatchCandidate(
            skills=["kapalinová chromatografie"],  # hplc
            seniority="senior", role_family="life_sciences_research",
            languages=["Czech", "English"], years_experience=7,
        )
        job = mkjob(
            role_family="life_sciences_research",
            requirements=[{"skill": "gas chromatography", "kind": "must_have", "hardness": "prerequisite"}],
        )
        score, matched, missing, strength, unproven = score_skills(cand, job)
        self.assertAlmostEqual(score, 0.4)
        self.assertNotIn("gas chromatography", matched)
        self.assertNotIn("gas chromatography", missing)
        self.assertEqual(unproven["gas chromatography"]["reason"], "adjacency")

    def test_specialization_earns_graduated_credit(self) -> None:
        cand = MatchCandidate(
            skills=["kvantitativní pcr"],  # qpcr, a specialization of pcr
            seniority="senior", role_family="life_sciences_research",
            languages=["Czech", "English"], years_experience=7,
        )
        job = mkjob(
            role_family="life_sciences_research",
            requirements=[{"skill": "pcr", "kind": "must_have", "hardness": "prerequisite"}],
        )
        score, matched, _missing, strength, _unproven = score_skills(cand, job)
        self.assertGreater(score, 0.0)
        self.assertLess(score, 1.0)
        self.assertIn("pcr", matched)
        self.assertLess(strength["pcr"], 1.0)


class GeneralProfessionalRoutingStabilityTest(unittest.TestCase):
    """Phase 4: general_professional meta-skills resolve (so they earn graded credit
    instead of the token fallback) but carry a LOW vote weight, so they never hijack
    a specialist family's classification."""

    def test_meta_skills_resolve(self) -> None:
        self.assertEqual(tax.resolve_term("komunikace"), "communication_skill")
        self.assertEqual(tax.resolve_term("teamwork"), "teamwork")
        self.assertEqual(tax.resolve_term("stanovení priorit"), "prioritization_skill")

    def test_meta_skill_vote_weight_is_low(self) -> None:
        by_id = {t["id"]: t for t in tax._TERMS}
        for tid in ("communication_skill", "teamwork", "ownership", "prioritization_skill"):
            votes = by_id[tid].get("role_family_votes", {})
            self.assertEqual(set(votes), {"general_professional"})
            self.assertLessEqual(votes["general_professional"], 0.25)

    def test_tech_cv_with_meta_skills_still_routes_to_tech(self) -> None:
        # A tech CV loaded with ubiquitous meta-skills must NOT flip to
        # general_professional — the specialist signal dominates the low meta votes.
        self.assertEqual(
            tax.classify_role_family(
                ["python", "react", "kubernetes", "communication skills", "teamwork", "ownership"],
                "Senior software engineer building backend services in Python with "
                "strong communication, teamwork and ownership.",
            ),
            "software_engineering",
        )

    def test_generic_office_cv_routes_to_general_professional(self) -> None:
        self.assertEqual(
            tax.classify_role_family(
                ["communication skills", "teamwork", "time management", "planning", "reporting"],
                "Office coordinator handling administration, planning and stakeholder communication.",
            ),
            "general_professional",
        )


if __name__ == "__main__":
    unittest.main()
