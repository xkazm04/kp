"""Requestor-persona eval for the role-intake dialog (Phase 2).

Mirrors interview_eval.py's brain-plane approach for the OTHER direction of
the dialog concept: the agent under test is ``intake.run_intake_turn`` (the
same code path the /api/intake/[id]/message route runs), and the interlocutor
is a hiring-REQUESTOR persona from ``intake_scenarios.json`` — the behavioral
coverage table in docs/development/role-intake-research.md §4 (vague
requester, over-specifier, solution jumper, twelve-must-haves, …).

Two modes:

* ``--no-llm`` — offline/CI: each scenario's ``golden_answers`` drive the
  DETERMINISTIC agent script. This certifies the keyless product path and the
  reliability invariants without a provider.
* live — both sides are LLMs (the agent via the ``role_intake`` use case, the
  persona via the same provider). Reliability invariants stay deterministic;
  there is deliberately no LLM judge yet (add one only once the invariants
  are stable, the interview_eval lesson). Live runs are single-sample PROBES,
  not the CI gate (a real dialog is nondeterministic — shape/turn-budget
  expectations go soft, see ``check_dialog(strict_shape=...)``); the gate is
  the offline mode via tests/test_intake_eval.py.

Reliability invariants (all deterministic, all must hold):

* ``completed``            — the dialog reaches a close before the turn cap.
* ``one_question_per_turn``— no agent turn machine-guns questions (≤2 '?').
* ``no_premature_end``     — the <<END>> sentinel appears only in the final turn.
* ``grounded_readback``    — the closing turn actually names the captured role
                             (title or a must-have skill) — a generic goodbye
                             is not a read-back.
* ``brief_core``           — the resulting RoleBrief carries a title + ≥1
                             must-have, and (story shape) ≥1 90-day outcome;
                             every requirement's provenance is in-vocabulary.
* ``shape``                — the session-shape triage matches the persona's
                             expected shape; power-unit sessions respect the
                             short-path agent-turn budget.

Run: ``python -m pipeline.jobfit.eval.intake_eval --no-llm`` (offline) or
without the flag for the live pass.
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path
from typing import Any

from .._cli import configure_stdio
from ..intake import opening_turn, run_intake_turn
from ..rolebrief import BRIEF_PROVENANCE, coerce_role_brief
from ._style import _make_styler, should_color
from .runner import glyph, verdict_banner

SCENARIOS_PATH = Path(__file__).with_name("intake_scenarios.json")
END_TOKEN = "<<END>>"
DEFAULT_CAP = 30  # max exchanges (requestor+agent pairs)


def load_scenarios(names: list[str] | None = None) -> list[dict]:
    data = json.loads(SCENARIOS_PATH.read_text(encoding="utf-8"))
    scenarios = data["scenarios"]
    if names:
        wanted = set(names)
        scenarios = [s for s in scenarios if s["name"] in wanted]
    return scenarios


def _persona_turn(provider: Any, scenario: dict, turns: list[dict]) -> str:
    """One live requestor reply: persona system + rendered history."""
    history = "\n".join(
        f"{'INTERVIEWER' if t['role'] == 'interviewer' else 'YOU'}: {t['text']}" for t in turns
    )
    task = (
        f"{history}\n\nProduce ONLY your next single reply as the hiring requestor, in character. "
        "1-4 sentences, no stage directions."
    )
    return provider.complete(task, system=scenario["requestor_prompt"]).text.strip()


def simulate(
    agent_provider: Any | None,
    persona_provider: Any | None,
    scenario: dict,
    cap: int = DEFAULT_CAP,
) -> tuple[list[dict], dict, str | None, bool]:
    """Drive one full intake dialog. Returns (turns, brief, shape, done)."""
    lang = scenario.get("lang", "en")
    opener = opening_turn(lang)
    turns: list[dict] = [{"role": "interviewer", "text": opener["reply"]}]
    brief: dict = opener["brief"]
    shape: str | None = None
    done = False
    golden = list(scenario.get("golden_answers") or [])
    idx = 0
    for _ in range(cap):
        if persona_provider is None:
            if idx >= len(golden):
                break
            message = golden[idx]
            idx += 1
        else:
            message = _persona_turn(persona_provider, scenario, turns)
        result = run_intake_turn(agent_provider, turns, brief, message, lang=lang)
        turns.append({"role": "candidate", "text": message})
        turns.append({"role": "interviewer", "text": result["reply"]})
        brief = result["brief"]
        shape = result["shape"]
        done = bool(result["done"])
        if done:
            break
    return turns, brief, shape, done


# --- deterministic reliability checks --------------------------------------


def check_dialog(
    scenario: dict,
    turns: list[dict],
    brief_payload: dict,
    shape: str | None,
    done: bool,
    *,
    strict_shape: bool = True,
) -> dict[str, bool]:
    agent_turns = [t["text"] for t in turns if t["role"] == "interviewer"]
    brief = coerce_role_brief(brief_payload)
    musts = [r for r in brief.requirements if r.kind == "must_have"]
    expect = scenario.get("expect", {})

    checks: dict[str, bool] = {}
    checks["completed"] = done
    # The opener + every mid-dialog turn asks at most 2 questions (a reflection
    # may end in a rhetorical '?'; three or more is machine-gunning).
    checks["one_question_per_turn"] = all(t.count("?") <= 2 for t in agent_turns)
    end_turns = [i for i, t in enumerate(agent_turns) if END_TOKEN in t]
    checks["no_premature_end"] = end_turns == [len(agent_turns) - 1] if done else len(end_turns) == 0
    if done and agent_turns:
        closing = agent_turns[-1].lower()
        # Token-level grounding: a live agent legitimately paraphrases the
        # captured title ("the DevOps role" for "Frontend-leaning DevOps
        # Engineer"), so require any substantive title token OR any must-have
        # skill token in the close — not the exact strings.
        def tokens(text: str) -> list[str]:
            return [w for w in "".join(c if c.isalnum() else " " for c in text.lower()).split() if len(w) >= 4]

        title_hit = any(w in closing for w in tokens(brief.title))
        skill_hit = any(w in closing for m in musts for w in tokens(m.skill))
        checks["grounded_readback"] = title_hit or skill_hit
    else:
        checks["grounded_readback"] = False
    core = bool(brief.title) and len(musts) >= 1
    if (shape or "story") == "story":
        core = core and len(brief.success_criteria) >= 1
    core = core and all(r.provenance in BRIEF_PROVENANCE for r in brief.requirements)
    checks["brief_core"] = core
    # Shape is a HARD expectation offline (the deterministic triage is exactly
    # what the golden path pins) but SOFT live: a real dialog can legitimately
    # resolve a story persona into a concrete power-unit close (observed with
    # solution_jumper — the agent retired the parked solution and landed a
    # crisp role). Live runs report the shape without gating on it.
    if expect.get("shape") and strict_shape:
        checks["shape"] = shape == expect["shape"]
    if expect.get("max_agent_turns") and strict_shape:
        checks["turn_budget"] = len(agent_turns) <= int(expect["max_agent_turns"])
    return checks


# --- report ----------------------------------------------------------------


def run_eval(scenarios: list[dict], *, no_llm: bool, cap: int, color: bool) -> tuple[str, bool]:
    st = _make_styler(color)
    agent_provider = None
    persona_provider = None
    if not no_llm:
        from ..llm.registry import resolve_provider

        agent_provider = resolve_provider("role_intake", timeout=120)
        if agent_provider is not None and not agent_provider.available():
            agent_provider = None
        persona_provider = agent_provider

    rows: list[tuple[str, dict[str, bool], int]] = []
    for scenario in scenarios:
        turns, brief, shape, done = simulate(agent_provider, persona_provider, scenario, cap=cap)
        checks = check_dialog(scenario, turns, brief, shape, done, strict_shape=persona_provider is None)
        rows.append((scenario["name"], checks, len([t for t in turns if t["role"] == "interviewer"])))

    total = sum(len(c) for _, c, _ in rows)
    passed = sum(1 for _, c, _ in rows if all(c.values()))
    ok = passed == len(rows)
    mode = "offline (deterministic agent + golden requestors)" if no_llm or agent_provider is None else "live"
    lines = ["# Role-intake dialog eval", ""]
    lines.append(
        verdict_banner(
            [f"{passed}/{len(rows)} personas PASS", f"{total} checks", mode],
            passed=ok,
            s=st,
        )
    )
    lines += ["", "| persona | turns | " + " | ".join(sorted({k for _, c, _ in rows for k in c})) + " |"]
    keys = sorted({k for _, c, _ in rows for k in c})
    lines.append("|" + "---|" * (len(keys) + 2))
    for name, checks, agent_turn_count in rows:
        cells = " | ".join(glyph(checks.get(k), st) if k in checks else glyph(None) for k in keys)
        lines.append(f"| {name} | {agent_turn_count} | {cells} |")
    return "\n".join(lines) + "\n", ok


def main(argv: list[str] | None = None) -> int:
    configure_stdio()
    parser = argparse.ArgumentParser(description="Quality-gate the role-intake dialog agent (text plane).")
    parser.add_argument("--no-llm", action="store_true", help="offline: deterministic agent + golden requestor answers")
    parser.add_argument("--scenarios", nargs="*", help="subset of persona names")
    parser.add_argument("--cap", type=int, default=DEFAULT_CAP)
    args = parser.parse_args(argv)

    scenarios = load_scenarios(args.scenarios)
    if not scenarios:
        print("no scenarios matched", file=sys.stderr)
        return 2
    report, ok = run_eval(scenarios, no_llm=args.no_llm, cap=args.cap, color=should_color())
    print(report)
    return 0 if ok else 1


if __name__ == "__main__":
    raise SystemExit(main())
