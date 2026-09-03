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
        # Straggler literals re-homed onto the config, byte-identical to the old
        # salary_band.SALARY_STEP (5000) and market_salary_cli.REGION_DEFAULT.
        self.assertEqual(CZECH_MARKET.salary_step, 5000)
        self.assertEqual(CZECH_MARKET.region_label, "Czech Republic (Prague)")


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

    def test_phrase_is_localized_and_degrades_honestly(self) -> None:
        # The offer letter's Czech body needs the period word too — it used to
        # hardcode "hrubá měsíční" beside a market-driven currency.
        self.assertEqual(gross_period_phrase("month", "cs"), "hrubá měsíční")
        self.assertEqual(gross_period_phrase("year", "cs"), "hrubá roční")
        # An unmapped language falls back to English (period still named correctly),
        # an unmapped period to the bare code — never a silently wrong period word.
        self.assertEqual(gross_period_phrase("month", "de"), "gross monthly")
        self.assertEqual(gross_period_phrase("fortnight"), "gross fortnight")


class SeniorityFallbackBandsAreMarketHomedTest(unittest.TestCase):
    """The offer drafter's seniority fallback bands live on MarketConfig. They were
    CZK/month magnitudes stamped with the ACTIVE market's currency, so a re-homed
    deploy drafted a candidate-facing "95,000 EUR gross monthly" — wrong by ~25x."""

    def test_czech_default_reproduces_the_previous_literals(self) -> None:
        self.assertEqual(
            dict(CZECH_MARKET.seniority_default_bands),
            {
                "junior": (45_000, 65_000),
                "medior": (65_000, 95_000),
                "senior": (95_000, 140_000),
                "lead": (130_000, 185_000),
            },
        )

    def test_an_uncalibrated_market_configures_none(self) -> None:
        # We hold no real German benchmark bands, so the honest configuration is
        # EMPTY — draft_offer then proposes no figure at all rather than relabelling
        # the Czech magnitudes in EUR.
        self.assertEqual(dict(BERLIN_MARKET.seniority_default_bands), {})

    def test_the_bands_are_read_only(self) -> None:
        # Shared module-level records: a consumer must not be able to mutate them.
        with self.assertRaises(TypeError):
            CZECH_MARKET.seniority_default_bands["junior"] = (1, 2)  # type: ignore[index]


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


