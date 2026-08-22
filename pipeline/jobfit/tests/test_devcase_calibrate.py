"""calibrate — corpus protection (#1) and a model/prompt-aware --resume cache key (#2).

#1: `build_corpus` used to UNCONDITIONALLY rewrite jobs.json, so a `--count 12` pilot truncated the
    frozen 100-JD canonical corpus that --freeze blessed and Part 2 consumes. calibrate now REUSES an
    existing corpus by default (running a pilot on a slice) and only (re)builds under --rebuild.
#2: the --resume cache was keyed on the positional id alone, so a re-calibration on a new model/prompt
    served the OLD cached cases and the gate/--freeze certified a corpus the model-under-test never made.
    The cache is now keyed on (id, model, promptVersions): a mismatch is a MISS that regenerates.
"""

import json
import shutil
import tempfile
import types
import unittest
from pathlib import Path

from pipeline.jobfit.devcase import calibrate, real_corpus
from pipeline.jobfit.devcase.lifecycle_eval import Row

# Recognizable office titles so the (buggy) rebuild path classifies to a real corpus offline —
# this makes the pre-fix truncation observable without touching the network.
_OFFICE_TITLES = {
    "operations": "Operations Manager",
    "hr": "HR Business Partner",
    "finance": "Financial Analyst",
    "sales": "Account Executive",
    "marketing": "Marketing Manager",
    "legal": "Legal Counsel",
}
_FAMS = list(_OFFICE_TITLES)


def _fake_jobs(n):
    return [
        {
            "id": f"cal-{i:03d}",
            "title": f"{_OFFICE_TITLES[_FAMS[i % len(_FAMS)]]} {i}",
            "company": "Co",
            "jd_text": f"Own the {_FAMS[i % len(_FAMS)]} work and deliver outcomes.",
            "role_family": _FAMS[i % len(_FAMS)],
            "seniority": "medior",
            "source": "test",
        }
        for i in range(n)
    ]


def _raw_rows(n):
    """Rows in the HF dataset shape, classifiable to real office families offline."""
    return [
        {
            "position_title": f"{_OFFICE_TITLES[_FAMS[i % len(_FAMS)]]} {i}",
            "company_name": "Co",
            "job_description": f"Own the {_FAMS[i % len(_FAMS)]} work and deliver outcomes.",
        }
        for i in range(n)
    ]


class _CalibrateTempDir(unittest.TestCase):
    """Redirect every seed_calibration path to a temp dir. Both modules bind their OWN copies of
    these names (calibrate does `from real_corpus import ...`), so patch both bindings."""

    def setUp(self):
        self.tmp = tempfile.mkdtemp()
        self.d = Path(self.tmp)
        self.jobs_path = self.d / "jobs.json"
        self.frozen_path = self.d / "FROZEN.json"
        self.cases_dir = self.d / "cases"
        self._orig = {
            "rc_out": real_corpus.OUT_DIR,
            "rc_jobs": real_corpus.JOBS_PATH,
            "rc_frozen": real_corpus.FROZEN_PATH,
            "rc_raw": real_corpus.RAW_CACHE,
            "cal_out": calibrate.OUT_DIR,
            "cal_jobs": calibrate.JOBS_PATH,
            "cal_cases": calibrate.CASES_DIR,
        }
        real_corpus.OUT_DIR = self.d
        real_corpus.JOBS_PATH = self.jobs_path
        real_corpus.FROZEN_PATH = self.frozen_path
        real_corpus.RAW_CACHE = self.d / "_raw_rows.json"
        calibrate.OUT_DIR = self.d
        calibrate.JOBS_PATH = self.jobs_path
        calibrate.CASES_DIR = self.cases_dir

    def tearDown(self):
        real_corpus.OUT_DIR = self._orig["rc_out"]
        real_corpus.JOBS_PATH = self._orig["rc_jobs"]
        real_corpus.FROZEN_PATH = self._orig["rc_frozen"]
        real_corpus.RAW_CACHE = self._orig["rc_raw"]
        calibrate.OUT_DIR = self._orig["cal_out"]
        calibrate.JOBS_PATH = self._orig["cal_jobs"]
        calibrate.CASES_DIR = self._orig["cal_cases"]
        shutil.rmtree(self.tmp, ignore_errors=True)


class TestPilotDoesNotClobberFrozenCorpus(_CalibrateTempDir):
    def test_count_12_pilot_leaves_frozen_100_intact(self):
        # A blessed 100-JD corpus + freeze marker on disk.
        self.jobs_path.write_text(json.dumps(_fake_jobs(100)), encoding="utf-8")
        self.frozen_path.write_text(json.dumps({"count": 100}), encoding="utf-8")
        # Seed the raw cache so even the (buggy) rebuild path stays offline+deterministic.
        real_corpus.RAW_CACHE.write_text(json.dumps(_raw_rows(40)), encoding="utf-8")

        rc = calibrate.main(["--count", "12", "--no-llm"])
        self.assertEqual(rc, 0)
        # #1: the pilot ran on a SLICE of the frozen corpus; jobs.json is never rewritten/truncated.
        on_disk = json.loads(self.jobs_path.read_text(encoding="utf-8"))
        self.assertEqual(len(on_disk), 100)


