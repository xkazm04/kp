"""Fault-injection drill — what degradation looks like when a provider LIES.

THE GAP THIS CLOSES. Keyless degradation is a product property here (ADR 0004)
and it is gated on every push: ``automation_eval --no-llm --strict`` runs every
task with ``provider=None`` and holds reliability at 100%. So the ABSENT-provider
path is the best-tested path in the pipeline. The path that had no test at all is
a provider that answers — one that hangs past its deadline, returns prose where
JSON was promised, returns an object whose every value is out of range, or
returns a fluent rejection letter that names the candidate's age as the reason.

This module runs the SAME tasks and the SAME reliability checks as
``automation_eval`` — imported from it, never restated — against
``llm.fault.FaultProvider``, one declared failure at a time, and records what
each one degrades to. It is a gate, not a report: with ``--strict`` every
expectation below must hold or the run exits non-zero.

    python -m pipeline.jobfit.eval.fault_eval --strict        # the CI gate
    python -m pipeline.jobfit.eval.fault_eval --mode hang     # one fault
    python -m pipeline.jobfit.eval.fault_eval --json

WHAT IS ASSERTED, per fault × task × scenario:

  SHAPE      the task's own reliability check passes — the identical function
             ``automation_eval`` gates the keyless path with, including the
             fairness invariants (no early-career auto-reject, no protected-
             characteristic language in a rejection, no re-match below floor).
             A lying provider must not be able to break an invariant that the
             absent provider cannot break.

  THE WIRE   for a fault that produces nothing usable, the answer on the wire is
             the deterministic one AND says so (``source == "deterministic"``).
             Truthful source labelling is the property that makes the other
             evals readable, so a fault that silently poses as model output is a
             failure even when its content is fine.

  THE BOUND  the number of paid completions one task run costs, held between a
             CEILING and a FLOOR. A provider that fails is a provider being paid
             to fail; ``complete_json``'s single corrective re-prompt and
             ``complete``'s three attempts are the stated ceilings. The floor is
             the other half: a task that never calls the handed-over provider
             spends 0, which passes every ceiling while exercising nothing — and
             for the three well-formed-payload faults no other column would have
             noticed. See ``Expectation.min_calls``.

  THE CLOCK  a hanging provider is bounded by the TOTAL deadline, not by
             attempts × timeout — the regression ``base.complete``'s deadline
             gate was written for.

  THE REASON what the OPERATOR is told. A deterministic serve is a zero-cost
             ledger line whichever way it happened, so "no key" and "the provider
             answered with prose" used to look identical in the usage record —
             the two degradations most worth telling apart, because the first is
             a configuration choice and the second is an outage being paid for.
             ``automation._generate`` now names every mid-call descent
             (``automation.DEGRADATION_REASONS``) and ``automation_cli`` passes it
             to ``emit_deterministic`` in place of the ``None`` the availability
             gate leaves behind. Each fault below declares which reasons it may
             legitimately produce; a fault that degrades ANONYMOUSLY fails here
             even when the answer on the wire is correct.

WHAT IS DELIBERATELY NOT ASSERTED. For ``nonsense`` and ``fairness_attack`` the
payload is well-formed, so coercion legitimately keeps parts of it; the contract
there is the invariant, not the source label. Everything those two modes prove is
in the SHAPE column — and because either may legitimately end up on the wire as
the model's own answer, neither declares a required reason.

STILL NOT COVERED, stated rather than hidden: the same seam exists in
``devcase/{analyze,design,evaluate,reflect}.py`` and in ``match_reasoning`` (the
path ``rematch`` takes), each with its own private ``_generate``. Those still
degrade anonymously. This drill runs the ``automation`` tasks, so it can only
hold that one seam to the contract; unifying the four copies is the follow-up.
See docs/development/fault-injection.md.
"""

from __future__ import annotations

import argparse
import json
import sys
import time
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass, field
from typing import Any

