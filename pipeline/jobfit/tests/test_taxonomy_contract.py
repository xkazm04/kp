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
