"""Seeker-side eligibility FLAGS on the matcher (WP4b).

The contract under test: a salary / location mismatch is a flag the reader sees —
never a hidden KO and never a score multiplier. A posting with no pay is UNKNOWN
(never "under"); two currencies are "not comparable" (no FX); month<->year is the
only conversion and the detail says so. seniority / language / work_mode mirror the
KO filter's verdict as flags without changing the KO behaviour itself.
"""

from __future__ import annotations

import contextlib
import io
import json
import tempfile
import unittest
from pathlib import Path

from pipeline.jobfit.market_config import ACTIVE_MARKET
from pipeline.jobfit.match_cli import main as match_main
from pipeline.jobfit.matching import (
    MatchCandidate,
    SalaryExpectation,
    eligibility_flags,
    ko_filter,
    match,
    score_job,
)
from pipeline.jobfit.posting_structure import structure_posting
from pipeline.jobfit.profile import CandidateProfileV2, SkillClaim
from pipeline.jobfit.tests._helpers import mkjob
from pipeline.jobfit.transform import apply_preferences, build_match_candidate

CUR = ACTIVE_MARKET.currency  # "CZK" for the product default; the job side has no currency of its own
PERIOD = ACTIVE_MARKET.period  # "month"


def _cand(**over) -> MatchCandidate:
    base = dict(skills=["Python"], seniority="medior", languages=["English"], education_level="bachelor")
    base.update(over)
    return MatchCandidate(**base)


def _structured_job(**over):
    """A Job built the way a harvested posting really reaches the matcher — through
    ``structure_posting``, so the stated currency/period are on the Job."""
    base = {
        "externalKey": "k", "url": "https://x.example/j/1", "title": "Finanční analytik",
        "company": "Firma", "location": "Praha", "country": "cz", "workMode": None,
        "postedAt": None, "salaryText": None, "salary": None, "jsonld": None, "lang": None,
        "bodyText": "Analýza rozpočtů a reporting. Excel, SQL.",
    }
    base.update(over)
    job, _notes = structure_posting(base)
    return job


def _annual_job():
    return _structured_job(salary={"min": 900_000, "max": 1_200_000, "currency": "CZK", "period": "year"})


def _flag(candidate: MatchCandidate, job, key: str):
    flags = [f for f in eligibility_flags(candidate, job) if f.key == key]
    assert len(flags) == 1, flags
    return flags[0]


class SalaryFlagTest(unittest.TestCase):
    def test_no_expectation_is_unknown(self) -> None:
        job = mkjob(salary_min=50_000, salary_max=70_000)
        f = _flag(_cand(), job, "salary")
        self.assertEqual(f.state, "unknown")
        self.assertIn("no expectation", f.detail)

    def test_posting_without_pay_is_unknown_never_under(self) -> None:
        # mkjob states no salary -> normalize_job stamps the market anchor band and
        # records the "salary_band" phantom. The seeker must read UNKNOWN, not "under".
        job = mkjob()
        self.assertIn("salary_band", job.defaulted_fields)
        f = _flag(_cand(salary_expectation=SalaryExpectation(amount=10_000_000, currency=CUR)), job, "salary")
        self.assertEqual(f.state, "unknown")
        self.assertIn("no pay", f.detail)

    def test_different_currency_is_not_comparable(self) -> None:
        job = mkjob(salary_min=50_000, salary_max=70_000)
        other = "EUR" if CUR != "EUR" else "CZK"
        f = _flag(_cand(salary_expectation=SalaryExpectation(amount=1, currency=other)), job, "salary")
        self.assertEqual(f.state, "unknown")
        self.assertIn("not comparable", f.detail)
        self.assertIn(other, f.detail)
        self.assertIn(CUR, f.detail)

    def test_currency_normalizes_case_and_symbol(self) -> None:
        job = mkjob(salary_min=50_000, salary_max=70_000)
        for spelling in (CUR.lower(), f" {CUR} "):
            f = _flag(_cand(salary_expectation=SalaryExpectation(amount=60_000, currency=spelling)), job, "salary")
            self.assertEqual(f.state, "ok", spelling)
        if CUR == "CZK":
            f = _flag(_cand(salary_expectation=SalaryExpectation(amount=60_000, currency="Kč")), job, "salary")
            self.assertEqual(f.state, "ok")

    def test_below_floor_is_flag_with_figures(self) -> None:
        job = mkjob(salary_min=50_000, salary_max=70_000)
        f = _flag(_cand(salary_expectation=SalaryExpectation(amount=80_000, currency=CUR, period=PERIOD)), job, "salary")
        self.assertEqual(f.state, "flag")
        self.assertIn("70000", f.detail)
        self.assertIn("80000", f.detail)

    def test_within_band_is_ok(self) -> None:
        job = mkjob(salary_min=50_000, salary_max=70_000)
        f = _flag(_cand(salary_expectation=SalaryExpectation(amount=65_000, currency=CUR, period=PERIOD)), job, "salary")
        self.assertEqual(f.state, "ok")
        # The max itself still clears the floor (>=, not >).
        f = _flag(_cand(salary_expectation=SalaryExpectation(amount=70_000, currency=CUR, period=PERIOD)), job, "salary")
        self.assertEqual(f.state, "ok")

    def test_period_conversion_is_x12_and_stated(self) -> None:
        job = mkjob(salary_min=50_000, salary_max=70_000)  # read as CUR/month
        other = "year" if PERIOD == "month" else "month"
        # 840 000 / year == 70 000 / month -> exactly at the max -> ok, and the detail says so.
        yearly = 70_000 * 12 if other == "year" else 70_000 / 12
        f = _flag(_cand(salary_expectation=SalaryExpectation(amount=yearly, currency=CUR, period=other)), job, "salary")
        self.assertEqual(f.state, "ok")
        self.assertIn(f"{other}->{PERIOD}", f.detail)
        self.assertIn("x12", f.detail)
        # One unit above -> flag, still stating the conversion.
        f = _flag(_cand(salary_expectation=SalaryExpectation(amount=yearly * 1.01, currency=CUR, period=other)), job, "salary")
        self.assertEqual(f.state, "flag")
        self.assertIn("x12", f.detail)


