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
* ``role_family``          — the family the pipeline actually CLASSIFIED
                             matches the scenario's declared family, and its
                             spine provenance is not "default" (the bank is
                             organised by family; the software_engineering
                             schema default must not vacuously pass its own
                             family — UAT 2026-08-10 L1-HRBP-17 / B11).
* ``requirements_captured``— every hard dealbreaker the transcript stated got
                             its OWN requirements[] row (L2-NEW-2: live
                             sessions filed hard conditions as facet prose and
                             starved the requirements list). Per-condition, not
                             merely non-empty: ``brief_core`` already demands
                             one must-have, so a bare ``len(...) >= 1`` cannot
                             fail unless ``brief_core`` fails too — it would
                             pass on a brief that filed every stated condition
                             as prose and picked up one unrelated requirement.

Those last two are emitted only when the scenario declares ``family`` and
``dealbreakers``, so EVERY scenario in both banks must declare both — omitting
a key would silently drop the assertion and still report PASS. Pinned by
tests/test_intake_eval.py::test_every_scenario_carries_both_standing_assertions.

Run: ``python -m pipeline.jobfit.eval.intake_eval --no-llm`` (offline) or
without the flag for the live pass.
"""

from __future__ import annotations

import argparse
import json
import sys
import time
from pathlib import Path
from typing import Any

from .._cli import configure_stdio
from ..intake import opening_turn, run_intake_turn
from ..rolebrief import BRIEF_PROVENANCE, coerce_role_brief
from ._style import _make_styler, should_color
from .runner import glyph, verdict_banner, write_text_lf

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


def unrouted_dealbreakers(dealbreakers: list[str], brief: Any) -> list[str]:
    """Stated hard conditions that never got a requirements[] row of their own.

    The extraction contract (``intake.py``, prompt v2) is explicit: a named
    skill/tool/certification/licence the requestor calls required "MUST become
    its OWN requirements[] row", and ``dealbreaker_context`` carries only the
    STORY behind a condition — "facets are never an alternative home". The
    downstream reader (``briefDealbreakerEvidence``) tolerates both homes as
    defense in depth; this eval pins the routing half, which is what L2-NEW-2
    actually broke.

    Matching is tolerant in BOTH directions because a live agent legitimately
    splits or narrows the stated phrase ("Flutter" for a stated "Flutter or
    React Native", "Java 17" for a stated "Java"). What it must not do is
    leave the condition as prose.
    """
    skills = [r.skill.lower() for r in brief.requirements if r.skill]
    return [d for d in dealbreakers if not any(d.lower() in s or s in d.lower() for s in skills)]


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
    # The two standing regressions from the 2026-08-10 UAT drain (B11). Both
    # hold live too: the extraction contract demands the classification and the
    # dealbreaker→requirements routing regardless of provider.
    family = scenario.get("family") or expect.get("role_family")
    if family:
        # Value match alone is not "actually classified" — the schema default
        # is software_engineering, so a software scenario would vacuously pass
        # on a brief nothing ever touched. Provenance must say the family was
        # captured (classified/inferred/stated), not defaulted.
        checks["role_family"] = (
            brief.role_family == family
            and brief.spine_provenance.get("role_family", "default") != "default"
        )
    dealbreakers = [d for d in (scenario.get("dealbreakers") or []) if d]
    if dealbreakers:
        # Per-condition, not merely non-empty — see the module docstring: a
        # bare len()>=1 is subsumed by brief_core and so can never fail alone.
        checks["requirements_captured"] = not unrouted_dealbreakers(dealbreakers, brief)
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


# --- JD-grounded corpus mode ------------------------------------------------
#
# The banks above are WRITTEN scenarios. This mode reads REAL job descriptions
# (eval/intake_corpus.py), turns each into a requestor persona grounded in that
# document (eval/intake_jd_persona.py) and runs the same dialog + the same
# `check_dialog` invariants — either in-process, or against a running kp server
# (`--http`), where the session is also PROMOTED so the run proves the whole
# product path and not just the engine.


DEFAULT_ROLES = 50
DUMP_RUN_FILE = "run.json"


def _load_previous(dump: str | None) -> dict[str, dict]:
    """Rows a previous run recorded as complete, keyed by scenario name."""
    if not dump:
        return {}
    path = Path(dump) / DUMP_RUN_FILE
    if not path.exists():
        return {}
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except (ValueError, OSError):
        return {}
    return {r["name"]: r for r in data.get("rows", []) if isinstance(r, dict) and r.get("complete") and r.get("name")}


def _write_dump(dump: str, rows: list[dict], meta: dict[str, Any]) -> None:
    root = Path(dump)
    (root / "transcripts").mkdir(parents=True, exist_ok=True)
    (root / "briefs").mkdir(parents=True, exist_ok=True)
    payload = {
        **meta,
        "rows": [{k: v for k, v in row.items() if k not in ("turns", "brief")} for row in rows],
    }
    write_text_lf(root / DUMP_RUN_FILE, json.dumps(payload, indent=2, ensure_ascii=False) + "\n")
    for row in rows:
        if row.get("turns"):
            lines = [
                f"# {row['name']}",
                "",
                f"- posting: **{row.get('posting_id') or '—'}** · title: **{row.get('title') or '—'}**",
                f"- JD family: **{row.get('jd_role_family') or '—'}** · captured family: **{row.get('family') or '—'}**",
                f"- shape: **{row.get('shape') or '—'}** · agent turns: **{row.get('agent_turns')}** · done: **{row.get('done')}**",
                "- checks: "
                + ", ".join(k + "=" + ("PASS" if v else "FAIL") for k, v in (row.get("checks") or {}).items()),
            ]
            if row.get("promoted"):
                lines.append(f"- promoted: **{row['promoted'].get('slug')}** (job {row['promoted'].get('jobId')})")
            elif row.get("promote_error"):
                lines.append(f"- promote refused: `{row['promote_error']}`")
            lines += ["", "## Transcript", ""]
            for turn in row["turns"]:
                who = "Interviewer" if turn["role"] == "interviewer" else "Requestor"
                lines += [f"**{who}:** {turn['text']}", ""]
            write_text_lf(root / "transcripts" / f"{row['name']}.md", "\n".join(lines))
        if row.get("brief") is not None:
            write_text_lf(
                root / "briefs" / f"{row['name']}.json",
                json.dumps(row["brief"], indent=2, ensure_ascii=False) + "\n",
            )


def run_corpus_eval(
    pairs: list[tuple[Any, dict]],
    *,
    no_llm: bool,
    cap: int,
    color: bool,
    dump: str | None = None,
    resume: bool = False,
    http_base: str | None = None,
    wall_minutes: float | None = None,
) -> tuple[str, bool, int]:
    """Run JD-grounded scenarios. Returns (report, ok, rows_reported).

    ``pairs`` is (Posting, scenario). Both transports produce the same row
    shape and are graded by the SAME ``check_dialog``; only the ``promoted``
    column is HTTP-only (there is nothing to promote in-process).
    """
    st = _make_styler(color)
    agent_provider = None
    persona_provider = None
    if not no_llm:
        from ..llm.registry import resolve_provider

        agent_provider = resolve_provider("role_intake", timeout=120)
        if agent_provider is not None and not agent_provider.available():
            agent_provider = None
        persona_provider = agent_provider

    client = None
    if http_base:
        from .intake_http_client import IntakeHttpClient, simulate_http

        client = IntakeHttpClient(http_base)

    previous = _load_previous(dump) if resume else {}
    rows: list[dict] = []
    ran = 0
    skipped = 0
    stopped_early = False
    started = time.monotonic()
    budget = wall_minutes * 60 if wall_minutes else None

    for posting, scenario in pairs:
        name = scenario["name"]
        if name in previous:
            rows.append(previous[name])
            skipped += 1
            continue
        if budget is not None and time.monotonic() - started > budget:
            stopped_early = True
            break
        if client is not None:
            result = simulate_http(client, persona_provider, posting, scenario, cap=cap)
            turns, brief, shape, done = result["turns"], result["brief"], result["shape"], result["done"]
            promoted, promote_error = result["promoted"], result["promote_error"]
        else:
            turns, brief, shape, done = simulate(agent_provider, persona_provider, scenario, cap=cap)
            promoted, promote_error = None, None
        # GROUND TRUTH for role_family differs by mode, on purpose. Offline the
        # answers ARE the deterministic script, so the truth is what this
        # pipeline classifies from them (scenario["family"], computed once in
        # intake_jd_persona). Live, the requestor improvises from the document,
        # so the only honest comparand is the POSTING's own family — grading a
        # live dialog against a deterministic replay's classification measures
        # the replay, not the agent.
        graded = scenario
        if persona_provider is not None and scenario.get("jd_role_family"):
            graded = {**scenario, "family": scenario["jd_role_family"]}
        checks = check_dialog(graded, turns, brief, shape, done, strict_shape=persona_provider is None)
        rows.append(
            {
                "name": name,
                "complete": True,
                "posting_id": scenario.get("posting_id"),
                "title": scenario.get("title"),
                "company": scenario.get("company"),
                "jd_role_family": scenario.get("jd_role_family"),
                # what the dialog actually captured / what role_family was graded against
                "family": (brief or {}).get("roleFamily") or (brief or {}).get("role_family"),
                "expected_family": graded.get("family"),
                "shape": shape,
                "done": done,
                "agent_turns": len([t for t in turns if t["role"] == "interviewer"]),
                "checks": checks,
                "promoted": promoted,
                "promote_error": promote_error,
                "turns": turns,
                "brief": brief,
            }
        )
        ran += 1

    passed = sum(1 for r in rows if all((r.get("checks") or {}).values()))
    ok = bool(rows) and passed == len(rows) and not stopped_early
    mode = "offline (deterministic agent + JD-derived answers)" if persona_provider is None else "live"
    if client is not None:
        mode += f" · HTTP {client.base_url}"
    keys = sorted({k for r in rows for k in (r.get("checks") or {})})
    lines = ["# JD-grounded role-intake simulation", ""]
    parts = [f"{passed}/{len(rows)} roles PASS", f"{ran} run", mode]
    if skipped:
        parts.append(f"{skipped} resumed")
    if stopped_early:
        parts.append(f"STOPPED at the {wall_minutes:g}-minute budget")
    lines.append(verdict_banner(parts, passed=ok, s=st))
    header = ["role", "family", "turns"] + keys + (["promoted"] if client is not None else [])
    lines += ["", "| " + " | ".join(header) + " |", "|" + "---|" * len(header)]
    for row in rows:
        checks = row.get("checks") or {}
        cells = [
            row["name"],
            str(row.get("family") or "—"),
            str(row.get("agent_turns") or "—"),
            *[glyph(checks.get(k), st) if k in checks else glyph(None) for k in keys],
        ]
        if client is not None:
            promoted = row.get("promoted") or {}
            cells.append(promoted.get("slug") or (row.get("promote_error") or "—"))
        lines.append("| " + " | ".join(cells) + " |")
    # A role whose JD states no screenable condition carries NO ground truth for
    # requirements_captured, so the check is not emitted (glyph "—"). Say how many
    # out loud: an invariant silently absent from a quarter of the table would
    # otherwise read as coverage it does not have.
    ungrounded = [r for r in rows if "requirements_captured" not in (r.get("checks") or {})]
    if ungrounded:
        lines += [
            "",
            f"_{len(ungrounded)}/{len(rows)} roles state no screenable hard condition in the JD — "
            "`requirements_captured` has no ground truth there and is reported as “—”, not as a pass._",
        ]
    drifted = [r for r in rows if r.get("jd_role_family") and r.get("family") != r.get("jd_role_family")]
    if drifted:
        lines += [
            "",
            f"**Family drift** — {len(drifted)}/{len(rows)} dialogs captured a family the posting did not "
            "declare (a signal about the intake dialog, not a failed check):",
            "",
        ]
        lines += [f"- `{r['name']}`: JD says {r['jd_role_family']} · dialog captured {r['family']}" for r in drifted]
    report = "\n".join(lines) + "\n"

    if dump:
        _write_dump(
            dump,
            rows,
            {
                "mode": mode,
                "cap": cap,
                "roles": len(pairs),
                "ran": ran,
                "resumed": skipped,
                "passed": passed,
                "no_dealbreaker_ground_truth": len(ungrounded),
                "stopped_early": stopped_early,
            },
        )
    return report, ok, len(rows)


def corpus_pairs(
    corpus_path: str, roles: int, lang: str, shape: str = "power_unit"
) -> list[tuple[Any, dict]]:
    """(Posting, scenario) pairs for ``roles`` distinct titles from ``corpus_path``."""
    from .intake_corpus import load_jd_corpus, stratified_distinct_roles
    from .intake_jd_persona import scenario_from_posting

    postings = load_jd_corpus(corpus_path, lang=lang)
    selection = stratified_distinct_roles(postings, roles)
    return [(p, scenario_from_posting(p, lang, shape)) for p in selection]


def main(argv: list[str] | None = None) -> int:
    configure_stdio()
    parser = argparse.ArgumentParser(description="Quality-gate the role-intake dialog agent (text plane).")
    parser.add_argument("--no-llm", action="store_true", help="offline: deterministic agent + golden requestor answers")
    parser.add_argument("--scenarios", nargs="*", help="subset of persona names")
    parser.add_argument(
        "--generated",
        type=int,
        default=0,
        metavar="N",
        help="use the market-breadth bank instead of the curated personas: N deterministic "
        "scenarios from intake_scenarios_gen.fixed_bank (role family × seniority × shape)",
    )
    parser.add_argument("--cap", type=int, default=DEFAULT_CAP)
    parser.add_argument(
        "--jd-corpus",
        metavar="PATH",
        help="JD-GROUNDED mode: read real job descriptions from this JSON corpus "
        "(data/seed_calibration/jobs.json, data/seed_jobs/jobs.json) and simulate one "
        "requestor per distinct role instead of running the written banks.",
    )
    parser.add_argument(
        "--roles",
        type=int,
        default=DEFAULT_ROLES,
        metavar="N",
        help=f"how many distinct roles to simulate from --jd-corpus (default {DEFAULT_ROLES})",
    )
    parser.add_argument("--lang", default="en", help="dialog language for the simulated sessions (default en)")
    parser.add_argument(
        "--shape",
        choices=("power_unit", "story"),
        default="power_unit",
        help="the session shape the JD-grounded persona plays (default power_unit — the short script)",
    )
    parser.add_argument(
        "--dump",
        metavar="DIR",
        help="write run.json + transcripts/<role>.md + briefs/<role>.json for the JD-grounded run",
    )
    parser.add_argument(
        "--resume",
        action="store_true",
        help="skip roles already recorded as complete in <DUMP>/run.json (needs --dump)",
    )
    parser.add_argument(
        "--http",
        metavar="BASE_URL",
        help="drive the RUNNING kp server's intake API (create → attach JD → messages → promote) "
        "instead of calling the dialog engine in-process. Loopback/private hosts only.",
    )
    parser.add_argument(
        "--wall-minutes",
        type=float,
        metavar="M",
        help="stop cleanly after M minutes and report the partial run (exit 2 if nothing ran)",
    )
    parser.add_argument(
        "--strict",
        action="store_true",
        help="Exit non-zero if a gate fails. Without it the report still prints FAIL and exits 0 "
             "(the suite-wide contract in eval/__main__.py).",
    )
    args = parser.parse_args(argv)

    if args.jd_corpus:
        try:
            pairs = corpus_pairs(args.jd_corpus, args.roles, args.lang, args.shape)
        except (OSError, ValueError) as exc:
            print(f"could not read the JD corpus: {exc}", file=sys.stderr)
            return 2
        if not pairs:
            print(f"no usable postings in {args.jd_corpus}", file=sys.stderr)
            return 2
        try:
            report, ok, reported = run_corpus_eval(
                pairs,
                no_llm=args.no_llm,
                cap=args.cap,
                color=should_color(),
                dump=args.dump,
                resume=args.resume,
                http_base=args.http,
                wall_minutes=args.wall_minutes,
            )
        except Exception as exc:  # noqa: BLE001 — a harness that cannot run exits 2, never 1
            print(f"the JD-grounded run could not start: {exc}", file=sys.stderr)
            return 2
        print(report)
        if not reported:
            print("no roles were simulated", file=sys.stderr)
            return 2
        return 1 if (args.strict and not ok) else 0

    if args.generated:
        from .intake_scenarios_gen import fixed_bank

        scenarios = fixed_bank(args.generated)
        if args.scenarios:
            wanted = set(args.scenarios)
            scenarios = [s for s in scenarios if s["name"] in wanted]
    else:
        scenarios = load_scenarios(args.scenarios)
    if not scenarios:
        # Nothing to run: the eval could not be performed, so 2 rather than a verdict.
        print("no scenarios matched", file=sys.stderr)
        return 2
    report, ok = run_eval(scenarios, no_llm=args.no_llm, cap=args.cap, color=should_color())
    print(report)
    # Exit-code contract (eval/__main__.py): --strict is what asks for a verdict.
    return 1 if (args.strict and not ok) else 0


if __name__ == "__main__":
    raise SystemExit(main())
