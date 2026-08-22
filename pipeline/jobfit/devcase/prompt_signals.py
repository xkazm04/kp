"""LLM-era controls #2 — signals from the CAPTURED prompt channel.

The Live Work Surface routes the candidate's assistant + stakeholder chat through
the platform (dev_session_chat), so the human<->LLM dialogue is observed evidence,
not a reconstruction. This module derives deterministic, unit-testable signals from
that transcript: how the candidate DROVE the model (decomposition, iteration,
verification asks) and how they engaged the stakeholder (clarifying questions).

FAIRNESS CONTRACT (same as process_events): using the assistant is never a penalty
— zero prompts is simply "no signal", and heavy use is graded on QUALITY, never
volume. The one negative-leaning signal is `briefPasteRatio`: a prompt that is
mostly the verbatim brief is the observable shape of one-shot delegation, and even
that only AIMS the authorship interview — it never scores the candidate down here.

A transcript message is a plain dict (free-form JSON, never a codegen'd model):
  {"channel": "assistant" | "stakeholder", "role": "user" | "model", "text": str}
"""
from __future__ import annotations

import re

# Words that signal the candidate is asking the model to VERIFY rather than produce —
# the LLM-era analogue of writing a test.
#
# LOCALE PARITY (2026-08-22): these lists must cover every locale the case itself can be
# delivered in. The brief/tasks/seed prose and BOTH chat personas are rendered in the
# posting's language (`devcase_cli --lang`, `chat.chat_reply`, `seed_materializer`), so a
# cs/de/fr candidate writes their prompts in that language. While the pattern was
# English-only, an identical session scored differently by language: "ověř prosím, jestli
# ten výpočet sedí" produced verificationAsks=0, which costs 0.2 of the observed
# verification term in `evaluate.evaluate_submission`'s deterministic path (judgment 80
# instead of 100) and drops the "asked the model to verify" evidence line from the LLM
# prompt. Same defect class as the Czech masculine-only stems in the CV pipeline.
#
# English keeps full word boundaries; cs/de/fr are matched as STEMS (leading \b only)
# because they inflect the ending — "ověř" must also catch "ověřit/ověřte/ověřil".
# Diacritic-free spellings ride along, as in automation._DECLARED_LANG_TO_LOCALE, since
# candidates routinely type without them. Tokens are chosen to be low-collision across
# the four languages (e.g. no bare "proc", which would match English "process").
_VERIFY_RE = re.compile(
    r"\b(verify|check|test|prove|confirm|validate|wrong|incorrect|mistake|are you sure|why did|why does|double.?check)\b"
    # cs
    r"|\b(ověř|overit|overte|zkontroluj|kontrol|vyzkouš|vyzkous|otestuj|špatn|spatn|chybn|nesed|nesouhlas|si jist|opravdu|proč)"
    # de — `teste(n|st)` / `teste(z|r)` (fr) are spelled out rather than left as a bare
    # "teste" stem so the widening can't reach back into English "tested"/"tester" and
    # quietly hand English speakers a signal the other three don't get.
    r"|\b(überprüf|uberpruf|prüf|pruf|kontrollier|teste(n|st)?\b|stimmt|falsch|fehler|sicher|wirklich|warum)"
    # fr
    r"|\b(vérifi|verifi|contrôl|controle|teste(z|r)?\b|erreur|faux|fausse|erroné|errone|pourquoi|vraiment|sûr que|sur que)",
    re.IGNORECASE,
)
_QUESTION_RE = re.compile(
    r"\?|\b(what|which|should|how|why|can|could|do you|is it|are there)\b"
    # Non-English interrogatives, for a question written without a question mark.
    r"|\b(jak|proč|mám|máme|můž|muz|který|která|které|kdy|kde)"
    r"|\b(wie|warum|wieso|soll|kann|könn|konn|welche)"
    r"|\b(pourquoi|comment|quel|quelle|dois-je|puis-je|est-ce|faut-il)",
    re.IGNORECASE,
)


