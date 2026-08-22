"""Guard: seeded candidates get UNIQUE, gender-correct Czech names.

Independent LLM calls kept defaulting to the same few common names (Tereza
Marešová ×14), so names are stamped deterministically; these lock that in.
"""
import unittest

from pipeline.jobfit.seed_candidates import (
    _NONTECH_ID_START,
    _SURNAMES,
    _base_name_pool,
    _feminize,
    _refuse_id_collision,
    build_nontech_specs,
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

    def test_feminize_fleeting_e(self):
        """-ek/-ec/-ěk drop the fleeting -e- before -ová.

        Naive suffixing minted forms that do not exist in Czech (Hájeková,
        Němecová) onto 10 of the 66 shipped seed candidates.
        """
        self.assertEqual(_feminize("Hájek"), "Hájková")
        self.assertEqual(_feminize("Jelínek"), "Jelínková")
        self.assertEqual(_feminize("Beránek"), "Beránková")
        self.assertEqual(_feminize("Sedláček"), "Sedláčková")
        self.assertEqual(_feminize("Blažek"), "Blažková")
        self.assertEqual(_feminize("Vlček"), "Vlčková")
        self.assertEqual(_feminize("Šimek"), "Šimková")
        self.assertEqual(_feminize("Němec"), "Němcová")
        # -ěk also softens the consonant the ě palatalized.
        self.assertEqual(_feminize("Vaněk"), "Vaňková")

    def test_no_impossible_feminine_surname_in_the_pool(self):
        """Every feminine surname the seeder can mint must be a real Czech form.

        Guards the whole curated pool, not just the four hand-picked cases above:
        *-eková / *-ecová / *-ěková are the shapes the fleeting-e bug produced.
        """
        minted = {_feminize(s) for s in _SURNAMES}
        impossible = sorted(n for n in minted if n.endswith(("eková", "ecová", "ěková")))
        self.assertEqual(impossible, [], f"non-Czech feminine forms in the name pool: {impossible}")


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


class TechSliceCeilingTest(unittest.TestCase):
    """The tech slice must never overwrite the fixed non-tech bank slice.

    `build_specs` numbers cand-000..cand-{count-1} and the bank slice starts at
    cand-050; both the resume merge and the final write are keyed on the id, so
    `--count 60 --no-resume` used to silently replace 10 of the 16 bank
    candidates with tech ones while the seeded analyses/pipeline kept pointing at
    those ids under their old role family.
    """

    def test_default_count_is_at_the_ceiling(self):
        self.assertIsNone(_refuse_id_collision(_NONTECH_ID_START))

    def test_over_the_ceiling_is_refused(self):
        message = _refuse_id_collision(_NONTECH_ID_START + 10)
        self.assertIsNotNone(message)
        self.assertIn("non-tech bank slice", message)

    def test_tech_and_nontech_ids_are_disjoint_at_the_ceiling(self):
        tech = {s["id"] for s in build_specs(_NONTECH_ID_START)}
        nontech = {s["id"] for s in build_nontech_specs()}
        self.assertEqual(tech & nontech, set())
        # ...and the names come from disjoint slices of the same unique pool.
        tech_names = {s["display_name"] for s in build_specs(_NONTECH_ID_START)}
        nontech_names = {s["display_name"] for s in build_nontech_specs()}
        self.assertEqual(tech_names & nontech_names, set())


if __name__ == "__main__":
    unittest.main()