class LocationFlagTest(unittest.TestCase):
    def test_no_preference_is_unknown(self) -> None:
        f = _flag(_cand(), mkjob(location="Brno"), "location")
        self.assertEqual(f.state, "unknown")

    def test_remote_is_ok_wherever_the_seeker_lives(self) -> None:
        f = _flag(_cand(preferred_locations=["Ostrava"]), mkjob(location="Praha", work_mode="remote"), "location")
        self.assertEqual(f.state, "ok")
        self.assertEqual(f.detail, "remote")

    def test_text_match_is_case_and_diacritics_insensitive(self) -> None:
        job = mkjob(location="Plzeň – Bory")
        self.assertEqual(_flag(_cand(preferred_locations=["plzen"]), job, "location").state, "ok")
        self.assertEqual(_flag(_cand(preferred_locations=["PLZEŇ"]), job, "location").state, "ok")

    def test_country_matches_a_token_in_the_location_text(self) -> None:
        # Job has no country field; the code can only match as a token of the text.
        self.assertEqual(_flag(_cand(preferred_countries=["cz"]), mkjob(location="Brno, CZ"), "location").state, "ok")
        # …never as a substring ("cz" inside "Czechoslovak Street" is not a country).
        self.assertEqual(_flag(_cand(preferred_countries=["cz"]), mkjob(location="Czechoslovak Street 1, Wien"), "location").state, "flag")

    def test_mismatch_is_flag(self) -> None:
        f = _flag(_cand(preferred_locations=["Praha"], preferred_countries=["de"]), mkjob(location="Brno", work_mode="onsite"), "location")
        self.assertEqual(f.state, "flag")
        self.assertIn("Brno", f.detail)
        self.assertIn("Praha", f.detail)

    def test_defaulted_location_is_unknown_not_flag(self) -> None:
        # mkjob states no location -> normalize_job stamps the market default ("Praha")
        # and records the phantom. A seeker in Brno must NOT be told the role is in Praha.
        job = mkjob()
        self.assertIn("location", job.defaulted_fields)
        self.assertEqual(_flag(_cand(preferred_locations=["Brno"]), job, "location").state, "unknown")


