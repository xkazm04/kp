"""V1 — run one scenario as a spoken interview, and turn the audio into gateable numbers.

Shared by ``v0_smoke`` (the single-session proof) and ``interview_eval --backend voice`` (the
scenario sweep), so both drive exactly the same code path.

Three things V1 adds over V0:

* **The real brief.** Sessions are minted as ``mode="candidate"`` (via /simulate, or /create for an
  entry-backed session), because /connect only sends our ``agentPrompt`` for candidate-mode. The
  tokenless lab silently tested ElevenLabs' stale dashboard prompt instead.
* **Per-turn alignment.** Each spoken utterance is paired with exactly the transcripts EL emitted
  while that turn was in flight, so "the ASR heard nothing" is unambiguous rather than an off-by-one.
* **Gates.** WER, first-audio latency percentiles, dropped utterances and transcript-persist
  fidelity become reliability issues that flow into the existing report.
"""

from __future__ import annotations

import time
from dataclasses import dataclass, field
from typing import Any

from ...claude_cli import ClaudeCliProvider
from . import app_client, audio
from .el_ws import ElVoiceSession
from .seal import refuse_if_offline
from .wer import WerResult, corpus_entity_fidelity, corpus_wer, entity_fidelity, normalize, wer

# Speech streams at REAL-TIME pace, so every word costs ElevenLabs seconds. A written-style answer
# ran 25 s in the first V0 run.
SPOKEN_BREVITY = (
    " You are on a LIVE VOICE call: reply in one or two short sentences (under 30 words), "
    "conversational, no lists, no markdown, no stage directions."
)
MAX_SPOKEN_CHARS = 220


def clip_spoken(text: str) -> str:
    """Hard cap, cut at a word boundary — a mid-word slice ("append-on") is synthesized literally."""
    text = " ".join((text or "").split())
    if len(text) <= MAX_SPOKEN_CHARS:
        return text
    cut = text[:MAX_SPOKEN_CHARS]
    return (cut.rsplit(" ", 1)[0] if " " in cut else cut).rstrip(",;:-") + "."


def was_heard(hypothesis: str) -> bool:
    """EL emits "..." for an utterance it captured no words from — a DROPPED turn, not a transcript."""
    return bool(normalize(hypothesis))


class WallBudget:
    """A wall-clock ceiling on one spoken run — ``BudgetedProvider`` (interview_optimize.py)
    applied to the resource this plane actually spends.

    The optimizer meters PROVIDER CALLS because that is where its money goes. Here the money is
    ElevenLabs MINUTES, and a spoken run had no ceiling on them at all: ``turns`` bounds how many
    times we speak and ``timeout`` bounds ONE wait, so a scenario whose agent keeps replying just
    under the per-wait timeout could burn ``turns x timeout`` seconds — and a sweep multiplies
    that by every scenario. ``max_minutes`` of 0 means unlimited, and the clock still runs, so
    every run can report what it cost (the same "meter always, cap on request" rule).

    A spent budget is a CLEAN STOP, not an error: the transcript collected so far is still
    persisted and scored, and the stop is recorded on the run (``budget_stopped`` /
    ``stopped_reason``) so a short run is never read as a short conversation.
    """

    def __init__(self, max_minutes: float = 0.0):
        self.max_minutes = max(0.0, max_minutes)
        self._started = time.monotonic()

    @property
    def elapsed_minutes(self) -> float:
        return (time.monotonic() - self._started) / 60.0

    @property
    def remaining_s(self) -> float | None:
        """Seconds left, or None when unlimited."""
        if not self.max_minutes:
            return None
        return self.max_minutes * 60.0 - (time.monotonic() - self._started)

    def spent(self) -> bool:
        left = self.remaining_s
        return left is not None and left <= 0

    def bound(self, timeout: float) -> float:
        """``timeout``, clipped to what is left. Never below 1 s — a sub-second wait would
        report a healthy agent as silent instead of reporting the budget."""
        left = self.remaining_s
        if left is None:
            return timeout
        return max(1.0, min(timeout, left))

    def reason(self) -> str:
        return (f"wall budget spent: {self.elapsed_minutes:.1f} of {self.max_minutes:.1f} minutes")


def percentile(values: list[float], p: float) -> float | None:
    """Nearest-rank percentile (p in 0..1). None for an empty sample."""
    if not values:
        return None
    ordered = sorted(values)
    idx = min(len(ordered) - 1, max(0, int(round(p * (len(ordered) - 1)))))
    return ordered[idx]


