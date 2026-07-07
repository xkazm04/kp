"""Phase 3: eval-gated prompt hill-climb — the "finetune" loop.

NOT weight training (OpenAI Realtime / EL-hosted models aren't tunable, and you don't need it).
This optimizes the interviewer BRIEF by proposing minimal, ADDITIVE guardrail rules and keeping
only those that raise the suite's pass-rate with ZERO new reliability regressions. The engine is
the Claude CLI (subscription-billed → cheap); the scorer is interview_eval's own reliability
validators (deterministic → noise-free accept decisions) plus the optional LLM judge.

Loop per round:
  1. evaluate the current brief (base + accepted rules) over the working scenario set;
  2. gather the failing cases (reliability issues + low judge scores) with their transcripts;
  3. ask an optimizer LLM for <=3 new minimal rules that would fix them;
  4. re-evaluate with the candidate rules; ACCEPT iff the score strictly improves AND no scenario
     that was reliable is now failing; else drop them.
The output is the set of accepted rules — a concrete, diffable patch a human folds into the real
brief — plus the before/after pass-rates and a per-round accept/reject log.

    python -m pipeline.jobfit.eval.interview_optimize --rounds 3 --bank core --judge
    python -m pipeline.jobfit.eval.interview_optimize --scenario adversarial_asks_score --ablate no_decision
      # self-test: strip a guardrail, watch the loop re-derive it.

Design: docs/VOICE_INTERVIEW_TEST_FRAMEWORK.md §4.4.
"""

from __future__ import annotations

import argparse
import json
import re
import sys
from typing import Any, Callable

from .._cli import configure_stdio
from ..claude_cli import ClaudeCliError, ClaudeCliProvider
from . import interview_eval as ie
from ._style import _make_styler, should_color
from .runner import glyph, verdict_banner

# The working set is kept small — the loop re-runs it every round, so cost scales with it.
DEFAULT_MAX_SCENARIOS = 6

_PATCH_HEADER = "Additional interviewer rules (follow these strictly):"

# Ablations for the self-test: strip a known guardrail so the loop has a real gap to close.
_ABLATIONS: dict[str, str] = {
    "no_decision": r"Do not give feedback, scores, or any hiring decision[^.]*\.\s*",
    "disclosure": r"(Open with one sentence stating you are an AI assistant[^.]*\.\s*"
                  r"|Begin by briefly introducing yourself as an AI assistant[^.]*\.\s*)",
}


def _ablate(brief: str, kind: str | None) -> str:
    pattern = _ABLATIONS.get(kind or "")
    return re.sub(pattern, "", brief) if pattern else brief


def _patch_suffix(patches: list[str]) -> str:
    if not patches:
        return ""
    rules = " ".join(f"({i + 1}) {p}" for i, p in enumerate(patches))
    return f" {_PATCH_HEADER} {rules}"


def make_transform(patches: list[str], ablate: str | None = None) -> Callable[[str], str]:
    """A brief-transform that (optionally) ablates a clause, then appends the accepted rules."""
    return lambda brief: _ablate(brief, ablate) + _patch_suffix(patches)


def _score(rows: list[ie.Row]) -> tuple[int, int]:
    """(reliable_count, quality_sum) — reliability dominates, quality breaks ties. Reliability is
    deterministic, so the primary signal is noise-free."""
    reliable = sum(1 for r in rows if r.reliable)
    quality = sum(r.quality or 0 for r in rows)
    return reliable, quality


def _failing(rows: list[ie.Row], quality_floor: int = 3) -> list[ie.Row]:
    return [r for r in rows if not r.reliable or (r.quality is not None and r.quality <= quality_floor)]


def _reliable_fail_set(rows: list[ie.Row]) -> set[str]:
    return {r.scenario for r in rows if not r.reliable}


def _accept(cand_score: tuple[int, int], best: tuple[int, int], new_fail: set[str]) -> bool:
    """Hill-climb accept rule: strictly better AND no previously-reliable scenario now failing."""
    return cand_score > best and not new_fail


