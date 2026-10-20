"""NEED_TO_ROLE — a KPI probe for key goal 2 ("hire-from-need composes a role from a stated need").

``intake_eval --no-llm`` certifies the need -> RoleBrief dialog and stops there. This
probe carries the same scenarios one stage further and counts how many reach a
COMPLETE role, keyless and network-free:

1. **brief**  — the scenario's ``golden_answers`` drive the deterministic offline
   intake agent (``intake_eval.simulate`` with no provider, the ``--no-llm`` path) to
   a RoleBrief; the brief must pass ``intake_eval.check_dialog``'s own ``brief_core``
   (title + >=1 must-have, and for a story-shaped session >=1 90-day outcome).
2. **rubric** — ``rolerubric.derive_role_rubric(brief)`` returns a non-empty axis list.
3. **jd**     — the keyless JD role design: ``devcase.analyze.analyze_need`` then
   ``devcase.design.design_role`` with NO provider, which is exactly what a keyless
   JD build runs (``app/_lib/jd-build-run.ts`` -> ``devcase_cli design-artifacts
   --role-only``). The need is projected from the brief the way ``runJdBuild`` does it.
   A draft is produced when the resulting role has a title and at least one must-have
   or responsibility — the content ``composeMarkdown`` lays out.

What the jd stage does NOT run: ``composeMarkdown`` (the Markdown layout) is
TypeScript and no Python-callable keyless composer exists, so it is declared in
``unmeasured`` rather than reimplemented here. Completeness is counted over the
stages that exist.

House rule (docs/.ai/tasks 2026-09-15 / 2026-10-05): when an input or a stage module
is missing, or cannot be imported, exit non-zero and print NO number. 0 is a reading;
"could not measure" is not 0.

Run: ``python -m pipeline.jobfit.eval.need_to_role_probe [--json]``
"""

from __future__ import annotations

import argparse
import json
import subprocess
import sys
from pathlib import Path
from types import SimpleNamespace
from typing import Any

STAGES = ("brief", "rubric", "jd")

# Declared up front so the output states its own scope instead of implying a
# wider one. Each entry is a thing a reader might assume this probe covers.
UNMEASURED = (
    {
        "stage": "jd_markdown",
        "reason": "composeMarkdown (app/_lib/jd-build-run.ts) is TypeScript and no Python-callable keyless "
        "Markdown composer exists; the jd stage measures the role design that feeds it (title, "
        "must-haves, responsibilities), not the rendered body",
    },
    {
        "stage": "jd_market_salary",
        "reason": "the salary band (market_salary_cli) is not part of the draft's completeness",
    },
    {
        "stage": "live_route",
        "reason": "the live hire-from-need route (/api/intake -> promote -> /api/jds/generate) and any "
        "LLM path are not exercised; this is the keyless deterministic path only",
    },
)

_REPO_ROOT = Path(__file__).resolve().parents[3]


class ProbeInputError(Exception):
    """An input or stage the probe needs is missing or broken. Never a reading."""


def _import_stages() -> SimpleNamespace:
    """Import every stage lazily, so a missing or broken module is a refusal at run
    time (exit 2, no number) rather than an ImportError at probe-import time."""
    from ..devcase.analyze import analyze_need
    from ..devcase.design import design_role
    from ..devcase.models import DevNeed, NeedAnalysis, StatedRequirement
    from ..rolebrief import BRIEF_PROVENANCE, coerce_role_brief
    from ..rolerubric import derive_role_rubric
    from .intake_eval import SCENARIOS_PATH, check_dialog, simulate

    return SimpleNamespace(
        analyze_need=analyze_need,
        design_role=design_role,
        DevNeed=DevNeed,
        NeedAnalysis=NeedAnalysis,
        StatedRequirement=StatedRequirement,
        BRIEF_PROVENANCE=BRIEF_PROVENANCE,
        coerce_role_brief=coerce_role_brief,
        derive_role_rubric=derive_role_rubric,
        SCENARIOS_PATH=SCENARIOS_PATH,
        check_dialog=check_dialog,
        simulate=simulate,
    )


def _load_scenarios(path: Path) -> list[dict]:
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError) as exc:
        raise ProbeInputError(f"cannot read the scenarios file {path}: {exc}") from exc
    scenarios = data.get("scenarios") if isinstance(data, dict) else None
    if not isinstance(scenarios, list) or not scenarios:
        raise ProbeInputError(f"{path} holds no scenarios — nothing to measure")
    for index, scenario in enumerate(scenarios):
        if not isinstance(scenario, dict) or not str(scenario.get("name") or "").strip():
            raise ProbeInputError(f"{path}: scenario #{index} has no name")
        if not isinstance(scenario.get("golden_answers"), list):
            raise ProbeInputError(f"{path}: scenario {scenario['name']!r} has no golden_answers list")
    return scenarios


def _brief_gap(brief: Any, stages: SimpleNamespace, shape: str | None) -> str:
    """Why ``brief_core`` failed, in the words of its own definition."""
    musts = [r for r in brief.requirements if r.kind == "must_have"]
    gaps: list[str] = []
    if not brief.title:
        gaps.append("no title")
    if not musts:
        gaps.append("no must-have requirement")
    if (shape or "story") == "story" and not brief.success_criteria:
        gaps.append("story session with no 90-day outcome")
    if any(r.provenance not in stages.BRIEF_PROVENANCE for r in brief.requirements):
        gaps.append("a requirement carries out-of-vocabulary provenance")
    return "brief core absent: " + ("; ".join(gaps) or "brief_core check failed")


