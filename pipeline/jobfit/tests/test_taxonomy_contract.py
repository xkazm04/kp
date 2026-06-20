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
        self.benchmarks = json.loads(BENCHMARKS_PATH.read_text(encoding="utf-8"))

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
        roles = self.benchmarks.get("roles")
        self.assertIsInstance(roles, list, "salary_benchmarks.json: 'roles' must be a list")
        self.assertGreater(len(roles), 0, "salary_benchmarks.json: 'roles' must be non-empty")
        for i, role in enumerate(roles):
            self.assertIsInstance(role, dict, f"salary_benchmarks.json: roles[{i}] must be an object")
            self.assertTrue(role.get("family"), f"salary_benchmarks.json: roles[{i}] missing 'family'")

    def test_benchmark_role_bands_are_well_formed(self) -> None:
        for i, role in enumerate(self.benchmarks["roles"]):
            for sen in SENIORITIES:
                band = role.get(sen)
                if band is None:
                    continue
                self.assertIsInstance(band, list, f"roles[{i}].{sen} must be a list")
                self.assertEqual(len(band), 2, f"roles[{i}].{sen} must be [min, max]")
                self.assertTrue(all(isinstance(n, (int, float)) for n in band), f"roles[{i}].{sen} non-numeric band")
                self.assertLessEqual(band[0], band[1], f"roles[{i}].{sen} has min > max")

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
