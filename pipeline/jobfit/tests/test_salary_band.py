import unittest

from pipeline.jobfit.market_config import BERLIN_MARKET, CZECH_MARKET
from pipeline.jobfit.salary_band import band_error, normalize_band, round_salary

# normalize_band REPAIRS an untrusted band (swap reversed, round, reject
# non-positive) — mirror of salary-band.ts normalizeSalaryBand (+ rounding).
NORMALIZE_CASES = [
    (50000, 70000, (50000, 70000)),  # already valid
    (70000, 50000, (50000, 70000)),  # reversed -> swapped
    (47300, 61800, (45000, 60000)),  # rounded to nearest 5000
    (60000, 60000, (60000, 60000)),  # equal endpoints allowed
    (0, 60000, None),                # non-positive min -> no usable band
    (60000, 0, None),                # non-positive max
    (-10, -5, None),                 # negative
]

# band_error VALIDATES for authoring — a reversed range is an error here even
# though normalize_band would repair it. Mirror of salary-band.ts salaryBandError.
ERROR_CASES = [
    (50000, 70000, None),
    (70000, 50000, "Minimum can't exceed the maximum."),
    (0, 10, "Enter a positive minimum and maximum."),
    (60000, 0, "Enter a positive minimum and maximum."),
]


class SalaryBandTest(unittest.TestCase):
    def test_round_salary_nearest_step(self) -> None:
        self.assertEqual(round_salary(47300), 45000)
        self.assertEqual(round_salary(61800), 60000)
        self.assertEqual(round_salary(58000), 60000)
        self.assertEqual(round_salary(0), 0)

    def test_normalize_band_matches_fixture(self) -> None:
        for lo, hi, expected in NORMALIZE_CASES:
            self.assertEqual(normalize_band(lo, hi), expected, msg=f"normalize_band({lo}, {hi})")

    def test_band_error_matches_fixture(self) -> None:
        for lo, hi, expected in ERROR_CASES:
            self.assertEqual(band_error(lo, hi), expected, msg=f"band_error({lo}, {hi})")

    def test_non_finite_rejected(self) -> None:
        self.assertIsNone(normalize_band(float("inf"), 50000))
        self.assertIsNotNone(band_error(float("nan"), 50000))


class SalaryStepFollowsMarketTest(unittest.TestCase):
    """The rounding grain is MarketConfig-driven (``salary_step``): the Czech default
    rounds to the nearest 5000 byte-for-byte, a finer-grained market to its own step."""

    def test_czech_default_rounds_to_5000_byte_identical(self) -> None:
        self.assertEqual(CZECH_MARKET.salary_step, 5000)
        # No market kwarg == the ACTIVE (Czech) market: unchanged behaviour.
        self.assertEqual(round_salary(47300), 45000)
        self.assertEqual(round_salary(47300, market=CZECH_MARKET), 45000)
        self.assertEqual(
            normalize_band(47300, 61800, market=CZECH_MARKET), (45000, 60000)
        )

    def test_berlin_flip_rounds_on_the_finer_grain(self) -> None:
        # A EUR/month market rounds to the nearest 500, not 5000 — 4,200 stays 4,000,
        # never collapsing to 5,000 the way the flat CZK grain would.
        self.assertEqual(BERLIN_MARKET.salary_step, 500)
        self.assertEqual(round_salary(4200, market=BERLIN_MARKET), 4000)
        self.assertEqual(round_salary(4790, market=BERLIN_MARKET), 5000)
        self.assertEqual(
            normalize_band(4230, 6180, market=BERLIN_MARKET), (4000, 6000)
        )
        # The same figure under the Czech grain rounds to a coarse multiple of 5000,
        # proving the step actually re-homes with the market.
        self.assertEqual(round_salary(4200, market=CZECH_MARKET), 5000)


if __name__ == "__main__":
    unittest.main()
