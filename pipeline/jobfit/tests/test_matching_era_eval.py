"""The twin-cast match harness (scoring hunt C5): determinism, stamp, reason codes,
keylessness and the baseline it measured on 2026-10-18.

The pinned numbers are what the PRODUCT scorer (the proof weights, ADR 0027, adopted
2026-10-18) pays for a free claim and for proof; the historical arithmetic they replaced
(18.3801 / 24.703, 9/66 crossings) is pinned in test_matching_proof_preview.py. They are
a measurement, not a target: C6b is expected to move them, and the person moving them
re-pins here in the same change. If this goes red without a
scorer change, the harness or the seed inputs drifted instead.
"""

from __future__ import annotations

import socket
import subprocess
import unittest
from unittest import mock

from pipeline.jobfit.eval import matching_era_eval as E


def _forbidden(*_a, **_k):
    raise AssertionError("keyless run touched the network or spawned a process")


class MatchingEraEvalTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.first = E.run()
        # The second run is the keyless one: any socket or subprocess use fails it,
        # and it must still reproduce the first run's fingerprint.
        with mock.patch.object(socket.socket, "connect", _forbidden), mock.patch.object(
            socket, "create_connection", _forbidden
        ), mock.patch.object(subprocess, "Popen", _forbidden):
            cls.second = E.run()

    def test_two_runs_share_a_fingerprint(self) -> None:
        self.assertEqual(self.first["fingerprint"], self.second["fingerprint"])
        self.assertEqual(self.first, self.second)

    def test_synthetic_stamp(self) -> None:
        self.assertEqual(self.first["stamp"], "SYNTHETIC")
        self.assertIn("[SYNTHETIC]", E._format(self.first))

    def test_every_crossing_has_a_reason_code(self) -> None:
        listed = self.first["results"]["tier_crossings"]["listed"]
        self.assertTrue(listed)
        for c in listed:
            self.assertTrue(c["reason"], c)
            self.assertNotEqual(c["from_tier"], c["to_tier"])
        counted = self.first["results"]["tier_crossings"]
        self.assertEqual(len(listed), counted["free_claim"] + counted["proof_premium"])

    def test_keyless_run_made_no_network_or_llm_calls(self) -> None:
        # setUpClass ran the second pass with sockets and subprocesses forbidden.
        self.assertEqual(self.second["stamp"], "SYNTHETIC")
        self.assertEqual(E.integrity_failures(self.second), [])

    def test_pinned_baseline(self) -> None:
        r = self.first["results"]
        self.assertEqual((r["candidates"], r["jobs"], r["pairs"]), (66, 120, 7920))
        self.assertEqual(r["free_claim_gain"], 3.0495)
        self.assertEqual(r["proof_premium"], 40.0092)
        tc = r["tier_crossings"]
        self.assertEqual((tc["free_claim"], tc["proof_premium"]), (433, 7674))
        self.assertEqual((tc["free_claim_at_best_job"], tc["best_job_pairs"]), (3, 66))
        for key in ("czech_gender_pair", "english_gender_pair", "czech_vs_english_male", "czech_vs_english_female"):
            self.assertEqual(r["neutrality"][key]["max_abs"], 0, key)
            self.assertEqual(r["neutrality"][key]["nonzero"], 0, key)
        self.assertEqual(
            {a: v["free_claim_gain"] for a, v in r["per_archetype"].items()},
            {"bau": 3.0063, "career_switcher": 2.4629, "student": 3.3902},
        )

    def test_harness_measures_only(self) -> None:
        # Stuffing is worth less than proof, and the scorer does not read hardness.
        r = self.first["results"]
        self.assertLess(r["free_claim_gain"], r["free_claim_gain"] + r["proof_premium"])
        self.assertEqual(E.integrity_failures(self.first), [])


if __name__ == "__main__":
    unittest.main()
