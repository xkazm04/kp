"""Tests for the Art. 72 post-market drift-alarm seed (calibration_drift.py).

Two layers:
  1. ``compute_calibration`` is a faithful Python mirror of the TS engine
     (``app/_lib/calibration.ts``) — same keys, same clamping, same bin edges,
     same coercion — so a payload built on either side is interchangeable.
  2. ``detect_drift`` alarms on real degradation (Brier, PSI, base-rate) and
     REFUSES to alarm on noise (either window below minOutcomes), exactly the
     honesty rule the rest of the suite enforces for unmeasured metrics.

Everything is deterministic and keyless — no fixtures, no API, no DB.
"""

from __future__ import annotations

import unittest

from pipeline.jobfit.calibration_drift import (
    BRIER_DEGRADATION_ALERT,
    CALIBRATION_BIN_COUNT,
    MIN_CALIBRATION_OUTCOMES,
    POSITIVE_RATE_SHIFT_ALERT,
    PSI_ALERT,
    VERDICT_DRIFT,
    VERDICT_INSUFFICIENT,
    VERDICT_OK,
    compute_calibration,
    detect_drift,
    population_stability_index,
)


def _pairs(*groups: tuple[int, float, int]) -> list[dict[str, float]]:
    """Expand (count, score, outcome) groups into a pair list."""
    out: list[dict[str, float]] = []
    for count, score, outcome in groups:
        out.extend({"score": score, "outcome": outcome} for _ in range(count))
    return out


# A well-calibrated 40-pair baseline: 70-scores advance 75% of the time,
# 30-scores advance 25% of the time (close to their stated probabilities).
BASELINE = compute_calibration(
    _pairs((15, 70, 1), (5, 70, 0), (5, 30, 1), (15, 30, 0))
)


class ComputeCalibrationMirrorTest(unittest.TestCase):
    """Parity with the TS computeCalibration semantics."""

    def test_mirrored_constants(self) -> None:
        # Keep numerically identical to app/_lib/calibration.ts.
        self.assertEqual(MIN_CALIBRATION_OUTCOMES, 20)
        self.assertEqual(CALIBRATION_BIN_COUNT, 10)

    def test_empty_input_has_null_brier_and_all_bins(self) -> None:
        res = compute_calibration([])
        self.assertEqual(res["n"], 0)
        self.assertIsNone(res["brier"])
        self.assertFalse(res["calibrated"])
        self.assertEqual(len(res["bins"]), CALIBRATION_BIN_COUNT)  # empty bins still emitted
        self.assertTrue(all(b["count"] == 0 for b in res["bins"]))

    def test_score_100_lands_in_last_bin_not_bin_10(self) -> None:
        res = compute_calibration([{"score": 100, "outcome": 1}])
        self.assertEqual(res["bins"][-1]["count"], 1)

    def test_out_of_range_scores_are_clamped(self) -> None:
        res = compute_calibration([{"score": -50, "outcome": 0}, {"score": 400, "outcome": 1}])
        self.assertEqual(res["bins"][0]["count"], 1)   # -50 -> p=0
        self.assertEqual(res["bins"][-1]["count"], 1)  # 400 -> p=1
        self.assertEqual(res["brier"], 0.0)            # both predictions exactly right

    def test_outcome_is_coerced_at_half(self) -> None:
        res = compute_calibration([{"score": 50, "outcome": 0.5}, {"score": 50, "outcome": 0.49}])
        self.assertEqual(res["positives"], 1)

    def test_brier_and_bins_match_hand_computation(self) -> None:
        res = compute_calibration(_pairs((3, 70, 1), (1, 70, 0)))
        # Brier: 3*(0.7-1)^2 + 1*(0.7-0)^2 over 4 = (3*0.09 + 0.49)/4 = 0.19
        self.assertAlmostEqual(res["brier"], 0.19)
        b7 = res["bins"][7]  # [0.7, 0.8)
        self.assertEqual(b7["count"], 4)
        self.assertAlmostEqual(b7["predicted"], 0.7)
        self.assertAlmostEqual(b7["observed"], 0.75)

    def test_calibrated_gate_uses_min_outcomes(self) -> None:
        self.assertFalse(compute_calibration(_pairs((19, 50, 1)))["calibrated"])
        self.assertTrue(compute_calibration(_pairs((20, 50, 1)))["calibrated"])

    def test_ts_shape_keys_exactly(self) -> None:
        # The payload must be drop-in interchangeable with the TS serialization.
        res = compute_calibration(_pairs((1, 50, 1)))
        self.assertEqual(set(res), {"n", "positives", "brier", "bins", "calibrated", "minOutcomes"})
        self.assertEqual(set(res["bins"][0]), {"lo", "hi", "count", "predicted", "observed"})


