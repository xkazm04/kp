"""The seeker's STATED direction in the career dimension (lot A2.1).

The contract under test:

* a posting title is read against the stated targetTitles whole-word, case- and
  diacritics-folded, with seniority words and parentheticals ignored and a tiny
  curated alias table (target_titles.py);
* with a stated target, the career score's FAMILY term reads the direction —
  1.0 for a title hit, 0.75 for a target-family hit, 0.35 otherwise (the CV's past
  family included); the seniority term is unchanged;
* the skills dimension never moves — direction is a preference fit, never a claim of
  possession;
* with NO stated target every score is byte-identical to the historical rule and the
  result carries no ``targetAlignment`` (the recruiter /api/match path never passes
  preferences).
"""

from __future__ import annotations

import unittest

from pipeline.jobfit.matching import (
    MatchCandidate,
    TargetAlignment,
    _SENIORITY_RANK,
    match,
    score_career,
    score_job,
    score_motivation,
    _target_alignment as target_alignment,
)
from pipeline.jobfit.posting_structure import structure_posting
from pipeline.jobfit.profile import CandidateProfileV2, Evidence, SkillClaim
from pipeline.jobfit.target_titles import matched_target_title, target_families, title_tokens
from pipeline.jobfit.tests._helpers import mkjob
from pipeline.jobfit.transform import apply_preferences, build_match_candidate


def _legacy_career(candidate: MatchCandidate, job) -> float:
    """The career rule as it stood before targets existed — the identity baseline."""
    family = 1.0 if candidate.role_family == job.role_family else 0.35
    prox = 1.0 - abs(_SENIORITY_RANK.get(candidate.seniority, 2) - _SENIORITY_RANK.get(job.seniority, 2)) / 3.0
    return round(0.6 * family + 0.4 * max(0.0, prox), 4)


class TitleMatchingTest(unittest.TestCase):
    def test_whole_word_and_level_words_ignored(self) -> None:
        self.assertEqual(matched_target_title("Senior AI Engineer (LLM)", ["AI Engineer"]), "AI Engineer")
        self.assertEqual(matched_target_title("Lead AI Engineer", ["Junior AI Engineer"]), "Junior AI Engineer")
        self.assertEqual(matched_target_title("Applied AI Engineer", ["AI Engineer"]), "AI Engineer")
        # Whole words only: no "ai" inside another word.
        self.assertIsNone(matched_target_title("Email Engineer", ["AI Engineer"]))
        self.assertIsNone(matched_target_title("Engineer AI", ["AI Engineer"]))

    def test_case_and_diacritics_fold(self) -> None:
        self.assertEqual(matched_target_title("SENIOR DATOVÝ ANALYTIK (m/ž)", ["datovy analytik"]), "datovy analytik")
        self.assertEqual(title_tokens("Senior Datový Analytik [Praha]"), ("datovy", "analytik"))

    def test_alias_table_reads_synonyms_as_one_target(self) -> None:
        for posting in ("ML Engineer", "LLM Engineer", "Machine Learning Engineer", "GenAI Engineer", "AI/ML Engineer"):
            self.assertEqual(matched_target_title(posting, ["AI Engineer"]), "AI Engineer", posting)
        # Symmetric: a seeker who said "ML Engineer" sees an "AI Engineer" posting.
        self.assertEqual(matched_target_title("AI Engineer", ["ML Engineer"]), "ML Engineer")
        # Relatedness is NOT synonymy: a data analyst is not an AI engineer.
        self.assertIsNone(matched_target_title("Data Analyst", ["AI Engineer"]))

    def test_a_level_word_alone_is_no_target(self) -> None:
        self.assertIsNone(matched_target_title("Senior Accountant", ["Senior"]))

    def test_target_families_stated_then_title_routed(self) -> None:
        self.assertEqual(target_families(["AI Engineer"], []), ["data_ai"])
        # The alias group routes GenAI to the AI engineer it names.
        self.assertEqual(target_families(["GenAI Engineer"], []), ["data_ai"])
        # Unknown stated families are dropped; stated order leads.
        self.assertEqual(target_families(["AI Engineer"], ["product_project", "not_a_family"]), ["product_project", "data_ai"])
        # A signal-free title routes nowhere rather than to the default family.
        self.assertEqual(target_families(["Astronaut"], []), [])


