"""reasoning_cli reasons about the candidate the score was computed for.

The seeker deep-dive (app/_lib/jobseeker/deepdive.ts) scores a posting through
``match_cli --preferences-json`` and then asks ``reasoning_cli`` for the rationale. The
second call used to go without the preferences, so the rationale was written for a
candidate with no salary floor, no work modes and the CV's own seniority - a different
candidate than the one scored. ``--preferences-json`` now applies the SAME overlay
(``transform.apply_preferences``) the matcher applies, and these tests pin that: the
total reasoning_cli reports equals match_cli's for the same inputs, with and without
preferences, and the preferences demonstrably reach the score.
"""

from __future__ import annotations

import io
import json
import unittest
from contextlib import redirect_stdout
from pathlib import Path
from tempfile import TemporaryDirectory

from pipeline.jobfit import match_cli, reasoning_cli

CANDIDATE = {
    "skills": ["Python", "SQL"],
    "seniority": "junior",
    "roleFamily": "software_engineering",
    "languages": ["English"],
    "yearsExperience": 6.0,
    "summary": "Backend engineer.",
}
JOB = {
    "id": "pref-1",
    "title": "Senior Backend Engineer",
    "company": "Acme",
    "location": "Prague",
    "workMode": "hybrid",
    "seniority": "senior",
    "roleFamily": "software_engineering",
    "requiredSkills": ["Python", "SQL"],
    "description": "Build data services in Python.",
}
# The seeker says they are senior and want hybrid work: both are matching inputs
# (seniority reaches the career score), and the salary floor drives an eligibility flag.
PREFERENCES = {
    "seniority": "senior",
    "workModes": ["hybrid"],
    "salaryFloor": {"amount": 90000, "currency": "CZK", "period": "month"},
}


def _run(main, argv: list[str]) -> dict:
    buf = io.StringIO()
    with redirect_stdout(buf):
        rc = main(argv)
    assert rc == 0, buf.getvalue()
    return json.loads(buf.getvalue().strip().splitlines()[-1])


class ReasoningCliPreferencesTest(unittest.TestCase):
    def _totals(self, preferences: dict | None) -> tuple[float, float]:
        with TemporaryDirectory() as tmp:
            cand = Path(tmp) / "cand.json"
            cand.write_text(json.dumps(CANDIDATE), encoding="utf-8")
            jobs = Path(tmp) / "jobs.json"
            jobs.write_text(json.dumps([JOB]), encoding="utf-8")
            empty = Path(tmp) / "corpus.json"
            empty.write_text("[]", encoding="utf-8")
            extra: list[str] = []
            if preferences is not None:
                prefs = Path(tmp) / "prefs.json"
                prefs.write_text(json.dumps(preferences), encoding="utf-8")
                extra = ["--preferences-json", str(prefs)]
            reasoned = _run(
                reasoning_cli.main,
                ["--candidate-json", str(cand), "--jobs", str(empty), "--jobs-json", str(jobs), "--job-id", "pref-1", "--no-llm", *extra],
            )
            matched = _run(
                match_cli.main,
                ["--candidate-json", str(cand), "--jobs", str(empty), "--jobs-json", str(jobs), "--limit", "5", "--include-blocked", *extra],
            )
        by_id = {m["jobId"]: m["total"] for m in matched.get("matches", [])}
        for b in matched.get("blocked", []):
            by_id.setdefault(b["jobId"], b["result"]["total"])
        self.assertIn("pref-1", by_id, matched)
        return reasoned["total"], by_id["pref-1"]

    def test_the_rationale_scores_the_same_candidate_the_matcher_scored(self) -> None:
        reasoned, matched = self._totals(PREFERENCES)
        self.assertEqual(reasoned, matched)

    def test_without_preferences_the_two_still_agree(self) -> None:
        reasoned, matched = self._totals(None)
        self.assertEqual(reasoned, matched)

    def test_the_preferences_reach_the_score(self) -> None:
        # Non-vacuity: if the overlay did nothing, the two tests above would pass on a
        # flag that is parsed and ignored.
        with_prefs, _ = self._totals(PREFERENCES)
        without, _ = self._totals(None)
        self.assertNotEqual(with_prefs, without)

    def test_a_non_object_preferences_file_is_no_preferences_not_a_crash(self) -> None:
        reasoned_list, _ = self._totals(["not", "an", "object"])  # type: ignore[arg-type]
        without, _ = self._totals(None)
        self.assertEqual(reasoned_list, without)


if __name__ == "__main__":
    unittest.main()
