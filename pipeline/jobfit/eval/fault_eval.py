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
each one degrades to. A SECOND seam family rides the same expectations: the
shared fallback runner ``devcase.provenance.generate_with_fallback`` (fifteen
call sites across devcase, agentfit, intake, jobseeker and repo_scan), drilled
through three representative callers — see ``FALLBACK_SEAMS``. It is a gate,
not a report: with ``--strict`` every expectation below must hold or the run
exits non-zero.

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
             ``automation._generate`` names every mid-call descent
             (``llm.degradation.DEGRADATION_REASONS``) and ``automation_cli``
             passes it to ``emit_deterministic`` in place of the ``None`` the
             availability gate leaves behind; ``generate_with_fallback`` stamps
             the same code as ``fallbackCode`` and the devcase / agentfit CLIs
             pass THAT. Each fault below declares which reasons it may
             legitimately produce; a fault that degrades ANONYMOUSLY fails here
             even when the answer on the wire is correct.

WHAT IS DELIBERATELY NOT ASSERTED. For ``nonsense`` and ``fairness_attack`` the
payload is well-formed, so coercion legitimately keeps parts of it; the contract
there is the invariant, not the source label. Everything those two modes prove is
in the SHAPE column — and because either may legitimately end up on the wire as
the model's own answer, neither declares a required reason.

STILL NOT COVERED, stated rather than hidden: the fallback-runner family is
drilled through three of its fifteen callers, not all of them — the runner is
one function, so its contract holds for every caller, but a caller's OWN
coercer or post-processing is only exercised where it is drilled. The
extraction path (``gemini.complete_document`` / cv_analysis) is a different seam
with no fault drill yet. See docs/development/fault-injection.md.
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
from ..devcase.provenance import FALLBACK_CODE_KEY, FALLBACK_REASON_KEY
from ..llm import provider_availability
from ..llm.degradation import DEGRADATION_REASONS
from ..llm.fault import MODES, NO_PAYLOAD_MODES, FaultProvider
from ._style import _make_styler, should_color
from .automation_eval import SCENARIOS, TASKS
from .runner import glyph, verdict_banner
from .thresholds import FAULT_THRESHOLD, record_refusal, settle_live, unit_map

# The candidate-facing letters. A fault that reaches the wire here reaches a
# person outside the company, which is why they carry an extra assertion.
LETTER_TASKS: tuple[str, ...] = ("outreach", "rejection", "offer")

# The tasks that record a descent reason — now every one of them. ``rematch``
# used to be listed by its absence ("match_reasoning has not adopted the
# vocabulary"), but ``automation.rematch_candidate`` records its descent through
# ``on_fallback`` and names the coerced-away answer itself, so the exemption was
# stale. Its call is conditional, so the reason is asserted only where
# ``_call_was_owed`` says a call was due.
REASONED_TASKS: tuple[str, ...] = ("screen", "outreach", "rejection", "prep", "scorecard", "offer", "rematch")

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


# ---------------------------------------------------------------------------
# The SECOND seam family: the shared fallback runner
# ---------------------------------------------------------------------------
#
# ``provenance.generate_with_fallback`` is one function behind fifteen call sites.
# Three are drilled — one per product that leans on it, each with a coercer of a
# different temperament: devcase ``analyze_need`` (field-by-field backfill, so a
# junk answer comes out as the template), agentfit ``analyze_agent_fit`` (a
# post-processed result: coverage ratio and budget are code-owned on BOTH paths)
# and intake ``run_intake_turn`` (a coercer that RAISES on a reply-less payload —
# the case the runner used to file beside a transport failure). The runner stamps
# ``fallbackCode``; THE REASON column reads it from there. Imports are deferred to
# the run so the drill's import cost stays automation's.

_SEAM_JOB = {
    "id": "fault-drill-job",
    "title": "Reporting Analyst",
    "company": "Acme",
    "location": "Praha",
    "description": "Build SQL reports and email weekly summaries to stakeholders.",
    "requirements": [{"skill": "SQL", "kind": "must_have", "hardness": "prerequisite"}],
    "salary_band": [40000, 60000],
}
_SEAM_CATALOG = [{"name": "postgres", "description": "Run SQL against a PostgreSQL database"}]


def _run_analyze_need(provider: Any) -> tuple[dict, str]:
    from ..devcase.analyze import analyze_need
    from ..devcase.models import DevNeed

    return analyze_need(DevNeed(title="Backend Engineer", stack=["Python"]), None, provider=provider)


def _check_analyze_need(out: dict) -> list[str]:
    from ..devcase.analyze import _ANALYZE_KEYS

    failures = [f"missing {k!r}" for k in _ANALYZE_KEYS if k not in out]
    conf = out.get("confidence")
    if not isinstance(conf, (int, float)) or not 0.0 <= conf <= 1.0:
        failures.append(f"confidence {conf!r} outside 0..1")
    return failures


