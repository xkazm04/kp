"""Single source of truth for every eval pass/fail threshold — with its reason.

Centralised so a gate can't silently drift per-module, and validated at import
so a typo'd threshold (negative, >1, non-numeric) fails fast instead of making a
run trivially pass or fail. Each eval module re-exports the table it consumes.

A bare number is not a threshold, it is a rumour. Every bar here is a :class:`Bar`
carrying four things a reader (and the ratchet) needs:

``why``
    what the bar is protecting — the sentence a reviewer would otherwise have to
    reconstruct from the module that reads it.
``measured`` / ``measured_at`` / ``source`` / ``corpus``
    the number the pipeline actually scored, when, and off which run. A bar with
    no recorded measurement says so (``UNMEASURED``) rather than implying one.
``slack``
    how far BELOW the measurement the bar is allowed to sit. This is the whole
    point of the file: ``role_relevance_at5`` sat at 0.60 while the engine
    measured 0.857, so a 25-point regression shipped green. The slack states the
    run-to-run variance (and, where the only measurement is on a sibling corpus,
    the transfer) the bar is deliberately absorbing — anything wider is not
    tolerance, it is a gate that has stopped watching.

``tests/test_thresholds.py`` asserts every measured bar sits inside its own
slack, and ``python -m pipeline.jobfit.eval.thresholds --tighten`` prints the
ratcheted bar for any that does not (exit 1 while a proposal is outstanding).
"""
from __future__ import annotations

import argparse
import json
from dataclasses import dataclass

from .._cli import configure_stdio

# Sentinel for a bar whose measurement has never been recorded in-tree (a keyed
# run, or an axis added after the last recorded run). It is a visible gap, not a
# silent one: `why` must say what it would take to measure it.
UNMEASURED = "unmeasured"


@dataclass(frozen=True)
class Bar:
    """One pass/fail bar and the evidence for where it sits."""

    value: float
    why: str
    slack: float
    measured: float | None = None
    measured_at: str = UNMEASURED
    source: str = ""
    corpus: str = ""
    scale: str = "fraction"  # "fraction" ([0,1]) or "1-5" (the judge's scale)

    @property
    def is_measured(self) -> bool:
        return self.measured is not None

    @property
    def floor(self) -> float | None:
        """Lowest value this bar may take given the measurement and its slack.

        Rounded to the 2 decimals bars are written in, so the comparison can't
        fail on a float tail nobody would ever type into the table.
        """
        return None if self.measured is None else round(self.measured - self.slack, 2)

    @property
    def within_slack(self) -> bool:
        floor = self.floor
        return True if floor is None else self.value >= floor

    def tightened(self) -> float | None:
        """The ratcheted bar ``--tighten`` proposes: the floor, or None if tight."""
        return None if self.within_slack else self.floor

    def as_dict(self) -> dict[str, object]:
        return {
            "value": self.value,
            "why": self.why,
            "slack": self.slack,
            "measured": self.measured,
            "measured_at": self.measured_at,
            "source": self.source,
            "corpus": self.corpus,
            "scale": self.scale,
            "floor": self.floor,
            "within_slack": self.within_slack,
        }


# --- Provenance shared by a whole family of bars ----------------------------
# The extraction bars gate runner.py over the committed golden set, but the only
# aggregate ever recorded in-tree is the 50-CV CSAS pilot (fixtures_csas/
# _pilot_report.json). Their slack therefore carries TWO things: Gemini's
# run-to-run variance AND the transfer from a sibling corpus. That is wide on
# purpose and stated here once — record a golden-set run and it should narrow.
_PILOT = dict(measured_at="2026-05-31", source="seed_cv_fixtures --all", corpus="fixtures_csas (50-CV CSAS pilot)")
# The matching eval has no model in the loop: same corpus, same code, same number
# every run. Its slack only has to absorb a corpus edit, so it is small.
_MATCH = dict(measured_at="2026-09-04", source="matching_eval --json", corpus="data/seed_jobs (committed corpus)")

# runner.py — golden-set extraction eval (fractions in [0, 1]).
# salary is gated on two axes: salary_coverage (did Gemini emit a band at all)
# and salary_overlap (how close the bands it *did* emit were). Keeping them apart
# stops a coverage regression from hiding behind an accuracy number averaged only
# over emitted bands — see runner.salary_band / Report.aggregate.
PASS_BARS: dict[str, Bar] = {
    "role_family": Bar(
        value=0.85,
        why="The role family routes everything downstream (archetype, matching, salary band); a "
            "wrong family is not a near-miss, it is a candidate scored against the wrong job.",
        slack=0.20,
        measured=0.98,
        **_PILOT,
    ),
    "seniority": Bar(
        value=0.80,
        why="A one-notch seniority slip is survivable (the ladder is ordinal and adjacent bands "
            "overlap in practice), so this sits below role_family — but not by 30 points.",
        slack=0.20,
        measured=1.0,
        **_PILOT,
    ),
    "salary_overlap": Bar(
        value=0.72,
        why="Band accuracy AMONG the bands Gemini emitted. An average of overlaps is the noisiest "
            "axis here — one CV with a stated band in another currency moves it several points.",
        slack=0.25,
        measured=0.968,
        **_PILOT,
    ),
    "salary_coverage": Bar(
        value=0.90,
        why="Did a band get emitted at all. Held high because a coverage collapse is an extraction "
            "bug, not a judgement call. UNMEASURED: the pilot report predates the coverage/overlap "
            "split (schemaVersion 1) and has no coverage figure — record one on the next keyed run.",
        slack=0.10,
    ),
    "skill_recall": Bar(
        value=0.75,
        why="Recall of an expected skill subset. Deliberately the most forgiving extraction bar: "
            "the expected subsets are hand-written and a CV legitimately words a skill three ways.",
        slack=0.20,
        measured=0.952,
        **_PILOT,
    ),
}

