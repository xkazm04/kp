"""Single source of truth for the market/locale a compensation figure lives in.

The pipeline was born Czech: the salary plausibility ceiling (``salary_band``),
the currency/period a bare pay figure defaults to (``pipeline``), and the city an
ad without a location is assumed to be in (``jobs.DEFAULT_POLICY``) were all
hardcoded CZK/Praha literals scattered across three modules. :class:`MarketConfig`
gathers them into ONE record so a market is defined once, and the consumers read
the active config instead of re-typing a locale constant.

The **Czech market is the product default** and :data:`CZECH_MARKET` reproduces the
previously-hardcoded values EXACTLY, so every existing fixture is byte-identical.
:data:`BERLIN_MARKET` is a second sample that proves the seam is real (it changes
currency/period/ceiling/location) — NOT a claim that we hold real German benchmark
data (see the module's non-goal).
"""

from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True)
class MarketConfig:
    """The locale/market a compensation figure is denominated and reasoned in.

    * ``market_id`` — stable slug (e.g. ``"cz"``).
    * ``currency`` — ISO-4217 code a bare pay figure defaults to (mirrors the TS
      ``APP_CURRENCY`` in ``app/_lib/format.ts``; a guard test keeps them equal).
    * ``period`` — the pay period the ceiling and defaults are expressed in
      (``"hour" | "month" | "year"``).
    * ``plausibility_ceiling`` — the largest plausible SINGLE gross figure in
      ``currency`` per ``period``; a band above it is almost certainly a data error
      (a yearly figure read as monthly, a stray zero) and is flagged for review.
    * ``default_location`` — the market hub stamped onto an ad that names no city.
    * ``benchmark_source_id`` — id of the anchor/benchmark dataset the bands come
      from (provenance; ties back to ``salary_benchmarks.json``).
    """

    market_id: str
    currency: str
    period: str
    plausibility_ceiling: int
    default_location: str
    benchmark_source_id: str


# The product default. These values reproduce the constants that were hardcoded in
# salary_band.py (350_000 CZK/month), pipeline.py (CZK/month defaults) and
# jobs.py (DEFAULT_POLICY location "Praha") EXACTLY — do not "tidy" them or existing
# fixtures shift. 350k CZK/month sits well above the top of the Czech market.
CZECH_MARKET = MarketConfig(
    market_id="cz",
    currency="CZK",
    period="month",
    plausibility_ceiling=350_000,
    default_location="Praha",
    benchmark_source_id="cz-ispv-2025",
)

# A second sample market that exercises the seam end-to-end (different currency,
# ceiling and hub). NON-GOAL: this does not ship real German benchmark bands — it
# exists so tests can prove the config actually drives behaviour, not to be a
# production EUR market.
BERLIN_MARKET = MarketConfig(
    market_id="de-berlin",
    currency="EUR",
    period="month",
    plausibility_ceiling=30_000,
    default_location="Berlin",
    benchmark_source_id="de-berlin-sample",
)


# The single switch point every consumer reads. Flip this to re-home the pipeline;
# leaving it CZECH_MARKET keeps all outputs identical to before this seam existed.
ACTIVE_MARKET: MarketConfig = CZECH_MARKET


# Human phrasing for a pay period. The JD-extraction prompt used to hardcode
# "gross monthly"; it now reads the active market's period through this map so the
# period assumption re-homes with the market (a year-denominated market would ask
# the parser for the "gross annual" range) instead of staying a stranded literal.
# For the Czech default (period "month") this yields "gross monthly" byte-for-byte.
_GROSS_PERIOD_PHRASE: dict[str, str] = {
    "hour": "gross hourly",
    "month": "gross monthly",
    "year": "gross annual",
}


def gross_period_phrase(period: str) -> str:
    """The 'gross monthly' / 'gross annual' / 'gross hourly' phrase for a pay
    ``period``, defaulting to ``"gross <period>"`` for an unmapped value."""
    return _GROSS_PERIOD_PHRASE.get(period, f"gross {period}")