from .. import automation
from .._cli import configure_stdio
from ..llm import provider_availability
from ..llm.fault import MODES, NO_PAYLOAD_MODES, FaultProvider
from ._style import _make_styler, should_color
from .automation_eval import SCENARIOS, TASKS
from .runner import glyph, verdict_banner
from .thresholds import FAULT_THRESHOLD

# The candidate-facing letters. A fault that reaches the wire here reaches a
# person outside the company, which is why they carry an extra assertion.
LETTER_TASKS: tuple[str, ...] = ("outreach", "rejection", "offer")

# The tasks whose LLM call goes through ``automation._generate``, and which
# therefore record a descent reason. ``rematch`` is the exception and is listed
# by its absence on purpose: it ranks with ``match_reasoning.generate``, a second
# copy of the same helper that has not adopted the vocabulary, so it still
# degrades anonymously. Asserting a reason there would fail on a gap this drill
# did not create; pretending the task is covered would hide it. It runs, and every
# other column still holds it — see the STILL NOT COVERED note in the header.
REASONED_TASKS: tuple[str, ...] = ("screen", "outreach", "rejection", "prep", "scorecard", "offer")

# A task renamed or added without deciding which side of that line it is on would
# silently stop being reason-checked, which is the failure this whole column is
# about. Same shape as the _MISSING guard below.
_UNKNOWN_TASKS = [t for t in REASONED_TASKS if t not in TASKS]
if _UNKNOWN_TASKS:
    raise RuntimeError(f"REASONED_TASKS names tasks that do not exist: {_UNKNOWN_TASKS}")

# THREE scenarios, not the full six: one early-career candidate (the fairness
# invariants are written about them), one Czech-language candidate (the letters
# have a locale-specific deterministic template that a discarded draft falls back
# to), and one plain weak BAU candidate (a reject IS the correct answer there, so
# it catches an over-eager guard). Every fault runs against all three; the point
# of the matrix is fault × task, and widening the scenario axis only multiplies
# the two modes that intentionally spend wall-clock.
_SCENARIO_NAMES = ("student_weak_fairness", "czech_outreach", "bau_weak")
SCENARIOS_UNDER_FAULT = [s for s in SCENARIOS if s.name in _SCENARIO_NAMES]

# A timing assertion needs headroom for a loaded CI runner; it is here to catch
# "attempts × timeout" blow-outs (a ~3× overrun), not to measure latency.
_DEADLINE_SLACK_S = 3.0


def _call_was_owed(task_name: str, out: dict) -> bool:
    """Was this task obliged to reach its LLM call at all?

    The call FLOOR (``Expectation.min_calls``) can only be asserted where a call
    was owed. ``rematch`` is the one task whose call is conditional:
    ``automation.rematch_candidate`` returns ``{"found": False}`` and never
    reaches ``generate_reasoning`` when no alternative role clears
    ``POLICY["rematch_floor"]`` — true for two of the three drill scenarios, so a
    blanket floor would fail on correct behaviour. Every other task calls
    unconditionally, and the default here says so.
    """
    if task_name == "rematch":
        return out.get("found") is not False
    return True


