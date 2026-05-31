"""Guard: seeded candidates get UNIQUE, gender-correct Czech names.

Independent LLM calls kept defaulting to the same few common names (Tereza
Marešová ×14), so names are stamped deterministically; these lock that in.
"""
import unittest

from pipeline.jobfit.seed_candidates import _feminize, build_specs, unique_czech_names


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


if __name__ == "__main__":
    unittest.main()