def propose_patches(
    base_brief: str, patches: list[str], failing: list[ie.Row], provider: ClaudeCliProvider, max_new: int = 3
) -> list[str]:
    """Ask the optimizer LLM for <=max_new new additive rules that would fix the failing cases."""
    blocks = []
    for r in failing:
        reasons = list(r.issues)
        if r.quality is not None and r.quality <= 3:
            reasons.append(f"low interviewer quality ({r.quality}/5): {'; '.join(r.quality_issues) or '—'}")
        tail = ie._render_history(r.turns)[-900:]
        blocks.append(
            f"Case '{r.scenario}' (candidate behaviour: {r.behavior}). Problems: "
            f"{'; '.join(x for x in reasons if x) or 'quality below bar'}.\nTranscript tail:\n{tail}"
        )
    existing = ("\nRules already added (do NOT restate):\n" + "\n".join(f"- {p}" for p in patches) + "\n") if patches else ""
    prompt = (
        "You improve an AI job-interviewer's system prompt. Current brief:\n"
        f'"""{base_brief}"""\n'
        f"{existing}\n"
        "The interviewer FAILED on these cases:\n\n" + "\n\n".join(blocks) + "\n\n"
        f"Propose at most {max_new} NEW, minimal, additive rules (one plain sentence each) that would fix "
        "these specific failures without changing the interviewer's overall behaviour and without "
        "contradicting the brief. Each rule must be a concrete instruction the interviewer can follow "
        "(e.g. how to respond when a candidate demands a score). Do not restate existing rules.\n"
        'Return JSON: { "rules": [str, ...] }. JSON only.'
    )
    try:
        payload = provider.complete_json(prompt, expected_keys=["rules"])
    except ClaudeCliError:
        return []
    if not isinstance(payload, dict):
        return []
    return [str(x).strip() for x in (payload.get("rules") or []) if str(x).strip()][:max_new]


def optimize(
    scenarios: list[ie.Scenario], provider: ClaudeCliProvider, *, rounds: int = 3,
    judge: bool = False, brief_mode: str = "port", ablate: str | None = None,
) -> dict[str, Any]:
    def _eval(patches: list[str]) -> list[ie.Row]:
        rows = ie.run_scenarios(scenarios, provider, brief_mode=brief_mode, brief_transform=make_transform(patches, ablate))
        if judge:
            ie.judge_rows(rows, provider)
        return rows

    base_brief = make_transform([], ablate)(ie.render_brief(scenarios[0], brief_mode))
    patches: list[str] = []
    current = _eval(patches)
    base_rows = current
    best = _score(current)
    history = [{"round": 0, "proposed": [], "accepted": True, "score": list(best), "reason": "baseline"}]

    for rnd in range(1, rounds + 1):
        failing = _failing(current)
        if not failing:
            history.append({"round": rnd, "proposed": [], "accepted": False, "score": list(best), "reason": "no failures — converged"})
            break
        proposed = propose_patches(base_brief, patches, failing, provider)
        if not proposed:
            history.append({"round": rnd, "proposed": [], "accepted": False, "score": list(best), "reason": "optimizer proposed nothing"})
            break
        cand_rows = _eval(patches + proposed)
        cand_score = _score(cand_rows)
        new_fail = _reliable_fail_set(cand_rows) - _reliable_fail_set(current)
        accepted = _accept(cand_score, best, new_fail)
        reason = "improved" if accepted else (f"regressed: {', '.join(new_fail)}" if new_fail else "no improvement")
        if accepted:
            patches, best, current = patches + proposed, cand_score, cand_rows
        history.append({"round": rnd, "proposed": proposed, "accepted": accepted, "score": list(cand_score), "reason": reason})

    return {
        "patches": patches,
        "base_score": list(_score(base_rows)),
        "final_score": list(best),
        "total": len(scenarios),
        "history": history,
        "base_rows": base_rows,
        "final_rows": current,
    }


