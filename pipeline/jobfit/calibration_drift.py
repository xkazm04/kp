"""Calibration drift alarm — the post-market-monitoring seed (EU AI Act Art. 72).

Art. 72 requires a high-risk system to MONITOR its own performance after
deployment, not just certify it once. The app already measures calibration
(``app/_lib/calibration.ts``: fit score read as a probability vs the observed
advance/pass outcome → 10-bin reliability curve + Brier score); this module adds
the missing comparison over TIME: given two such calibration payloads — a frozen
baseline and a current window — decide, deterministically and without any model
call, whether the score→outcome relationship has drifted enough to alarm.

Pure functions only, no wiring: nothing here reads a database, calls an API, or
schedules anything. Callers feed it payloads in the EXACT shape the TS engine
emits (``CalibrationResult``: ``n``/``positives``/``brier``/``bins``/
``calibrated``/``minOutcomes``, bins with ``lo``/``hi``/``count``/``predicted``/
``observed``), so a JSON blob serialized by the app is directly consumable.
``compute_calibration`` mirrors the TS ``computeCalibration`` so Python-side
callers can also build a payload from raw (score, outcome) pairs.

Drift axes (each with a named, commented threshold):

  - brier degradation — the headline "are our probabilities getting worse" axis;
  - PSI (population stability index) over the bin score distribution — the
    standard "did the scored population shift" measure (credit-risk convention:
    <0.10 stable, 0.10-0.25 moderate, >0.25 significant);
  - base-rate shift — the observed positive (advance) rate moved, which
    invalidates the reliability curve even if Brier looks flat.

Honesty gate: with EITHER window below ``minOutcomes`` the verdict is
``insufficient_data`` and the alarm NEVER fires — an alarm computed on noise is
itself a monitoring defect (same principle as the TS ``calibrated`` flag and
matching_eval's "unmeasured metric must not pass" rule).
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Mapping, Sequence

# Mirrors of app/_lib/calibration.ts (keep numerically identical).
MIN_CALIBRATION_OUTCOMES = 20
CALIBRATION_BIN_COUNT = 10

# -- drift thresholds -------------------------------------------------------
# Brier ranges 0 (perfect) .. 0.25 (uninformative coin at p=0.5). A worsening of
# 0.05 eats a fifth of that whole range — comfortably past run-to-run jitter on
# n>=20 windows, and roughly the gap between a decent (≈0.18) and a useless
# (≈0.25) recruitment ranker. Improvement never alarms (signed, not absolute).
BRIER_DEGRADATION_ALERT = 0.05
# Standard PSI convention: >0.25 = significant population shift. We alarm only
# at "significant"; the 0.10 "moderate" band is reported but does not alarm.
PSI_ALERT = 0.25
# The observed advance rate is the curve's anchor; a ±10-percentage-point move
# means the outcome mix changed enough that the frozen curve no longer describes
# the population (e.g. a hiring-bar change), regardless of the Brier delta.
POSITIVE_RATE_SHIFT_ALERT = 0.10
# PSI epsilon floor so an empty bin on one side contributes a large-but-finite
# term instead of a division by zero / log(0).
_PSI_EPSILON = 1e-4

VERDICT_OK = "ok"
VERDICT_DRIFT = "drift"
VERDICT_INSUFFICIENT = "insufficient_data"


def _clamp_prob(score: float) -> float:
    """TS ``clampProb``: a 0-100 fit total read as a probability, clamped."""
    try:
        p = float(score) / 100.0
    except (TypeError, ValueError):
        return 0.0
    if p != p:  # NaN
        return 0.0
    return 0.0 if p < 0.0 else 1.0 if p > 1.0 else p


def _bin_index(prob: float) -> int:
    """TS ``binIndex``: [0,0.1)->0 … [0.9,1.0]->9; prob==1 lands in the last bin."""
    idx = int(prob * CALIBRATION_BIN_COUNT)
    return CALIBRATION_BIN_COUNT - 1 if idx >= CALIBRATION_BIN_COUNT else idx


def compute_calibration(
    pairs: Sequence[Mapping[str, Any]],
    min_outcomes: int = MIN_CALIBRATION_OUTCOMES,
) -> dict[str, Any]:
    """Python mirror of TS ``computeCalibration`` — same keys, same semantics.

    ``pairs`` are ``{"score": 0-100, "outcome": 0|1}`` mappings; ``outcome`` is
    coerced (>= 0.5 counts as positive), non-finite scores are treated as 0.
    Deterministic and side-effect free.
    """
    acc = [{"count": 0, "sum_pred": 0.0, "sum_obs": 0} for _ in range(CALIBRATION_BIN_COUNT)]
    n = 0
    positives = 0
    sq_err = 0.0
    for pair in pairs:
        prob = _clamp_prob(pair.get("score", 0))
        outcome = 1 if float(pair.get("outcome", 0)) >= 0.5 else 0
        n += 1
        positives += outcome
        sq_err += (prob - outcome) ** 2
        b = acc[_bin_index(prob)]
        b["count"] += 1
        b["sum_pred"] += prob
        b["sum_obs"] += outcome
    bins = [
        {
            "lo": i / CALIBRATION_BIN_COUNT,
            "hi": (i + 1) / CALIBRATION_BIN_COUNT,
            "count": b["count"],
            "predicted": (b["sum_pred"] / b["count"]) if b["count"] else 0,
            "observed": (b["sum_obs"] / b["count"]) if b["count"] else 0,
        }
        for i, b in enumerate(acc)
    ]
    return {
        "n": n,
        "positives": positives,
        "brier": (sq_err / n) if n else None,
        "bins": bins,
        "calibrated": n >= min_outcomes,
        "minOutcomes": min_outcomes,
    }


def _bin_shares(payload: Mapping[str, Any]) -> list[float]:
    """Per-bin share of the window's pairs, epsilon-floored for the PSI log term."""
    bins = payload["bins"]
    total = sum(int(b["count"]) for b in bins)
    if total <= 0:
        return [_PSI_EPSILON] * len(bins)
    return [max(int(b["count"]) / total, _PSI_EPSILON) for b in bins]


