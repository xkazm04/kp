"""Single-session voice proof — the V0 smoke, now a thin wrapper over the V1 runner.

    python -m pipeline.jobfit.eval.voice.v0_smoke --base-url http://localhost:3100 --turns 2

Requires: the dev server running, ELEVENLABS_* configured, Piper voices in data/piper.
Costs ~1 REAL ElevenLabs minute. For a scenario sweep use `interview_eval --backend voice`.

Unlike the original V0 (which used the tokenless lab and therefore silently tested ElevenLabs'
dashboard prompt), this mints a **candidate-mode** session, so the agent runs OUR brief.
"""

from __future__ import annotations

import argparse
import asyncio
import sys

from ..._cli import configure_stdio
from ...claude_cli import ClaudeCliProvider
from .._style import _make_styler, should_color
from ..runner import glyph, verdict_banner  # eval/runner.py — the shared report chrome
from . import app_client, tts
from .session_runner import format_wer_table, percentile, run_voice_scenario, voice_checks


async def _run(args) -> int:
    st = _make_styler(should_color(args))

    from ..interview_eval import select_scenarios

    # The scenario is resolved FIRST because it decides which Piper voice will be spoken.
    scenarios = select_scenarios(bank="core", scenario=args.scenario)
    if not scenarios:
        sys.stderr.write(f"v0_smoke: no scenario named {args.scenario!r}\n")
        return 2
    scenario = scenarios[0]

    # Preflight: fail loudly BEFORE spending ElevenLabs minutes — which means checking the
    # voice this run will ACTUALLY synthesize. Checking a fixed "en" let a Czech scenario
    # pass the gate on a box with no cs_CZ model, mint a real session, and only then raise
    # inside speak() on the first utterance: minutes spent, traceback, no report.
    ok, why = tts.available(args.lang or scenario.language or "en")
    if not ok:
        sys.stderr.write(f"v0_smoke: TTS unavailable — {why}\n")
        return 2
    try:
        avail = app_client.get_availability(args.base_url)
    except app_client.AppError as exc:
        sys.stderr.write(f"v0_smoke: {exc}\n")
        return 2
    if not avail.get("elevenlabs"):
        sys.stderr.write("v0_smoke: the app reports ElevenLabs unavailable (check ELEVENLABS_* in .env.local)\n")
        return 2

    provider = ClaudeCliProvider(timeout=90)
    if not provider.available():
        sys.stderr.write("v0_smoke: Claude CLI unavailable — persona will use a canned reply\n")
        provider = None

    print(f"scenario={scenario.name} lang={scenario.language} turns={args.turns} "
          f"voice={tts.VOICES.get(scenario.language)} session={args.kind}")

    def on_event(kind: str, text: str) -> None:
        prefix = {"session": "session", "agent": "  agent>", "spoke": "  spoke>"}.get(kind, kind)
        print(f"{prefix} {text[:170]}")

    run = await run_voice_scenario(
        scenario, base_url=args.base_url, kind=args.kind, sim_mode=args.sim_mode,
        entry_id=args.entry, turns=args.turns, timeout=args.timeout, provider=provider, on_event=on_event,
    )

    issues = voice_checks(run, wer_budget=args.wer_budget, latency_budget_s=args.latency_budget)
    w = run.wer
    passed = not issues
    p50 = percentile(run.latencies_s, 0.5)

    print("\n" + verdict_banner(
        [f"{'PASS' if passed else 'FAIL'}",
         f"WER {w.wer:.1%}" if w.ref_words else "WER n/a",
         f"latency p50 {p50:.2f}s" if p50 is not None else "latency n/a"],
        passed=passed, s=st))

    print(f"\nconversation_id: {run.conversation_id}")
    print(f"wall {run.wall_s:.1f}s · agent audio {run.agent_audio_s:.1f}s · interruptions {run.interruptions} "
          f"· brief={'ours' if run.agent_prompt_used else 'DASHBOARD'}")
    if issues:
        print("\n## Voice issues")
        for i in issues:
            print(f"  {glyph(False)} {i}")
    else:
        print(f"  {glyph(True)} all voice invariants held")

    if run.pairs:
        print("\n" + "\n".join(format_wer_table(run)))
    if run.latencies_s:
        print(f"\nfirst-audio latency per turn: {', '.join(f'{x:.2f}s' for x in run.latencies_s)}")
    print(f"\npersisted turns: {run.stored_turns} · scorecard: "
          f"{(run.scorecard or {}).get('recommendation') if run.scorecard else 'none (no pipeline entry)'}")
    return 0 if passed else 1


def main(argv: list[str] | None = None) -> int:
    configure_stdio(errors="replace")
    p = argparse.ArgumentParser(description="Prove the voice loop on one scenario (spends real EL minutes).")
    p.add_argument("--base-url", default=app_client.DEFAULT_BASE_URL)
    p.add_argument("--scenario", default="swe_senior_strong")
    p.add_argument("--lang", default=None, choices=[None, "en", "cs"],
                   help="Override which Piper voice the preflight checks (default: the scenario's language).")
    p.add_argument("--kind", choices=["sim", "entry"], default="sim",
                   help="sim = candidate-mode demo session (our brief, no scorecard); entry = entry-backed (+ scorecard).")
    p.add_argument("--sim-mode", choices=["regular", "student", "student-case"], default="regular")
    p.add_argument("--entry", default=None, help="Pipeline entry id (with --kind entry).")
    p.add_argument("--turns", type=int, default=2)
    p.add_argument("--timeout", type=float, default=90.0)
    p.add_argument("--wer-budget", type=float, default=0.35)
    p.add_argument("--latency-budget", type=float, default=8.0)
    p.add_argument("--no-color", action="store_true")
    args = p.parse_args(argv)
    return asyncio.run(_run(args))


if __name__ == "__main__":
    raise SystemExit(main())