class ApplyPreferencesTargetsTest(unittest.TestCase):
    def test_targets_are_carried(self) -> None:
        c = apply_preferences(MatchCandidate(), {"targetTitles": [" AI Engineer "], "targetRoleFamilies": ["data_ai"]})
        self.assertEqual(c.target_titles, ["AI Engineer"])
        self.assertEqual(c.target_role_families, ["data_ai"])

    def test_empty_targets_are_inert(self) -> None:
        base = MatchCandidate()
        self.assertEqual(apply_preferences(base, {"targetTitles": [], "targetRoleFamilies": []}), base)


class NoTargetIdentityTest(unittest.TestCase):
    """The recruiter path (no preferences) must score exactly as before."""

    JOBS = [
        mkjob(title="AI Engineer", role_family="data_ai", seniority="medior"),
        mkjob(title="Backend Developer", role_family="software_engineering", seniority="lead"),
        mkjob(title="Accountant", role_family="finance_accounting", seniority="junior"),
    ]

    def test_career_is_the_historical_rule(self) -> None:
        for cand in (MatchCandidate(), MatchCandidate(role_family="data_ai", seniority="senior")):
            for job in self.JOBS:
                self.assertEqual(score_career(cand, job), _legacy_career(cand, job))
                self.assertIsNone(target_alignment(cand, job))

    def test_results_identical_and_carry_no_alignment(self) -> None:
        cand = MatchCandidate(skills=["Python"], role_family="data_ai")
        for prefs in (None, {}, {"targetTitles": [], "targetRoleFamilies": []}, {"targetTitles": ["Senior"]}):
            other = apply_preferences(cand, prefs)
            for job in self.JOBS:
                a = score_job(cand, job).model_dump(by_alias=True, exclude_none=True)
                b = score_job(other, job).model_dump(by_alias=True, exclude_none=True)
                self.assertEqual(a, b)
                self.assertNotIn("targetAlignment", a)


class AlignmentStatesTest(unittest.TestCase):
    CAND = MatchCandidate(role_family="product_project", seniority="medior", target_titles=["AI Engineer"])

    def _state(self, **job) -> TargetAlignment:
        alignment = target_alignment(self.CAND, mkjob(seniority="medior", **job))
        assert alignment is not None
        return alignment

    def test_four_states(self) -> None:
        self.assertEqual(self._state(title="Senior AI Engineer", role_family="software_engineering").state, "target")
        self.assertEqual(self._state(title="Data Scientist", role_family="data_ai").state, "family")
        self.assertEqual(self._state(title="IT Business Analyst", role_family="product_project").state, "past")
        self.assertEqual(self._state(title="Accountant", role_family="finance_accounting").state, "none")

    def test_shape(self) -> None:
        a = self._state(title="ML Engineer (m/w/d)", role_family="data_ai")
        self.assertEqual(
            a.model_dump(by_alias=True),
            {"state": "target", "matchedTitle": "AI Engineer", "targetFamilies": ["data_ai"], "pastFamily": "product_project"},
        )
        none = self._state(title="Accountant", role_family="finance_accounting")
        self.assertIsNone(none.matched_title)

    def test_career_family_term_follows_the_direction(self) -> None:
        # Same seniority on both sides: seniority term = 1.0, so career = 0.6 * family + 0.4.
        expect = {"target": 1.0, "family": 0.75, "past": 0.35, "none": 0.35}
        jobs = {
            "target": mkjob(title="AI Engineer", role_family="data_ai", seniority="medior"),
            "family": mkjob(title="Data Scientist", role_family="data_ai", seniority="medior"),
            "past": mkjob(title="IT Business Analyst", role_family="product_project", seniority="medior"),
            "none": mkjob(title="Accountant", role_family="finance_accounting", seniority="medior"),
        }
        for state, job in jobs.items():
            self.assertAlmostEqual(score_career(self.CAND, job), round(0.6 * expect[state] + 0.4, 4), msg=state)

    def test_seniority_term_unchanged(self) -> None:
        job = mkjob(title="AI Engineer", role_family="data_ai", seniority="lead")
        self.assertAlmostEqual(score_career(self.CAND, job), round(0.6 * 1.0 + 0.4 * (1 - 2 / 3), 4))

    def test_early_career_fit_term_reads_the_direction(self) -> None:
        student = self.CAND.model_copy(update={"archetype": "student"})
        target = mkjob(title="AI Engineer", role_family="data_ai", languages=[])
        past = mkjob(title="Business Analyst", role_family="product_project", languages=[])
        self.assertGreater(score_motivation(student, target), score_motivation(student, past))
        # Without targets the student reads its own family, as before.
        plain = student.model_copy(update={"target_titles": []})
        self.assertGreater(score_motivation(plain, past), score_motivation(plain, target))

    def test_blocked_as_if_result_carries_it(self) -> None:
        cand = self.CAND.model_copy(update={"preferred_work_modes": ["remote"]})
        job = mkjob(title="AI Engineer", role_family="data_ai", work_mode="onsite", seniority="medior")
        resp = match(cand, [job], include_blocked=True)
        self.assertEqual(resp.matches, [])
        assert resp.blocked
        self.assertEqual(resp.blocked[0].result.target_alignment.state, "target")