class MarketSeamStragglersTest(unittest.TestCase):
    """Round-10 stragglers: four comp/persona literals never re-homed with the seam.
    Each is byte-identical for the Czech default and flips under a re-homed market."""

    def test_group_compare_persona_names_the_active_market(self) -> None:
        from pipeline.jobfit.group_compare import _system_prompt

        # Byte-identical to the old hardcoded "_SYSTEM" for the Czech default.
        self.assertIn("precise technical recruiter for the Czech tech market", _system_prompt())
        self.assertIn(
            "precise technical recruiter for the Czech tech market",
            _system_prompt(CZECH_MARKET),
        )
        # A re-homed market names ITS market instead of biasing every comparison Czech.
        berlin = _system_prompt(BERLIN_MARKET)
        self.assertIn("German tech market", berlin)
        self.assertNotIn("Czech", berlin)

    def test_cli_region_default_follows_the_active_market(self) -> None:
        from pipeline.jobfit import market_salary_cli

        # Byte-identical region phrase for the Czech default.
        self.assertEqual(market_salary_cli.REGION_DEFAULT, "Czech Republic (Prague)")
        self.assertEqual(market_salary_cli.REGION_DEFAULT, ACTIVE_MARKET.region_label)
        self.assertEqual(BERLIN_MARKET.region_label, "Germany (Berlin)")

    def test_cli_fallback_currency_follows_the_market(self) -> None:
        from pipeline.jobfit import market_salary_cli

        # The deterministic fallback labels the band in the market's currency:
        # "CZK" for the Czech default, "EUR" under the Berlin sample — never a
        # hardcoded "CZK" applied to a euro band.
        cz = market_salary_cli._fallback("software_engineering", "medior")
        self.assertEqual(cz["currency"], "CZK")
        de = market_salary_cli._fallback("software_engineering", "medior", market=BERLIN_MARKET)
        self.assertEqual(de["currency"], "EUR")
        # The grounded-payload repair path defaults the same way when the payload
        # omits a currency.
        _, _ = market_salary_cli._coerce({}, "software_engineering", "medior")
        repaired, _ = market_salary_cli._coerce(
            {"suggestedMinimum": 3000, "suggestedMaximum": 5000},
            "software_engineering",
            "medior",
            market=BERLIN_MARKET,
        )
        self.assertEqual(repaired["currency"], "EUR")

    def test_cli_fallback_band_comes_from_the_SAME_market_as_its_currency(self) -> None:
        """The currency and the NUMBERS must come from one market.

        ``_fallback`` looked the band up with ``role_band(family, seniority)`` — no
        market kwarg, i.e. always the ACTIVE (Czech) benchmark block — while stamping
        the caller's ``market.currency`` on it. Under the Berlin sample that returned
        65,500–103,000 **EUR**/month: the CZK magnitudes wearing a EUR label, ~25x
        the de-berlin block's own band. Same defect class as the offer drafter's
        seniority fallback bands, one module over.
        """
        from pipeline.jobfit import market_salary_cli
        from pipeline.jobfit.taxonomy import role_band

        cz = market_salary_cli._fallback("software_engineering", "medior")
        self.assertEqual(
            (cz["suggestedMinimum"], cz["suggestedMaximum"]),
            role_band("software_engineering", "medior", market=CZECH_MARKET),
        )
        de = market_salary_cli._fallback(
            "software_engineering", "medior", market=BERLIN_MARKET
        )
        self.assertEqual(
            (de["suggestedMinimum"], de["suggestedMaximum"]),
            role_band("software_engineering", "medior", market=BERLIN_MARKET),
        )
        # …and the two markets really do disagree, so the assertion above has teeth.
        self.assertNotEqual(
            (cz["suggestedMinimum"], cz["suggestedMaximum"]),
            (de["suggestedMinimum"], de["suggestedMaximum"]),
        )

    def test_cli_fallback_summary_is_native_for_every_app_locale(self) -> None:
        """``normalize_lang`` accepts all four app locales, and this sentence is baked
        into a candidate-facing posting, so every one of them gets a NATIVE sentence.

        History: ``_FALLBACK_SUMMARY`` first subscripted the table, so ``--lang de|fr``
        raised KeyError('de') inside ``_fallback`` — which ``_coerce`` calls
        unconditionally — and main()'s blanket handler turned it into ``{"error":
        "'de'", "status": 500}`` instead of the band this CLI promises to always
        return. ``.get`` stopped the crash but served the ENGLISH sentence inside a
        German posting; the table now covers de/fr and this test pins that, while
        ``.get`` stays as the guard for a genuinely unknown code (below).
        """
        from pipeline.jobfit import market_salary_cli
        from pipeline.jobfit.i18n import LANG_NAMES

        rendered = {
            lang: market_salary_cli._fallback("software_engineering", "medior", lang)["summary"]
            for lang in LANG_NAMES  # en, cs, de, fr — every locale the pipeline accepts
        }
        for lang, summary in rendered.items():
            self.assertTrue(summary, f"--lang {lang} produced no fallback summary")
        # Four locales, four distinct sentences: no locale is quietly served English.
        self.assertEqual(len(set(rendered.values())), len(rendered), msg=rendered)
        # An UNKNOWN code still resolves to English rather than raising.
        for lang in ("zz", "xx-YY"):
            self.assertEqual(
                market_salary_cli._fallback("software_engineering", "medior", lang)["summary"],
                rendered["en"],
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

    def test_active_market_block_matches_its_config(self) -> None:
        # Benchmarks are keyed by market; the ACTIVE market's block must be priced in
        # the active MarketConfig currency (legacy flat file: the top-level currency).
        benchmarks = json.loads(BENCHMARKS_JSON.read_text(encoding="utf-8"))
        markets = benchmarks.get("markets")
        block = (
            markets.get(ACTIVE_MARKET.market_id)
            if isinstance(markets, dict)
            else benchmarks  # legacy flat shape == the active market
        )
        self.assertIsNotNone(block, f"no benchmark block for active market {ACTIVE_MARKET.market_id!r}")
        self.assertEqual(
            block.get("currency"),
            ACTIVE_MARKET.currency,
            "the active market's benchmark block drifted from its MarketConfig currency.",
        )

    def test_every_benchmark_block_is_in_lockstep_with_its_market(self) -> None:
        # Per-market lockstep (replaces the old file-global currency guard): each
        # benchmark block's currency must equal the MarketConfig of the SAME market,
        # so a market can never advertise bands in a currency its config disowns.
        benchmarks = json.loads(BENCHMARKS_JSON.read_text(encoding="utf-8"))
        markets = benchmarks.get("markets")
        # A flat (non-keyed) file can hold only ONE market, so with >1 MarketConfig
        # configured it silently DROPS the rest — the exact data loss the old
        # apply-market-salaries.mjs flat write caused (it clobbered the keyed file with
        # a CZ-only block, dropping de-berlin). The Python LOADER still tolerates flat
        # at runtime (documented legacy fallback), but the SOURCE file must be keyed so
        # no configured market vanishes. This assertion makes that VISIBLE instead of
        # the old silent skipTest that let the hole go unnoticed. Regenerate keyed via
        # `npm run market:apply` (writes markets{<id>}, preserving siblings).
        configured = sorted({CZECH_MARKET.market_id, BERLIN_MARKET.market_id})
        self.assertIsInstance(
            markets,
            dict,
            f"data/salary_benchmarks.json is FLAT but {len(configured)} markets are configured "
            f"({configured}); a flat file drops all but one. Regenerate keyed via `npm run market:apply`.",
        )
        config_by_id = {m.market_id: m for m in (CZECH_MARKET, BERLIN_MARKET)}
        for market_id, block in markets.items():
            cfg = config_by_id.get(market_id)
            self.assertIsNotNone(
                cfg, f"benchmark block {market_id!r} has no MarketConfig to lockstep against."
            )
            self.assertEqual(
                block.get("currency"),
                cfg.currency,
                f"benchmark block {market_id!r} currency drifted from MarketConfig {market_id!r}.",
            )


class MarketApplyRoundTripTest(unittest.TestCase):
    """Pins scripts/apply-market-salaries.mjs write-safety against the KEYED file:
    regenerating the cz block must PRESERVE every sibling market (de-berlin) and
    never emit the legacy flat shape. Runs the real script against an isolated COPY
    (the repo data file is never touched). Skipped when node is unavailable."""

    def _run(self, tmp: Path, *args: str) -> dict:
        import shutil
        import subprocess

        node = shutil.which("node")
        if node is None:
            self.skipTest("node not on PATH — integration round-trip skipped")
        (tmp / "scripts").mkdir(parents=True, exist_ok=True)
        (tmp / "data").mkdir(parents=True, exist_ok=True)
        script = REPO_ROOT / "scripts" / "apply-market-salaries.mjs"
        shutil.copy(script, tmp / "scripts" / script.name)
        for name in ("salary_benchmarks.json", "salary_benchmarks.manual.json", "market_pulse.json"):
            shutil.copy(REPO_ROOT / "data" / name, tmp / "data" / name)
        subprocess.run(
            [node, str(tmp / "scripts" / script.name), *args],
            check=True,
            capture_output=True,
            cwd=str(tmp),
        )
        return json.loads((tmp / "data" / "salary_benchmarks.json").read_text(encoding="utf-8"))

    def test_default_cz_run_preserves_de_berlin_and_stays_keyed(self):
        import tempfile

        original = json.loads(BENCHMARKS_JSON.read_text(encoding="utf-8"))
        with tempfile.TemporaryDirectory() as td:
            out = self._run(Path(td))
        # Never the flat shape (the data-loss bug): keyed, no top-level roles.
        self.assertIn("markets", out)
        self.assertNotIn("roles", out)
        # de-berlin SURVIVES the cz regeneration, byte-for-byte.
        self.assertIn("de-berlin", out["markets"])
        self.assertEqual(out["markets"]["de-berlin"], original["markets"]["de-berlin"])
        # cz is regenerated with ISPV provenance and its config currency.
        cz = out["markets"]["cz"]
        self.assertEqual(cz["currency"], CZECH_MARKET.currency)
        self.assertTrue(any("ispv_median" in r for r in cz["roles"]))

    def test_market_arg_targets_a_named_block_and_preserves_the_rest(self):
        import tempfile

        with tempfile.TemporaryDirectory() as td:
            out = self._run(Path(td), "--market", "cz")
        # An explicit --market cz behaves like the default and keeps de-berlin.
        self.assertIn("cz", out["markets"])
        self.assertIn("de-berlin", out["markets"])


if __name__ == "__main__":
    unittest.main()