def _run_agent_fit(provider: Any) -> tuple[dict, str]:
    from ..agentfit import analyze_agent_fit
    from ..jobs import Job

    return analyze_agent_fit(Job.model_validate(_SEAM_JOB), list(_SEAM_CATALOG), provider=provider)


def _check_agent_fit(out: dict) -> list[str]:
    from ..agentfit import FIT_VERDICTS

    fit = out.get("fit") if isinstance(out.get("fit"), dict) else {}
    failures = []
    if fit.get("verdict") not in FIT_VERDICTS:
        failures.append(f"verdict {fit.get('verdict')!r} outside {FIT_VERDICTS}")
    ratio = fit.get("coverageRatio")
    if not isinstance(ratio, (int, float)) or not 0.0 <= ratio <= 1.0:
        failures.append(f"coverageRatio {ratio!r} outside 0..1")
    if not isinstance(out.get("budget"), dict):
        failures.append("no code-owned budget")
    return failures


def _run_intake_turn(provider: Any) -> tuple[dict, str]:
    from ..intake import run_intake_turn

    artifact = run_intake_turn(provider, [], {}, "We need a backend engineer for our payments team.", "en")
    return artifact, str(artifact.get("source"))


def _check_intake_turn(out: dict) -> list[str]:
    failures = []
    if not str(out.get("reply") or "").strip():
        failures.append("no reply for the requestor")
    if not isinstance(out.get("brief"), dict):
        failures.append("no brief")
    if not isinstance(out.get("done"), bool):
        failures.append(f"done {out.get('done')!r} is not a bool")
    return failures


FALLBACK_SEAMS: dict[str, dict[str, Any]] = {
    "analyze_need": {"run": _run_analyze_need, "check": _check_analyze_need},
    "analyze_agent_fit": {"run": _run_agent_fit, "check": _check_agent_fit},
    "run_intake_turn": {"run": _run_intake_turn, "check": _check_intake_turn},
}

# The seams have no scenario axis; their rows say so in the scenario column.
_SEAM_SCENARIO = "fixture"


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
    # The mid-call descent reason automation._generate recorded (or, for a
    # fallback-runner seam, the fallbackCode it stamped), or None when the run did
    # not degrade after the availability gate.
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
    owed = _call_was_owed(task_name, out)
    failures += _judge(exp, provider.calls, source, seconds, reason, owed=owed, reasoned=task_name in REASONED_TASKS)

    # THE LETTERS — a protected-characteristic term must never survive into a
    # message a candidate reads, and the discarded draft must say so.
    if task_name in LETTER_TASKS:
        hit = automation.protected_language(out.get("subject"), out.get("body"), out.get("feedback"))
        if hit:
            failures.append(f"FAIRNESS: protected term {hit!r} in a candidate letter")
        if mode == "protected_language" and source != "deterministic":
            failures.append(f"a letter naming a protected characteristic was labelled source={source!r}")

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


def _judge(
    exp: Expectation,
    calls: int,
    source: str,
    seconds: float,
    reason: str | None,
    *,
    owed: bool,
    reasoned: bool,
) -> list[str]:
    """THE BOUND, THE WIRE, THE CLOCK and THE REASON — the columns both seam families
    are held to, stated once so the second family cannot be graded more kindly."""
    failures: list[str] = []

    # THE BOUND — a ceiling AND a floor. See Expectation.min_calls for why the
    # ceiling alone was one-sided.
    if calls > exp.max_calls:
        failures.append(f"spent {calls} completions, ceiling {exp.max_calls}")
    elif exp.min_calls and owed and calls < exp.min_calls:
        failures.append(
            f"spent {calls} completions, floor {exp.min_calls}: the provider was handed over "
            f"and never called, so this fault was never actually exercised"
        )

    # THE WIRE — only for faults that produce nothing usable.
    if exp.mode in NO_PAYLOAD_MODES and source != "deterministic":
        failures.append(f"unusable output reached the wire as source={source!r}")

    # THE CLOCK.
    if exp.max_seconds is not None and seconds > exp.max_seconds:
        failures.append(f"took {seconds:.1f}s, deadline budget {exp.max_seconds:.1f}s")

    # THE REASON — what the operator can read back out of the usage ledger. Only
    # where a call was owed: a task that legitimately never reached its LLM call
    # has no mid-call descent to name.
    if exp.reasons and reasoned and owed:
        if reason is None:
            failures.append(
                f"degraded anonymously: expected one of {sorted(exp.reasons)}, the ledger would say nothing"
            )
        elif reason not in exp.reasons:
            failures.append(f"recorded reason {reason!r}, expected one of {sorted(exp.reasons)}")
    if reason is not None and reason not in DEGRADATION_REASONS:
        # A reason outside the declared vocabulary is a reason the TS side and the
        # operator docs do not know how to read.
        failures.append(f"reason {reason!r} is not in DEGRADATION_REASONS")
    return failures