class MirroredKoFlagsTest(unittest.TestCase):
    def test_all_five_keys_always_present(self) -> None:
        flags = eligibility_flags(_cand(), mkjob())
        self.assertEqual([f.key for f in flags], ["salary", "location", "seniority", "language", "work_mode"])

    def test_ko_reasons_surface_as_flags_with_the_ko_text(self) -> None:
        cand = _cand(seniority="junior", languages=["Czech"], preferred_work_modes=["remote"])
        job = mkjob(seniority="lead", languages=["German"], work_mode="onsite")
        passed, reasons = ko_filter(cand, job)
        self.assertFalse(passed)
        by_key = {f.key: f for f in eligibility_flags(cand, job)}
        for key in ("seniority", "language", "work_mode"):
            self.assertEqual(by_key[key].state, "flag", key)
            self.assertIn(by_key[key].detail, [r.detail for r in reasons], key)

    def test_passing_gates_read_ok(self) -> None:
        by_key = {f.key: f for f in eligibility_flags(_cand(), mkjob(seniority="medior"))}
        for key in ("seniority", "language", "work_mode"):
            self.assertEqual(by_key[key].state, "ok", key)


class StatedPeriodAndCurrencyTest(unittest.TestCase):
    """The flag reads the posting's OWN currency/period (WP: salary honesty across periods).

    A harvested ad states its pay in whatever units it likes. Reading every ad in the
    active market's units answered a CZK/year posting "posting states no pay" and an
    hourly one the same — while the seeker's detail panel, which does read the posting's
    units, called them "not comparable". Chip and panel disagreed about one posting.
    """

    def test_annual_posting_is_compared_not_shrugged_at(self) -> None:
        if CUR != "CZK" or PERIOD != "month":
            self.skipTest("pin is written for the CZK/month product default")
        job = _annual_job()
        self.assertEqual(job.salary_period, "year", "the raw statement survives")
        self.assertEqual(job.salary_band, [75_000, 100_000], "…while the band is restated x12 for the market")
        # 80 000 CZK/month sits inside the restated band → ok, never unknown.
        f = _flag(_cand(salary_expectation=SalaryExpectation(amount=80_000, currency=CUR, period=PERIOD)), job, "salary")
        self.assertEqual(f.state, "ok")
        self.assertIn("year", f.detail)
        self.assertIn("x12", f.detail)
        # 150 000 CZK/month is above it → flag, still never unknown.
        f = _flag(_cand(salary_expectation=SalaryExpectation(amount=150_000, currency=CUR, period=PERIOD)), job, "salary")
        self.assertEqual(f.state, "flag")

    def test_hourly_posting_says_hourly_never_no_pay(self) -> None:
        job = _structured_job(bodyText="Práce na směny. Hodinová sazba 250 Kč/hod.")
        self.assertEqual(job.salary_period, "hour")
        self.assertIn("salary_band", job.defaulted_fields, "an hourly rate never becomes a band")
        f = _flag(_cand(salary_expectation=SalaryExpectation(amount=60_000, currency=CUR, period=PERIOD)), job, "salary")
        self.assertEqual(f.state, "unknown")
        self.assertIn("hourly", f.detail)
        self.assertNotIn("no pay", f.detail)

    def test_foreign_currency_posting_says_not_comparable_never_no_pay(self) -> None:
        if CUR == "EUR":
            self.skipTest("the fixture's foreign currency is the market's own")
        job = _structured_job(salary={"min": 4_500, "max": 6_000, "currency": "EUR", "period": "month"})
        f = _flag(_cand(salary_expectation=SalaryExpectation(amount=60_000, currency=CUR, period=PERIOD)), job, "salary")
        self.assertEqual(f.state, "unknown")
        self.assertIn("not comparable", f.detail)
        self.assertIn("EUR", f.detail)
        self.assertNotIn("no pay", f.detail)

    def test_a_posting_with_no_units_still_reads_in_the_market_and_says_so(self) -> None:
        job = mkjob(salary_min=50_000, salary_max=70_000)
        self.assertIsNone(job.salary_currency)
        f = _flag(_cand(salary_expectation=SalaryExpectation(amount=60_000, currency=CUR, period=PERIOD)), job, "salary")
        self.assertEqual(f.state, "ok")
        self.assertIn(ACTIVE_MARKET.market_id, f.detail)