@dataclass(frozen=True)
class Expectation:
    """One declared fault and what the product owes when it happens."""

    mode: str
    # What a reader should take away from the row — printed in the report so the
    # recorded expectation is legible without reading this file.
    degrades_to: str
    # The lie this fault tells, in the operator's words. Lives here rather than in
    # the doc because `--doc-table` GENERATES the doc's fault table from this
    # tuple: a mode added or re-described in code and not in prose is the drift
    # `test_fault_eval.test_doc_table_matches_the_doc` exists to refuse.
    lie: str
    # Ceiling on paid completions for ONE task run. Derived, not guessed:
    #   3 = base._MAX_ATTEMPTS (a retryable failure on every attempt)
    #   2 = one call + complete_json's single corrective re-prompt
    #   1 = the provider answered; nothing to retry or repair
    #   0 = available() was False, so nothing was ever spent
    max_calls: int
    # FLOOR on paid completions, and the other half of the bound. The ceiling
    # alone is one-sided: a task that quietly stopped calling the provider at all
    # — a `provider=None` that crept back into a call site, a guard that returns
    # the deterministic answer before it ever tries — spends 0, which is under
    # every ceiling, so the drill read it as a pass. For `nonsense`,
    # `fairness_attack` and `protected_language` NOTHING else would have noticed:
    # the payload is well-formed, so THE WIRE does not apply and `reasons` is
    # empty by design. Default 1 rather than 0 so a mode added to fault.py
    # inherits the floor instead of opting out of it silently; `unavailable` is
    # the one declared 0, because its whole point is that nothing is spent.
    min_calls: int = 1
    # Total wall-clock budget handed to the provider, and thus the deadline the
    # run must respect. Small on purpose: the drill should be seconds, not minutes.
    timeout_s: int = 30
    # None = do not assert timing (the fault is instantaneous).
    max_seconds: float | None = None
    # The mid-call descent reasons this fault may legitimately record, as a SET
    # rather than one value: `transient` lands on "provider_timeout" or
    # "provider_error" depending on whether the retries or the deadline ran out
    # first, and pinning either one would make the drill flap on a loaded runner.
    # Empty = assert nothing (the descent happened at the availability gate, or
    # the model's answer legitimately shipped).
    reasons: frozenset[str] = frozenset()


_CALL_FAILED = frozenset({"provider_timeout", "provider_error"})
_UNPARSEABLE = frozenset({"unparseable_output"})
_UNUSABLE = frozenset({"unusable_output"})

EXPECTATIONS: tuple[Expectation, ...] = (
    Expectation(
        "unavailable",
        "the keyless path — nothing is spent and the deterministic answer ships",
        lie="`available()` is False — the CONTROL row",
        max_calls=0,
        # The one fault with no floor: spending nothing IS the expectation.
        min_calls=0,
        # No call was made, so _generate records nothing: the reason for THIS
        # descent belongs to the availability gate and the CLI already has it.
        reasons=frozenset(),
    ),
    Expectation(
        "transient",
        "retried up to 3 times, then the deterministic answer",
        lie="a retryable 503 on every attempt",
        max_calls=3,
        timeout_s=2,
        max_seconds=2 + _DEADLINE_SLACK_S,
        reasons=_CALL_FAILED,
    ),
    Expectation(
        "hang",
        "bounded by the TOTAL deadline, then the deterministic answer",
        lie="sleeps, then times out, every attempt",
        max_calls=3,
        timeout_s=2,
        max_seconds=2 + _DEADLINE_SLACK_S,
        reasons=_CALL_FAILED,
    ),
    Expectation(
        "malformed",
        "one corrective re-prompt, then the deterministic answer",
        lie="confident prose, no JSON at all",
        max_calls=2,
        reasons=_UNPARSEABLE,
    ),
    Expectation(
        "truncated",
        "one corrective re-prompt, then the deterministic answer",
        lie="a JSON object cut off mid-value",
        max_calls=2,
        reasons=_UNPARSEABLE,
    ),
    Expectation(
        "empty",
        "one corrective re-prompt, then the deterministic answer",
        lie="an empty string",
        max_calls=2,
        reasons=_UNPARSEABLE,
    ),
    # Valid JSON of the wrong TYPE: it parses, so the call succeeds and the
    # coercer is what trips — which is why this one is "unusable", not
    # "unparseable". The distinction is the whole reason the two are separate.
    Expectation(
        "wrong_shape",
        "parsed, coerced away, reported as deterministic",
        lie="valid JSON of the wrong type (a list)",
        max_calls=1,
        reasons=_UNUSABLE,
    ),
    Expectation(
        "nonsense",
        "every value clamped into range; invariants hold",
        lie="a well-formed object, every value out of range",
        max_calls=1,
    ),
    Expectation(
        "fairness_attack",
        "the fairness gate overrules the model's verdict",
        lie="a plausible hard REJECT at max confidence, aimed at the early-career candidate",
        max_calls=1,
    ),
    Expectation(
        "protected_language",
        "the letter is discarded whole for the deterministic one",
        lie="a well-formed letter blaming age, marital status and disability",
        max_calls=1,
    ),
)