@dataclass
class VoiceRun:
    scenario: str
    turns: list[dict] = field(default_factory=list)           # browser-shaped VoiceTurn[]
    ground_truth: list[str] = field(default_factory=list)     # what we actually spoke
    heard: list[str] = field(default_factory=list)            # EL's ASR, aligned per turn
    latencies_s: list[float] = field(default_factory=list)
    interruptions: int = 0
    agent_audio_s: float = 0.0
    conversation_id: str | None = None
    agent_prompt_used: bool = False
    stored_turns: int | None = None
    scorecard: dict | None = None
    wall_s: float = 0.0
    errored: str | None = None
    condition: str = "clean"      # audio degradation applied to our speech (V2)
    barge_in: bool = False        # this run tried to interrupt the agent mid-utterance
    barged: bool = False          # the agent actually yielded (an interruption event fired)
    budget_minutes: float = 0.0   # the wall ceiling this run was given (0 = unlimited)
    budget_stopped: bool = False  # the run ended because the ceiling was reached, not the script
    stopped_reason: str | None = None  # why it stopped early — a clean stop, never an error

    @property
    def pairs(self) -> list[tuple[str, str]]:
        return list(zip(self.ground_truth, self.heard))

    @property
    def wer(self) -> WerResult:
        return corpus_wer(self.pairs)

    @property
    def entities(self):
        return corpus_entity_fidelity(self.pairs)

    @property
    def dropped(self) -> list[int]:
        return [i for i, h in enumerate(self.heard) if not was_heard(h)]

    def metrics(self) -> dict[str, Any]:
        w = self.wer
        ef = self.entities
        return {
            "wer": round(w.wer, 4),
            "wer_words": w.ref_words,
            "substitutions": w.substitutions,
            "deletions": w.deletions,
            "insertions": w.insertions,
            "entity_recall": round(ef.recall, 4),
            "entities_total": ef.total,
            "entities_missing": list(ef.missing),
            "condition": self.condition,
            "barge_in": self.barge_in,
            "barged": self.barged,
            "budget_minutes": self.budget_minutes,
            "budget_stopped": self.budget_stopped,
            "stopped_reason": self.stopped_reason,
            "latencies": [round(x, 3) for x in self.latencies_s],
            "latency_p50": percentile(self.latencies_s, 0.5),
            "latency_p95": percentile(self.latencies_s, 0.95),
            "dropped": len(self.dropped),
            "utterances": len(self.ground_truth),
            "interruptions": self.interruptions,
            "agent_audio_s": round(self.agent_audio_s, 1),
            "wall_s": round(self.wall_s, 1),
            "agent_prompt_used": self.agent_prompt_used,
            "conversation_id": self.conversation_id,
            "ground_truth": self.ground_truth,
            "heard": self.heard,
        }


def voice_checks(run: VoiceRun, *, wer_budget: float, latency_budget_s: float) -> list[str]:
    """Voice-plane reliability invariants. These join the transcript validators, so a spoken run is
    gated on BOTH what was said and how the audio behaved."""
    issues: list[str] = []
    if run.errored:
        issues.append(f"voice: session error — {run.errored}")
    if not run.ground_truth:
        issues.append("voice: nothing was spoken")
        return issues
    if run.dropped:
        issues.append(f"voice: {len(run.dropped)} utterance(s) dropped — the ASR heard nothing")
    w = run.wer
    if w.ref_words and w.wer > wer_budget:
        issues.append(f"voice: WER {w.wer:.1%} exceeds budget {wer_budget:.0%}")
    # Entity fidelity: a spoken skill/tech term that didn't survive into the transcript would be
    # scored as absent (or as a fabricated substitute). This is the gate WER can't be — the V1
    # React->Rust corruption sat at 8% WER but lost two skills.
    ef = run.entities
    if ef.missing:
        issues.append(f"voice: {len(ef.missing)} domain term(s) lost in transcription: {', '.join(ef.missing)}")
    # NB: barge-in is NOT gated here. "Agent didn't yield" can mean the EL agent has interruptions
    # disabled in its dashboard config rather than a defect, so a hard gate would just flag config.
    # The result (run.barged) is reported; investigate the agent's turn/interruption settings before
    # treating a no-yield as a bug.
    p95 = percentile(run.latencies_s, 0.95)
    if p95 is not None and p95 > latency_budget_s:
        issues.append(f"voice: first-audio latency p95 {p95:.1f}s exceeds budget {latency_budget_s:.1f}s")
    if run.stored_turns is not None and run.stored_turns != len(run.turns):
        issues.append(f"voice: persisted {run.stored_turns} turns but sent {len(run.turns)}")
    if not run.agent_prompt_used:
        issues.append("voice: no agentPrompt — the agent used its dashboard prompt, not our brief")
    return issues