class NeverAGateNeverAScoreTest(unittest.TestCase):
    """Preferences change the flags and NOTHING else."""

    def test_totals_identical_for_an_annual_posting_too(self) -> None:
        """The x12 restatement moves the BAND and the flag — never the score."""
        if CUR != "CZK" or PERIOD != "month":
            self.skipTest("pin is written for the CZK/month product default")
        job = _annual_job()
        plain = _cand()
        with_prefs = _cand(salary_expectation=SalaryExpectation(amount=500_000, currency=CUR), preferred_locations=["Ostrava"])
        a, b = score_job(plain, job), score_job(with_prefs, job)
        self.assertEqual(a.total, b.total)
        self.assertEqual(a.fit_tier, b.fit_tier)
        self.assertEqual(a.score_breakdown, b.score_breakdown)
        self.assertEqual(a.confidence, b.confidence)
        self.assertEqual({f.key: f.state for f in b.eligibility}["salary"], "flag")
        self.assertEqual({f.key: f.state for f in a.eligibility}["salary"], "unknown", "no expectation set")

    def test_totals_identical_with_and_without_preferences(self) -> None:
        job = mkjob(salary_min=50_000, salary_max=70_000, location="Brno", seniority="medior")
        plain = _cand()
        with_prefs = _cand(
            salary_expectation=SalaryExpectation(amount=500_000, currency=CUR),
            preferred_locations=["Ostrava"],
            preferred_countries=["de"],
        )
        a, b = score_job(plain, job), score_job(with_prefs, job)
        self.assertEqual(a.total, b.total)
        self.assertEqual(a.fit_tier, b.fit_tier)
        self.assertEqual(a.score_breakdown, b.score_breakdown)
        self.assertEqual(a.confidence, b.confidence)
        # …while the flags DID fire, so the seeker sees the mismatch on the card.
        states = {f.key: f.state for f in b.eligibility}
        self.assertEqual(states["salary"], "flag")
        self.assertEqual(states["location"], "flag")

    def test_flags_never_ko_a_job(self) -> None:
        job = mkjob(salary_min=50_000, salary_max=70_000, location="Brno", seniority="medior")
        with_prefs = _cand(salary_expectation=SalaryExpectation(amount=500_000, currency=CUR), preferred_locations=["Ostrava"])
        self.assertTrue(ko_filter(with_prefs, job)[0])
        resp = match(with_prefs, [job], limit=5)
        self.assertEqual(resp.meta["koFiltered"], 0)
        self.assertEqual(len(resp.matches), 1)
        self.assertEqual({f.key: f.state for f in resp.matches[0].eligibility}["salary"], "flag")

    def test_ranking_order_unchanged_by_preferences(self) -> None:
        jobs = [
            mkjob(title="A", salary_min=40_000, salary_max=50_000, location="Brno", seniority="medior"),
            mkjob(title="B", salary_min=90_000, salary_max=120_000, location="Praha", seniority="medior",
                  requirements=[{"skill": "Python", "kind": "must_have"}, {"skill": "Rust", "kind": "must_have"}]),
        ]
        plain = match(_cand(), jobs).matches
        prefs = match(_cand(salary_expectation=SalaryExpectation(amount=100_000, currency=CUR), preferred_locations=["Praha"]), jobs).matches
        self.assertEqual([(m.job_id, m.total) for m in plain], [(m.job_id, m.total) for m in prefs])