_BY_MODE = {e.mode: e for e in EXPECTATIONS}

# Every declared mode must carry an expectation: a mode added to fault.py without
# one would run and assert nothing, which is worse than not running.
_MISSING = [m for m in MODES if m not in _BY_MODE]
if _MISSING:
    raise RuntimeError(f"fault modes without a recorded expectation: {_MISSING}")


@dataclass
class Row:
    mode: str
    task: str
    scenario: str
    source: str
    calls: int
    seconds: float
    # The mid-call descent reason automation._generate recorded, or None when the
    # run did not degrade after the availability gate.
    reason: str | None = None
    failures: list[str] = field(default_factory=list)

    @property
    def ok(self) -> bool:
        return not self.failures


def _run_one(mode: str, task_name: str, scenario: Any) -> Row:
    exp = _BY_MODE[mode]
    # One provider per run: `.calls` is this run's bill, and a shared instance
    # would make the bound unreadable.
    provider = FaultProvider(mode, timeout=exp.timeout_s)
    # The call-site contract, mirrored exactly from automation_cli.py: consult
    # availability first, and pass None when the provider cannot serve.
    ok, _descent = provider_availability(provider)
    handed = provider if ok else None

    started = time.monotonic()
    try:
        out, source = TASKS[task_name]["run"](scenario, handed)
    except Exception as exc:  # noqa: BLE001 — an escaping exception IS the finding
        # Drain the thread-local even on the failure path: these run on a pooled
        # thread, and a reason left behind would be read as the NEXT item's.
        automation.take_degradation_reason()
        return Row(
            mode=mode,
            task=task_name,
            scenario=scenario.name,
            source="raised",
            calls=provider.calls,
            seconds=time.monotonic() - started,
            failures=[f"escaped as {type(exc).__name__}: {exc}"],
        )
    seconds = time.monotonic() - started
    # Consume-once, so it must be read here and passed down rather than re-read.
    reason = automation.take_degradation_reason()

    # SHAPE — the same reliability check the keyless gate uses.
    failures = list(TASKS[task_name]["check"](out, scenario))

    # THE BOUND — a ceiling AND a floor. See Expectation.min_calls for why the
    # ceiling alone was one-sided.
    if provider.calls > exp.max_calls:
        failures.append(f"spent {provider.calls} completions, ceiling {exp.max_calls}")
    elif exp.min_calls and _call_was_owed(task_name, out) and provider.calls < exp.min_calls:
        failures.append(
            f"spent {provider.calls} completions, floor {exp.min_calls}: the provider was handed over "
            f"and never called, so this fault was never actually exercised"
        )

    # THE WIRE — only for faults that produce nothing usable.
    if mode in NO_PAYLOAD_MODES and source != "deterministic":
        failures.append(f"unusable output reached the wire as source={source!r}")

    # THE LETTERS — a protected-characteristic term must never survive into a
    # message a candidate reads, and the discarded draft must say so.
    if task_name in LETTER_TASKS:
        hit = automation.protected_language(out.get("subject"), out.get("body"), out.get("feedback"))
        if hit:
            failures.append(f"FAIRNESS: protected term {hit!r} in a candidate letter")
        if mode == "protected_language" and source != "deterministic":
            failures.append(f"a letter naming a protected characteristic was labelled source={source!r}")

    # THE CLOCK.
    if exp.max_seconds is not None and seconds > exp.max_seconds:
        failures.append(f"took {seconds:.1f}s, deadline budget {exp.max_seconds:.1f}s")

    # THE REASON — what the operator can read back out of the usage ledger.
    if exp.reasons and task_name in REASONED_TASKS:
        if reason is None:
            failures.append(
                f"degraded anonymously: expected one of {sorted(exp.reasons)}, the ledger would say nothing"
            )
        elif reason not in exp.reasons:
            failures.append(f"recorded reason {reason!r}, expected one of {sorted(exp.reasons)}")
    if reason is not None and reason not in automation.DEGRADATION_REASONS:
        # A reason outside the declared vocabulary is a reason the TS side and the
        # operator docs do not know how to read.
        failures.append(f"reason {reason!r} is not in automation.DEGRADATION_REASONS")

    return Row(
        mode=mode,
        task=task_name,
        scenario=scenario.name,
        source=source,
        calls=provider.calls,
        seconds=seconds,
        reason=reason,
        failures=failures,
    )