class DetectDriftTest(unittest.TestCase):
    def test_identical_windows_are_ok(self) -> None:
        report = detect_drift(BASELINE, BASELINE)
        self.assertEqual(report.verdict, VERDICT_OK)
        self.assertFalse(report.alarm)
        self.assertEqual(report.brier_delta, 0.0)
        self.assertAlmostEqual(report.psi or 0.0, 0.0, places=6)
        self.assertEqual(report.positive_rate_shift, 0.0)
        self.assertEqual(report.reasons, [])

    def test_brier_degradation_alarms_with_reason(self) -> None:
        # Same scores, inverted outcomes for the low bin: the 30-scores now
        # advance 75% of the time — the probabilities went bad.
        current = compute_calibration(
            _pairs((15, 70, 1), (5, 70, 0), (15, 30, 1), (5, 30, 0))
        )
        report = detect_drift(BASELINE, current)
        self.assertTrue(report.alarm)
        self.assertEqual(report.verdict, VERDICT_DRIFT)
        self.assertIsNotNone(report.brier_delta)
        self.assertGreaterEqual(report.brier_delta, BRIER_DEGRADATION_ALERT)
        self.assertTrue(any("brier" in r for r in report.reasons))

    def test_brier_improvement_never_alarms(self) -> None:
        # Signed, not absolute: getting BETTER must not trip the alarm.
        improved = compute_calibration(
            _pairs((20, 75, 1), (20, 25, 0))  # sharper and more accurate
        )
        report = detect_drift(BASELINE, improved)
        self.assertLess(report.brier_delta, 0)
        self.assertFalse(any("brier" in r for r in report.reasons))

    def test_population_shift_trips_psi(self) -> None:
        # Same outcome quality, but the whole scored population migrated from
        # the 30/70 bins into the 90 bin — a significant distribution shift.
        current = compute_calibration(_pairs((36, 90, 1), (4, 90, 0)))
        report = detect_drift(BASELINE, current)
        self.assertTrue(report.alarm)
        self.assertGreaterEqual(report.psi, PSI_ALERT)
        self.assertTrue(any("PSI" in r for r in report.reasons))

    def test_base_rate_shift_alarms(self) -> None:
        # Same score mix, but almost everyone advances now: the frozen curve no
        # longer describes the population even where the Brier delta is small.
        current = compute_calibration(
            _pairs((20, 70, 1), (14, 30, 1), (6, 30, 0))
        )
        report = detect_drift(BASELINE, current)
        base_rate = BASELINE["positives"] / BASELINE["n"]
        cur_rate = current["positives"] / current["n"]
        self.assertGreaterEqual(abs(cur_rate - base_rate), POSITIVE_RATE_SHIFT_ALERT)
        self.assertTrue(any("advance rate" in r for r in report.reasons))
        self.assertTrue(report.alarm)

    def test_insufficient_data_never_alarms(self) -> None:
        # 10 catastrophically miscalibrated pairs — but below minOutcomes, so
        # the ONLY honest verdict is insufficient_data, alarm off, axes None.
        thin = compute_calibration(_pairs((10, 90, 0)))
        for baseline, current in ((BASELINE, thin), (thin, BASELINE), (thin, thin)):
            report = detect_drift(baseline, current)
            self.assertEqual(report.verdict, VERDICT_INSUFFICIENT)
            self.assertFalse(report.alarm)
            self.assertIsNone(report.brier_delta)
            self.assertIsNone(report.psi)
            self.assertIsNone(report.positive_rate_shift)
            self.assertTrue(any("minOutcomes" in r for r in report.reasons))

    def test_psi_is_symmetric_zero_on_equal_distributions(self) -> None:
        self.assertAlmostEqual(population_stability_index(BASELINE, BASELINE), 0.0, places=9)

    def test_psi_survives_empty_bins(self) -> None:
        # One side empty in a bin the other populates: epsilon floor, no crash,
        # finite positive PSI.
        a = compute_calibration(_pairs((20, 20, 0)))
        b = compute_calibration(_pairs((20, 80, 1)))
        psi = population_stability_index(a, b)
        self.assertGreater(psi, 0.0)
        self.assertLess(psi, float("inf"))

    def test_deterministic(self) -> None:
        # Pure function: identical inputs produce identical reports.
        current = compute_calibration(_pairs((36, 90, 1), (4, 90, 0)))
        self.assertEqual(detect_drift(BASELINE, current), detect_drift(BASELINE, current))


if __name__ == "__main__":
    unittest.main()
