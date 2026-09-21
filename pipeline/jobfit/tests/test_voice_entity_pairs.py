"""Keyless entity-fidelity corpus. No Piper, no network, no EL minutes.

``test_voice_harness`` already pins Levenshtein, number-folding, and the V1
pair as Python literals. A TECH_TERMS regression or a Czech inflection miss
cannot fail a keyless run unless those (said, heard) pairs are committed data
this module loads. ``run_gated`` discovers every ``test_*.py`` here.
"""

from __future__ import annotations

import json
import unittest
from pathlib import Path

from pipeline.jobfit.eval.voice.wer import corpus_entity_fidelity, domain_terms, entity_fidelity

FIXTURE = (
    Path(__file__).resolve().parents[1] / "eval" / "voice" / "fixtures" / "entity_pairs.json"
)
REQUIRED_IDS = ("v1_corruption", "clean_en", "inflected_cs")


def _load_pairs() -> list[dict]:
    payload = json.loads(FIXTURE.read_text(encoding="utf-8"))
    pairs = payload["pairs"]
    if not isinstance(pairs, list):
        raise TypeError(f"{FIXTURE} pairs must be a list")
    return pairs


class TestCommittedEntityPairs(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.pairs = _load_pairs()
        cls.by_id = {row["id"]: row for row in cls.pairs}

    def test_required_ids_are_present(self) -> None:
        self.assertTrue(FIXTURE.is_file(), f"missing committed corpus {FIXTURE}")
        missing = [i for i in REQUIRED_IDS if i not in self.by_id]
        self.assertEqual(missing, [], f"entity_pairs.json missing required ids: {missing}")

    def test_each_pair_matches_entity_fidelity(self) -> None:
        for row in self.pairs:
            with self.subTest(row["id"]):
                ef = entity_fidelity(row["said"], row["heard"])
                self.assertEqual(list(ef.missing), row["expect_missing"])
                self.assertEqual(ef.ok, row["expect_ok"])

    def test_v1_reports_the_two_missing_skills(self) -> None:
        row = self.by_id["v1_corruption"]
        ef = entity_fidelity(row["said"], row["heard"])
        self.assertEqual(set(ef.missing), {"react", "postgresql"})
        self.assertFalse(ef.ok)

    def test_clean_en_is_ok(self) -> None:
        row = self.by_id["clean_en"]
        ef = entity_fidelity(row["said"], row["heard"])
        self.assertTrue(ef.ok)
        self.assertEqual(ef.missing, ())

    def test_inflected_cs_is_ok_and_prefix_matches_reactem(self) -> None:
        row = self.by_id["inflected_cs"]
        self.assertIn("Reactem", row["said"])
        self.assertIn("react", domain_terms(row["said"]))
        ef = entity_fidelity(row["said"], row["heard"])
        self.assertTrue(ef.ok)

    def test_corpus_pools_the_v1_losses(self) -> None:
        corpus = [(row["said"], row["heard"]) for row in self.pairs]
        agg = corpus_entity_fidelity(corpus)
        self.assertEqual(set(agg.missing), {"react", "postgresql"})
        self.assertFalse(agg.ok)


if __name__ == "__main__":
    unittest.main()