def run_drill(modes: list[str] | None = None, max_workers: int = 4) -> list[Row]:
    selected = modes or list(MODES)
    items = [
        (mode, task_name, scenario)
        for mode in selected
        for task_name in TASKS
        for scenario in SCENARIOS_UNDER_FAULT
    ]
    workers = max(1, min(max_workers, len(items)))
    with ThreadPoolExecutor(max_workers=workers) as pool:
        return list(pool.map(lambda item: _run_one(*item), items))


def _aggregate(rows: list[Row]) -> dict[str, Any]:
    by_mode: dict[str, dict[str, Any]] = {}
    for r in rows:
        m = by_mode.setdefault(
            r.mode, {"n": 0, "ok": 0, "max_calls": 0, "max_seconds": 0.0, "reasons": []}
        )
        m["n"] += 1
        m["ok"] += 1 if r.ok else 0
        m["max_calls"] = max(m["max_calls"], r.calls)
        m["max_seconds"] = max(m["max_seconds"], round(r.seconds, 2))
        # Every reason this fault actually produced, so the report shows what the
        # operator would read rather than only what was demanded.
        label = r.reason or "—"
        if label not in m["reasons"]:
            m["reasons"].append(label)
    total = len(rows)
    passed = sum(1 for r in rows if r.ok)
    return {
        "pass_rate": round(passed / total, 3) if total else 0.0,
        "total": total,
        "passed": passed,
        "by_mode": by_mode,
    }


def _passes(agg: dict[str, Any]) -> bool:
    # A drill with nothing in it is not a pass: an empty --mode filter must not
    # read as "every fault degraded correctly".
    return agg["total"] > 0 and agg["pass_rate"] >= FAULT_THRESHOLD


def _format_md(rows: list[Row], agg: dict[str, Any], *, color: bool = False) -> str:
    st = _make_styler(color)
    passed = _passes(agg)
    n_fail = agg["total"] - agg["passed"]
    banner = verdict_banner(
        [
            f"{agg['passed']}/{agg['total']} checks {'PASS' if passed else 'FAIL'}",
            f"faults {len(agg['by_mode'])}",
            f"expectations held {agg['pass_rate']:.0%}",
        ]
        + ([f"{n_fail} FAIL"] if n_fail else []),
        passed=passed,
        s=st,
    )
    lines = [
        st("# Fault-injection drill (a provider that answers, badly)", "bold") + "\n",
        banner + "\n",
        f"Tasks: {len(TASKS)} · scenarios: {len(SCENARIOS_UNDER_FAULT)} "
        f"({', '.join(s.name for s in SCENARIOS_UNDER_FAULT)}) · "
        f"threshold: every expectation holds ({FAULT_THRESHOLD:.0%})\n",
        "## Per fault\n",
        "| fault | runs | held | max calls (ceiling) | slowest | ledger reason | degrades to |",
        "|---|---|---|---|---|---|---|",
    ]
    for mode, m in agg["by_mode"].items():
        exp = _BY_MODE[mode]
        held = m["ok"] == m["n"]
        lines.append(
            f"| `{mode}` {glyph(held, st)} | {m['n']} | {m['ok']}/{m['n']} | "
            f"{m['max_calls']} ({exp.max_calls}) | {m['max_seconds']:.2f}s | "
            f"{', '.join(f'`{r}`' for r in m['reasons'])} | {exp.degrades_to} |"
        )
    bad = [r for r in rows if not r.ok]
    if bad:
        lines.append("\n## Expectations that did NOT hold\n")
        for r in bad:
            lines.append(f"- **{r.mode} / {r.task} / {r.scenario}**: {'; '.join(r.failures)}")
    return "\n".join(lines)


