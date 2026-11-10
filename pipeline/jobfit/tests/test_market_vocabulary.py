"""The product market vocabulary (cz/de/gb) and the per-spawn market switch.

``market_config.MARKETS`` is what a workspace owner can pick; the TS mirror is
``app/_lib/markets.ts`` (pinned to this module by ``app/_lib/markets.test.ts``). The
active market is read ONCE per process from ``KP_MARKET`` — every CLI is spawned per
request with its workspace's market in that variable — so the switch is exercised here
in a child interpreter, the same way the app exercises it.

The regression bar is the Czech default: with ``KP_MARKET`` unset (every other test,
fixture and eval) nothing moves. The new markets hold NO salary benchmark, so their
honest outputs are refusals, never another market's figures in their currency.
"""

from __future__ import annotations

import json
import os
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

from pipeline.jobfit import market_config
from pipeline.jobfit.market_config import (
    CZECH_MARKET,
    DE_MARKET,
    GB_MARKET,
    MARKET_ENV,
    MARKET_IDS,
    has_benchmark,
    market_for_id,
)
from pipeline.jobfit.pipeline import withhold_uncalibrated_salary
from pipeline.jobfit.models import SalaryEstimate
from pipeline.jobfit.taxonomy import role_band, role_benchmark

REPO = Path(__file__).resolve().parents[3]


def _child(code: str, market: str | None) -> str:
    env = {k: v for k, v in os.environ.items() if k != MARKET_ENV}
    if market is not None:
        env[MARKET_ENV] = market
    env["PYTHONIOENCODING"] = "utf-8"
    out = subprocess.run(
        [sys.executable, "-c", code], cwd=REPO, env=env, capture_output=True, text=True, encoding="utf-8", timeout=120
    )
    if out.returncode != 0:
        raise AssertionError(out.stderr)
    return out.stdout.strip()


class VocabularyTest(unittest.TestCase):
    def test_closed_list_and_default(self) -> None:
        self.assertEqual(MARKET_IDS, ("cz", "de", "gb"))
        self.assertEqual(market_config.DEFAULT_MARKET_ID, "cz")
        self.assertIs(market_for_id(None), CZECH_MARKET)
        self.assertIs(market_for_id("nope"), CZECH_MARKET)
        self.assertIs(market_for_id(" DE "), DE_MARKET)

    def test_only_cz_holds_a_benchmark(self) -> None:
        self.assertTrue(has_benchmark(CZECH_MARKET))
        self.assertFalse(has_benchmark(DE_MARKET))
        self.assertFalse(has_benchmark(GB_MARKET))
        # An uncalibrated market carries NO default bands (refuse-to-quote).
        self.assertEqual(dict(DE_MARKET.seniority_default_bands), {})
        self.assertEqual(dict(GB_MARKET.seniority_default_bands), {})

    def test_units(self) -> None:
        self.assertEqual((DE_MARKET.currency, DE_MARKET.period, DE_MARKET.default_location), ("EUR", "month", "Berlin"))
        self.assertEqual((GB_MARKET.currency, GB_MARKET.period, GB_MARKET.default_location), ("GBP", "year", "London"))
        self.assertEqual(market_config.currency_unit("de", market=DE_MARKET), "€/Monat")
        self.assertEqual(market_config.currency_unit("en", market=GB_MARKET), "£/year")
        self.assertEqual(market_config.currency_unit("cs", market=GB_MARKET), "GBP/rok")
        self.assertEqual(market_config.gross_period_phrase(GB_MARKET.period), "gross annual")

    def test_a_benchmarkless_market_reads_no_band(self) -> None:
        # The old lookup fell back to the ACTIVE (Czech) roles for a market with no
        # block: Czech magnitudes wearing a EUR label.
        self.assertIsNone(role_band("software_engineering", "medior", market=DE_MARKET))
        self.assertIsNone(role_benchmark("software_engineering", "medior", market=GB_MARKET))
        self.assertIsNotNone(role_band("software_engineering", "medior", market=CZECH_MARKET))

    def test_withheld_estimate_is_coded_and_in_market_units(self) -> None:
        repairs: list[str] = []
        est = SalaryEstimate(currency="EUR", period="month", minimum=4000, maximum=6000, midpoint=5000,
                             confidence="medium", rationale=["x"])
        out = withhold_uncalibrated_salary(est, repairs, market=GB_MARKET)
        self.assertEqual((out.minimum, out.maximum, out.midpoint), (0, 0, 0))
        self.assertEqual((out.currency, out.period), ("GBP", "year"))
        self.assertEqual([getattr(r, "code", None) for r in repairs], ["salary_no_market_benchmark"])
        self.assertEqual(repairs[0].value, "gb")


