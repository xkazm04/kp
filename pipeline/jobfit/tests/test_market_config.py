"""Contract for the compensation MarketConfig seam (Direction 2, matching-engine).

The CZK/Praha market was hardcoded across salary_band, pipeline and jobs. This
pins three things:

1. the Czech default reproduces the previously-hardcoded values EXACTLY, so every
   existing fixture is byte-identical (currency CZK, period month, ceiling 350k,
   hub "Praha");
2. the three consumers actually READ the active config (not a stale literal);
3. a second sample market (EUR/Berlin) proves the seam — swapping the config
   swaps the pipeline's currency/period defaults — without shipping real German
   benchmark data.

It also keeps the Python default in sync with the two cross-boundary values it
mirrors: the TS ``APP_CURRENCY`` (app/_lib/format.ts) and the currency declared in
``salary_benchmarks.json``.
"""

from __future__ import annotations

import json
import re
import unittest
from pathlib import Path

from pipeline.jobfit import salary_band
from pipeline.jobfit.jobs import DEFAULT_POLICY, _build_extraction_prompt
from pipeline.jobfit.market_config import (
    ACTIVE_MARKET,
    BERLIN_MARKET,
    CZECH_MARKET,
    currency_unit,
    gross_period_phrase,
)
from pipeline.jobfit.pipeline import _annual_ceiling_for, _normalize_currency_period

REPO_ROOT = Path(__file__).resolve().parents[3]
FORMAT_TS = REPO_ROOT / "app" / "_lib" / "format.ts"
BENCHMARKS_JSON = REPO_ROOT / "data" / "salary_benchmarks.json"


class CzechDefaultIsUnchangedTest(unittest.TestCase):
    def test_active_market_is_the_czech_default(self) -> None:
        self.assertIs(ACTIVE_MARKET, CZECH_MARKET)

    def test_czech_values_match_the_old_hardcoded_constants(self) -> None:
        self.assertEqual(CZECH_MARKET.currency, "CZK")
        self.assertEqual(CZECH_MARKET.period, "month")
        self.assertEqual(CZECH_MARKET.plausibility_ceiling, 350_000)
        self.assertEqual(CZECH_MARKET.default_location, "Praha")
        # The company-adjustment band, byte-identical to the old insights.py literals.
        self.assertEqual(CZECH_MARKET.company_adjustment_max, 1.20)
        self.assertEqual(CZECH_MARKET.company_adjustment_min, 0.75)


class ConsumersReadTheConfigTest(unittest.TestCase):
    def test_salary_band_ceiling_comes_from_the_active_market(self) -> None:
        self.assertEqual(
            salary_band.SALARY_PLAUSIBILITY_CEILING, ACTIVE_MARKET.plausibility_ceiling
        )
        # Byte-identical to the old literal for the Czech default.
        self.assertEqual(salary_band.SALARY_PLAUSIBILITY_CEILING, 350_000)

    def test_default_policy_location_comes_from_the_active_market(self) -> None:
        self.assertEqual(DEFAULT_POLICY["location"], ACTIVE_MARKET.default_location)
        self.assertEqual(DEFAULT_POLICY["location"], "Praha")

    def test_company_adjustment_band_comes_from_the_active_market(self) -> None:
        from pipeline.jobfit import insights

        self.assertEqual(insights._MAX_ADJUSTMENT, ACTIVE_MARKET.company_adjustment_max)
        self.assertEqual(insights._MIN_ADJUSTMENT, ACTIVE_MARKET.company_adjustment_min)
        # Byte-identical to the old literals for the Czech default.
        self.assertEqual(insights._MAX_ADJUSTMENT, 1.20)
        self.assertEqual(insights._MIN_ADJUSTMENT, 0.75)

    def test_currency_period_default_follows_the_active_market(self) -> None:
        # Empty inputs fall back to the active market baseline (CZK/month).
        self.assertEqual(_normalize_currency_period(None, None), ("CZK", "month"))
        self.assertEqual(_normalize_currency_period("", ""), ("CZK", "month"))
        # A stated currency/period still wins and is only tidied (case/whitespace).
        self.assertEqual(_normalize_currency_period(" eur ", " YEAR "), ("EUR", "year"))


class SeamProvenBySecondMarketTest(unittest.TestCase):
    """Swapping the config swaps behaviour — the seam is real, not cosmetic."""

    def test_berlin_config_differs_on_every_market_axis(self) -> None:
        self.assertNotEqual(BERLIN_MARKET.currency, CZECH_MARKET.currency)
        self.assertNotEqual(BERLIN_MARKET.plausibility_ceiling, CZECH_MARKET.plausibility_ceiling)
        self.assertNotEqual(BERLIN_MARKET.default_location, CZECH_MARKET.default_location)
        # The non-production Berlin stub carries its own (placeholder) adjustment band,
        # proving the clamp re-homes with the market rather than staying a Czech literal.
        self.assertNotEqual(BERLIN_MARKET.company_adjustment_max, CZECH_MARKET.company_adjustment_max)

    def test_pipeline_defaults_switch_under_the_berlin_market(self) -> None:
        # The same empty input now defaults to EUR/month instead of CZK/month,
        # proving the pipeline default reads the injected config.
        self.assertEqual(
            _normalize_currency_period(None, None, market=BERLIN_MARKET), ("EUR", "month")
        )


