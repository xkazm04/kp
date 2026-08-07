"""Calibration corpus: classification, office filter, stratify, Scenario adapter.

All network-free — exercises the pure transforms on fixture rows (fetch_rows, the
only network code, is not touched)."""

import unittest

from pipeline.jobfit.devcase.real_corpus import (
    build_jobs,
    classify_family,
    classify_rows,
    classify_seniority,
    is_office,
    scenarios_from_jobs,
    stratify,
)
from pipeline.jobfit.devcase.models import DevNeed

# Realistic raw rows in the HF dataset shape, spanning office families + 2 non-office.
_ROWS = [
    {"position_title": "Senior Software Engineer", "company_name": "Acme", "job_description": "Build and own backend services in Python."},
    {"position_title": "Marketing Manager", "company_name": "Brandco", "job_description": "Own the content calendar and grow organic traffic."},
    {"position_title": "HR Business Partner", "company_name": "Peoplesoft", "job_description": "Partner with leaders on talent and people operations."},
    {"position_title": "Financial Analyst", "company_name": "FinCo", "job_description": "Own the forecast and explain variances to the business."},
    {"position_title": "Account Executive", "company_name": "SalesInc", "job_description": "Run the sales cycle and own the number."},
    {"position_title": "Legal Counsel", "company_name": "Lawyers LLP", "job_description": "Review contracts and manage compliance."},
    {"position_title": "Warehouse Associate", "company_name": "Logix", "job_description": "Operate a forklift and pick orders."},
    {"position_title": "Delivery Driver", "company_name": "Quickship", "job_description": "Drive a van and deliver packages."},
    {"position_title": "Data Entry Clerk", "company_name": "", "job_description": ""},  # JD-less -> dropped
]


class TestSeniority(unittest.TestCase):
    def test_keywords(self):
        self.assertEqual(classify_seniority("Junior Accountant"), "junior")
        self.assertEqual(classify_seniority("Intern, Marketing"), "junior")
        self.assertEqual(classify_seniority("Senior Software Engineer"), "senior")
        self.assertEqual(classify_seniority("Head of Sales"), "lead")
        self.assertEqual(classify_seniority("Principal Designer"), "lead")
        self.assertEqual(classify_seniority("Marketing Manager"), "senior")
        self.assertEqual(classify_seniority("Software Engineer"), "medior")  # default


class TestFamily(unittest.TestCase):
    def test_office_families(self):
        self.assertEqual(classify_family("Senior Software Engineer", "python backend"), "software_engineering")
        self.assertEqual(classify_family("Marketing Manager", ""), "marketing")
        self.assertEqual(classify_family("HR Business Partner", ""), "hr")
        self.assertEqual(classify_family("Financial Analyst", ""), "finance")
        self.assertEqual(classify_family("Account Executive", ""), "sales")
        self.assertEqual(classify_family("Legal Counsel", ""), "legal")

    def test_non_office_returns_none(self):
        self.assertIsNone(classify_family("Forklift Operator", "operate a forklift"))
        self.assertFalse(is_office("Warehouse Associate"))
        self.assertFalse(is_office("Delivery Driver"))
        self.assertTrue(is_office("Marketing Manager"))


class TestClassifyRows(unittest.TestCase):
    def setUp(self):
        self.by_family = classify_rows(_ROWS)

    def test_drops_non_office_and_jdless(self):
        all_titles = [r["title"] for rs in self.by_family.values() for r in rs]
        self.assertNotIn("Warehouse Associate", all_titles)
        self.assertNotIn("Delivery Driver", all_titles)
        self.assertNotIn("Data Entry Clerk", all_titles)  # JD-less

    def test_breadth_of_families(self):
        # 6 distinct office families among the valid rows.
        self.assertEqual(
            set(self.by_family),
            {"software_engineering", "marketing", "hr", "finance", "sales", "legal"},
        )

    def test_rows_carry_classification(self):
        eng = self.by_family["software_engineering"][0]
        self.assertEqual(eng["role_family"], "software_engineering")
        self.assertEqual(eng["seniority"], "senior")
        self.assertTrue(eng["jd_text"])


class TestStratify(unittest.TestCase):
    def test_round_robin_breadth_then_depth(self):
        by_family = {
            "a": [{"id": "a1"}, {"id": "a2"}, {"id": "a3"}],
            "b": [{"id": "b1"}],
            "c": [{"id": "c1"}, {"id": "c2"}],
        }
        picked = stratify(by_family, 4)
        # one from each family first (breadth), then depth from the largest
        self.assertEqual([r["id"] for r in picked], ["a1", "b1", "c1", "a2"])

    def test_deterministic_and_capped(self):
        by_family = {"a": [{"id": "a1"}, {"id": "a2"}], "b": [{"id": "b1"}]}
        self.assertEqual(stratify(by_family, 10), stratify(by_family, 10))  # deterministic
        self.assertEqual(len(stratify(by_family, 10)), 3)  # never exceeds the pool


class TestBuildAndAdapt(unittest.TestCase):
    def test_build_jobs_ids_and_fields(self):
        picked = stratify(classify_rows(_ROWS), 100)
        jobs = build_jobs(picked)
        self.assertEqual(jobs[0]["id"], "cal-000")
        self.assertTrue(all(set(j) >= {"id", "title", "company", "jd_text", "role_family", "seniority", "source"} for j in jobs))

    def test_scenarios_from_jobs(self):
        jobs = build_jobs(stratify(classify_rows(_ROWS), 100))
        scns = scenarios_from_jobs(jobs)
        self.assertEqual(len(scns), len(jobs))
        scn = scns[0]
        self.assertIsInstance(scn.need, DevNeed)
        self.assertEqual(scn.snapshot, None)  # office roles have no codebase
        self.assertTrue(scn.planted.get("real"))
        self.assertEqual(scn.need.jd_text, jobs[0]["jd_text"])
        self.assertEqual(scn.need.role_family, jobs[0]["role_family"])
        self.assertEqual(scn.need.seniority_target, jobs[0]["seniority"])


if __name__ == "__main__":
    unittest.main()