def _persona_reply(provider: ClaudeCliProvider | None, persona: str, turns: list[dict], fallback: str) -> str:
    if provider is None:
        return fallback
    try:
        from ..interview_eval import _candidate_turn

        return clip_spoken(_candidate_turn(provider, persona + SPOKEN_BREVITY, turns)) or fallback
    except Exception:  # noqa: BLE001 — a persona hiccup must not sink a paid session
        return fallback


def _voice_for(text: str, default: str) -> str:
    """Piper voices are monolingual — speak Czech text with the Czech voice."""
    from ..interview_eval import _clear_lang

    return _clear_lang(text) or default


def mint_session(
    base_url: str, *, kind: str = "sim", mode: str = "regular", entry_id: str | None = None,
    provider: str = "elevenlabs", language: str | None = None,
) -> dict[str, Any]:
    """A candidate-mode session (so /connect hands us the real brief). ``kind='entry'`` also
    produces a scorecard on /complete."""
    if kind == "entry":
        if not entry_id:
            raise ValueError("kind='entry' needs an entry_id")
        return app_client.create(base_url, entry_id=entry_id, provider=provider, language=language)
    return app_client.simulate(base_url, mode=mode, provider=provider, language=language)


async def run_voice_scenario(
    scenario,
    *,
    base_url: str,
    kind: str = "sim",
    sim_mode: str = "regular",
    entry_id: str | None = None,
    turns: int = 2,
    timeout: float = 90.0,
    provider: ClaudeCliProvider | None = None,
    gain: float = 1.0,
    noise_snr_db: float | None = None,
    barge_in: bool = False,
    barge_in_delay: float = 1.5,
    max_minutes: float = 0.0,
    seed: int = 0,
    on_event=None,
) -> VoiceRun:
    """Speak one scenario end to end and persist it exactly as the browser does.

    ``gain`` / ``noise_snr_db`` degrade our audio (the V2 probes). ``barge_in`` cuts in
    ``barge_in_delay`` s into the agent's reply to turn 1 to test that it yields.
    ``max_minutes`` caps the paid wall-clock (:class:`WallBudget`; 0 = unlimited, metered
    either way) — a spent budget stops the conversation cleanly and is recorded on the run."""
    # This run opens a REAL wss:// session to api.elevenlabs.io. Refuse it under the E-SH-4
    # no-egress seal here, before a session is minted or a minute is spent.
    refuse_if_offline("speak a scenario into a real ElevenLabs realtime session")
    budget = WallBudget(max_minutes)
    run = VoiceRun(scenario=scenario.name)
    run.budget_minutes = budget.max_minutes
    run.condition = audio.describe(gain, noise_snr_db)
    run.barge_in = barge_in
    effect = audio.make_effect(gain=gain, noise_snr_db=noise_snr_db, seed=seed)
    say = on_event or (lambda *_: None)
    lang = scenario.language

    minted = mint_session(base_url, kind=kind, mode=sim_mode, entry_id=entry_id,
                          language=scenario.language if scenario.language != "en" else None)
    token = minted.get("token")
    session = app_client.connect(base_url, provider="elevenlabs", consent=True, token=token)
    sid = session["sessionId"]
    tok = session.get("token") or token
    agent_prompt = session.get("agentPrompt")
    run.agent_prompt_used = bool(agent_prompt)
    say("session", f"{sid} agentPrompt={'yes' if agent_prompt else 'NO (dashboard prompt!)'}")

    import asyncio as _a

    # Mirror the production fix (VoiceInterview.tsx): pin the agent's language via the override, not
    # just the prompt — the EL agent's dashboard default is Czech and the prompt loses to it.
    t0 = time.monotonic()
    async with ElVoiceSession(session["connect"]["signedUrl"], agent_prompt=agent_prompt,
                              language=scenario.language) as call:

        async def _say_and_hear(text: str, *, wait_full: bool) -> bool:
            """Speak one utterance; capture the transcript window it produced. When ``wait_full`` we
            wait out the agent's whole reply (so the ASR result has landed); otherwise we only wait
            for the agent to START (the barge-in case) and snapshot what's arrived."""
            heard_from = len(call.result.user_transcripts)
            call.begin_turn()
            dur = await call.speak(text, _voice_for(text, lang), effect=effect)
            say("spoke", f"({dur:.1f}s) {text}")
            # Never wait past the budget: the ceiling is on PAID wall-clock, so it has to
            # bound the waits too, not just the turn count.
            wait_s = budget.bound(timeout)
            got = await (call.wait_for_agent_turn(timeout=wait_s) if wait_full
                         else call.wait_for_agent_start(timeout=wait_s))
            run.ground_truth.append(text)
            run.heard.append(" ".join(call.result.user_transcripts[heard_from:]).strip())
            return got

        if not await call.wait_for_agent_turn(timeout=budget.bound(timeout)):
            run.errored = "agent never spoke"
        elif barge_in and turns >= 2:
            # Turn 1, then cut in mid-reply and check the agent yields (emits an interruption).
            say("agent", call.result.agent_responses[-1] if call.result.agent_responses else "(audio only)")
            if not await _say_and_hear(scenario.first_message, wait_full=False):
                run.errored = "agent never started replying (barge-in)"
            else:
                await _a.sleep(barge_in_delay)  # let it get mid-sentence
                before = call.result.interruptions
                line = _persona_reply(provider, scenario.candidate_prompt, call.result.turns,
                                      "Sorry to jump in — could I add one quick thing?")
                got = await _say_and_hear(line, wait_full=True)
                run.barged = call.result.interruptions > before
                say("barge", f"cut in after {barge_in_delay:.1f}s → agent yielded={run.barged}")
                if not got:
                    run.errored = "agent did not respond after the barge-in"
        else:
            say("agent", call.result.agent_responses[-1] if call.result.agent_responses else "(audio only)")
            for i in range(turns):
                # A spent budget ends the conversation cleanly BETWEEN turns — the transcript
                # so far is still persisted and scored below; the stop is recorded, never
                # dressed up as an error or left to look like a short conversation.
                if budget.spent():
                    run.budget_stopped = True
                    run.stopped_reason = budget.reason()
                    say("budget", f"stopping after {i} turn(s) — {run.stopped_reason}")
                    break
                text = scenario.first_message if i == 0 else _persona_reply(
                    provider, scenario.candidate_prompt, call.result.turns, "Could you say a bit more about that?"
                )
                if not await _say_and_hear(text, wait_full=True):
                    # A wait the BUDGET cut short is a stop, not a silent agent. Reporting it
                    # as "agent did not reply" would send a reader hunting a defect that is
                    # only the ceiling they asked for.
                    if budget.spent():
                        run.budget_stopped = True
                        run.stopped_reason = budget.reason()
                        say("budget", f"stopped mid-turn — {run.stopped_reason}")
                    else:
                        run.errored = "agent did not reply within timeout"
                    break
                say("agent", call.result.agent_responses[-1] if call.result.agent_responses else "(audio only)")

        r = call.result
        run.turns = r.turns
        run.latencies_s = r.latencies_s
        run.interruptions = r.interruptions
        run.agent_audio_s = r.agent_audio_s
        run.conversation_id = r.conversation_id
        # The DRIVER's error wins over the turn-taking one. A dead socket or an unmeasurable
        # agent audio format makes every wait time out, so the run's own "agent did not reply
        # within timeout" is the SYMPTOM; reporting it over the protocol fault sent whoever
        # read the report looking at the agent instead of at the one line that explains it.
        run.errored = r.errored or run.errored

    run.wall_s = time.monotonic() - t0

    if tok and run.turns:
        try:
            saved = app_client.complete(base_url, token=tok, session_id=sid, transcript=run.turns, status="completed")
            run.stored_turns = len((saved.get("session") or {}).get("transcript") or [])
            run.scorecard = saved.get("scorecard")
        except app_client.AppError as exc:
            run.errored = run.errored or f"persist failed: {exc}"
    return run


def format_wer_table(run: VoiceRun) -> list[str]:
    lines = ["## Ground truth vs ASR (the metric only the voice plane produces)"]
    for gt, hyp in run.pairs:
        r = wer(gt, hyp)
        lines.append(f"  WER {r.wer:6.1%}  (S{r.substitutions} D{r.deletions} I{r.insertions} / N{r.ref_words})")
        lines.append(f"    said : {gt}")
        lines.append(f"    heard: {hyp or '(nothing — DROPPED)'}")
    w = run.wer
    lines.append(f"\n  corpus WER: {w.wer:.2%} over {w.ref_words} words")
    return lines
