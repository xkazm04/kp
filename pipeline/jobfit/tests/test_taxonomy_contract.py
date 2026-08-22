"""Data contract for taxonomy.json and salary_benchmarks.json.

The pipeline assumes a precise shape for these two data files. taxonomy.py
validates the basics at import, but this pins the contract as a discrete, named,
fast-running check that fails with the exact file + field on drift — rather than
surfacing as a cryptic KeyError/IndexError deep in matching or at module import.
"""
import json
import unittest
from pathlib import Path

from pipeline.jobfit import taxonomy
from pipeline.jobfit.taxonomy import (
    DEFAULT_PROVENANCE,
    PROVENANCE_RANK,
    PROVENANCE_WEIGHTS,
    provenance_rank,
    provenance_weight,
)

DATA_DIR = Path(taxonomy.__file__).resolve().parents[2] / "data"
TAXONOMY_PATH = DATA_DIR / "taxonomy.json"
BENCHMARKS_PATH = DATA_DIR / "salary_benchmarks.json"
SENIORITIES = ("junior", "medior", "senior", "lead")


class TaxonomyContractTest(unittest.TestCase):
    def setUp(self) -> None:
        self.taxonomy = json.loads(TAXONOMY_PATH.read_text(encoding="utf-8"))
        self.raw_benchmarks = json.loads(BENCHMARKS_PATH.read_text(encoding="utf-8"))
        # Benchmarks are keyed by market (markets[market_id]); a legacy flat file
        # (top-level 'roles') is read as the single active-market block. Expose the
        # ACTIVE market's block as ``self.benchmarks`` so the existing role-shape
        # assertions keep pinning the pilot's bands unchanged.
        self.market_blocks = self._market_blocks(self.raw_benchmarks)
        self.benchmarks = self.market_blocks[taxonomy.ACTIVE_MARKET.market_id]

    @staticmethod
    def _market_blocks(raw: dict) -> dict:
        markets = raw.get("markets")
        if isinstance(markets, dict) and markets:
            return markets
        if isinstance(raw.get("roles"), list):
            return {taxonomy.ACTIVE_MARKET.market_id: raw}
        raise AssertionError("salary_benchmarks.json has neither 'markets' nor a top-level 'roles'.")

    def test_terms_have_unique_id_and_match_list(self) -> None:
        terms = self.taxonomy.get("terms")
        self.assertIsInstance(terms, list, "taxonomy.json: 'terms' must be a list")
        self.assertGreater(len(terms), 0, "taxonomy.json: 'terms' must be non-empty")
        ids: set[str] = set()
        for i, term in enumerate(terms):
            self.assertIsInstance(term, dict, f"taxonomy.json: terms[{i}] must be an object")
            self.assertTrue(term.get("id"), f"taxonomy.json: terms[{i}] missing 'id'")
            self.assertIsInstance(term.get("match"), list, f"taxonomy.json: terms[{i}].match must be a list")
            self.assertNotIn(term["id"], ids, f"taxonomy.json: duplicate term id {term['id']!r}")
            ids.add(term["id"])

    def test_term_parents_resolve_to_known_ids(self) -> None:
        terms = self.taxonomy["terms"]
        ids = {t["id"] for t in terms}
        for term in terms:
            for parent in term.get("parents", []) or []:
                self.assertIn(parent, ids, f"taxonomy.json: term {term['id']!r} has unknown parent {parent!r}")

    def test_benchmark_roles_have_family(self) -> None:
        # Every market block (not just the active one) must carry a well-formed
        # 'roles' array, so a re-homed market never boots on malformed data.
        for mid, block in self.market_blocks.items():
            roles = block.get("roles")
            self.assertIsInstance(roles, list, f"salary_benchmarks.json[{mid}]: 'roles' must be a list")
            self.assertGreater(len(roles), 0, f"salary_benchmarks.json[{mid}]: 'roles' must be non-empty")
            for i, role in enumerate(roles):
                self.assertIsInstance(role, dict, f"salary_benchmarks.json[{mid}]: roles[{i}] must be an object")
                self.assertTrue(role.get("family"), f"salary_benchmarks.json[{mid}]: roles[{i}] missing 'family'")

    def test_benchmark_role_bands_are_well_formed(self) -> None:
        for mid, block in self.market_blocks.items():
            for i, role in enumerate(block["roles"]):
                for sen in SENIORITIES:
                    band = role.get(sen)
                    if band is None:
                        continue
                    self.assertIsInstance(band, list, f"[{mid}] roles[{i}].{sen} must be a list")
                    self.assertEqual(len(band), 2, f"[{mid}] roles[{i}].{sen} must be [min, max]")
                    self.assertTrue(all(isinstance(n, (int, float)) for n in band), f"[{mid}] roles[{i}].{sen} non-numeric band")
                    self.assertLessEqual(band[0], band[1], f"[{mid}] roles[{i}].{sen} has min > max")

    def test_default_family_is_known(self) -> None:
        families = {r["family"] for r in self.benchmarks["roles"]}
        default = self.benchmarks.get("default_family")
        if default is not None:
            self.assertIn(default, families, "salary_benchmarks.json: default_family is not a known role family")

    def test_module_role_families_match_data(self) -> None:
        # The import-time tuple must equal the data file (guards a stale build).
        self.assertEqual(list(taxonomy.ROLE_FAMILIES), [r["family"] for r in self.benchmarks["roles"]])

    def test_every_benchmark_family_has_a_description(self) -> None:
        # The taxonomy owns the role-family vocabulary's meaning; every comp family
        # must carry a one-line description the analysis prompt can present, or a
        # non-tech candidate has no industry-appropriate family to be classified into.
        role_families = self.taxonomy.get("role_families")
        self.assertIsInstance(role_families, dict, "taxonomy.json: 'role_families' must be an object")
        self.assertGreater(len(role_families), 0, "taxonomy.json: 'role_families' must be non-empty")
        for role in self.benchmarks["roles"]:
            fam = role["family"]
            self.assertIn(fam, role_families, f"role family {fam!r} has no description in taxonomy.json::role_families")
            self.assertTrue(str(role_families[fam]).strip(), f"role family {fam!r} has an empty description")

    def test_role_band_reads_the_market_block(self) -> None:
        # role_band defaults to the ACTIVE (Czech) market — byte-identical to before
        # the file was market-keyed — and returns the market's OWN bands when a market
        # is passed. The de-berlin SAMPLE block proves the read path re-homes: its
        # EUR bands differ from (and are far smaller than) the CZK bands.
        from pipeline.jobfit.market_config import BERLIN_MARKET, CZECH_MARKET

        cz_band = taxonomy.role_band("software_engineering", "medior")
        self.assertEqual(cz_band, taxonomy.role_band("software_engineering", "medior", market=CZECH_MARKET))
        self.assertEqual(list(cz_band), self.benchmarks["roles"][0]["medior"])  # SE is first

        de_block = self.market_blocks.get("de-berlin")
        if de_block is not None:  # committed markets-map file
            de_band = taxonomy.role_band("software_engineering", "medior", market=BERLIN_MARKET)
            self.assertIsNotNone(de_band)
            self.assertNotEqual(de_band, cz_band)
            self.assertLess(de_band[1], cz_band[0])  # EUR figures are far below the CZK band
            de_se = next(r for r in de_block["roles"] if r["family"] == "software_engineering")
            self.assertEqual(list(de_band), de_se["medior"])

    def test_role_band_returns_each_familys_OWN_row(self) -> None:
        # The test above pins ONE family — software_engineering, which happens to be
        # roles[0]. A lookup that ignored `family` entirely and returned the first
        # matching row would satisfy it while handing a finance role the SOFTWARE
        # band: a comp anchor the candidate then negotiates against, wrong by a whole
        # profession. Enumerate EVERY family x seniority from the shipped file so the
        # binding is data-driven, not one hand-picked row.
        for mid, block in self.market_blocks.items():
            market = next(
                (m for m in (taxonomy.ACTIVE_MARKET,) if m.market_id == mid), None
            )
            if market is None:
                continue  # non-active markets are covered by the de-berlin case above
            for role in block["roles"]:
                fam = role["family"]
                for sen in SENIORITIES:
                    expected = role.get(sen)
                    actual = taxonomy.role_band(fam, sen, market=market)
                    if expected is None:
                        self.assertIsNone(actual, f"{fam}/{sen}: band invented from nothing")
                    else:
                        self.assertEqual(
                            list(actual), list(expected),
                            f"{fam}/{sen} resolved to another family's band",
                        )

    def test_the_family_bands_are_actually_distinct(self) -> None:
        # Non-vacuity for the loop above: if every family shipped the same numbers a
        # family-blind lookup would pass it. At least two families must genuinely
        # differ at the same seniority.
        medior = {
            r["family"]: tuple(r["medior"]) for r in self.benchmarks["roles"] if r.get("medior")
        }
        self.assertGreater(len(set(medior.values())), 1, "all families share one band")
        # And the specific pair the finding names: finance must not read as software.
        if "finance_accounting" in medior and "software_engineering" in medior:
            self.assertNotEqual(medior["finance_accounting"], medior["software_engineering"])

    def test_an_unknown_family_has_no_band_rather_than_a_borrowed_one(self) -> None:
        # A family the benchmark file does not model must yield None, never the
        # first row's numbers dressed up as its own.
        self.assertIsNone(taxonomy.role_band("no_such_family_xyz", "medior"))
        self.assertIsNone(taxonomy.role_band("software_engineering", "no_such_seniority"))

    def test_taxonomy_covers_non_tech_industries(self) -> None:
        # P0-1: the role-family vocabulary must reach beyond the original 3 IT families
        # so non-tech workforces are representable, not collapsed to software_engineering.
        for fam in ("healthcare_clinical", "skilled_trades", "frontline_service",
                    "finance_accounting", "general_professional"):
            self.assertIn(fam, taxonomy.ROLE_FAMILY_SET, f"missing expected role family {fam!r}")
        self.assertEqual(taxonomy.DEFAULT_FAMILY, "general_professional",
                         "default family should be the neutral fallback, not a tech family")