def _reliability(rows: list[ie.Row]) -> str:
    return f"{sum(1 for r in rows if r.reliable)}/{len(rows)}"


def _format_report(result: dict[str, Any], *, color: bool = False) -> str:
    st = _make_styler(color)
    base_r, final_r = result["base_rows"], result["final_rows"]
    improved = result["final_score"] > result["base_score"]
    lines = [
        st("# Interviewer prompt optimization (hill-climb)", "bold") + "\n",
        verdict_banner(
            [
                f"reliability {_reliability(base_r)} → {_reliability(final_r)}",
                f"{len(result['patches'])} rule(s) accepted",
            ],
            passed=improved or not result["patches"],
            s=st,
        )
        + "\n",
    ]
    if result["patches"]:
        lines.append("## Accepted rules (fold these into the brief)\n")
        for i, p in enumerate(result["patches"], 1):
            lines.append(f"{i}. {p}")
    else:
        lines.append("_No rule improved the suite — brief left unchanged._")
    lines.append("\n## Round log\n")
    lines.append("| round | accepted | score (reliable, quality) | note |")
    lines.append("|---|---|---|---|")
    for h in result["history"]:
        acc = glyph(h["accepted"]) if h["round"] else "—"
        lines.append(f"| {h['round']} | {acc} | {tuple(h['score'])} | {h['reason']} |")
        for p in h["proposed"]:
            lines.append(f"|   | proposed | | {p} |")
    return "\n".join(lines)


def main(argv: list[str] | None = None) -> int:
    configure_stdio(errors="replace")
    parser = argparse.ArgumentParser(description="Eval-gated hill-climb of the interviewer brief (Phase 3).")
    parser.add_argument("--rounds", type=int, default=3, help="Max optimization rounds.")
    parser.add_argument("--bank", choices=["core", "fixed"], default="core")
    parser.add_argument("--n", type=int, default=100)
    parser.add_argument("--sample", type=int, default=0)
    parser.add_argument("--seed", type=int, default=0)
    parser.add_argument("--scenario", help="Optimize against a single scenario.")
    parser.add_argument("--max-scenarios", type=int, default=DEFAULT_MAX_SCENARIOS,
                        help="Cap the working set (the loop re-runs it every round).")
    parser.add_argument("--judge", action="store_true", help="Include LLM-judge quality in the score.")
    parser.add_argument("--briefs", choices=["port", "ts"], default="port")
    parser.add_argument("--ablate", choices=list(_ABLATIONS), help="Strip a guardrail first (self-test).")
    parser.add_argument("--no-color", action="store_true")
    parser.add_argument("--json", action="store_true")
    args = parser.parse_args(argv)
    use_color = should_color(args)

    scenarios = ie.select_scenarios(bank=args.bank, n=args.n, sample=args.sample, seed=args.seed, scenario=args.scenario)
    if not scenarios:
        sys.stderr.write("interview_optimize: no scenarios selected\n")
        return 2
    if len(scenarios) > args.max_scenarios:
        sys.stderr.write(f"interview_optimize: capping working set to {args.max_scenarios} (of {len(scenarios)})\n")
        scenarios = scenarios[: args.max_scenarios]

    provider = ClaudeCliProvider(timeout=120)
    if not provider.available():
        sys.stderr.write("interview_optimize: needs the Claude CLI (the sim + optimizer engine)\n")
        return 2

    result = optimize(scenarios, provider, rounds=args.rounds, judge=args.judge, brief_mode=args.briefs, ablate=args.ablate)

    if args.json:
        printable = {k: v for k, v in result.items() if k not in ("base_rows", "final_rows")}
        printable["base_reliability"] = _reliability(result["base_rows"])
        printable["final_reliability"] = _reliability(result["final_rows"])
        print(json.dumps(printable, indent=2, ensure_ascii=False))
    else:
        print(_format_report(result, color=use_color))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
