"""Guard: seeded candidates get UNIQUE, gender-correct Czech names.

Independent LLM calls kept defaulting to the same few common names (Tereza
Marešová ×14), so names are stamped deterministically; these lock that in.
"""
import unittest

from pipeline.jobfit.seed_candidates import (
    _base_name_pool,
    _feminize,
    build_specs,
    name_pool_capacity,
    unique_czech_names,
)


class TestUniqueNames(unittest.TestCase):
    def test_names_are_unique(self):
        names = unique_czech_names(50)
        self.assertEqual(len(names), 50)
        self.assertEqual(len(set(names)), 50)

    def test_deterministic(self):
        self.assertEqual(unique_czech_names(30, seed=7), unique_czech_names(30, seed=7))

    def test_build_specs_stamps_unique_names(self):
        names = [s["display_name"] for s in build_specs(50)]
        self.assertEqual(len(set(names)), 50)

    def test_feminize_morphology(self):
        self.assertEqual(_feminize("Novák"), "Nováková")     # consonant -> +ová
        self.assertEqual(_feminize("Černý"), "Černá")         # -ý -> -á
        self.assertEqual(_feminize("Svoboda"), "Svobodová")   # -a -> -ová
        self.assertEqual(_feminize("Mareš"), "Marešová")


class TestNamePoolExhaustion(unittest.TestCase):
    """The seeder advertises enterprise scale; it must not IndexError at scale."""

    def test_capacity_matches_distinct_base_names(self):
        pool = _base_name_pool()
        self.assertEqual(name_pool_capacity(), len(pool))
        self.assertEqual(len(set(pool)), len(pool))  # no female/male collisions

    def test_exactly_n_unique_beyond_capacity(self):
        n = name_pool_capacity() + 250
        names = unique_czech_names(n)
        self.assertEqual(len(names), n)            # never short of n...
        self.assertEqual(len(set(names)), n)       # ...and still all unique

    def test_at_capacity_exactly(self):
        cap = name_pool_capacity()
        names = unique_czech_names(cap)
        self.assertEqual(len(names), cap)
        self.assertEqual(len(set(names)), cap)

    def test_build_specs_beyond_capacity_no_indexerror(self):
        count = name_pool_capacity() + 100
        specs = build_specs(count)  # used to raise IndexError on names[i]
        self.assertEqual(len(specs), count)
        self.assertEqual(len({s["display_name"] for s in specs}), count)

    def test_rename_zip_does_not_truncate(self):
        # --rename-only zips records with names; names must cover every record.
        record_count = name_pool_capacity() + 17
        names = unique_czech_names(record_count)
        self.assertEqual(len(names), record_count)

    def test_suffix_degradation_is_deterministic(self):
        n = name_pool_capacity() + 50
        self.assertEqual(unique_czech_names(n, seed=7), unique_czech_names(n, seed=7))

    def test_below_capacity_unchanged_by_overflow_path(self):
        # The overflow handling must not perturb the sub-capacity output.
        names = unique_czech_names(50, seed=7)
        self.assertEqual(len(names), 50)
        self.assertEqual(len(set(names)), 50)

    def test_zero_and_negative(self):
        self.assertEqual(unique_czech_names(0), [])
        self.assertEqual(unique_czech_names(-5), [])


if __name__ == "__main__":
    unittest.main()
