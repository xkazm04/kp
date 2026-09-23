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
    measured 0.857, so a 26-point regression shipped green. The slack states the
    run-to-run variance (and, where the only measurement is on a sibling corpus,
    the transfer) the bar is deliberately absorbing — anything wider is not
    tolerance, it is a gate that has stopped watching.

``tests/test_thresholds.py`` asserts every measured bar sits inside its own
slack, and ``python -m pipeline.jobfit.eval.thresholds --tighten`` prints the
ratcheted bar for any that does not (exit 1 while a proposal is outstanding).

THE MEASUREMENT IS RECORDED, NOT TYPED. The slack check is only as good as the
figure it reads, and until 2026-09-23 that figure was a literal typed here by
hand that nothing re-derived: an engine change lifting relevance@5 to 0.95 would
have left the record at 0.857 and the slack reading a stale number (the same
blindness this file was written for, one layer up). The measurements now live in
``measurements.json``, one line per bar, and a ``deterministic`` bar (an eval
with no model in the loop: same code, same corpus, same number every run) is
CERTIFIED on every strict run: :func:`certify_live` compares the live figure and
its count ``n`` to the record, and a difference fails the gate. The owning eval's
``--record`` flag is the only writer; it rewrites that eval's lines alone and
refuses to run in CI, because re-recording is an operator act that moves the
certified figure and the committed diff is its review.
"""
from __future__ import annotations

import argparse
import datetime as _dt
import json
import os
import sys
from collections.abc import Mapping
from dataclasses import dataclass, replace
from pathlib import Path

from .._cli import configure_stdio

# Sentinel for a bar whose measurement has never been recorded in-tree (a keyed
# run, or an axis added after the last recorded run). It is a visible gap, not a
# silent one: `why` must say what it would take to measure it.
UNMEASURED = "unmeasured"

# The recorded measurements, one line per bar. Read here only; written only by
# :func:`record_measurements` (an eval's ``--record``).
MEASUREMENTS_PATH = Path(__file__).with_name("measurements.json")
MEASUREMENTS_SCHEMA = 1
# Any of these set means the process is a CI job, where --record must not run.
CI_ENV_VARS: tuple[str, ...] = ("CI", "GITHUB_ACTIONS")


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
    # How many units the measurement was taken over (scenarios, task-runs, drill
    # rows, checks). Recorded with the figure so a corpus that grew or shrank is
    # a finding instead of a number silently re-meaning itself.
    n: int | None = None
    # No model in the loop: the live figure must EQUAL the record, so a strict
    # run certifies it (certify_live). A keyed / judged bar is never certified.
    deterministic: bool = False
    # The exact command that re-records this bar (deterministic bars only).
    recorder: str = ""

    @property
    def is_measured(self) -> bool:
        return self.measured is not None

    @property
    def recorder_module(self) -> str:
        """The eval module named by ``recorder`` (``matching_eval``, …), or ''."""
        for token in self.recorder.split():
            if token.startswith("pipeline.jobfit.eval."):
                return token.rsplit(".", 1)[-1]
        return ""

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
            "n": self.n,
            "deterministic": self.deterministic,
            "floor": self.floor,
            "within_slack": self.within_slack,
        }


# --- Where the measurements come from ----------------------------------------
# Every measured/measured_at/source/corpus/n below is BOUND from measurements.json
# (bind_measurements), never typed here. The extraction bars gate runner.py over
# the committed golden set, but the only aggregate ever recorded in-tree is the
# 50-CV CSAS pilot (fixtures_csas/_pilot_report.json). Their slack therefore
# carries TWO things: Gemini's run-to-run variance AND the transfer from a sibling
# corpus. That is wide on purpose and stated here once. They are keyed, so never
# live-certified. The matching eval has no model in the loop: same corpus, same
# code, same number every run. Its slack only has to absorb a corpus edit, so it
# is small, and its record is certified on every strict run.
_REC = "python -m pipeline.jobfit.eval."
_MATCH = dict(deterministic=True, recorder=_REC + "matching_eval --record")

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
    ),
    "seniority": Bar(
        value=0.80,
        why="A one-notch seniority slip is survivable (the ladder is ordinal and adjacent bands "
            "overlap in practice), so this sits below role_family — but not by 30 points.",
        slack=0.20,
    ),
    "salary_overlap": Bar(
        value=0.72,
        why="Band accuracy AMONG the bands Gemini emitted. An average of overlaps is the noisiest "
            "axis here — one CV with a stated band in another currency moves it several points.",
        slack=0.25,
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
    ),
}

# matching_eval.py — archetype routing + entry precision + relevance@5.
MATCHING_BARS: dict[str, Bar] = {
    "archetype_accuracy": Bar(
        value=1.0,
        why="Routing is table-driven and deterministic: a single miss is a broken table, never a "
            "bad day. No margin is meaningful, so the bar is the contract.",
        slack=0.0,
        **_MATCH,
    ),
    "entry_precision": Bar(
        value=0.99,
        why="An entry-level seeker shown a senior-only role is the fairness failure this suite "
            "exists for. One point of slack covers a single borderline row in a growing corpus.",
        slack=0.02,
        **_MATCH,
    ),
    "role_relevance_at5": Bar(
        value=0.84,
        why="Are the top 5 matches in a family the seeker asked for. Ratcheted 2026-09-04 from "
            "0.60, which sat 26 points under what the deterministic engine has been measuring — a "
            "quarter of the ranking could rot without turning the gate red.",
        slack=0.02,
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
        deterministic=True,
        recorder=_REC + "automation_eval --no-llm --record",
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
        deterministic=True,
        recorder=_REC + "fault_eval --record",
    ),
    "INTAKE_THRESHOLD": Bar(
        value=1.0,
        # The same kind of number as FAULT_THRESHOLD: --no-llm drives the
        # deterministic intake agent with each persona's golden answers, so every
        # check is a contract the CODE owes (the dialog closes, one question a
        # turn, a grounded read-back, a stated dealbreaker filed as its own
        # requirement). It gates on the CHECK pass rate, and its n is the check
        # count, because the failure the eval's own docstring warns about is a
        # scenario losing a key and silently dropping an assertion.
        why="Share of the offline role-intake dialog checks that hold over the curated persona "
            "bank. Every check is a contract the deterministic agent owes, so a single miss is a "
            "regression, not a bad day (_validate refuses any value but 1.0).",
        slack=0.0,
        deterministic=True,
        recorder=_REC + "intake_eval --no-llm --record",
    ),
}

# --- Binding the recorded measurements --------------------------------------

_RECORD_KEYS = ("measured", "n", "measured_at", "source", "corpus")


def _qualified(table: str, key: str) -> str:
    return key if table == "SCALAR" else f"{table}.{key}"


# The bars as DECLARED above (reason, value, slack, determinism), before any
# measurement is attached. bind_measurements reads these, never the bound tables.
_DECLARED: dict[str, dict[str, Bar]] = {
    "PASS_THRESHOLDS": PASS_BARS,
    "MATCHING_THRESHOLDS": MATCHING_BARS,
    "SCALAR": SCALAR_BARS,
}


def load_measurements(path: Path | None = None) -> dict[str, dict[str, object]]:
    """The recorded measurements, keyed by qualified bar name."""
    data = json.loads((path or MEASUREMENTS_PATH).read_text(encoding="utf-8"))
    if data.get("schema") != MEASUREMENTS_SCHEMA or not isinstance(data.get("bars"), dict):
        raise ValueError(f"{MEASUREMENTS_PATH.name} is not a schema-{MEASUREMENTS_SCHEMA} measurements file")
    return {name: dict(rec) for name, rec in data["bars"].items()}


def _check_record(name: str, rec: Mapping[str, object]) -> None:
    unknown = set(rec) - set(_RECORD_KEYS)
    if unknown:
        raise ValueError(f"measurements.json {name} carries unknown fields {sorted(unknown)}")
    measured = rec.get("measured")
    if not isinstance(measured, (int, float)) or isinstance(measured, bool):
        raise ValueError(f"measurements.json {name} `measured` must be a number, got {measured!r}")
    n = rec.get("n")
    if n is not None and (not isinstance(n, int) or isinstance(n, bool) or n <= 0):
        raise ValueError(f"measurements.json {name} `n` must be a positive count or null, got {n!r}")
    for key in ("measured_at", "source", "corpus"):
        if not isinstance(rec.get(key), str):
            raise ValueError(f"measurements.json {name} `{key}` must be a string")


def bind_measurements(records: Mapping[str, Mapping[str, object]]) -> dict[str, dict[str, Bar]]:
    """Attach each recorded measurement to its declared bar.

    Refuses (ValueError) a record for a bar that does not exist, a deterministic
    bar with no record, and a deterministic record with no count: a bar that is
    certified against its live run cannot be certified against nothing.
    """
    declared = {_qualified(t, k): bar for t, bars in _DECLARED.items() for k, bar in bars.items()}
    orphans = sorted(set(records) - set(declared))
    if orphans:
        raise ValueError(f"measurements.json records bars that do not exist: {orphans}")
    bound: dict[str, dict[str, Bar]] = {}
    for table, bars in _DECLARED.items():
        out: dict[str, Bar] = {}
        for key, bar in bars.items():
            name = _qualified(table, key)
            rec = records.get(name)
            if rec is None:
                if bar.deterministic:
                    raise ValueError(
                        f"{name} is deterministic but has no record in measurements.json — run "
                        f"`{bar.recorder}` and commit the diff"
                    )
                out[key] = bar
                continue
            _check_record(name, rec)
            if bar.deterministic and rec.get("n") is None:
                raise ValueError(f"{name} is deterministic, so its record must carry `n`")
            out[key] = replace(bar, **{k: rec.get(k) for k in _RECORD_KEYS})
        bound[table] = out
    return bound


_BOUND = bind_measurements(load_measurements())
PASS_BARS = _BOUND["PASS_THRESHOLDS"]
MATCHING_BARS = _BOUND["MATCHING_THRESHOLDS"]
SCALAR_BARS = _BOUND["SCALAR"]

# The flat float tables every eval module already consumes — derived, never typed
# twice, so a bar and its reason cannot drift apart.
PASS_THRESHOLDS = {key: bar.value for key, bar in PASS_BARS.items()}
MATCHING_THRESHOLDS = {key: bar.value for key, bar in MATCHING_BARS.items()}
RELIABILITY_THRESHOLD = SCALAR_BARS["RELIABILITY_THRESHOLD"].value
QUALITY_THRESHOLD = SCALAR_BARS["QUALITY_THRESHOLD"].value
FAULT_THRESHOLD = SCALAR_BARS["FAULT_THRESHOLD"].value
INTAKE_THRESHOLD = SCALAR_BARS["INTAKE_THRESHOLD"].value


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
        if bar.deterministic and not bar.recorder_module:
            raise ValueError(f"{name} is deterministic but names no `recorder` command to re-record it")
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
    if INTAKE_THRESHOLD != 1.0:
        raise ValueError(
            f"INTAKE_THRESHOLD is not a tunable quality bar — every offline intake check is a "
            f"contract the deterministic agent owes; got {INTAKE_THRESHOLD!r}"
        )
    _validate_bars()


_validate()


# --- Certifying and re-recording a live run ----------------------------------

# A live figure is a (value, n) pair: the rate the eval reported and the count of
# units it was taken over.
Live = Mapping[str, "tuple[float, int]"]


def _same(a: float, b: float) -> bool:
    # Every eval reports its rates rounded to 3 decimals; compare at that
    # precision so a float tail cannot fake a finding, and nothing coarser.
    return round(float(a), 3) == round(float(b), 3)


def certify_live(live: Live) -> list[str]:
    """Findings for every DETERMINISTIC bar whose live figure or count differs
    from its record. A keyed / judged bar is never certified (it has run-to-run
    variance, which is what its slack is for). Empty list = certified."""
    bars = all_bars()
    findings: list[str] = []
    for name, (value, n) in live.items():
        bar = bars[name]  # a KeyError here is a caller naming a bar that does not exist
        if not bar.deterministic:
            continue
        moved = []
        if bar.measured is None or not _same(value, bar.measured):
            moved.append("the measurement moved")
        if n != bar.n:
            moved.append("corpus size moved")
        if not moved:
            continue
        findings.append(
            f"{name}: live {round(float(value), 3)} over n={n}, recorded {bar.measured} over "
            f"n={bar.n} ({bar.measured_at}) — {' and '.join(moved)}. The certified figure is "
            f"stale: if the change is intended, re-record it with `{bar.recorder}` and commit "
            f"the measurements.json diff; if it is not, the engine regressed."
        )
    return findings


def render_measurements(records: Mapping[str, Mapping[str, object]]) -> str:
    """The canonical text of measurements.json: one bar per line, so a --record
    diff touches exactly the lines of the bars it re-measured."""
    lines = [
        "{",
        f'  "schema": {MEASUREMENTS_SCHEMA},',
        '  "note": "Written by an eval\'s --record flag (never by hand, never in CI). Read by '
        'thresholds.py. A deterministic bar is certified against its live run on every strict run.",',
        '  "bars": {',
    ]
    items = list(records.items())
    for i, (name, rec) in enumerate(items):
        entry = {k: rec.get(k) for k in _RECORD_KEYS}
        comma = "," if i < len(items) - 1 else ""
        lines.append(f"    {json.dumps(name)}: {json.dumps(entry, ensure_ascii=False)}{comma}")
    lines += ["  }", "}", ""]
    return "\n".join(lines)


def record_refusal(environ: Mapping[str, str] | None = None) -> str | None:
    """Why --record may not run here, or None. It refuses inside CI: re-recording
    moves the certified figure, and a CI job doing it would certify whatever the
    push measured — the gate grading itself."""
    env = os.environ if environ is None else environ
    hit = [var for var in CI_ENV_VARS if env.get(var, "").strip() not in ("", "0", "false")]
    if hit:
        return (
            f"--record rewrites the certified measurement and refuses to run in CI ({hit[0]} is set). "
            "Record on an operator machine and commit the measurements.json diff."
        )
    return None


def record_measurements(live: Live, *, source: str, today: str | None = None, path: Path | None = None) -> list[str]:
    """Rewrite ONLY the named bars' measured / n / measured_at / source; every
    other line of the file stays byte-identical. Returns the names whose record
    changed. Refuses a bar that is not deterministic (a keyed figure is recorded
    from its own report, not re-derived by a keyless run)."""
    target = path or MEASUREMENTS_PATH
    bars = all_bars()
    for name in live:
        if not bars[name].deterministic:
            raise ValueError(f"{name} is not deterministic; --record only re-derives keyless figures")
    records = load_measurements(target)
    stamp = today or _dt.date.today().isoformat()
    changed: list[str] = []
    for name, (value, n) in live.items():
        old = records.get(name, {})
        new = {
            "measured": round(float(value), 3),
            "n": int(n),
            "measured_at": stamp,
            "source": source,
            "corpus": old.get("corpus") or bars[name].corpus,
        }
        if old.get("measured") != new["measured"] or old.get("n") != new["n"] or old.get("source") != source:
            changed.append(name)
            records[name] = new
    bind_measurements(records)  # never write a file the next import would refuse
    target.write_text(render_measurements(records), encoding="utf-8", newline="\n")
    return changed


def settle_live(live: Live, *, record: bool, prog: str) -> bool:
    """The one call every keyless eval makes after a canonical run: record it
    (--record) or certify it. Prints to stderr; True when the record stands."""
    if record:
        bars = all_bars()
        sources = {bars[name].recorder for name in live}
        if len(sources) != 1:
            raise ValueError(f"{prog}: one --record run re-records one eval's bars, got {sorted(sources)}")
        changed = record_measurements(live, source=sources.pop())
        if changed:
            sys.stderr.write(f"{prog}: recorded {', '.join(changed)} in {MEASUREMENTS_PATH.name}\n")
        else:
            sys.stderr.write(f"{prog}: the record already matches this run; nothing re-dated\n")
        return True
    findings = certify_live(live)
    for finding in findings:
        sys.stderr.write(f"{prog}: stale record — {finding}\n")
    return not findings


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
