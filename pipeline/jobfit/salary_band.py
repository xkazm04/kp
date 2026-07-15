"""Single Python authority for the salary-band money invariant.

A valid band is two positive numbers with ``min <= max``; a reversed range is
repaired by swapping rather than dropped, and non-positive / non-finite values
are rejected. Salaries round to the nearest :data:`SALARY_STEP` so a band like
47,300-61,800 reads as 45k-60k, never spuriously precise.

This mirrors the documented contract of ``app/_lib/salary-band.ts``
(``normalizeSalaryBand`` / ``salaryBandError``) so the band a JD advertises and
the band the matching pipeline emits can never drift apart. These are numbers
users negotiate against — keep the rule in exactly ONE place per language. See
``tests/test_salary_band.py`` for the shared fixture both sides are checked
against.
"""

from __future__ import annotations

import math

from .market_config import ACTIVE_MARKET, MarketConfig

# Salaries round to the nearest ``salary_step`` of the ACTIVE market (5000 for the
# CZK/month default — a 47,300-61,800 band reads as 45k-60k). The grain now lives on
# ``MarketConfig.salary_step`` so a finer-grained currency (a EUR/month market, where
# rounding to the nearest 5000 would erase the figure) re-homes it in lockstep with
# the currency rather than leaving this literal stranded. For the Czech default this
# is 5000 byte-for-byte.
SALARY_STEP = ACTIVE_MARKET.salary_step

# Plausibility ceiling for a single gross salary figure, in the ACTIVE market's
# currency/period (the same market and period the pipeline emits by default — see
# ``SalaryEstimate`` currency/period defaults in pipeline._salary_from_payload).
# A band whose maximum exceeds this is almost certainly a data error — a yearly
# figure mistaken for monthly, or a stray extra zero — rather than a real offer,
# so the analysis flags it for manual review instead of trusting it. For the
# Czech default this is 350k CZK/month, which sits well above the top of the Czech
# market (senior/principal and most exec comp land far below it), giving generous
# headroom while still catching garbage. The value now lives on
# ``MarketConfig.plausibility_ceiling`` so re-homing the market moves it in lockstep
# with the currency/period rather than leaving this literal stranded.
SALARY_PLAUSIBILITY_CEILING = ACTIVE_MARKET.plausibility_ceiling


def round_salary(value: float, *, market: MarketConfig = ACTIVE_MARKET) -> int:
    """Round a salary to the nearest ``market.salary_step`` (default: the ACTIVE
    market's grain, 5000 for the Czech default)."""
    step = market.salary_step
    return int(round(value / step) * step)


def _positive_finite(value: float) -> bool:
    return math.isfinite(value) and value > 0


def normalize_band(
    minimum: float, maximum: float, *, market: MarketConfig = ACTIVE_MARKET
) -> tuple[int, int] | None:
    """Sanitize an untrusted ``(min, max)`` into a usable, rounded band.

    Swaps a reversed range and rejects non-finite / non-positive values; returns
    ``None`` when no usable band can be formed, so callers fall back instead of
    advertising garbage. Mirror of salary-band.ts ``normalizeSalaryBand`` (plus
    the shared rounding).
    """
    if not _positive_finite(minimum) or not _positive_finite(maximum):
        return None
    lo, hi = (minimum, maximum) if minimum <= maximum else (maximum, minimum)
    return round_salary(lo, market=market), round_salary(hi, market=market)


def band_error(minimum: float, maximum: float) -> str | None:
    """Human-readable reason a ``(min, max)`` band is invalid, or ``None`` if it
    is fine. Mirror of salary-band.ts ``salaryBandError``."""
    if not _positive_finite(minimum) or not _positive_finite(maximum):
        return "Enter a positive minimum and maximum."
    if minimum > maximum:
        return "Minimum can't exceed the maximum."
    return None