if __name__ == "__main__":
    unittest.main()


class ProvenanceFallbackTest(unittest.TestCase):
    """An unrecognised provenance must land on the floor, not mid-ladder.

    ``provenance_weight`` used to return the "unknown" rung (0.6) for a missing or
    unrecognised key. That sits ABOVE _MATCH_THRESHOLD, so a typo'd provenance
    string promoted an unevidenced claim into matched_skills while the same claim
    tagged honestly as self_declared (0.4) landed in unproven_skills.
    """

    def test_unrecognised_and_missing_provenance_get_the_floor(self) -> None:
        floor = PROVENANCE_WEIGHTS[DEFAULT_PROVENANCE]
        for value in (None, "", "  ", "profesional", "observed!!", "made_up_tier"):
            with self.subTest(provenance=value):
                self.assertEqual(provenance_weight(value), floor)

    def test_the_unknown_rung_itself_is_unchanged(self) -> None:
        # "unknown" is a real, deliberately-written value (Evidence.provenance
        # defaults to it; resolved_provenance emits it for an unmapped kind), so
        # only the FALLBACK moved — the rung keeps its weight.
        self.assertEqual(provenance_weight("unknown"), PROVENANCE_WEIGHTS["unknown"])
        self.assertGreater(PROVENANCE_WEIGHTS["unknown"], PROVENANCE_WEIGHTS[DEFAULT_PROVENANCE])

    def test_unrecognised_provenance_is_logged(self) -> None:
        with self.assertLogs("pipeline.jobfit.taxonomy", level="WARNING") as cm:
            provenance_weight("kubernetees_pro")
        self.assertTrue(any("kubernetees_pro" in line for line in cm.output))

    def test_known_provenance_still_normalises(self) -> None:
        self.assertEqual(provenance_weight("Open-Source"), PROVENANCE_WEIGHTS["open_source"])
        self.assertEqual(provenance_weight(" academic project "), PROVENANCE_WEIGHTS["academic_project"])


