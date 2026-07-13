"""Calibration corpus: classification, office filter, stratify, Scenario adapter.

All network-free — exercises the pure transforms on fixture rows (fetch_rows, the
only network code, is not touched)."""

import json
import shutil
import tempfile
import unittest
from pathlib import Path

from pipeline.jobfit.devcase import real_corpus
from pipeline.jobfit.devcase.real_corpus import (
    CorpusFrozenError,
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


def _fake_jobs(n):
    return [
        {"id": f"cal-{i:03d}", "title": f"Role {i}", "company": "Co", "jd_text": "jd",
         "role_family": "operations", "seniority": "medior", "source": "test"}
        for i in range(n)
    ]


class TestFrozenCorpusProtection(unittest.TestCase):
    """#1 — jobs.json is the canonical Part-2 fixture once --freeze wrote FROZEN.json. A SMALLER
    build (e.g. a --count 12 pilot) must not silently truncate it. _persist_jobs refuses the shrink
    unless forced; a same/larger build, or a build with no freeze marker, writes normally."""

    def setUp(self):
        self.tmp = tempfile.mkdtemp()
        d = Path(self.tmp)
        self._orig = (real_corpus.OUT_DIR, real_corpus.JOBS_PATH, real_corpus.FROZEN_PATH)
        real_corpus.OUT_DIR = d
        real_corpus.JOBS_PATH = d / "jobs.json"
        real_corpus.FROZEN_PATH = d / "FROZEN.json"

    def tearDown(self):
        real_corpus.OUT_DIR, real_corpus.JOBS_PATH, real_corpus.FROZEN_PATH = self._orig
        shutil.rmtree(self.tmp, ignore_errors=True)

    def _freeze_100(self):
        real_corpus.JOBS_PATH.write_text(json.dumps(_fake_jobs(100)), encoding="utf-8")
        real_corpus.FROZEN_PATH.write_text(json.dumps({"count": 100}), encoding="utf-8")

    def test_refuses_to_shrink_a_frozen_corpus(self):
        self._freeze_100()
        with self.assertRaises(CorpusFrozenError):
            real_corpus._persist_jobs(_fake_jobs(12))  # a 12-JD pilot must not truncate the frozen 100
        self.assertEqual(len(json.loads(real_corpus.JOBS_PATH.read_text())), 100)  # intact on disk

    def test_force_allows_the_deliberate_shrink(self):
        self._freeze_100()
        real_corpus._persist_jobs(_fake_jobs(12), force=True)
        self.assertEqual(len(json.loads(real_corpus.JOBS_PATH.read_text())), 12)

    def test_not_frozen_writes_freely(self):
        real_corpus.JOBS_PATH.write_text(json.dumps(_fake_jobs(100)), encoding="utf-8")
        real_corpus._persist_jobs(_fake_jobs(12))  # no FROZEN.json -> nothing blessed to protect
        self.assertEqual(len(json.loads(real_corpus.JOBS_PATH.read_text())), 12)

    def test_same_size_rebuild_allowed_even_when_frozen(self):
        self._freeze_100()
        real_corpus._persist_jobs(_fake_jobs(100))  # a same-size regenerate does not shrink
        self.assertEqual(len(json.loads(real_corpus.JOBS_PATH.read_text())), 100)


class TestFetchRowsCacheExtent(unittest.TestCase):
    """#4 — a narrow ``--fetch-limit`` cache must NOT silently satisfy a later BROADER request.
    Reusing a tiny slice for an unlimited build rebuilds the whole corpus narrow (the industry-lock
    the harness exists to break) while every report reads green. The cache stamps its extent in a
    sibling meta file; a request the cache can't cover re-fetches. (Network is faked — no HTTP.)"""

    def setUp(self):
        self.tmp = tempfile.mkdtemp()
        d = Path(self.tmp)
        self._orig = (real_corpus.OUT_DIR, real_corpus.RAW_CACHE, real_corpus._fetch_page)
        real_corpus.OUT_DIR = d
        real_corpus.RAW_CACHE = d / "_raw_rows.json"
        # Fake dataset: 250 distinct rows, served in <=100-row pages, counting every network hit.
        self.dataset = [
            {"position_title": f"Role {i}", "company_name": "Co", "job_description": "jd"}
            for i in range(250)
        ]
        self.calls: list[tuple[int, int]] = []

        def fake_fetch_page(offset, length):
            self.calls.append((offset, length))
            page = self.dataset[offset : offset + length]
            return {"num_rows_total": len(self.dataset), "rows": [{"row": r} for r in page]}

        real_corpus._fetch_page = fake_fetch_page

    def tearDown(self):
        real_corpus.OUT_DIR, real_corpus.RAW_CACHE, real_corpus._fetch_page = self._orig
        shutil.rmtree(self.tmp, ignore_errors=True)

    def test_narrow_cache_does_not_satisfy_a_broader_request(self):
        narrow = real_corpus.fetch_rows(limit=50)  # a quick debug pull
        self.assertEqual(len(narrow), 50)
        after_narrow = len(self.calls)
        self.assertGreater(after_narrow, 0)
        # A later FULL build (limit=None) must RE-FETCH, not reuse the narrow slice.
        full = real_corpus.fetch_rows(limit=None)
        self.assertEqual(len(full), 250)  # pre-fix: returned the cached slice, not 250
        self.assertGreater(len(self.calls), after_narrow)  # network was hit again
        # …and now the cache is full, so a subsequent request is served offline.
        before = len(self.calls)
        self.assertEqual(len(real_corpus.fetch_rows(limit=100)), 100)
        self.assertEqual(len(self.calls), before)

    def test_full_cache_serves_any_request_offline(self):
        self.assertEqual(len(real_corpus.fetch_rows(limit=None)), 250)
        before = len(self.calls)
        # A full pull covers both a broad and a narrow later request with no new fetch.
        self.assertEqual(len(real_corpus.fetch_rows(limit=None)), 250)
        self.assertEqual(len(real_corpus.fetch_rows(limit=30)), 30)
        self.assertEqual(len(self.calls), before)

    def test_narrow_cache_serves_a_smaller_or_equal_request_offline(self):
        real_corpus.fetch_rows(limit=80)
        before = len(self.calls)
        # A later request for <= the cached extent is covered without a re-fetch (no over-correction).
        self.assertEqual(len(real_corpus.fetch_rows(limit=50)), 50)
        self.assertEqual(len(self.calls), before)

    def test_legacy_meta_less_cache_is_refetched_for_a_full_request(self):
        # A cache from before the extent-stamp fix (no meta file) is treated as truncated: an
        # unlimited request re-fetches rather than certify a broad corpus from an unknown slice.
        real_corpus.OUT_DIR.mkdir(parents=True, exist_ok=True)
        real_corpus.RAW_CACHE.write_text(
            json.dumps([{"position_title": "Old", "company_name": "C", "job_description": "jd"}]),
            encoding="utf-8",
        )  # no sibling meta file
        before = len(self.calls)
        full = real_corpus.fetch_rows(limit=None)
        self.assertEqual(len(full), 250)  # pre-fix: returned the 1-row legacy slice
        self.assertGreater(len(self.calls), before)


if __name__ == "__main__":
    unittest.main()
