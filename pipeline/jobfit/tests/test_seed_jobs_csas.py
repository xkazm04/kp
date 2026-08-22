"""Guard: the ČS corpus generator never mints two jobs with the same id.

The tech slice numbers ``job-000..job-{count-1}`` and the fixed non-tech slice
starts at ``job-100``. Above that ceiling the two overlap, and
``seed_jobs.generate`` keys its output on the id — so the surviving record is
whichever concurrent LLM call returned last: the same command run twice yields a
different corpus, and one of the two roles vanishes with no message.
Deterministic, no LLM.
"""

from __future__ import annotations

import unittest

from pipeline.jobfit.seed_jobs_csas import (
    CSAS_NONTECH_ROLES,
    _NONTECH_ID_START,
    build_nontech_specs,
    build_specs,
)


class SpecIdentityTest(unittest.TestCase):
    def test_default_corpus_ids_are_unique(self) -> None:
        ids = [s["id"] for s in build_specs(100)]
        self.assertEqual(len(ids), 100 + len(CSAS_NONTECH_ROLES))
        self.assertEqual(len(set(ids)), len(ids))

    def test_count_above_the_ceiling_is_refused_not_raced(self) -> None:
        with self.assertRaises(ValueError) as ctx:
            build_specs(_NONTECH_ID_START + 20)
        self.assertIn("non-tech slice", str(ctx.exception))

    def test_specs_are_deterministic_for_a_seed(self) -> None:
        self.assertEqual(build_specs(100, seed=42), build_specs(100, seed=42))

    def test_nontech_slice_starts_after_the_tech_ceiling(self) -> None:
        ids = [s["id"] for s in build_nontech_specs()]
        self.assertEqual(ids[0], f"job-{_NONTECH_ID_START:03d}")
        self.assertEqual(len(set(ids)), len(CSAS_NONTECH_ROLES))


if __name__ == "__main__":
    unittest.main()