# The doc's generated block is delimited by HTML comments rather than a code
# fence: a fenced markdown table renders as source, and the point of the block is
# that a reader sees the table. The markers are what `--doc-table` writes between
# and what test_fault_eval reads back out.
DOC_PATH = "docs/development/fault-injection.md"
DOC_TABLE_BEGIN = "<!-- generated: fault-table (python -m pipeline.jobfit.eval.fault_eval --doc-table) -->"
DOC_TABLE_END = "<!-- /generated: fault-table -->"


def _doc_table() -> str:
    """The fault table as the doc carries it, generated from ``EXPECTATIONS``.

    The table was hand-narrated in prose and bound to nothing, so a mode added,
    renamed or re-costed in code left the doc quietly wrong. Now the code writes
    it and ``test_fault_eval`` refuses the drift.
    """
    lines = [
        "| mode | the lie it tells | what the product owes | paid calls |",
        "| --- | --- | --- | --- |",
    ]
    for e in EXPECTATIONS:
        # "≤ N" only where there is a range to bound; a fault that costs exactly
        # one call (or none) should not read as an upper limit someone may relax.
        calls = f"≤ {e.max_calls}" if e.max_calls > 1 else str(e.max_calls)
        lines.append(f"| `{e.mode}` | {e.lie} | {e.degrades_to} | {calls} |")
    return "\n".join(lines)


def main(argv: list[str] | None = None) -> int:
    configure_stdio(errors="replace")

    parser = argparse.ArgumentParser(
        description="Drill the LLM degradation path with a provider that answers badly."
    )
    parser.add_argument(
        "--mode",
        action="append",
        choices=list(MODES),
        help="Run only this fault (repeatable). Default: every declared fault.",
    )
    parser.add_argument("--strict", action="store_true", help="Exit non-zero if an expectation fails.")
    parser.add_argument("--no-color", action="store_true", help="Disable ANSI color in the pretty report.")
    parser.add_argument("--json", action="store_true")
    parser.add_argument(
        "--doc-table",
        action="store_true",
        help=f"Print the fault table for {DOC_PATH} and exit (runs no drill).",
    )
    args = parser.parse_args(argv)

    if args.doc_table:
        print(_doc_table())
        return 0

    rows = run_drill(args.mode)
    agg = _aggregate(rows)

    if args.json:
        print(
            json.dumps(
                {
                    "aggregate": agg,
                    "passes": _passes(agg),
                    "expectations": [
                        {
                            "mode": e.mode,
                            "degradesTo": e.degrades_to,
                            "maxCalls": e.max_calls,
                            "timeoutS": e.timeout_s,
                            "reasons": sorted(e.reasons),
                        }
                        for e in EXPECTATIONS
                    ],
                    "rows": [
                        {
                            "mode": r.mode,
                            "task": r.task,
                            "scenario": r.scenario,
                            "source": r.source,
                            "reason": r.reason,
                            "calls": r.calls,
                            "seconds": round(r.seconds, 3),
                            "ok": r.ok,
                            "failures": r.failures,
                        }
                        for r in rows
                    ],
                },
                indent=2,
                ensure_ascii=False,
            )
        )
    else:
        print(_format_md(rows, agg, color=should_color(args)))

    if not _passes(agg):
        sys.stderr.write("fault_eval: at least one degradation expectation did not hold\n")
    return 1 if (args.strict and not _passes(agg)) else 0


if __name__ == "__main__":
    raise SystemExit(main())
