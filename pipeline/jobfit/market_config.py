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
    * ``currency_symbol`` — the native glyph shown in the market's home language
      (``"Kč"`` for CZK), with the ISO code used in every other language — so a
      campaign salary line reads ``"Kč/měsíc"`` for a Czech reader and
      ``"CZK/month"`` for everyone else. See :func:`currency_unit`.
    * ``home_lang`` — the output language that reads as native for this market
      (``"cs"`` for the Czech market): the language in which the native currency
      symbol and native period word are used.
    * ``market_descriptor`` — the human phrase naming this market in generated
      copy, e.g. ``"Czech"`` in "a recruitment-marketing copywriter for the
      Czech tech market". Drives the campaign system prompt so the LLM is told
      the RIGHT market instead of a hardcoded "Czech" on every generation.
    * ``period`` — the pay period the ceiling and defaults are expressed in
      (``"hour" | "month" | "year"``).
    * ``plausibility_ceiling`` — the largest plausible SINGLE gross figure in
      ``currency`` per ``period``; a band above it is almost certainly a data error
      (a yearly figure read as monthly, a stray zero) and is flagged for review.
    * ``default_location`` — the market hub stamped onto an ad that names no city.
    * ``benchmark_source_id`` — id of the anchor/benchmark dataset the bands come
      from (provenance; ties back to ``salary_benchmarks.json``).
    * ``company_adjustment_max`` / ``company_adjustment_min`` — the defensible
      clamp on the cumulative company-compensation multiplier (insights.py). The
      band is market-calibrated (the Czech ceiling aligns with the upper end of
      the Kitalent Prague multinational base premium), so like the salary ceiling
      it must re-home with the market rather than stay a hardcoded literal.
    * ``salary_step`` — the rounding grain a band is snapped to (``round_salary``),
      in ``currency`` units. Flat 5 000 for a CZK/month market reads a
      47,300–61,800 range as 45k–60k; a EUR/month market must round on a far
      finer grain (rounding €4,200 to the nearest €5,000 would erase the figure),
      so the step re-homes with the currency rather than staying a stranded literal.
    * ``region_label`` — the human region phrase the grounded-salary CLI names in
      its research prompt (``"Czech Republic (Prague)"``); a bare
      ``default_location`` ("Praha") is not the country-qualified phrase the prompt
      needs, so the market carries the full label.
    """

    market_id: str
    currency: str
    period: str
    plausibility_ceiling: int
    default_location: str
    benchmark_source_id: str
    company_adjustment_max: float
    company_adjustment_min: float
    # Candidate-/prompt-facing market identity. Defaulted so the eight positional
    # fields above stay a stable construction contract; both shipped markets set
    # them explicitly.
    currency_symbol: str = ""
    home_lang: str = "en"
    market_descriptor: str = ""
    salary_step: int = 5000
    region_label: str = ""


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
    # Byte-identical to the previously-hardcoded insights.py band. 1.20 aligns with
    # the upper end of the Kitalent Prague multinational base premium (30–40% over
    # local mid-market); 0.75 floors a stacked-discount company.
    company_adjustment_max=1.20,
    company_adjustment_min=0.75,
    # "Kč" for a Czech reader, "CZK" for every other language (see currency_unit);
    # "Czech" fills the campaign system prompt's market phrase byte-for-byte.
    currency_symbol="Kč",
    home_lang="cs",
    market_descriptor="Czech",
    # Byte-identical to the previously-hardcoded salary_band.SALARY_STEP (5 000) and
    # market_salary_cli.REGION_DEFAULT ("Czech Republic (Prague)").
    salary_step=5000,
    region_label="Czech Republic (Prague)",
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
    # NON-PRODUCTION placeholders (like this stub's other fields): a tighter band
    # standing in for a real German multinational-premium calibration we don't hold.
    company_adjustment_max=1.15,
    company_adjustment_min=0.80,
    currency_symbol="€",
    home_lang="de",
    market_descriptor="German",
    # NON-PRODUCTION placeholders: a EUR/month market must round on a far finer
    # grain than CZK's 5 000 (that would erase a real euro figure), and the CLI
    # names the country-qualified region — both prove the fields re-home, not that
    # we hold real German calibration.
    salary_step=500,
    region_label="Germany (Berlin)",
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


# The candidate-facing period word per output language, for the salary-band unit
# suffix (``Kč/měsíc``, ``CZK/month``). Covers the app LOCALES (en/cs/de/fr); an
# unmapped language falls back to the bare period code so the unit is still honest.
_PERIOD_WORD: dict[str, dict[str, str]] = {
    "month": {"en": "month", "cs": "měsíc", "de": "Monat", "fr": "mois"},
    "year": {"en": "year", "cs": "rok", "de": "Jahr", "fr": "an"},
    "hour": {"en": "hour", "cs": "hodina", "de": "Stunde", "fr": "heure"},
}


def currency_unit(lang: str, *, market: MarketConfig = ACTIVE_MARKET) -> str:
    """The salary-band unit suffix (e.g. ``"Kč/měsíc"``, ``"CZK/month"``) for the
    ``market``'s currency and period, rendered in ``lang``.

    The market's native currency SYMBOL is used only when writing in its home
    language (``home_lang``); every other language uses the ISO currency CODE — so
    a Czech reader sees ``"Kč/měsíc"`` and everyone else ``"CZK/month"``, exactly
    the old hardcoded literal. A non-CZK market renders ITS own unit (``"€/Monat"``
    for a EUR/German reader, ``"EUR/month"`` otherwise), which is the whole point:
    the figure is never silently relabelled CZK.
    """
    period_word = _PERIOD_WORD.get(market.period, {}).get(lang) or market.period
    code = market.currency_symbol if (lang == market.home_lang and market.currency_symbol) else market.currency
    return f"{code}/{period_word}"