# matching_eval.py — archetype routing + entry precision + relevance@5.
MATCHING_BARS: dict[str, Bar] = {
    "archetype_accuracy": Bar(
        value=1.0,
        why="Routing is table-driven and deterministic: a single miss is a broken table, never a "
            "bad day. No margin is meaningful, so the bar is the contract.",
        slack=0.0,
        measured=1.0,
        **_MATCH,
    ),
    "entry_precision": Bar(
        value=0.99,
        why="An entry-level seeker shown a senior-only role is the fairness failure this suite "
            "exists for. One point of slack covers a single borderline row in a growing corpus.",
        slack=0.02,
        measured=1.0,
        **_MATCH,
    ),
    "role_relevance_at5": Bar(
        value=0.84,
        why="Are the top 5 matches in a family the seeker asked for. Ratcheted 2026-09-04 from "
            "0.60, which sat 26 points under what the deterministic engine has been measuring — a "
            "quarter of the ranking could rot without turning the gate red.",
        slack=0.02,
        measured=0.857,
        **_MATCH,
    ),
}

# automation_eval.py — HR-automation reliability + judge quality (1-5 scale).
# fault_eval.py — the fault-injection drill (a provider that ANSWERS, badly).
SCALAR_BARS: dict[str, Bar] = {
    "RELIABILITY_THRESHOLD": Bar(
        value=1.0,
        why="Well-formedness plus the hard fairness invariants (no auto-reject of an early-career "
            "candidate, no protected-characteristic language, the re-match score floor). Every one "
            "of those is a contract the CODE owes, so 100% is the only readable bar.",
        slack=0.0,
        measured=1.0,
        measured_at="2026-09-04",
        source="automation_eval --no-llm --json",
        corpus="automation_eval.SCENARIOS (42 task-runs)",
    ),
    "QUALITY_THRESHOLD": Bar(
        value=3.5,
        why="Mean LLM-judge score, 1-5, over the automation outputs: 'a competent recruiter would "
            "send this' rather than 'this is excellent'. UNMEASURED: --judge needs the Claude CLI "
            "and no judged run is recorded in-tree; record one before tightening.",
        slack=0.5,
        scale="1-5",
    ),
    "FAULT_THRESHOLD": Bar(
        value=1.0,
        # 1.0 with NO acceptable range below it, and that is the point of stating it
        # here: every other threshold in this file scores a model's judgement, where a
        # margin is meaningful. This one scores whether the CODE holds its own declared
        # contract when a dependency lies — the fairness gate overrules a hostile
        # verdict, a discarded draft reports itself as deterministic, a failing call is
        # still bounded. There is no "97% of the time" reading of any of those, so a
        # failure is a regression in the product, never a bad day for a provider.
        why="Whether the code holds its own degradation contract when a dependency lies. A "
            "contract either holds or it does not — there is no '97% of the time' reading, so "
            "this one is not a tunable quality bar at all (_validate refuses any other value).",
        slack=0.0,
        measured=1.0,
        measured_at="2026-09-04",
        source="fault_eval --strict",
        corpus="fault_eval drills",
    ),
}

# The flat float tables every eval module already consumes — derived, never typed
# twice, so a bar and its reason cannot drift apart.
PASS_THRESHOLDS = {key: bar.value for key, bar in PASS_BARS.items()}
MATCHING_THRESHOLDS = {key: bar.value for key, bar in MATCHING_BARS.items()}
RELIABILITY_THRESHOLD = SCALAR_BARS["RELIABILITY_THRESHOLD"].value
QUALITY_THRESHOLD = SCALAR_BARS["QUALITY_THRESHOLD"].value
FAULT_THRESHOLD = SCALAR_BARS["FAULT_THRESHOLD"].value


def all_bars() -> dict[str, Bar]:
    """Every bar in the file under its qualified name (``TABLE.key``)."""
    out: dict[str, Bar] = {}
    for table, bars in (("PASS_THRESHOLDS", PASS_BARS), ("MATCHING_THRESHOLDS", MATCHING_BARS)):
        for key, bar in bars.items():
            out[f"{table}.{key}"] = bar
    out.update(SCALAR_BARS)
    return out


def loose_bars() -> dict[str, Bar]:
    """Measured bars sitting further below their measurement than their slack allows."""
    return {name: bar for name, bar in all_bars().items() if not bar.within_slack}


