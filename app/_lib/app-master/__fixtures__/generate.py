"""Regenerate the backbone parity fixtures FROM THE PYTHON AUTHORITY.

``app/_lib/app-master/backbone.ts`` is a port of
``pipeline.jobfit.appmaster.backbone_score``. Two implementations of one scoring
function drift unless something pins them together, so the TS side is tested
against output this script produced by CALLING the Python function — not against
hand-written expectations, which would only pin the port to itself.

Run from the repo root::

    python app/_lib/app-master/__fixtures__/generate.py

Then ``npm run test:unit`` (``app/_lib/app-master/backbone.test.ts``) asserts the
TS port reproduces every fixture exactly, key for key and float for float.

The three cases are chosen to exercise the three verdicts AND the two
disciplines the rubric calls load-bearing:

  * ``pass``       — every rule measured, no gate tripped
  * ``incomplete`` — nothing to rate on five of six rules (unmeasured is NOT
                     zero: the score is over the scored weight only, and
                     ``coverage`` discloses how little that was)
  * ``fail``       — a forbidden-class violation fails the verdict outright,
                     however good the weighted rules look

Inputs are written in camelCase (the wire/TS spelling); ``_Base`` accepts them
through its alias generator, so one literal feeds both sides.
"""

from __future__ import annotations

import json
import pathlib
import sys

# Import the package from the repo root regardless of the cwd this is run from.
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[4]))

from pipeline.jobfit.appmaster import PerformanceBackbone, backbone_score  # noqa: E402

HERE = pathlib.Path(__file__).resolve().parent

CASES: dict[str, dict] = {
    # Every rule has a reading and nothing is over the line — the only shape that
    # can reach "pass".
    "pass": {
        "windowDays": 30,
        "proposalsOpened": 8,
        "proposalsMerged": 6,
        "proposalsReverted": 1,
        "gatePassRate": 0.92,
        "forbiddenClassViolations": 0,
        "kpiDeltas": [
            {"kpiKey": "p95_ttfb_ms", "baseline": 820.0, "current": 610.0, "target": 600.0,
             "direction": "lte", "windowDays": 30, "measured": True},
            {"kpiKey": "gate_green_rate", "baseline": 0.71, "current": 0.94, "target": 0.9,
             "direction": "gte", "windowDays": 30, "measured": True},
            {"kpiKey": "open_bug_age_days", "baseline": 12.0, "current": 14.0, "target": 7.0,
             "direction": "lte", "windowDays": 30, "measured": True},
        ],
        "budgetReservedUsd": 120.0,
        "budgetSettledUsd": 90.0,
        "budgetUnmeasured": False,
        "ledgerConsistent": True,
    },
    # A probation window in which almost nothing was measurable. The point of the
    # fixture: five rules drop out of BOTH numerator and denominator, so the one
    # rule that could be read scores 1.0 — and `coverage` 0.05 is what stops that
    # from reading as a perfect agent.
    "incomplete": {
        "windowDays": 14,
        "proposalsOpened": 0,
        "proposalsMerged": 0,
        "proposalsReverted": 0,
        "gatePassRate": None,
        "forbiddenClassViolations": 0,
        "kpiDeltas": [
            {"kpiKey": "weekly_active_users", "baseline": None, "current": None, "target": 500.0,
             "direction": "gte", "windowDays": 14, "measured": False},
        ],
        "budgetReservedUsd": 0.0,
        "budgetSettledUsd": 0.0,
        "budgetUnmeasured": True,
        "ledgerConsistent": True,
    },
    # The gate is not a weight: two forbidden-class violations fail the verdict
    # even though four rules still contribute. The window is also over budget and
    # the ledger disagrees with the record, so the weighted score is low too —
    # but the verdict would be "fail" regardless.
    "fail": {
        "windowDays": 30,
        "proposalsOpened": 5,
        "proposalsMerged": 1,
        "proposalsReverted": 1,
        "gatePassRate": 0.4,
        "forbiddenClassViolations": 2,
        "kpiDeltas": [
            {"kpiKey": "p95_ttfb_ms", "baseline": 820.0, "current": 910.0, "target": 600.0,
             "direction": "lte", "windowDays": 30, "measured": True},
        ],
        "budgetReservedUsd": 50.0,
        "budgetSettledUsd": 80.0,
        "budgetUnmeasured": False,
        "ledgerConsistent": False,
    },
}


def main() -> None:
    for name, payload in CASES.items():
        backbone = PerformanceBackbone.model_validate(payload)
        fixture = {
            "_generatedBy": "app/_lib/app-master/__fixtures__/generate.py",
            "_source": "pipeline.jobfit.appmaster.backbone_score",
            "backbone": payload,
            "expected": backbone_score(backbone),
        }
        path = HERE / f"backbone-{name}.json"
        path.write_text(json.dumps(fixture, indent=2, sort_keys=False) + "\n", encoding="utf-8")
        print(f"wrote {path.relative_to(pathlib.Path.cwd()) if path.is_relative_to(pathlib.Path.cwd()) else path}")


if __name__ == "__main__":
    main()