class TestResumeCacheKey(_CalibrateTempDir):
    def _scn(self):
        return types.SimpleNamespace(id="cal-000", label="l", planted={})

    def _write_cached(self, model, versions, issues=None):
        self.cases_dir.mkdir(parents=True, exist_ok=True)
        payload = {
            "source": "llm",
            "issues": issues or [],
            "analysis": {},
            "role": {},
            "case": {},
            "model": model,
            "promptVersions": versions,
        }
        (self.cases_dir / "cal-000.json").write_text(json.dumps(payload), encoding="utf-8")

    def test_hit_when_model_and_versions_match(self):
        self._write_cached(calibrate.DEFAULT_MODEL_TAG, dict(calibrate.EXPECTED_PROMPT_VERSIONS))
        row = calibrate._row_from_file(self._scn(), self.cases_dir / "cal-000.json", calibrate.DEFAULT_MODEL_TAG)
        self.assertIsNotNone(row)
        self.assertEqual(row.source, "llm")

    def test_miss_when_model_changed(self):
        # A case cached on the default model must MISS when the run pins a new model -> regenerate,
        # so the gate/--freeze can't certify cases a different model produced.
        self._write_cached(calibrate.DEFAULT_MODEL_TAG, dict(calibrate.EXPECTED_PROMPT_VERSIONS))
        row = calibrate._row_from_file(self._scn(), self.cases_dir / "cal-000.json", "haiku")
        self.assertIsNone(row)

    def test_miss_when_prompt_version_changed(self):
        stale = {**calibrate.EXPECTED_PROMPT_VERSIONS, "case": "case-design-v1"}
        self._write_cached(calibrate.DEFAULT_MODEL_TAG, stale)
        row = calibrate._row_from_file(self._scn(), self.cases_dir / "cal-000.json", calibrate.DEFAULT_MODEL_TAG)
        self.assertIsNone(row)

    def test_run_reuses_on_match_but_regenerates_on_model_change(self):
        # Behavioral end-to-end: run() must skip regeneration on a match and DO it on a mismatch.
        self._write_cached(calibrate.DEFAULT_MODEL_TAG, dict(calibrate.EXPECTED_PROMPT_VERSIONS))
        scn = self._scn()
        calls = []

        def fake_run_one(s, ap, cp):
            calls.append(s.id)
            return Row(id=s.id, label=s.label, planted=s.planted, source="llm", issues=[])

        orig = calibrate.run_one
        calibrate.run_one = fake_run_one
        try:
            calibrate.run([scn], object(), object(), {}, workers=1, resume=True, model_tag=calibrate.DEFAULT_MODEL_TAG)
            self.assertEqual(calls, [])  # same model+prompt -> cache HIT, no regeneration
            calibrate.run([scn], object(), object(), {}, workers=1, resume=True, model_tag="haiku")
            self.assertEqual(calls, ["cal-000"])  # changed model -> cache MISS -> regenerated
        finally:
            calibrate.run_one = orig


class TestGateCannotCertifyAnUnmeasuredJudge(unittest.TestCase):
    """#3 (2026-08-22): a REQUESTED judged dimension that produced no verdicts used to be
    skipped, not failed. `run_judge` silently drops every call that errors or returns
    unparseable JSON, so exhausting the Claude session limit mid-run empties both judged
    metrics; with the cases served from the --resume cache, reliability stays 1.0 and
    error_fallbacks 0, and `--strict --freeze` stamped FROZEN.json `passed: true` on a
    corpus whose quality and role-fit were never measured."""

    HEALTHY = {"reliability": 1.0, "error_fallbacks": 0, "case_title_uniqueness": 1.0}

    def test_judge_that_returned_nothing_fails_the_gate(self):
        passed, reasons = calibrate.evaluate_gate(
            self.HEALTHY, None, {"mean_by_task": {}, "overall": None}, judged=True
        )
        self.assertFalse(passed)
        self.assertTrue(any("NO case scores" in r for r in reasons), reasons)
        self.assertTrue(any("role-fit" in r for r in reasons), reasons)

    def test_unjudged_run_is_unaffected(self):
        # No --judge: the judged dimensions were never requested, so their absence is not
        # a failure (the structural gates still apply).
        passed, reasons = calibrate.evaluate_gate(self.HEALTHY, None, None, judged=False)
        self.assertTrue(passed, reasons)

    def test_a_measured_judge_still_passes_and_still_fails_on_a_low_mean(self):
        passed, _ = calibrate.evaluate_gate(self.HEALTHY, 1.0, {"mean_by_task": {"case": 4.4}}, judged=True)
        self.assertTrue(passed)
        passed, reasons = calibrate.evaluate_gate(self.HEALTHY, 1.0, {"mean_by_task": {"case": 2.1}}, judged=True)
        self.assertFalse(passed)
        self.assertTrue(any("case-mean 2.1" in r for r in reasons), reasons)


if __name__ == "__main__":
    unittest.main()
