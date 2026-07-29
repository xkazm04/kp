"""LLM-era controls #2 + #5 — the in-session chat channels.

Two personas the candidate can talk to inside the Live Work Surface, both routed
through the platform so the dialogue becomes observed evidence (dev_session_chat):

* assistant — the candidate's own work assistant. Sees ONLY candidate-visible
  material (brief, tasks, their current file), never probes/canaries/reveals. The
  point is not the assistant's brilliance but that the candidate's PROMPTS to it
  are captured and graded on quality (prompt_signals.py).

* stakeholder — the busy hiring-team stakeholder behind the brief. Sees the
  internal probe decision spaces so its answers stay CONSISTENT with the case's
  designed ambiguity, but it must never resolve an ambiguity outright, confirm
  anything is deliberate, or reveal internal notes — a real stakeholder gives
  context and constraints, not answers. Which clarifying questions the candidate
  asks is a first-class framing signal.

LLM path + deterministic fallback (a short honest "unavailable" reply) via the
shared provenance runner, like every other generation step.
"""
from __future__ import annotations

import json
import logging
from typing import Any

from .provenance import fenced_untrusted, generate_with_fallback

_LOG = logging.getLogger(__name__)

CHAT_PROMPT_VERSION = "session-chat-v1"

MAX_TRANSCRIPT_MSGS = 30  # most recent turns fed back for continuity
MAX_REPLY_CHARS = 2_500

_ASSISTANT_SYSTEM = (
    "You are the in-product work assistant helping a candidate complete a timeboxed work-sample exercise. "
    "Be a competent, concise pair: answer questions, draft or improve content when asked, point out risks. "
    "Ground yourself in the supplied brief/tasks and the candidate's current file. Never mention that the "
    "exercise contains probes, traps, or evaluation mechanics — you don't know about any. Output strict JSON only."
)

_STAKEHOLDER_SYSTEM = (
    "You role-play the busy hiring-team STAKEHOLDER who owns the brief of a work-sample exercise. Answer the "
    "candidate's questions the way a real stakeholder would: helpful, brief (2-5 sentences), concrete about "
    "business context and constraints. The brief contains DELIBERATE ambiguities; the internal notes list the "
    "defensible options each one admits. NEVER resolve an ambiguity outright, never say any part is deliberate "
    "or a test, never reveal internal notes — instead give the real-world context that helps the candidate make "
    "and OWN the call ('we've seen both; it depends on X — your call'). If asked something outside the brief, "
    "improvise a plausible, consistent detail. Output strict JSON only."
)

_REPLY_KEYS = ("reply",)


def _clip_transcript(transcript: list[dict]) -> list[dict]:
    msgs = [
        {"role": "user" if m.get("role") == "user" else "model", "text": str(m.get("text") or "")[:2000]}
        for m in (transcript or [])
        if isinstance(m, dict) and str(m.get("text") or "").strip()
    ]
    return msgs[-MAX_TRANSCRIPT_MSGS:]


def chat_reply(
    channel: str,
    case: dict,
    role: dict,
    transcript: list[dict],
    message: str,
    *,
    current_file: dict | None = None,
    lang: str = "en",
    provider: Any | None = None,
) -> tuple[dict, str]:
    """One reply on the given channel. Returns ({reply, promptVersion}, source)."""
    from ..i18n import language_directive

    stakeholder = channel == "stakeholder"
    # Candidate-visible context only for the assistant; the stakeholder additionally
    # sees the probes' decision spaces (to stay consistent) but is instructed to
    # never disclose them.
    ctx: dict[str, Any] = {
        "role": {"title": role.get("title"), "seniority": role.get("seniority")},
        "case": {"title": case.get("title"), "brief": case.get("brief"), "tasks": case.get("tasks")},
    }
    if stakeholder:
        ctx["internalProbeNotes"] = [
            {"where": p.get("where"), "decisionSpace": p.get("decisionSpace")}
            for p in (case.get("coverProbes") or [])
            if isinstance(p, dict)
        ]
        mfu = case.get("midFlightUpdate")
        if isinstance(mfu, dict):
            ctx["internalMidFlightUpdate"] = {"update": mfu.get("update")}
    if current_file and not stakeholder:
        ctx["candidateCurrentFile"] = {
            "path": str(current_file.get("path") or ""),
            "contents": str(current_file.get("contents") or "")[:4000],
        }

    prompt = (
        f"Context:\n{json.dumps(ctx, ensure_ascii=False, indent=2)}\n\n"
        f"{fenced_untrusted('CHAT_TRANSCRIPT', _clip_transcript(transcript))}\n\n"
        f"{fenced_untrusted('CANDIDATE_MESSAGE', str(message)[:4000])}\n\n"
        f'Reply to the candidate\'s message in character. Return JSON: {{ "reply": str (max {MAX_REPLY_CHARS} chars) }}. JSON only.'
        f"\n\n{language_directive(lang)}"
    )

    def deterministic() -> dict:
        # Honest degraded mode: never fake a persona deterministically.
        return {
            "reply": (
                "The stakeholder is unavailable right now — make the call you think is right and record it in your DECISIONS log."
                if stakeholder
                else "The assistant is unavailable right now — please continue and try again in a moment."
            )
        }

    def coerce(payload: Any) -> dict:
        det = deterministic()
        if not isinstance(payload, dict):
            return det
        reply = str(payload.get("reply") or "").strip()
        return {"reply": reply[:MAX_REPLY_CHARS]} if reply else det

    result, source = generate_with_fallback(
        provider,
        prompt,
        _STAKEHOLDER_SYSTEM if stakeholder else _ASSISTANT_SYSTEM,
        deterministic,
        coerce,
        _LOG,
        expected_keys=_REPLY_KEYS,
    )
    result["promptVersion"] = CHAT_PROMPT_VERSION
    return result, source