def population_stability_index(
    baseline: Mapping[str, Any], current: Mapping[str, Any]
) -> float:
    """PSI between the two windows' score-bin distributions.

    ``sum((cur - base) * ln(cur / base))`` over the ten shared probability bins.
    Both payloads carry exactly CALIBRATION_BIN_COUNT bins by construction (the
    TS engine always emits all bins, empty ones with count 0)."""
    from math import log

    base = _bin_shares(baseline)
    cur = _bin_shares(current)
    if len(base) != len(cur):
        raise ValueError(f"bin count mismatch: baseline {len(base)} vs current {len(cur)}")
    return sum((c - b) * log(c / b) for b, c in zip(base, cur))


@dataclass
class DriftReport:
    """The Art. 72 monitoring verdict for one baseline→current comparison."""

    verdict: str  # ok | drift | insufficient_data
    alarm: bool
    brier_delta: float | None  # current − baseline; positive = worse; None if either is None
    psi: float | None  # None when insufficient data
    positive_rate_shift: float | None  # |current − baseline| advance rate
    baseline_n: int
    current_n: int
    reasons: list[str] = field(default_factory=list)  # human-readable, one per tripped axis


def detect_drift(
    baseline: Mapping[str, Any],
    current: Mapping[str, Any],
    *,
    brier_alert: float = BRIER_DEGRADATION_ALERT,
    psi_alert: float = PSI_ALERT,
    positive_rate_alert: float = POSITIVE_RATE_SHIFT_ALERT,
) -> DriftReport:
    """Compare two CalibrationResult payloads and decide whether to alarm.

    Pure: same inputs → same DriftReport. Either window uncalibrated (below its
    own ``minOutcomes``) → ``insufficient_data`` with NO alarm and no computed
    axes, because a drift verdict on statistical noise is worse than none.
    """
    base_n = int(baseline.get("n", 0))
    cur_n = int(current.get("n", 0))
    if not baseline.get("calibrated") or not current.get("calibrated"):
        return DriftReport(
            verdict=VERDICT_INSUFFICIENT,
            alarm=False,
            brier_delta=None,
            psi=None,
            positive_rate_shift=None,
            baseline_n=base_n,
            current_n=cur_n,
            reasons=[
                f"window below minOutcomes (baseline {base_n}/{baseline.get('minOutcomes')}, "
                f"current {cur_n}/{current.get('minOutcomes')}) — drift not evaluable"
            ],
        )

    reasons: list[str] = []

    base_brier = baseline.get("brier")
    cur_brier = current.get("brier")
    brier_delta: float | None = None
    if base_brier is not None and cur_brier is not None:
        brier_delta = round(float(cur_brier) - float(base_brier), 6)
        if brier_delta >= brier_alert:
            reasons.append(
                f"brier degraded by {brier_delta:+.3f} (>= {brier_alert}) — "
                "score probabilities are getting less reliable"
            )

    psi = round(population_stability_index(baseline, current), 6)
    if psi >= psi_alert:
        reasons.append(
            f"score-distribution PSI {psi:.3f} (>= {psi_alert}) — the scored population shifted significantly"
        )

    rate_shift = round(abs(current["positives"] / cur_n - baseline["positives"] / base_n), 6)
    if rate_shift >= positive_rate_alert:
        reasons.append(
            f"advance rate moved by {rate_shift:.3f} (>= {positive_rate_alert}) — "
            "the outcome base rate no longer matches the baseline curve"
        )

    alarm = bool(reasons)
    return DriftReport(
        verdict=VERDICT_DRIFT if alarm else VERDICT_OK,
        alarm=alarm,
        brier_delta=brier_delta,
        psi=psi,
        positive_rate_shift=rate_shift,
        baseline_n=base_n,
        current_n=cur_n,
        reasons=reasons,
    )