def _run_seam(mode: str, seam_name: str) -> Row:
    """One fault against one caller of ``generate_with_fallback``.

    Same call-site contract as :func:`_run_one` (availability first, ``None`` when the
    provider cannot serve) and the same columns via :func:`_judge`; THE REASON is the
    ``fallbackCode`` the runner stamped on the artifact — exactly what devcase_cli and
    agentfit_cli hand to ``emit_deterministic``."""
    exp = _BY_MODE[mode]
    seam = FALLBACK_SEAMS[seam_name]
    provider = FaultProvider(mode, timeout=exp.timeout_s)
    ok, _descent = provider_availability(provider)
    handed = provider if ok else None

    started = time.monotonic()
    try:
        out, source = seam["run"](handed)
    except Exception as exc:  # noqa: BLE001 — an escaping exception IS the finding
        return Row(
            mode=mode,
            task=seam_name,
            scenario=_SEAM_SCENARIO,
            source="raised",
            calls=provider.calls,
            seconds=time.monotonic() - started,
            failures=[f"escaped as {type(exc).__name__}: {exc}"],
        )
    seconds = time.monotonic() - started
    code = out.get(FALLBACK_CODE_KEY)
    reason = str(code) if code else None

    failures = list(seam["check"](out))
    failures += _judge(exp, provider.calls, source, seconds, reason, owed=True, reasoned=True)
    # The prose and the code are one stamp: a reason the envelope shows with no code
    # behind it is exactly the anonymous ledger line this column refuses.
    if out.get(FALLBACK_REASON_KEY) and reason is None:
        failures.append("fallbackReason stamped with no fallbackCode beside it")

    return Row(
        mode=mode,
        task=seam_name,
        scenario=_SEAM_SCENARIO,
        source=source,
        calls=provider.calls,
        seconds=seconds,
        reason=reason,
        failures=failures,
    )


def _drill_items(modes: list[str]) -> list[tuple[str, str, str, Any]]:
    """Every (kind, mode, name, scenario) the drill runs: the automation tasks across
    the scenarios under fault, then the fallback-runner seams on their fixture."""
    items: list[tuple[str, str, str, Any]] = [
        ("task", mode, task_name, scenario)
        for mode in modes
        for task_name in TASKS
        for scenario in SCENARIOS_UNDER_FAULT
    ]
    items += [("seam", mode, seam_name, None) for mode in modes for seam_name in FALLBACK_SEAMS]
    return items


def _run_item(item: tuple[str, str, str, Any]) -> Row:
    kind, mode, name, scenario = item
    return _run_one(mode, name, scenario) if kind == "task" else _run_seam(mode, name)


def run_drill(modes: list[str] | None = None, max_workers: int = 4) -> list[Row]:
    items = _drill_items(modes or list(MODES))
    workers = max(1, min(max_workers, len(items)))
    with ThreadPoolExecutor(max_workers=workers) as pool:
        return list(pool.map(_run_item, items))


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


def live_measurements(agg: dict[str, Any]) -> dict[str, tuple[float, int]]:
    """The full drill's figure for thresholds.certify_live: the pass rate over
    the drill-row count, so a seam or task that silently left the matrix moves
    ``n`` even though every remaining row still passes."""
    return {"FAULT_THRESHOLD": (agg["pass_rate"], agg["total"])}


def live_units(rows: list[Row]) -> dict[str, dict[str, float]]:
    """The drill rows behind FAULT_THRESHOLD, by ``<mode>/<task>/<scenario>``:
    1.0 when the row held its contract. ``n`` alone cannot see a row swapped
    for another; the ids can."""
    return {"FAULT_THRESHOLD": unit_map((f"{r.mode}/{r.task}/{r.scenario}", 1.0 if r.ok else 0.0) for r in rows)}


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
        f"fallback-runner seams: {len(FALLBACK_SEAMS)} ({', '.join(FALLBACK_SEAMS)}) · "
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
    parser.add_argument(
        "--strict",
        action="store_true",
        help="Exit non-zero if an expectation fails, or (full drill only) the drill's pass rate or "
             "row count no longer matches measurements.json.",
    )
    parser.add_argument(
        "--record",
        action="store_true",
        help="Operator act, full drill only: re-record FAULT_THRESHOLD in measurements.json from "
             "this run. Refuses to run in CI.",
    )
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
    if args.record:
        refusal = record_refusal() or ("--record needs the full drill, not a --mode subset" if args.mode else None)
        if refusal:
            sys.stderr.write(f"fault_eval: {refusal}\n")
            return 2

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
    certified = True
    if not args.mode:
        # A --mode subset is a different n by construction; only the full drill is certified.
        certified = settle_live(live_measurements(agg), live_units(rows), record=args.record, prog="fault_eval")
    return 1 if (args.strict and not (_passes(agg) and certified)) else 0


if __name__ == "__main__":
    raise SystemExit(main())