class PerSpawnSwitchTest(unittest.TestCase):
    """KP_MARKET is read at import, in the child: what the app does per request."""

    PROBE = (
        "import json\n"
        "from pipeline.jobfit.market_config import ACTIVE_MARKET\n"
        "from pipeline.jobfit import taxonomy, salary_band, insights\n"
        "from pipeline.jobfit.jobs import DEFAULT_POLICY\n"
        "print(json.dumps({'id': ACTIVE_MARKET.market_id, 'loc': DEFAULT_POLICY['location'],"
        " 'step': salary_band.SALARY_STEP, 'ceiling': salary_band.SALARY_PLAUSIBILITY_CEILING,"
        " 'families': len(taxonomy.ROLE_FAMILIES), 'band': taxonomy.role_band('software_engineering', 'medior')}))\n"
    )

    def test_unset_is_czech(self) -> None:
        got = json.loads(_child(self.PROBE, None))
        self.assertEqual(got["id"], "cz")
        self.assertEqual(got["loc"], "Praha")
        self.assertEqual((got["step"], got["ceiling"]), (5000, 350_000))
        self.assertIsNotNone(got["band"])

    def test_de_rehomes_without_inventing_a_band(self) -> None:
        cz = json.loads(_child(self.PROBE, None))
        got = json.loads(_child(self.PROBE, "de"))
        self.assertEqual(got["id"], "de")
        self.assertEqual(got["loc"], "Berlin")
        self.assertEqual((got["step"], got["ceiling"]), (500, 30_000))
        # Same role-family vocabulary (classification still works), no figures.
        self.assertEqual(got["families"], cz["families"])
        self.assertIsNone(got["band"])

    def test_unknown_id_falls_back_to_default_and_says_so(self) -> None:
        got = json.loads(_child(self.PROBE, "xx"))
        self.assertEqual(got["id"], "cz")

    def test_market_salary_cli_states_the_absence(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            role = Path(tmp) / "role.json"
            role.write_text(json.dumps({"title": "Dev", "seniority": "medior", "roleFamily": "software_engineering"}),
                            encoding="utf-8")
            code = (
                "import sys\nfrom pipeline.jobfit.market_salary_cli import main\n"
                f"sys.exit(main(['--no-grounding', '--input-json', {str(role)!r}]))\n"
            )
            cz = json.loads(_child(code, None))["result"]
            gb = json.loads(_child(code, "gb"))["result"]
        # Czech payload: the historical keys only (no period/absence keys added).
        self.assertNotIn("absence", cz)
        self.assertNotIn("period", cz)
        self.assertGreater(cz["suggestedMinimum"], 0)
        self.assertEqual(gb["absence"], "no_market_benchmark")
        self.assertEqual(gb["period"], "year")
        self.assertEqual((gb["suggestedMinimum"], gb["suggestedMaximum"], gb["currency"]), (0, 0, "GBP"))
        self.assertEqual(gb["summary"], "")
        self.assertIsNone(gb["benchmark"])

    def test_analysis_prompt_names_the_market(self) -> None:
        code = "from pipeline.jobfit import gemini\nprint(gemini._anchor_rule())\n"
        self.assertIn("CZECH-MARKET CZK/MONTH", _child(code, None))
        de = _child(code, "de")
        self.assertIn("NO deterministic anchor_band", de)
        self.assertNotIn("CZK", de)


if __name__ == "__main__":
    unittest.main()