def _validate_bars() -> None:
    for name, bar in all_bars().items():
        if not bar.why.strip():
            raise ValueError(f"{name} has no `why` — a bare number is not a threshold")
        if not isinstance(bar.slack, (int, float)) or isinstance(bar.slack, bool) or bar.slack < 0:
            raise ValueError(f"{name} slack must be a non-negative number, got {bar.slack!r}")
        if bar.is_measured:
            if bar.measured_at == UNMEASURED or not bar.measured_at.strip():
                raise ValueError(f"{name} records a measurement but no `measured_at`")
            if not bar.source.strip():
                raise ValueError(f"{name} records a measurement but names no `source` command")
        else:
            if bar.measured_at != UNMEASURED:
                raise ValueError(f"{name} has a `measured_at` but no measurement")
            if UNMEASURED.upper() not in bar.why.upper():
                raise ValueError(
                    f"{name} has no recorded measurement and its `why` does not say so — an "
                    f"unmeasured bar must declare the gap, not hide it"
                )
        lo, hi = (1.0, 5.0) if bar.scale == "1-5" else (0.0, 1.0)
        if not (lo <= bar.value <= hi):
            raise ValueError(f"{name} is on the {bar.scale} scale, so {bar.value!r} is out of range")
        if bar.is_measured and not (lo <= bar.measured <= hi):
            raise ValueError(f"{name} measurement {bar.measured!r} is off its own {bar.scale} scale")
    # The float tables are DERIVED from the bars; a hand-edited table would let a
    # gate read a number whose `why` describes a different one.
    for table, bars in (("PASS_THRESHOLDS", PASS_BARS), ("MATCHING_THRESHOLDS", MATCHING_BARS)):
        derived = {key: bar.value for key, bar in bars.items()}
        if globals()[table] != derived:
            raise ValueError(f"{table} drifted from its Bar table — it must stay derived, never hand-edited")


def _validate() -> None:
    for name, table in (("PASS_THRESHOLDS", PASS_THRESHOLDS), ("MATCHING_THRESHOLDS", MATCHING_THRESHOLDS)):
        for key, value in table.items():
            if not isinstance(value, (int, float)) or isinstance(value, bool) or not (0.0 <= value <= 1.0):
                raise ValueError(f"{name}[{key!r}] must be a number in [0, 1], got {value!r}")
    if not (0.0 <= RELIABILITY_THRESHOLD <= 1.0):
        raise ValueError(f"RELIABILITY_THRESHOLD must be in [0, 1], got {RELIABILITY_THRESHOLD!r}")
    if not (1.0 <= QUALITY_THRESHOLD <= 5.0):
        raise ValueError(f"QUALITY_THRESHOLD must be in [1, 5], got {QUALITY_THRESHOLD!r}")
    if FAULT_THRESHOLD != 1.0:
        raise ValueError(
            f"FAULT_THRESHOLD is not a tunable quality bar — a degradation contract either holds "
            f"or it does not; got {FAULT_THRESHOLD!r}"
        )
    _validate_bars()


_validate()


def _report(*, as_json: bool) -> str:
    if as_json:
        return json.dumps({name: bar.as_dict() for name, bar in all_bars().items()}, indent=2, ensure_ascii=False)
    lines = ["| bar | value | measured | at | slack | floor | tighten to |", "|---|---|---|---|---|---|---|"]
    for name, bar in all_bars().items():
        measured = "–" if bar.measured is None else f"{bar.measured}"
        floor = "–" if bar.floor is None else f"{bar.floor}"
        proposal = bar.tightened()
        lines.append(
            f"| {name} | {bar.value} | {measured} | {bar.measured_at} | {bar.slack} | {floor} | "
            f"{'—' if proposal is None else proposal} |"
        )
    return "\n".join(lines)


def main(argv: list[str] | None = None) -> int:
    """Exit-code contract (see ``eval/__main__.py``): 0 = every bar is tight,
    1 = at least one bar is looser than its stated slack (a ratchet is outstanding)."""
    configure_stdio(errors="replace")
    parser = argparse.ArgumentParser(description="Show the eval bars, their reasons and their recorded measurements.")
    parser.add_argument(
        "--tighten",
        action="store_true",
        help="Propose the ratcheted value for every bar sitting further below its measurement than "
             "its slack allows, and exit non-zero while any proposal is outstanding.",
    )
    parser.add_argument("--json", action="store_true", help="Machine-readable table.")
    args = parser.parse_args(argv)

    print(_report(as_json=args.json))
    loose = loose_bars()
    if not args.tighten:
        return 0
    if not loose:
        print("\nEvery measured bar sits within its stated slack. Nothing to tighten.")
        return 0
    print("\n## Proposed ratchet\n")
    for name, bar in loose.items():
        print(
            f"- **{name}**: {bar.value} → **{bar.tightened()}** "
            f"(measured {bar.measured} on {bar.measured_at}, slack {bar.slack})"
        )
    print(
        "\nEach proposal is the measurement minus the bar's own stated slack. Move the value in "
        "thresholds.py, or widen the slack WITH a reason — do not leave the gap unexplained."
    )
    return 1


if __name__ == "__main__":
    raise SystemExit(main())