class MultiCurrencyCeilingSeamTest(unittest.TestCase):
    """The per-currency annual plausibility ceiling is MarketConfig-driven: the
    active market OWNS its home currency's ceiling (derived from its declared
    plausibility_ceiling), while every OTHER currency comes from a fixed neutral
    table that does NOT move when the market flips. Pre-fix, the CZK row was
    ``ACTIVE_MARKET.plausibility_ceiling x 12`` so flipping to a EUR market would
    have collapsed the CZK bound to ~30k x 12 and flagged every real Czech salary.
    """

    def test_czech_default_is_byte_identical(self) -> None:
        # Home currency under the Czech default: 350k/month x12 = 4.2M/yr.
        self.assertEqual(_annual_ceiling_for("CZK"), 4_200_000)
        self.assertEqual(_annual_ceiling_for("CZK", market=CZECH_MARKET), 4_200_000)
        # A foreign currency comes from the neutral table.
        self.assertEqual(_annual_ceiling_for("EUR"), 600_000)

    def test_berlin_flip_leaves_czk_ceiling_correct(self) -> None:
        # Re-homing to the EUR/Berlin market must NOT drag the CZK bound down to the
        # Berlin ceiling x12 (~360k) — a foreign currency keeps its neutral bound.
        self.assertEqual(_annual_ceiling_for("CZK", market=BERLIN_MARKET), 4_200_000)
        # ...while the now-home EUR currency is derived from Berlin's ceiling:
        # 30k/month x12 = 360k/yr (its declared sample ceiling), not the neutral 600k.
        self.assertEqual(
            _annual_ceiling_for("EUR", market=BERLIN_MARKET),
            BERLIN_MARKET.plausibility_ceiling * 12,
        )
        self.assertEqual(_annual_ceiling_for("EUR", market=BERLIN_MARKET), 360_000)

    def test_home_ceiling_tracks_the_declared_ceiling_in_lockstep(self) -> None:
        # The home currency bound is always the market's own annualized ceiling.
        for market in (CZECH_MARKET, BERLIN_MARKET):
            self.assertEqual(
                _annual_ceiling_for(market.currency, market=market),
                market.plausibility_ceiling * 12,
            )


class ExtractionPromptPeriodFollowsMarketTest(unittest.TestCase):
    """The JD-extraction prompt's salary-period assumption is MarketConfig-driven,
    not a hardcoded 'gross monthly' literal."""

    def test_czech_default_prompt_says_gross_monthly(self) -> None:
        self.assertEqual(gross_period_phrase("month"), "gross monthly")
        self.assertIn("gross monthly pay range", _build_extraction_prompt())

    def test_phrase_follows_the_period(self) -> None:
        self.assertEqual(gross_period_phrase("year"), "gross annual")
        self.assertEqual(gross_period_phrase("hour"), "gross hourly")


class CurrencyUnitFollowsMarketTest(unittest.TestCase):
    """The candidate-facing salary unit ('Kč/měsíc', 'CZK/month') is
    MarketConfig-driven: the native symbol in the market's home language, the ISO
    code everywhere else — never a hardcoded Czech literal."""

    def test_czech_default_is_byte_identical(self) -> None:
        # The exact strings the old hardcoded literal produced.
        self.assertEqual(currency_unit("cs"), "Kč/měsíc")
        self.assertEqual(currency_unit("en"), "CZK/month")
        # Other app locales use the ISO code with a native period word.
        self.assertEqual(currency_unit("de"), "CZK/Monat")
        self.assertEqual(currency_unit("fr"), "CZK/mois")

    def test_non_czk_market_renders_its_own_unit(self) -> None:
        # Home language → native symbol; any other → ISO code. Never relabelled CZK.
        self.assertEqual(currency_unit("de", market=BERLIN_MARKET), "€/Monat")
        self.assertEqual(currency_unit("en", market=BERLIN_MARKET), "EUR/month")
        self.assertNotIn("CZK", currency_unit("cs", market=BERLIN_MARKET))


class CrossBoundarySyncTest(unittest.TestCase):
    """The Python default currency must equal the two values it mirrors, so the
    three sources can never silently disagree about what a bare band is priced in."""

    def test_matches_ts_app_currency(self) -> None:
        text = FORMAT_TS.read_text(encoding="utf-8")
        match = re.search(r'\bAPP_CURRENCY\s*=\s*["\']([^"\']+)["\']', text)
        self.assertIsNotNone(match, f"could not find APP_CURRENCY in {FORMAT_TS}")
        self.assertEqual(
            match.group(1),
            ACTIVE_MARKET.currency,
            "app/_lib/format.ts APP_CURRENCY drifted from the active MarketConfig currency.",
        )

    def test_matches_benchmark_currency(self) -> None:
        benchmarks = json.loads(BENCHMARKS_JSON.read_text(encoding="utf-8"))
        self.assertEqual(
            benchmarks.get("currency"),
            ACTIVE_MARKET.currency,
            "salary_benchmarks.json currency drifted from the active MarketConfig currency.",
        )


if __name__ == "__main__":
    unittest.main()