def _posting(title: str, body: str):
    job, _ = structure_posting({
        "externalKey": title, "url": f"https://x.example/{title}", "title": title,
        "company": "Firma", "location": "Praha", "country": "cz", "workMode": None,
        "postedAt": None, "salaryText": None, "salary": None, "jsonld": None, "lang": "en",
        "bodyText": body,
    })
    return job


def _changer(archetype: str = "bau") -> CandidateProfileV2:
    """8y analyst + QA + frontend, then ~1y AI consultant (the motivating seeker)."""
    return CandidateProfileV2(
        archetype=archetype, role_family="product_project", seniority="senior", years_experience=9,
        education_level="master", languages=["Czech", "English"],
        skill_claims=[SkillClaim(skill="Python", provenance="professional")],
        evidence=[
            Evidence(kind="job", title="AI Consultant", text="LLM assistants, RAG and prompt engineering in Python.",
                     skills=["Python", "LLM", "RAG", "Prompt engineering"], recency="2025"),
            Evidence(kind="job", title="IT Business Analyst", text="Requirements analysis, UML, BPMN, SQL.",
                     skills=["Business analysis", "Requirements analysis", "UML", "BPMN", "SQL", "JIRA", "Confluence"], recency="2023"),
            Evidence(kind="job", title="QA Engineer", text="Test automation with Selenium.",
                     skills=["Selenium", "Test automation", "JavaScript"], recency="2019"),
            Evidence(kind="job", title="Frontend Developer", text="React and TypeScript UIs.",
                     skills=["React", "TypeScript", "JavaScript"], recency="2017"),
        ],
    )


class CareerChangerOrderingTest(unittest.TestCase):
    """MEASURED 2026-09-25 (BAU, weights skills .5 / career .35 / personal .15):

        posting                    before        after (targets ["AI Engineer"])
        AI Engineer                55 promising  69 promising  (target)
        Senior AI Engineer (LLM)   64 promising  77 strong     (target)
        IT Business Analyst        75 strong     61 promising  (past)
        QA Engineer                52 partial    52 partial    (none)
    """

    POSTINGS = [
        _posting("AI Engineer", "We build LLM applications. You will design RAG pipelines in Python, work with "
                 "LangChain, prompt engineering and evaluation of model outputs. Docker, AWS, SQL."),
        _posting("Senior AI Engineer (LLM)", "Senior engineer for our generative AI platform: Python, LLM, RAG, "
                 "vector databases, prompt engineering, evaluation, MLOps, Kubernetes."),
        _posting("IT Business Analyst", "Gather and document requirements, business analysis, UML, BPMN, SQL, "
                 "JIRA, Confluence, stakeholder management, user stories."),
        _posting("QA Engineer", "Test automation with Selenium and Cypress, JavaScript, test planning, regression "
                 "testing, JIRA, CI/CD."),
    ]

    def _scores(self, prefs):
        cand = build_match_candidate(_changer(), prefs)
        return {job.title: score_job(cand, job) for job in self.POSTINGS}

    def test_stated_direction_outranks_the_past(self) -> None:
        before = self._scores(None)
        after = self._scores({"targetTitles": ["AI Engineer"]})
        # Before: the past ranks first.
        self.assertGreater(before["IT Business Analyst"].total, before["Senior AI Engineer (LLM)"].total)
        # After: both AI postings outrank the analyst posting.
        ba = after["IT Business Analyst"].total
        self.assertGreater(after["AI Engineer"].total, ba)
        self.assertGreater(after["Senior AI Engineer (LLM)"].total, ba)
        self.assertEqual(after["IT Business Analyst"].target_alignment.state, "past")
        # The skills dimension is honest: the direction never moves it.
        for title in before:
            self.assertEqual(before[title].skills_score, after[title].skills_score, title)
            self.assertEqual(before[title].matched_skills, after[title].matched_skills, title)


if __name__ == "__main__":
    unittest.main()