class ProvenanceRankTest(unittest.TestCase):
    def test_rank_is_a_total_order_over_every_weighted_provenance(self) -> None:
        self.assertEqual(set(PROVENANCE_RANK), set(PROVENANCE_WEIGHTS))
        self.assertEqual(len(set(PROVENANCE_RANK.values())), len(PROVENANCE_RANK))

    def test_rank_breaks_the_ties_the_weights_cannot(self) -> None:
        for weaker, stronger in (
            ("professional", "observed"),
            ("open_source", "internship"),
            ("academic_project", "personal_project"),
            ("extracurricular", "certification"),
        ):
            with self.subTest(pair=(weaker, stronger)):
                self.assertEqual(PROVENANCE_WEIGHTS[weaker], PROVENANCE_WEIGHTS[stronger])
                self.assertLess(PROVENANCE_RANK[weaker], PROVENANCE_RANK[stronger])

    def test_rank_is_monotone_in_weight_apart_from_the_unknown_rung(self) -> None:
        # Rank orders EVIDENTIAL STRENGTH; weight is a scoring multiplier. They agree
        # everywhere except "unknown", which weighs 0.6 for legacy scoring reasons but
        # means "nothing recorded" — so it consolidates near the bottom, deliberately.
        items = [kv for kv in sorted(PROVENANCE_RANK.items(), key=lambda kv: kv[1]) if kv[0] != "unknown"]
        for (a, _), (b, _) in zip(items, items[1:]):
            self.assertLessEqual(PROVENANCE_WEIGHTS[a], PROVENANCE_WEIGHTS[b], f"{a} -> {b}")
        self.assertLess(PROVENANCE_RANK["unknown"], PROVENANCE_RANK["coursework"])

    def test_unrecognised_rank_falls_to_the_floor(self) -> None:
        self.assertEqual(provenance_rank("nope"), PROVENANCE_RANK[DEFAULT_PROVENANCE])
        self.assertEqual(provenance_rank(None), PROVENANCE_RANK[DEFAULT_PROVENANCE])
