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
from pipeline.jobfit.jobs import DEFAULT_POLICY
from pipeline.jobfit.market_config import ACTIVE_MARKET, BERLIN_MARKET, CZECH_MARKET
from pipeline.jobfit.pipeline import _normalize_currency_period

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

    def test_pipeline_defaults_switch_under_the_berlin_market(self) -> None:
        # The same empty input now defaults to EUR/month instead of CZK/month,
        # proving the pipeline default reads the injected config.
        self.assertEqual(
            _normalize_currency_period(None, None, market=BERLIN_MARKET), ("EUR", "month")
        )


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