def _need_from_brief(brief: Any, stages: SimpleNamespace) -> Any:
    """The DevNeed ``runJdBuild`` builds from a promoted brief (jd-build-run.ts)."""
    musts = [r.skill for r in brief.requirements if r.kind == "must_have"]
    return stages.DevNeed(
        title=brief.title,
        stack=musts[:10],
        responsibilities=[t for t in [*brief.success_criteria, *brief.responsibilities] if t][:12],
        seniority_target=brief.seniority or "medior",
        role_family=brief.role_family or "software_engineering",
        notes=brief.summary,
        stated_requirements=[
            stages.StatedRequirement(skill=r.skill, kind=r.kind, hardness=r.hardness, weight=r.weight)
            for r in brief.requirements
            if r.skill
        ],
    )


def _run_scenario(scenario: dict, stages: SimpleNamespace) -> tuple[str, str] | None:
    """Drive one scenario. None = complete; otherwise (first stage it stopped at, why)."""
    stage = "brief"
    try:
        # provider=None on both sides is the --no-llm path: golden answers in, the
        # deterministic agent out. No provider is resolved, no key is read.
        turns, payload, shape, done = stages.simulate(None, None, scenario)
        core = stages.check_dialog(scenario, turns, payload, shape, done)["brief_core"]
        brief = stages.coerce_role_brief(payload)
        if not core:
            return "brief", _brief_gap(brief, stages, shape)

        stage = "rubric"
        axes = stages.derive_role_rubric(brief)
        if not axes:
            return "rubric", "derive_role_rubric returned no axes"

        stage = "jd"
        need = _need_from_brief(brief, stages)
        analysis, _ = stages.analyze_need(need, None, provider=None)
        role, _ = stages.design_role(need, stages.NeedAnalysis.model_validate(analysis), provider=None)
        has_content = bool(role.get("mustHaves")) or bool(role.get("responsibilities"))
        if not str(role.get("title") or "").strip():
            return "jd", "the designed role has no title"
        if not has_content:
            return "jd", "the designed role has neither must-haves nor responsibilities"
    except Exception as exc:  # noqa: BLE001 — a stage that raises on ONE scenario is that scenario's failure, not the run's
        return stage, f"{type(exc).__name__}: {exc}"
    return None


def measure(scenarios: list[dict], stages: SimpleNamespace) -> dict[str, Any]:
    failures: list[dict[str, str]] = []
    reached = {s: 0 for s in STAGES}
    for scenario in scenarios:
        stopped = _run_scenario(scenario, stages)
        # A scenario reaches every stage up to and including the one it stopped at.
        last = STAGES.index(stopped[0]) if stopped else len(STAGES) - 1
        for s in STAGES[: last + 1]:
            reached[s] += 1
        if stopped:
            failures.append({"scenario": scenario["name"], "stage": stopped[0], "reason": stopped[1]})
    failed_at = {s: sum(1 for f in failures if f["stage"] == s) for s in STAGES}
    return {
        "value": len(scenarios) - len(failures),
        "denominator": len(scenarios),
        "commit": _commit(),
        "stages": {
            s: {"measured": True, "attempted": reached[s], "passed": reached[s] - failed_at[s]} for s in STAGES
        },
        "failures": failures,
        "unmeasured": [dict(u) for u in UNMEASURED],
        "note": "completeness counted over the stages that exist (brief, rubric, jd); the jd stage is the "
        "keyless role design only — see unmeasured",
    }


def _commit() -> str | None:
    try:
        done = subprocess.run(
            ["git", "rev-parse", "HEAD"], cwd=_REPO_ROOT, capture_output=True, text=True, timeout=10, check=True
        )
    except (OSError, subprocess.SubprocessError):
        return None  # provenance only — a reading without a commit is still a reading
    return done.stdout.strip() or None


def render(reading: dict[str, Any]) -> str:
    lines = [f"NEED_TO_ROLE = {reading['value']}/{reading['denominator']}", ""]
    lines.append(f"commit: {reading['commit'] or 'unknown'}")
    lines.append("stages (reached -> passed):")
    for name, stage in reading["stages"].items():
        lines.append(f"  {name}: {stage['passed']}/{stage['attempted']}")
    if reading["failures"]:
        lines.append("incomplete:")
        lines += [f"  {f['scenario']} — stopped at {f['stage']}: {f['reason']}" for f in reading["failures"]]
    else:
        lines.append("incomplete: none")
    lines.append("unmeasured:")
    lines += [f"  {u['stage']}: {u['reason']}" for u in reading["unmeasured"]]
    lines.append(f"note: {reading['note']}")
    return "\n".join(lines) + "\n"


def main(argv: list[str] | None = None) -> int:
    from .._cli import configure_stdio

    configure_stdio()
    parser = argparse.ArgumentParser(description="NEED_TO_ROLE: scenarios that reach a complete role, keyless.")
    parser.add_argument("--json", action="store_true", help="emit the reading as JSON")
    parser.add_argument("--scenarios", metavar="PATH", help="scenarios file (default: intake_scenarios.json)")
    args = parser.parse_args(argv)
    try:
        stages = _import_stages()
        path = Path(args.scenarios) if args.scenarios else Path(stages.SCENARIOS_PATH)
        scenarios = _load_scenarios(path)
    except ProbeInputError as exc:
        print(f"need_to_role_probe: {exc} — no reading", file=sys.stderr)
        return 2
    except Exception as exc:  # noqa: BLE001 — a stage module that cannot be imported is a refusal, never a number
        print(f"need_to_role_probe: a stage module is unavailable ({type(exc).__name__}: {exc}) — no reading", file=sys.stderr)
        return 2
    reading = measure(scenarios, stages)
    print(json.dumps(reading, indent=2, ensure_ascii=False) if args.json else render(reading), end="\n" if args.json else "")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