def _norm(text: str) -> str:
    return re.sub(r"\s+", " ", (text or "").strip().lower())


def _brief_paste_ratio(prompts: list[str], brief: str) -> float:
    """How much of the case brief the single most brief-like prompt contains, 0..1.

    Token-shingle containment (order-insensitive, cheap, deterministic): the fraction
    of the brief's 5-gram shingles present in the prompt. ~1.0 = the brief was pasted
    wholesale (the one-shot delegation shape); ~0 = prompts are the candidate's own
    words. Short briefs (< 8 tokens) can't shingle — return 0.0 (no signal).
    """
    btoks = _norm(brief).split()
    if len(btoks) < 8 or not prompts:
        return 0.0
    n = 5
    shingles = {" ".join(btoks[i : i + n]) for i in range(len(btoks) - n + 1)}
    if not shingles:
        return 0.0
    best = 0.0
    for p in prompts:
        ptext = _norm(p)
        hit = sum(1 for s in shingles if s in ptext)
        best = max(best, hit / len(shingles))
    return round(min(1.0, best), 3)


def derive_prompt_signals(chat: list[dict], case: dict | None = None) -> dict:
    """Deterministic prompt-channel signals. Empty/absent transcript -> all-zero
    signals with ``observed: False`` so consumers can tell "didn't use the channel"
    from "channel not captured"."""
    msgs = [m for m in (chat or []) if isinstance(m, dict) and str(m.get("text") or "").strip()]
    a_user = [str(m["text"]) for m in msgs if m.get("channel") == "assistant" and m.get("role") == "user"]
    s_user = [str(m["text"]) for m in msgs if m.get("channel") == "stakeholder" and m.get("role") == "user"]

    brief = str((case or {}).get("brief") or "")
    verification_asks = sum(1 for p in a_user if _VERIFY_RE.search(p))
    clarifying = sum(1 for q in s_user if _QUESTION_RE.search(q))

    # Iteration depth: the longest run of consecutive assistant-channel user turns —
    # a candidate who follows up on the model's answer (refines, challenges, narrows)
    # rather than firing one prompt and pasting the result.
    depth = 0
    run = 0
    for m in msgs:
        if m.get("channel") != "assistant":
            continue
        if m.get("role") == "user":
            run += 1
            depth = max(depth, run)
        # a model turn doesn't reset the run — user->model->user counts as depth 2
    return {
        "observed": bool(msgs),
        "assistantPrompts": len(a_user),
        "stakeholderQuestions": len(s_user),
        "clarifyingQuestions": clarifying,
        "verificationAsks": verification_asks,
        "meanPromptChars": int(sum(len(p) for p in a_user) / len(a_user)) if a_user else 0,
        "iterationDepth": depth,
        "briefPasteRatio": _brief_paste_ratio(a_user, brief),
        # Observed channel -> high evidence confidence, matching process_events (0.8).
        "confidence": 0.8 if msgs else 0.0,
    }


def prompt_evidence(signals: dict) -> list[str]:
    """Human-readable evidence lines for the evaluation context / UI."""
    if not signals.get("observed"):
        return []
    out = [
        f"Assistant prompts: {signals['assistantPrompts']} (mean {signals['meanPromptChars']} chars, iteration depth {signals['iterationDepth']}).",
        f"Stakeholder questions: {signals['stakeholderQuestions']} ({signals['clarifyingQuestions']} clarifying).",
    ]
    if signals.get("verificationAsks"):
        out.append(f"Asked the model to verify/check its output {signals['verificationAsks']} time(s).")
    ratio = signals.get("briefPasteRatio") or 0.0
    if ratio >= 0.6:
        out.append(f"A prompt contained ~{int(ratio * 100)}% of the brief verbatim — one-shot delegation shape (aim the interview here; not a score penalty).")
    return out
