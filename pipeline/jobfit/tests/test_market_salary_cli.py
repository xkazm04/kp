"""The deterministic salary band must say WHERE it came from and HOW OLD it is.

Two defects are pinned here. (1) The band a keyless build advertises is read off a
2025 benchmark vintage and rendered as a timeless fact, and a family hand-entered
with no sample behind it renders identically to one measured on 838 rows — so the
payload now carries ``benchmark: {sourceId, asOf, sampleK}`` and the surfaces can
say so. (2) ``_FALLBACK_SUMMARY`` covered en/cs while ``normalize_lang`` accepts
all four app locales, so a German or French JD baked the ENGLISH sentence into a
candidate-facing posting.
"""

import unittest

from pipeline.jobfit.i18n import normalize_lang
from pipeline.jobfit.market_config import BERLIN_MARKET, CZECH_MARKET
from pipeline.jobfit.market_salary_cli import _FALLBACK_SUMMARY, _coerce, _fallback
from pipeline.jobfit.taxonomy import THIN_SAMPLE_K, role_band, role_benchmark

# The app's four locales (messages/{en,cs,de,fr}.json). The CLI's --lang is the
# POSTING's language, so every one of them must get a native sentence.
APP_LOCALES = ("en", "cs", "de", "fr")


class RoleBenchmarkTest(unittest.TestCase):
    def test_band_agrees_with_role_band(self) -> None:
        """The provenance lookup must not become a second, drifting band source."""
        for family in ("software_engineering", "operations_logistics", "hr_people"):
            for seniority in ("junior", "medior", "senior", "lead"):
                bm = role_benchmark(family, seniority)
                self.assertIsNotNone(bm, msg=f"{family}/{seniority}")
                self.assertEqual(bm["band"], role_band(family, seniority))

    def test_measured_family_carries_source_vintage_and_sample(self) -> None:
        bm = role_benchmark("operations_logistics", "medior")
        self.assertEqual(bm["sourceId"], CZECH_MARKET.benchmark_source_id)
        self.assertEqual(bm["sourceId"], "cz-ispv-2025")
        # An ISO-8601 vintage, not an empty string: this is the whole point.
        self.assertTrue(bm["asOf"].startswith("20"), msg=bm["asOf"])
        self.assertIsInstance(bm["sampleK"], int)
        self.assertGreater(bm["sampleK"], THIN_SAMPLE_K)

    def test_hand_entered_family_reports_no_sample_not_zero(self) -> None:
        """``product_project``/``hr_people`` are ``source: "manual"`` with no
        ``sample_k``. ``None`` means "no sample", never "zero rows"."""
        for family in ("product_project", "hr_people"):
            bm = role_benchmark(family, "medior")
            self.assertIsNone(bm["sampleK"], msg=family)

    def test_thin_sample_is_reported_as_a_number_not_hidden(self) -> None:
        # life_sciences_research rests on 19 ISPV rows — a real band, a thin one.
        bm = role_benchmark("life_sciences_research", "medior")
        self.assertEqual(bm["sampleK"], 19)
        self.assertLess(bm["sampleK"], THIN_SAMPLE_K)

    def test_second_market_reports_its_own_provenance(self) -> None:
        bm = role_benchmark("software_engineering", "medior", market=BERLIN_MARKET)
        self.assertEqual(bm["sourceId"], "de-berlin-sample")
        # The sample block carries no generated_at — an empty vintage, never the
        # Czech block's date borrowed across markets.
        self.assertEqual(bm["asOf"], "")
        self.assertIsNone(bm["sampleK"])

    def test_unknown_family_misses_exactly_like_role_band(self) -> None:
        self.assertIsNone(role_band("not_a_family", "medior"))
        self.assertIsNone(role_benchmark("not_a_family", "medior"))


class FallbackBenchmarkPayloadTest(unittest.TestCase):
    def test_deterministic_result_carries_benchmark_provenance(self) -> None:
        out = _fallback("software_engineering", "senior")
        self.assertIn("benchmark", out)
        self.assertEqual(out["benchmark"]["sourceId"], "cz-ispv-2025")
        self.assertTrue(out["benchmark"]["asOf"])
        self.assertEqual(out["benchmark"]["sampleK"], 117)
        # The band itself is unchanged by the provenance work.
        self.assertEqual(
            (out["suggestedMinimum"], out["suggestedMaximum"]),
            role_band("software_engineering", "senior"),
        )

    def test_taxonomy_miss_carries_no_benchmark(self) -> None:
        """A 0-0 band is not a benchmark reading, so it must not wear one."""
        out = _fallback("not_a_family", "medior")
        self.assertEqual((out["suggestedMinimum"], out["suggestedMaximum"]), (0, 0))
        self.assertIsNone(out["benchmark"])

    def test_grounded_result_is_not_credited_to_the_table(self) -> None:
        out, grounded = _coerce(
            {"suggestedMinimum": 90000, "suggestedMaximum": 120000, "confidence": "high", "summary": "x"},
            "software_engineering",
            "senior",
        )
        self.assertTrue(grounded)
        # Present on the wire and explicitly null: a live-web band did not come from
        # the 2025 table and must not carry its vintage.
        self.assertIn("benchmark", out)
        self.assertIsNone(out["benchmark"])

    def test_unusable_grounded_payload_degrades_to_the_benchmarked_band(self) -> None:
        out, grounded = _coerce({"suggestedMinimum": "85 000"}, "software_engineering", "senior")
        self.assertFalse(grounded)
        self.assertEqual(out["benchmark"]["sourceId"], "cz-ispv-2025")

    def test_berlin_fallback_labels_and_sources_the_same_market(self) -> None:
        out = _fallback("software_engineering", "medior", market=BERLIN_MARKET)
        self.assertEqual(out["currency"], "EUR")
        self.assertEqual(out["benchmark"]["sourceId"], "de-berlin-sample")


class FallbackSummaryLocaleTest(unittest.TestCase):
    def test_every_app_locale_has_a_native_sentence(self) -> None:
        for lang in APP_LOCALES:
            self.assertIn(normalize_lang(lang), _FALLBACK_SUMMARY, msg=lang)

    def test_no_locale_silently_serves_the_english_sentence(self) -> None:
        english = _FALLBACK_SUMMARY["en"]
        for lang in APP_LOCALES:
            summary = _fallback("software_engineering", "medior", lang)["summary"]
            self.assertTrue(summary.strip(), msg=lang)
            if lang != "en":
                self.assertNotEqual(summary, english, msg=f"--lang {lang} baked the English sentence into the posting")

    def test_unknown_code_still_resolves_to_english_rather_than_raising(self) -> None:
        self.assertEqual(_fallback("software_engineering", "medior", "zz")["summary"], _FALLBACK_SUMMARY["en"])

    def test_summaries_are_distinct_per_locale(self) -> None:
        rendered = {lang: _fallback("software_engineering", "medior", lang)["summary"] for lang in APP_LOCALES}
        self.assertEqual(len(set(rendered.values())), len(APP_LOCALES), msg=rendered)


if __name__ == "__main__":
    unittest.main()