class BuildMatchCandidatePreferencesTest(unittest.TestCase):
    def _profile(self) -> CandidateProfileV2:
        return CandidateProfileV2(
            archetype="bau",
            role_family="software_engineering",
            seniority="medior",
            languages=["Czech", "English"],
            skill_claims=[SkillClaim(skill="Python", provenance="professional")],
        )

    def test_single_arg_call_unchanged(self) -> None:
        c = build_match_candidate(self._profile())
        self.assertIsNone(c.salary_expectation)
        self.assertEqual(c.preferred_locations, [])
        self.assertEqual(c.preferred_countries, [])
        self.assertEqual(c.seniority, "medior")
        self.assertEqual(build_match_candidate(self._profile(), None), c)

    def test_preferences_map_onto_the_candidate(self) -> None:
        c = build_match_candidate(
            self._profile(),
            {
                "salaryFloor": {"amount": 80000, "currency": "czk", "period": "year"},
                "locations": ["Praha", " Brno "],
                "countries": ["CZ", "de"],
                "workModes": ["remote", "hybrid"],
                "seniority": "senior",
                # Was pinned as "ignored here": targets only steered fetching, so a
                # career changer was ranked by their past. They now reach the career
                # score's direction term (lot A2.1, test_matching_targets.py) — and
                # only that term; the eligibility flags asserted here never read them.
                "targetTitles": ["AI Engineer"],
                "targetRoleFamilies": ["data_ai"],
            },
        )
        self.assertEqual(c.target_titles, ["AI Engineer"])
        self.assertEqual(c.target_role_families, ["data_ai"])
        self.assertEqual(c.salary_expectation, SalaryExpectation(amount=80000.0, currency="czk", period="year"))
        self.assertEqual(c.preferred_locations, ["Praha", "Brno"])
        self.assertEqual(c.preferred_countries, ["cz", "de"])
        self.assertEqual(c.preferred_work_modes, ["remote", "hybrid"])
        self.assertEqual(c.seniority, "senior")

    def test_empty_and_malformed_preferences_are_inert(self) -> None:
        base = build_match_candidate(self._profile())
        c = build_match_candidate(
            self._profile(),
            {"salaryFloor": None, "locations": [], "countries": [], "workModes": [], "seniority": None},
        )
        self.assertEqual(c, base)
        # A floor with no currency is dropped, not guessed; a non-positive amount too.
        self.assertIsNone(apply_preferences(base, {"salaryFloor": {"amount": 100, "currency": ""}}).salary_expectation)
        self.assertIsNone(apply_preferences(base, {"salaryFloor": {"amount": 0, "currency": "CZK"}}).salary_expectation)
        # An unknown period falls back to month.
        self.assertEqual(
            apply_preferences(base, {"salaryFloor": {"amount": 1, "currency": "CZK", "period": "week"}}).salary_expectation.period,
            "month",
        )

    def test_empty_work_modes_do_not_erase_an_existing_preference(self) -> None:
        base = build_match_candidate(self._profile()).model_copy(update={"preferred_work_modes": ["remote"]})
        self.assertEqual(apply_preferences(base, {"workModes": []}).preferred_work_modes, ["remote"])


class MatchCliPreferencesTest(unittest.TestCase):
    def _run(self, argv_extra: list[str], files: dict[str, object]) -> dict:
        with tempfile.TemporaryDirectory() as tmp:
            argv: list[str] = []
            for flag, payload in files.items():
                path = Path(tmp) / f"{flag.strip('-')}.json"
                path.write_text(json.dumps(payload, ensure_ascii=False), encoding="utf-8")
                argv += [flag, str(path)]
            argv += argv_extra
            out = io.StringIO()
            with contextlib.redirect_stdout(out):
                code = match_main(argv)
            return {"code": code, "payload": json.loads(out.getvalue() or "{}")}

    def test_preferences_json_end_to_end(self) -> None:
        job = mkjob(
            title="Tiny Corpus Engineer",
            seniority="medior",
            location="Brno",
            salary_min=50_000,
            salary_max=70_000,
        ).model_dump(mode="json")
        # --jobs pointing at a one-job corpus so the run is hermetic and fast.
        with tempfile.TemporaryDirectory() as tmp:
            corpus = Path(tmp) / "corpus.json"
            corpus.write_text(json.dumps([job]), encoding="utf-8")
            candidate = {"skills": ["Python"], "seniority": "medior", "languages": ["English"], "educationLevel": "bachelor"}
            prefs = {"salaryFloor": {"amount": 90000, "currency": CUR, "period": PERIOD}, "locations": ["Praha"]}
            without = self._run(["--jobs", str(corpus)], {"--candidate-json": candidate})
            with_prefs = self._run(["--jobs", str(corpus)], {"--candidate-json": candidate, "--preferences-json": prefs})
        self.assertEqual(without["code"], 0)
        self.assertEqual(with_prefs["code"], 0)
        a, b = without["payload"]["matches"], with_prefs["payload"]["matches"]
        self.assertEqual(len(a), 1)
        self.assertEqual(len(b), 1)
        # Same score, same tier: preferences never move the number.
        self.assertEqual(a[0]["total"], b[0]["total"])
        self.assertEqual(a[0]["fitTier"], b[0]["fitTier"])
        # camelCase on the wire, and the two seeker flags fired.
        states = {f["key"]: f["state"] for f in b[0]["eligibility"]}
        self.assertEqual(states["salary"], "flag")
        self.assertEqual(states["location"], "flag")
        self.assertEqual({f["key"]: f["state"] for f in a[0]["eligibility"]}["salary"], "unknown")


if __name__ == "__main__":
    unittest.main()
