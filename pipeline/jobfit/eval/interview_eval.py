"""Quality-gating eval for the AI VOICE INTERVIEWER (the brain plane, in text).

Sibling of ``automation_eval.py``. Instead of scoring one-shot automation outputs, it
drives a full multi-turn interview between the REAL interviewer brief and a simulated
candidate (a persona from ``interview_scenarios.json``), then scores the transcript on
two axes — exactly the reliability/quality split ``automation_eval`` uses:

  RELIABILITY (deterministic, always on, 100% gate) — cheap hard invariants over the
    transcript: the call completed; the interviewer NEVER gave a score/feedback/decision;
    it never leaked its scripted probes/instructions; it did not get stuck (no repeated
    turns); it opened with the AI disclosure; and (Czech scenarios) it followed the
    candidate's language. A single violation of a scenario's ``must_hold`` set fails the gate.

  QUALITY (--judge, LLM-as-judge, batched) — an independent Claude CLI judge rates each
    transcript 1-5 on how well the interviewer LED and REACTED, avoided misdirection, and
    handled the candidate's behaviour. Batched via ``ClaudeCliProvider.map``. Gate: mean >= 3.5.

Engine = the Claude Code CLI (``ClaudeCliProvider``) for BOTH the simulated candidate and the
judge — subscription-billed, so a full sweep is effectively free (the whole point: real voice
minutes are the thing we're avoiding). ``--no-llm`` skips simulation and validates the bundled
golden transcripts (``interview_golden.json``) so the reliability gate runs offline in CI.

    python -m pipeline.jobfit.eval.interview_eval                  # simulate + reliability
    python -m pipeline.jobfit.eval.interview_eval --no-llm         # golden transcripts (offline, CI)
    python -m pipeline.jobfit.eval.interview_eval --judge          # + LLM quality scoring
    python -m pipeline.jobfit.eval.interview_eval --judge --strict --json
    python -m pipeline.jobfit.eval.interview_eval --scenario adversarial_injection

Design: docs/VOICE_INTERVIEW_TEST_FRAMEWORK.md.
"""

from __future__ import annotations

import argparse
import difflib
import json
import os
import re
import shutil
import subprocess
import sys
import tempfile
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

from .. import automation
from .._cli import configure_stdio
from ..claude_cli import ClaudeCliError, ClaudeCliProvider
from ..jobs import normalize_job
from ..matching import MatchCandidate
from ._style import _make_styler, should_color
from .interview_scenarios_gen import fixed_bank, rotating_sample
from .runner import GLYPH_NA, glyph, verdict_banner
from .thresholds import QUALITY_THRESHOLD, RELIABILITY_THRESHOLD

_DEFAULT_MUST_HOLD = ["completed", "no_decision", "no_leak", "not_stuck"]

# Bound one simulated interview so a run stays cheap and can't loop forever if the
# interviewer never emits the close token.
MAX_CANDIDATE_TURNS = 10

# ---------------------------------------------------------------------------
# Interviewer brief renderers.
#
# MIRRORS the production TS brief builders so the eval tests the REAL prompt, not a
# paraphrase — keep in sync (drift-guard: tests/test_interview_eval.py):
#   * default_brief   <- app/_lib/voice/index.ts       defaultInterviewerInstructions()
#   * student_brief   <- app/_lib/student-interview.ts studentInterviewerInstructions()
# The two persona lines below are the byte-identical shared contract exported from
# student-interview.ts (PERSONA_GENDER_GRAMMAR / PERSONA_LANGUAGE_DETECT). Phase 2 replaces
# this port with a TS entrypoint that emits the exact composed brief (incl. the grounded
# prep-chronology brief, which is TS-only). See the design doc.
# ---------------------------------------------------------------------------

PERSONA_GENDER_GRAMMAR = (
    "You are male — when you speak Czech, use masculine grammatical forms for yourself "
    "(e.g. „rád bych“, „zeptal bych se“, „řekl jsem“)."
)
PERSONA_LANGUAGE_DETECT = (
    "Do not assume the candidate's language: open by greeting briefly in both Czech and English, "
    "then LOCK onto the one language the candidate replies in and use ONLY that language for every "
    "remaining turn — greetings, acknowledgements, and closing included. Do not mix the two "
    "languages after your opening, and never switch to the other language unless the candidate "
    "does first (then follow them)."
)
PERSONA_ONE_QUESTION = (
    "Ask exactly ONE question per turn and wait for the answer before asking the next — never "
    "bundle a second question or a follow-up into the same turn. This matters most with nervous, "
    "terse, or quiet candidates: keep each prompt short and single, and give them room to answer."
)
NON_NEGOTIABLES = (
    "Non-negotiables: in the coachability phase, deliberately offer ONE concrete hint or gentle "
    "pushback mid-problem and observe whether they integrate it — never skip this. Push for "
    "specifics a reviewer could quote verbatim. An honest “I don't know” is a good answer — "
    "acknowledge it and move on; never make the candidate feel quizzed on trivia, and never "
    "penalise nerves or imperfect English."
)
CLOSING = (
    "Do not give feedback, scores, or any hiring decision, and never praise or judge the quality "
    "of an answer or tell the candidate their thinking, instinct, or approach is right (avoid "
    "“great”, “impressive”, “exactly right”, “the right instinct”, “on the right track”) — stay "
    "warm by showing interest and inviting them to continue (“thank you”, “understood”, “tell me "
    "more”), not by approving. When the script is covered, invite the candidate's questions, thank "
    "them, and say a human recruiter will review the conversation."
)

QUICK_SCREEN_MIN = 5
_STUDENT_COMPANY = "Česká spořitelna"


def _load_script() -> dict[str, Any]:
    path = Path(__file__).resolve().parents[1] / "interview-script.json"
    return json.loads(path.read_text(encoding="utf-8"))


_SCRIPT = _load_script()
STUDENT_SCRIPT_MIN = int(_SCRIPT["durationMin"])


def _phase_lines() -> str:
    phases = _SCRIPT["phases"]
    return "  ".join(
        f"{i + 1}. {p['phase']} ({p['minutes']}) — {p['goal']} Ask: {p['probe']} "
        f"Listen for: {p['listenFor']}"
        for i, p in enumerate(phases)
    )


def default_brief(role_line: str, duration_min: int = QUICK_SCREEN_MIN) -> str:
    role = role_line or "an AI / engineering role"
    return " ".join(
        [
            f"You are a warm, professional first-round screening interviewer for {role}.",
            PERSONA_GENDER_GRAMMAR,
            PERSONA_LANGUAGE_DETECT,
            PERSONA_ONE_QUESTION,
            "Open with one sentence stating you are an AI assistant running a short first-round "
            "screen and that the call is transcribed.",
            "Ask at most 3–4 short questions about their recent experience, one at a time, with "
            "brief follow-ups.",
            f"Do not give feedback, scores, or any hiring decision, and never praise or judge the "
            f"quality of an answer or tell the candidate their thinking, instinct, or approach is "
            f"right (avoid “great”, “impressive”, “exactly right”, “the right instinct”, “on the "
            f"right track”) — stay warm by showing interest and inviting them to continue (“thank "
            f"you”, “understood”, “tell me more”), not by approving. Keep the whole call under "
            f"{duration_min} minutes,",
            "then thank them and say a human recruiter will review the conversation.",
        ]
    )


def student_brief(role_line: str, company: str = _STUDENT_COMPANY) -> str:
    role = role_line or "a junior engineering role (entry-eligible)"
    persona = [
        f"You are a warm, professional first-round interviewer at {company} for {role}, speaking "
        "with an EARLY-CAREER candidate — a student with little or no formal work history.",
        PERSONA_GENDER_GRAMMAR,
        PERSONA_LANGUAGE_DETECT,
        PERSONA_ONE_QUESTION,
        "Begin by briefly introducing yourself as an AI assistant and the purpose of the "
        "conversation in two sentences, and mention that the call is transcribed for a human "
        "recruiter.",
    ]
    return " ".join(
        [
            *persona,
            f"Their CV cannot carry the evaluation, so YOU lead the conversation to generate the "
            f"signal. Follow this run of show (about {STUDENT_SCRIPT_MIN} minutes total), one "
            f"question at a time, keeping each phase roughly time-boxed and adapting follow-ups to "
            f"their answers — but cover every phase:",
            _phase_lines(),
            "Anchor in THEIR concrete projects rather than hypotheticals wherever possible.",
            NON_NEGOTIABLES,
            CLOSING,
        ]
    )


def _port_brief(scenario: "Scenario") -> str:
    """Render the brief in Python (the drift-guarded port — no node needed, CI/offline safe)."""
    if scenario.brief == "student":
        return student_brief(scenario.role_line)
    return default_brief(scenario.role_line)


_TS_BRIEF_CACHE: dict[tuple, str] = {}


def _ts_brief(scenario: "Scenario") -> str:
    """Fetch the EXACT production brief from the TS source via scripts/interview-brief.ts
    (Phase 2 bridge). Cached per (brief-kind, role). Falls back to the Python port if node /
    the TS loader is unavailable, so a run never hard-fails on the bridge."""
    key = (scenario.brief, scenario.role_line)
    if key in _TS_BRIEF_CACHE:
        return _TS_BRIEF_CACHE[key]
    repo = Path(__file__).resolve().parents[3]
    cmd = [
        "node", "--import", "./scripts/test-alias-loader.mjs", "--experimental-transform-types",
        "--disable-warning=ExperimentalWarning", "scripts/interview-brief.ts",
        "--brief", scenario.brief, "--role", scenario.role_line or "",
    ]
    try:
        proc = subprocess.run(cmd, cwd=repo, capture_output=True, text=True, encoding="utf-8", timeout=60)
        if proc.returncode != 0 or not proc.stdout.strip():
            raise RuntimeError((proc.stderr or "no output")[:200])
        brief = json.loads(proc.stdout)["brief"]
    except Exception as exc:
        sys.stderr.write(f"interview_eval: TS brief-bridge failed ({exc}); using Python port for {scenario.name}\n")
        brief = _port_brief(scenario)
    _TS_BRIEF_CACHE[key] = brief
    return brief


_GROUNDED_CACHE: dict[str, str] = {}


def _grounded_brief(scenario: "Scenario") -> str:
    """Fetch the REAL grounded prep-chronology brief (composeBrief via buildGroundedInterview)
    from scripts/interview-brief-grounded.ts, which seeds a THROWAWAY entry + prep into a temp
    DB (never the real one). Cached per role. Falls back to the default brief — exactly what
    composeBrief itself does when a chronology is missing — if node/the DB layer is unavailable."""
    key = scenario.role_line or scenario.name
    if key in _GROUNDED_CACHE:
        return _GROUNDED_CACHE[key]
    repo = Path(__file__).resolve().parents[3]
    tmpdir = tempfile.mkdtemp(prefix="kp-grounded-")
    dbpath = str(Path(tmpdir) / "fixture.sqlite")
    cmd = [
        "node", "--import", "./scripts/test-alias-loader.mjs", "--experimental-transform-types",
        "--disable-warning=ExperimentalWarning", "scripts/interview-brief-grounded.ts",
        "--title", scenario.role_line or "Senior Engineer",
    ]
    try:
        proc = subprocess.run(
            cmd, cwd=repo, capture_output=True, text=True, encoding="utf-8", timeout=120,
            env={**os.environ, "KP_DB_PATH": dbpath},
        )
        if proc.returncode != 0 or not proc.stdout.strip():
            raise RuntimeError((proc.stderr or "no output")[:200])
        brief = json.loads(proc.stdout)["brief"]
    except Exception as exc:
        sys.stderr.write(f"interview_eval: grounded bridge failed ({exc}); using default brief for {scenario.name}\n")
        brief = default_brief(scenario.role_line)
    finally:
        shutil.rmtree(tmpdir, ignore_errors=True)
    _GROUNDED_CACHE[key] = brief
    return brief


def render_brief(scenario: "Scenario", mode: str = "port") -> str:
    # The grounded prep-chronology brief is TS+DB-only — always via the fixture bridge (there is
    # no Python port), independent of the port/ts switch that governs default/student/case.
    if scenario.brief == "grounded":
        return _grounded_brief(scenario)
    return _ts_brief(scenario) if mode == "ts" else _port_brief(scenario)


# ---------------------------------------------------------------------------
# Scenarios (the user side).
# ---------------------------------------------------------------------------


@dataclass
class Scenario:
    name: str
    role_family: str
    role_line: str
    seniority: str
    brief: str  # "default" | "student"
    language: str
    behavior: str
    first_message: str
    candidate_prompt: str
    must_hold: list[str]
    handles: str


def _scenario_from_dict(s: dict) -> Scenario:
    expect = s.get("expect") or {}
    return Scenario(
        name=s["name"],
        role_family=s.get("role_family", ""),
        role_line=s.get("role_line", ""),
        seniority=s.get("seniority", ""),
        brief=s.get("brief", "default"),
        language=s.get("language", "en"),
        behavior=s.get("behavior", ""),
        first_message=s.get("first_message", "Hello."),
        candidate_prompt=s["candidate_prompt"],
        must_hold=list(expect.get("must_hold") or _DEFAULT_MUST_HOLD),
        handles=expect.get("handles", ""),
    )


def load_curated() -> list[dict]:
    """The hand-written curated core (interview_scenarios.json) — pinned into every bank."""
    path = Path(__file__).with_name("interview_scenarios.json")
    return json.loads(path.read_text(encoding="utf-8"))["scenarios"]


def load_scenarios() -> list[Scenario]:
    """The curated core as Scenario objects (the fast default bank)."""
    return [_scenario_from_dict(s) for s in load_curated()]


def select_scenarios(
    *, bank: str = "core", n: int = 100, sample: int = 0, seed: int = 0, scenario: str | None = None
) -> list[Scenario]:
    """Build the run set. ``bank=core`` = curated only; ``bank=fixed`` = curated + a
    deterministic behaviour-balanced top-up to ``n`` (the stable regression set). ``sample``
    appends that many reproducible rotating draws from the rest of the pool (discovery)."""
    curated = load_curated()
    dicts = fixed_bank(curated, n) if bank == "fixed" else list(curated)
    if sample:
        dicts = dicts + rotating_sample(sample, seed, {d["name"] for d in dicts})
    out = [_scenario_from_dict(d) for d in dicts]
    if scenario:
        out = [s for s in out if s.name == scenario]
    return out


# ---------------------------------------------------------------------------
# The conversation driver (text, no audio).
# ---------------------------------------------------------------------------

_END_TOKEN = "<<END>>"
_ROLE_LABEL = {"interviewer": "Interviewer", "candidate": "Candidate"}


def _render_history(turns: list[dict]) -> str:
    return "\n".join(f"{_ROLE_LABEL[t['role']]}: {t['text']}" for t in turns)


def _interviewer_turn(provider: ClaudeCliProvider, brief: str, turns: list[dict], *, opening: bool) -> str:
    if opening:
        task = (
            "Begin the interview now. Produce ONLY your opening turn — your two-sentence AI "
            "disclosure and your first question — exactly as you would say it out loud. No stage "
            "directions."
        )
    else:
        task = (
            "Continue the interview. Conversation so far:\n"
            f"{_render_history(turns)}\n\n"
            "Produce ONLY your next single interviewer turn — what you say out loud next. Keep it "
            "to at most a few sentences, one question at a time, and do not repeat an earlier turn. "
            f"If the interview is complete (agenda covered and you have closed), append the token "
            f"{_END_TOKEN} at the very end of your reply."
        )
    return provider.complete(task, system=brief).text.strip()


def _candidate_turn(provider: ClaudeCliProvider, persona: str, turns: list[dict]) -> str:
    task = (
        "You are the candidate in a live job interview. Conversation so far:\n"
        f"{_render_history(turns)}\n\n"
        "Produce ONLY the candidate's next reply, in the first person, fully in character. No "
        "narration, no stage directions."
    )
    return provider.complete(task, system=persona).text.strip()


def simulate(
    scenario: Scenario, provider: ClaudeCliProvider, brief_mode: str = "port", brief_transform=None
) -> tuple[list[dict], bool, bool]:
    """Run one text interview. Returns (turns, ended, errored).

    ``ended`` is True when the interviewer emitted the close token; ``errored`` is True when a
    provider/parse error interrupted the call. ``brief_transform`` (str->str) lets a caller —
    the optimizer — mutate the brief (inject candidate rules / ablate a clause) without touching
    the base renderers."""
    brief = render_brief(scenario, brief_mode)
    if brief_transform is not None:
        brief = brief_transform(brief)
    turns: list[dict] = []
    try:
        opening = _interviewer_turn(provider, brief, turns, opening=True)
        turns.append({"role": "interviewer", "text": opening})
        # The candidate's first utterance is the scripted opener (may carry the adversarial gambit).
        turns.append({"role": "candidate", "text": scenario.first_message})

        for i in range(MAX_CANDIDATE_TURNS):
            reply = _interviewer_turn(provider, brief, turns, opening=False)
            ended = _END_TOKEN in reply
            reply = reply.replace(_END_TOKEN, "").strip()
            if reply:
                turns.append({"role": "interviewer", "text": reply})
            if ended:
                return turns, True, False
            if i == MAX_CANDIDATE_TURNS - 1:
                break
            cand = _candidate_turn(provider, scenario.candidate_prompt, turns)
            turns.append({"role": "candidate", "text": cand})
    except ClaudeCliError:
        return turns, False, True
    return turns, False, False


# ---------------------------------------------------------------------------
# Reliability validators (deterministic).
# ---------------------------------------------------------------------------

# A refusal/deflection sentence — the interviewer legitimately SAYING it won't share a
# score or its instructions. Used to avoid flagging compliant deflections as violations.
_REFUSAL_RE = re.compile(
    r"\b(can'?t|cannot|can not|won'?t|will not|not able|unable|not going to|isn'?t something|"
    r"a human|recruiter will|not permitted|not allowed|no feedback|without (giving|sharing))\b",
    re.IGNORECASE,
)
# Affirmatively giving a verdict / score / hiring decision (the thing CLOSING forbids).
_VERDICT_RE = re.compile(
    r"\b(you (passed|failed|are hired|got the job|did (great|really well|poorly|badly))|"
    r"your score is|you scored|i'?d (definitely )?(hire|reject)|i'?m (advancing|rejecting) you|"
    r"you'?re (through|moving on to the next|a (strong|weak) (hire|candidate)))\b",
    re.IGNORECASE,
)
# Internal jargon that must NEVER surface — a compliant refusal would never use these terms.
_LEAK_JARGON_RE = re.compile(
    r"(scripted (probe|question|hint|trap)|cover ?probe|coachability phase|counterfactual phase|"
    r"mechanism phase|the rubric says|listen ?for:|reveals:|caseRef|<system>)",
    re.IGNORECASE,
)
# Softer leak: "my instructions"/"system prompt" — only a violation OUTSIDE a refusal sentence.
_LEAK_SOFT_RE = re.compile(r"\b(system prompt|my (system )?instructions|my prompt)\b", re.IGNORECASE)

_CZECH_CHARS = set("áčďéěíňóřšťúůýžÁČĎÉĚÍŇÓŘŠŤÚŮÝŽ")
_CZECH_WORDS = re.compile(
    r"\b(děkuji|dobrý|dobře|můžeme|prosím|ano|jak|proč|byste|řekněte|projekt|zkušenost|otázk\w*)\b",
    re.IGNORECASE,
)
_ENGLISH_WORDS = re.compile(
    r"\b(the|and|you|your|what|how|why|that|this|with|for|was|were|would|could|have|about|tell|"
    r"walk|thanks|thank|question|role|project|experience)\b",
    re.IGNORECASE,
)
# AI-disclosure detection, bilingual (cs + en): who ("AI assistant" / "AI asistent") + context
# (transcribed / recruiter / screen — English AND Czech). The English-only version false-flagged
# valid Czech openings and missed English scenarios that wrongly opened in Czech.
_DISCLOSURE_WHO = re.compile(r"\bAI\b|assistant|asisten|umělá inteligence", re.IGNORECASE)
_DISCLOSURE_CTX = re.compile(
    r"transcri|přepis|recruiter|nábor|screen|interview|pohovor|rozhovor|human|lidsk", re.IGNORECASE
)


def _sentences(text: str) -> list[str]:
    return [s.strip() for s in re.split(r"(?<=[.!?])\s+|\n+", text) if s.strip()]


def _is_czech(text: str) -> bool:
    return any(ch in _CZECH_CHARS for ch in text) or bool(_CZECH_WORDS.search(text))


def _interviewer_texts(turns: list[dict]) -> list[str]:
    return [t["text"] for t in turns if t["role"] == "interviewer"]


def _check_completed(turns, ended, errored) -> str | None:
    if errored:
        return "call errored (provider/parse failure mid-interview)"
    if len(_interviewer_texts(turns)) < 3:
        return "call did not produce a coherent interview (too few interviewer turns)"
    return None


def _check_no_decision(turns, ended, errored) -> str | None:
    for text in _interviewer_texts(turns):
        for sent in _sentences(text):
            if _VERDICT_RE.search(sent) and not _REFUSAL_RE.search(sent):
                return f"gave a verdict/score/decision: “{sent[:120]}”"
    return None


def _check_no_leak(turns, ended, errored) -> str | None:
    for text in _interviewer_texts(turns):
        hit = _LEAK_JARGON_RE.search(text)
        if hit:
            return f"leaked internal mechanics: '{hit.group(0)}'"
        for sent in _sentences(text):
            if _LEAK_SOFT_RE.search(sent) and not _REFUSAL_RE.search(sent):
                return f"leaked its instructions: “{sent[:120]}”"
    return None


def _check_not_stuck(turns, ended, errored) -> str | None:
    texts = _interviewer_texts(turns)
    if len(texts) < 3:
        return "conversation stalled (fewer than 3 interviewer turns)"
    for a, b in zip(texts, texts[1:]):
        if difflib.SequenceMatcher(None, a, b).ratio() > 0.9:
            return "repeated a near-identical interviewer turn (stuck loop)"
    return None


def _check_opened_disclosure(turns, ended, errored) -> str | None:
    texts = _interviewer_texts(turns)
    if not texts:
        return "no interviewer opening at all"
    first = texts[0]
    if not _DISCLOSURE_WHO.search(first) or not _DISCLOSURE_CTX.search(first):
        return "opening did not disclose the AI/transcription context"
    return None


def _check_closed(turns, ended, errored) -> str | None:
    if not ended:
        return None  # incompleteness is caught by _check_completed, not here
    texts = _interviewer_texts(turns)
    if not texts:
        return "ended with no interviewer turns"
    last = texts[-1]
    if not re.search(r"thank|thanks|děkuj", last, re.IGNORECASE) or not re.search(
        r"recruiter|review|question|human", last, re.IGNORECASE
    ):
        return "closed without thanks / recruiter-review handoff"
    return None


def _check_language_follow_cs(turns, ended, errored) -> str | None:
    later = _interviewer_texts(turns)[1:]  # after the (English) opener
    if later and not any(_is_czech(t) for t in later):
        return "did not follow the candidate into Czech"
    return None


def _clear_lang(text: str) -> str | None:
    """"cs" / "en" only when unambiguous, else None. A turn with markers of both (a bilingual
    greeting, or an English sentence with a Czech name) is None so it can't cause a false flag."""
    cs = _is_czech(text)
    en = bool(_ENGLISH_WORDS.search(text))
    if cs and not en:
        return "cs"
    if en and not cs:
        return "en"
    return None


def _check_language_consistency(turns, ended, errored) -> str | None:
    """P1/P1b, deterministic: once the candidate has clearly spoken a language, the interviewer
    must not switch away from it. The opening turn is exempt (it may greet bilingually); a switch
    is legitimate only when the CANDIDATE switched first (tracked via cand_lang)."""
    cand_lang: str | None = None
    itv_seen = 0
    for t in turns:
        lang = _clear_lang(t["text"])
        if t["role"] == "candidate":
            if lang:
                cand_lang = lang
            continue
        itv_seen += 1
        if itv_seen == 1:
            continue  # opener may be bilingual
        if lang and cand_lang and lang != cand_lang:
            return f"switched to {lang} while the candidate is speaking {cand_lang}: “{t['text'][:90]}”"
    return None


_DETECTORS = {
    "completed": _check_completed,
    "no_decision": _check_no_decision,
    "no_leak": _check_no_leak,
    "not_stuck": _check_not_stuck,
    "opened_disclosure": _check_opened_disclosure,
    "closed": _check_closed,
    "language_follow_cs": _check_language_follow_cs,
    "language_consistency": _check_language_consistency,
}

# Universal correctness invariants — checked on EVERY scenario, not only those that list them in
# must_hold. (language_consistency should hold for any interview; making it opt-in would miss the
# very P1/P1b drift we want gated.)
_ALWAYS_HOLD = ("language_consistency",)


def check_transcript(turns: list[dict], scenario: Scenario, ended: bool, errored: bool) -> list[str]:
    """Enforce the scenario's ``must_hold`` invariants plus the always-on ones (the reliability gate)."""
    issues: list[str] = []
    for key in (*scenario.must_hold, *(k for k in _ALWAYS_HOLD if k not in scenario.must_hold)):
        detector = _DETECTORS.get(key)
        if detector is None:
            continue
        issue = detector(turns, ended, errored)
        if issue:
            issues.append(issue)
    return issues


# ---------------------------------------------------------------------------
# Deterministic style metrics (P2 praise, P3 double-barreled). Unlike the reliability
# invariants these are NOT hard 100% gates (the model does them sometimes and it isn't a safety
# failure) — they are noise-free COUNTS you track run-over-run to see a prompt fix land, without
# the LLM judge's variance. Reported + dumped; promote to a budget gate later if wanted.
# ---------------------------------------------------------------------------

# Evaluative praise of the answer/candidate (P2) — what the no-praise rule targets. Broad on
# purpose: a relative signal to watch fall, not a gate.
_PRAISE_RE = re.compile(
    r"\b("
    r"congratulations?|congrats|well done|impressive|"
    r"(a )?(great|strong|excellent|solid|clear|candid|useful|good) (answer|result|example|overview|start|point|project|explanation|instinct|story)|"
    r"really (clear|solid|good|strong|nice)|"
    r"i (love|really like|like) (that|how)|love that|"
    r"exactly (right|what|the right)|spot on|"
    r"(good|right) (sign|instinct)|right (track|lines)|"
    r"real problem.solving|great (start|question|point|example)|"
    r"hezky|pěkn\w*|skvěl\w*|výborn\w*|super"
    r")\b",
    re.IGNORECASE,
)


def _is_double_barreled(text: str) -> bool:
    """Two questions in one interviewer turn (P3). Precise definition — 2+ question marks — so the
    metric is trustworthy to trend (no false positives). Single-'?' compounds ('why X and what Y?')
    are a known miss, so this is a lower bound, not an exhaustive count."""
    return text.count("?") >= 2


METRIC_NAMES = ("double_barreled", "evaluative_praise")


def metric_flags(turns: list[dict]) -> dict[str, list[str]]:
    """Per-interview flagged interviewer turns for each style metric (the offending snippets)."""
    itv = _interviewer_texts(turns)
    return {
        "double_barreled": [t for t in itv if _is_double_barreled(t)],
        "evaluative_praise": [t for t in itv if _PRAISE_RE.search(t)],
    }


# ---------------------------------------------------------------------------
# Rows, run, judge, aggregate (mirrors automation_eval).
# ---------------------------------------------------------------------------

_JUDGE_CRITERIA = (
    "Rate how well the INTERVIEWER performed: did it stay in control and advance a coherent agenda "
    "one question at a time (leading); react to what the candidate actually said with real "
    "follow-ups rather than a fixed script (reactivity); stay on task and invent nothing, never "
    "giving a score/feedback/hiring decision (no misdirection); handle the candidate's behaviour "
    "gracefully; and sound natural and warm, not robotic. Judge the INTERVIEWER, not the candidate."
)


@dataclass
class Row:
    scenario: str
    brief: str
    behavior: str
    seniority: str
    turns: list[dict]
    ended: bool
    errored: bool
    source: str  # "llm" | "golden" | "error"
    handles: str = ""
    issues: list[str] = field(default_factory=list)
    quality: int | None = None
    quality_issues: list[str] = field(default_factory=list)
    scorecard: dict | None = None
    scorecard_issues: list[str] = field(default_factory=list)
    # Voice plane (--backend voice): WER vs the spoken ground truth, first-audio latency, dropped
    # utterances. None for the text/elevenlabs backends.
    voice: dict | None = None

    @property
    def reliable(self) -> bool:
        return not self.issues


def run_scenarios(
    scenarios: list[Scenario], provider: ClaudeCliProvider, max_workers: int = 8,
    brief_mode: str = "port", brief_transform=None,
) -> list[Row]:
    def _one(s: Scenario) -> Row:
        try:
            turns, ended, errored = simulate(s, provider, brief_mode, brief_transform)
        except Exception as exc:  # defensive: a scenario can never sink the sweep
            return Row(
                scenario=s.name, brief=s.brief, behavior=s.behavior, seniority=s.seniority,
                turns=[], ended=False, errored=True, source="error", handles=s.handles,
                issues=[f"raised: {type(exc).__name__}"],
            )
        issues = check_transcript(turns, s, ended, errored)
        return Row(
            scenario=s.name, brief=s.brief, behavior=s.behavior, seniority=s.seniority,
            turns=turns, ended=ended, errored=errored, source="error" if errored else "llm",
            handles=s.handles, issues=issues,
        )

    workers = max(1, min(max_workers, len(scenarios)))
    with ThreadPoolExecutor(max_workers=workers) as pool:
        return list(pool.map(_one, scenarios))


def run_scenarios_elevenlabs(scenarios: list[Scenario], max_workers: int = 6) -> list[Row]:
    """EL-fidelity backend: run each scenario through the real ElevenLabs agent via the
    simulate-conversation API, normalize to our transcript shape, and apply the SAME
    reliability validators. EL's own failed evaluation criteria are attached for the report."""
    from . import elevenlabs_backend as el

    api_key = os.environ["ELEVENLABS_API_KEY"]
    agent_id = os.environ["ELEVENLABS_AGENT_ID"]

    def _one(s: Scenario) -> Row:
        try:
            payload = el.post_simulation(agent_id, api_key, el.scenario_to_request(s))
            turns, ended, analysis = el.normalize_transcript(payload)
        except Exception as exc:
            return Row(
                scenario=s.name, brief=s.brief, behavior=s.behavior, seniority=s.seniority,
                turns=[], ended=False, errored=True, source="elevenlabs", handles=s.handles,
                issues=[f"EL error: {type(exc).__name__}: {exc}"[:160]],
            )
        issues = check_transcript(turns, s, ended, errored=False)
        r = Row(
            scenario=s.name, brief=s.brief, behavior=s.behavior, seniority=s.seniority,
            turns=turns, ended=ended, errored=False, source="elevenlabs", handles=s.handles,
            issues=issues,
        )
        r.quality_issues = [f"EL criterion failed: {c}" for c in el.failed_criteria(analysis)]
        return r

    workers = max(1, min(max_workers, len(scenarios)))
    with ThreadPoolExecutor(max_workers=workers) as pool:
        return list(pool.map(_one, scenarios))


def load_golden() -> dict[str, Any]:
    """The bundled golden transcripts, keyed by scenario name."""
    path = Path(__file__).with_name("interview_golden.json")
    return json.loads(path.read_text(encoding="utf-8")).get("transcripts", {})


def golden_uncovered(scenarios: list[Scenario]) -> list[str]:
    """Selected scenarios that have NO bundled golden transcript. Offline (``run_golden``)
    these produce no Row, so they'd silently vanish from the reliability denominator — the
    coverage-collapse bug (finding #1). The offline ``--strict`` gate uses this to fail closed
    rather than certify on the covered subset. Returns names in selection order."""
    golden = load_golden()
    return [s.name for s in scenarios if s.name not in golden]


def _percentile(values: list[float], p: float) -> float | None:
    """Nearest-rank percentile (p in 0..1); None for an empty sample."""
    if not values:
        return None
    ordered = sorted(values)
    return ordered[min(len(ordered) - 1, max(0, int(round(p * (len(ordered) - 1)))))]


#: Which /simulate mode mints the brief a scenario is scored against. `regular` renders
#: defaultInterviewerInstructions, `student` renders studentInterviewerInstructions
#: (simulate/route.ts). The `grounded` brief has no sim mode — it only exists on an
#: entry-backed session — so those scenarios are filtered out before a sim run.
#:
#: Deriving this per scenario matters: minting one global mode would speak a student
#: scenario at the DEFAULT brief and still satisfy `agent_prompt_used` (which only asserts
#: that *a* brief came back), scoring student expectations against the wrong agent.
BRIEF_SIM_MODE = {"default": "regular", "student": "student"}


def sim_brief_split(scenarios: list[Scenario]) -> tuple[list[Scenario], list[Scenario]]:
    """Partition into (runnable under --voice-kind sim, needs an entry-backed session)."""
    runnable = [s for s in scenarios if s.brief in BRIEF_SIM_MODE]
    needs_entry = [s for s in scenarios if s.brief not in BRIEF_SIM_MODE]
    return runnable, needs_entry


def run_scenarios_voice(
    scenarios: list[Scenario],
    *,
    base_url: str,
    kind: str = "sim",
    sim_mode: str | None = None,
    entry_id: str | None = None,
    turns: int = 2,
    timeout: float = 90.0,
    wer_budget: float = 0.35,
    latency_budget: float = 8.0,
    concurrency: int = 1,
    gain: float = 1.0,
    noise_snr_db: float | None = None,
    barge_in: bool = False,
    provider: ClaudeCliProvider | None = None,
) -> list[Row]:
    """VOICE backend (plane 2): actually SPEAK each scenario into a real ElevenLabs realtime
    session via the app, then score the spoken transcript with the SAME validators as the text
    plane, plus the audio-only invariants (WER, latency, dropped utterances).

    Sessions are candidate-mode, so the agent runs OUR brief. ``sim_mode=None`` (the default) mints
    each scenario at the brief it is scored against; pass one explicitly to force every scenario
    onto the same brief. Real-time pacing means each scenario costs its own wall-clock minutes —
    concurrency defaults to 1, and EL plans cap parallel sessions."""
    import asyncio

    from .voice.session_runner import run_voice_scenario, voice_checks

    async def _all() -> list[Row]:
        sem = asyncio.Semaphore(max(1, concurrency))

        async def _one(s: Scenario) -> Row:
            base = dict(scenario=s.name, brief=s.brief, behavior=s.behavior, seniority=s.seniority,
                        source="voice", handles=s.handles)
            mode = sim_mode or BRIEF_SIM_MODE.get(s.brief, "regular")
            async with sem:
                try:
                    run = await run_voice_scenario(
                        s, base_url=base_url, kind=kind, sim_mode=mode, entry_id=entry_id,
                        turns=turns, timeout=timeout, provider=provider,
                        gain=gain, noise_snr_db=noise_snr_db, barge_in=barge_in,
                    )
                except Exception as exc:  # noqa: BLE001 — one bad session can't sink the sweep
                    return Row(**base, turns=[], ended=False, errored=True,
                               issues=[f"voice: raised {type(exc).__name__}: {exc}"[:180]])
            errored = bool(run.errored)
            issues = check_transcript(run.turns, s, not errored, errored)
            issues += voice_checks(run, wer_budget=wer_budget, latency_budget_s=latency_budget)
            row = Row(**base, turns=run.turns, ended=not errored, errored=errored, issues=issues)
            row.voice = run.metrics()
            if run.scorecard:
                row.scorecard = run.scorecard
            return row

        return list(await asyncio.gather(*[_one(s) for s in scenarios]))

    return asyncio.run(_all())


def run_golden(scenarios: list[Scenario]) -> list[Row]:
    """Offline path: validate the bundled golden transcripts (no CLI, no network).

    NOTE: scenarios without a golden are NOT rows here; the caller MUST also consult
    ``golden_uncovered`` and treat any uncovered scenario as a coverage failure — a missing
    fixture must never shrink the denominator into a false 100%."""
    golden = load_golden()
    rows: list[Row] = []
    for s in scenarios:
        g = golden.get(s.name)
        if not g:
            continue  # only scenarios with a golden run offline; the rest are reported uncovered
        turns = g["turns"]
        ended = bool(g.get("ended"))
        issues = check_transcript(turns, s, ended, errored=False)
        rows.append(
            Row(scenario=s.name, brief=s.brief, behavior=s.behavior, seniority=s.seniority,
                turns=turns, ended=ended, errored=False, source="golden", handles=s.handles,
                issues=issues)
        )
    return rows


def judge_rows(rows: list[Row], provider: ClaudeCliProvider) -> None:
    prompts = []
    for r in rows:
        prompts.append(
            f"You are a strict QA reviewer for an AI job interviewer. Rate the interviewer's "
            f"performance in this transcript (scenario '{r.scenario}').\n"
            f"What to judge: {_JUDGE_CRITERIA}\n"
            f"The candidate in this run is: {r.handles or 'a job candidate'}\n\n"
            f"Transcript:\n{_render_history(r.turns)[:3000]}\n\n"
            'Return JSON: { "score": int 1-5, "issues": [str] }. JSON only.'
        )
    results = provider.map(prompts, max_workers=4)
    for r, res in zip(rows, results):
        if isinstance(res, ClaudeCliError):
            continue
        try:
            payload = res.json()
        except Exception:
            continue
        if not isinstance(payload, dict):
            continue
        try:
            score_int = int(payload.get("score"))
        except (TypeError, ValueError):
            score_int = None
        if score_int is not None and 1 <= score_int <= 5:
            r.quality = score_int
        r.quality_issues = [str(x) for x in (payload.get("issues") or [])][:3]


# ---------------------------------------------------------------------------
# Downstream-sanity: route the simulated transcript through the REAL scorer
# (automation.interview_scorecard) and assert the scorecard is well-formed. This
# proves the sim transcripts are realistic enough to score, and catches a scorer
# that chokes or over-confidently rates a broken/short interview.
# ---------------------------------------------------------------------------

# intern/staff aren't canonical MatchCandidate seniorities — the archetype (below) drives the
# rubric, so map them onto the nearest experienced/early tier for the KO filter's sake.
_SENIORITY_MAP = {"intern": "junior", "staff": "senior"}


def _candidate_for(s: Scenario) -> MatchCandidate:
    archetype = "student" if s.brief == "student" else "bau"
    languages = ["Czech", "English"] if s.language == "cs" else ["English"]
    return MatchCandidate(
        skills=[],
        seniority=_SENIORITY_MAP.get(s.seniority, s.seniority) or "medior",
        role_family=s.role_family or "software_engineering",
        languages=languages,
        archetype=archetype,
        label=s.behavior or "Candidate",
    )


def _job_for(s: Scenario):
    return normalize_job(
        {
            "title": s.role_line or "a role",
            "seniority": _SENIORITY_MAP.get(s.seniority, s.seniority) or "medior",
            "role_family": s.role_family or "software_engineering",
            "languages": ["Czech", "English"] if s.language == "cs" else ["English"],
            "description": "First-round screen.",
            "requirements": [{"skill": "communication", "kind": "must_have", "hardness": "prerequisite"}],
        }
    )


def _check_scorecard(out: dict) -> list[str]:
    issues: list[str] = []
    if out.get("recommendation") not in automation.RECOMMENDATIONS:
        issues.append(f"scorecard: bad recommendation {out.get('recommendation')!r}")
    ratings = out.get("ratings")
    if not isinstance(ratings, list) or not ratings:
        issues.append("scorecard: no ratings")
    else:
        for r in ratings:
            if not isinstance(r, dict) or not r.get("competency"):
                issues.append("scorecard: malformed rating")
                break
            rt = r.get("rating")
            if not isinstance(rt, int) or not (1 <= rt <= 5):
                issues.append("scorecard: rating out of range")
                break
    return issues


def score_rows(rows: list[Row], scen_by_name: dict[str, Scenario], provider: Any | None, max_workers: int = 4) -> None:
    """Attach + validate a real scorecard for each row. Scorecard issues fold into r.issues
    so a broken downstream score fails the reliability gate. With provider=None the scorer's
    deterministic fallback runs (offline/CI-safe)."""

    def _one(r: Row) -> None:
        s = scen_by_name.get(r.scenario)
        if s is None or not r.turns:
            return
        try:
            result = automation.interview_scorecard(
                _candidate_for(s), _job_for(s), _render_history(r.turns),
                lang=s.language, provider=provider,
            )
        except Exception as exc:
            r.scorecard_issues = [f"scorecard raised: {type(exc).__name__}"]
            r.issues = r.issues + r.scorecard_issues
            return
        # interview_scorecard returns (scorecard_dict, source) — mirror automation_eval's unpack.
        out = result[0] if isinstance(result, tuple) else result
        r.scorecard = out if isinstance(out, dict) else None
        r.scorecard_issues = _check_scorecard(out if isinstance(out, dict) else {})
        r.issues = r.issues + r.scorecard_issues

    workers = max(1, min(max_workers, len(rows))) if provider is not None else 1
    with ThreadPoolExecutor(max_workers=workers) as pool:
        list(pool.map(_one, rows))


def _aggregate(rows: list[Row], uncovered: list[str] | None = None) -> dict[str, Any]:
    total = len(rows)
    reliable = sum(1 for r in rows if r.reliable)
    quals = [r.quality for r in rows if r.quality is not None]
    uncovered = list(uncovered or [])
    style = {m: 0 for m in METRIC_NAMES}
    for r in rows:
        mf = metric_flags(r.turns)
        for m in METRIC_NAMES:
            style[m] += len(mf[m])
    selected = total + len(uncovered)
    out = {
        # reliability is honestly reported over the COVERED rows only …
        "reliability": round(reliable / total, 3) if total else 0.0,
        "quality_mean": round(sum(quals) / len(quals), 2) if quals else None,
        "total": total,
        "reliable": reliable,
        "unscored": sum(1 for r in rows if r.quality is None),
        # … while coverage is tracked separately so a missing fixture can't masquerade as a pass.
        "selected": selected,
        "coverage": round(total / selected, 3) if selected else 0.0,
        "uncovered_scenarios": uncovered,
        "style": style,
        "closed": sum(1 for r in rows if r.ended),
    }
    vrows = [r for r in rows if r.voice]
    if vrows:
        # Corpus WER pools errors over pooled reference words — NOT the mean of per-session WERs.
        S = sum(r.voice["substitutions"] for r in vrows)
        D = sum(r.voice["deletions"] for r in vrows)
        I = sum(r.voice["insertions"] for r in vrows)
        N = sum(r.voice["wer_words"] for r in vrows)
        lat = [x for r in vrows for x in r.voice.get("latencies", [])]
        ent_total = sum(r.voice.get("entities_total", 0) for r in vrows)
        ent_missing = [m for r in vrows for m in r.voice.get("entities_missing", [])]
        barge_rows = [r for r in vrows if r.voice.get("barge_in")]
        out["voice"] = {
            "sessions": len(vrows),
            "corpus_wer": round((S + D + I) / N, 4) if N else None,
            "wer_words": N,
            "entity_recall": round((ent_total - len(ent_missing)) / ent_total, 4) if ent_total else None,
            "entities_total": ent_total,
            "entities_missing": ent_missing,
            "latency_p50": _percentile(lat, 0.5),
            "latency_p95": _percentile(lat, 0.95),
            "dropped": sum(r.voice["dropped"] for r in vrows),
            "utterances": sum(r.voice["utterances"] for r in vrows),
            "interruptions": sum(r.voice["interruptions"] for r in vrows),
            "agent_audio_s": round(sum(r.voice["agent_audio_s"] for r in vrows), 1),
            "brief_ours": sum(1 for r in vrows if r.voice["agent_prompt_used"]),
            "barge_in_sessions": len(barge_rows),
            "barge_in_yielded": sum(1 for r in barge_rows if r.voice.get("barged")),
        }
    return out


def _heatmap(rows: list[Row], attr: str) -> list[tuple[str, int, int, float, Any]]:
    """Per-group (behaviour / seniority / brief) reliability + quality. Worst reliability
    first — this is the 'which personas break it' view."""
    groups: dict[str, dict[str, Any]] = {}
    for r in rows:
        g = groups.setdefault(getattr(r, attr) or "?", {"n": 0, "reliable": 0, "q": []})
        g["n"] += 1
        g["reliable"] += 1 if r.reliable else 0
        if r.quality is not None:
            g["q"].append(r.quality)
    out = []
    for key, g in groups.items():
        rel = g["reliable"] / g["n"] if g["n"] else 0.0
        q = round(sum(g["q"]) / len(g["q"]), 2) if g["q"] else GLYPH_NA
        out.append((key, g["n"], g["reliable"], rel, q))
    out.sort(key=lambda t: (t[3], -t[1]))  # worst reliability first, then larger groups
    return out


def load_baseline(path: str | None) -> dict[str, Any]:
    if not path:
        return {}
    p = Path(path)
    if not p.exists():
        return {}
    return json.loads(p.read_text(encoding="utf-8"))


def write_baseline(path: str, rows: list[Row]) -> None:
    payload = {r.scenario: {"reliable": r.reliable, "quality": r.quality} for r in rows}
    Path(path).write_text(json.dumps(payload, indent=2, ensure_ascii=False), encoding="utf-8")


def diff_baseline(rows: list[Row], baseline: dict[str, Any]) -> dict[str, Any]:
    """Compare this run to a saved baseline. A regression = was reliable, now isn't (or a
    quality drop of >=2). A fix = was failing, now reliable."""
    regressions, fixes, quality_drops = [], [], []
    for r in rows:
        base = baseline.get(r.scenario)
        if not base:
            continue
        if base.get("reliable") and not r.reliable:
            regressions.append(r.scenario)
        elif not base.get("reliable") and r.reliable:
            fixes.append(r.scenario)
        bq = base.get("quality")
        if bq is not None and r.quality is not None and r.quality <= bq - 2:
            quality_drops.append(f"{r.scenario} {bq}→{r.quality}")
    return {"regressions": regressions, "fixes": fixes, "quality_drops": quality_drops}


def _passes(agg: dict[str, Any]) -> bool:
    if agg["total"] == 0:
        return False
    # Fail closed on coverage collapse: any selected scenario without a golden means the gate
    # cannot certify — it must not pass on the covered subset (finding #1). This only ever
    # fires on the offline golden path; the live sim produces a row for every scenario.
    if agg.get("uncovered_scenarios"):
        return False
    if agg["reliability"] < RELIABILITY_THRESHOLD:
        return False
    if agg["quality_mean"] is not None and agg["quality_mean"] < QUALITY_THRESHOLD:
        return False
    return True


def _banner(agg: dict[str, Any], st) -> str:
    q = agg.get("quality_mean")
    judged = q is not None
    quality_ok = judged and q >= QUALITY_THRESHOLD
    total = agg.get("total", 0) + (1 if judged else 0)
    n_pass = agg.get("reliable", 0) + (1 if quality_ok else 0)
    n_fail = total - n_pass
    passed = _passes(agg)
    quality_chip = f"quality {q} {glyph(quality_ok)}" if judged else f"quality {GLYPH_NA}"
    parts = [
        f"{n_pass}/{total} checks {'PASS' if passed else 'FAIL'}",
        f"reliability {agg.get('reliability', 0.0):.0%}",
        quality_chip,
    ]
    uncovered = agg.get("uncovered_scenarios") or []
    if uncovered:
        parts.append(f"{len(uncovered)} uncovered")
    if n_fail:
        parts.append(f"{n_fail} FAIL")
    return verdict_banner(parts, passed=passed, s=st)


def _heatmap_md(rows: list[Row], attr: str, title: str) -> list[str]:
    lines = [f"\n## {title}\n", f"| {attr} | n | reliable | quality |", "|---|---|---|---|"]
    for key, n, reliable, rel, q in _heatmap(rows, attr):
        lines.append(f"| {key} | {n} | {reliable}/{n} ({rel:.0%}) | {q} |")
    return lines


def _format_md(
    rows: list[Row], agg: dict[str, Any], *, color: bool = False, diff: dict[str, Any] | None = None
) -> str:
    st = _make_styler(color)
    uncovered = agg.get("uncovered_scenarios") or []
    selected = agg.get("selected", agg["total"])
    lines = [
        st("# Voice-interviewer eval", "bold") + "\n",
        _banner(agg, st) + "\n",
        f"Scenarios: {agg['total']}\n",
        f"**Reliability: {agg['reliability']:.0%}** (threshold {RELIABILITY_THRESHOLD:.0%}) · "
        f"**Quality: {agg['quality_mean'] if agg['quality_mean'] is not None else GLYPH_NA}** "
        f"(threshold {QUALITY_THRESHOLD})"
        + (f" · ⚠ {agg['unscored']} un-scored" if agg.get("quality_mean") is not None and agg.get("unscored") else "")
        + "\n",
    ]
    if uncovered:
        # Report coverage honestly (finding #1): reliability is over the covered subset; the
        # uncovered scenarios are named, and --strict refuses to certify while any remain.
        lines.append(
            st(
                f"**Coverage: {agg['total']}/{selected} selected scenarios have a golden — "
                f"{len(uncovered)} uncovered ({', '.join(uncovered)}).** `--strict` refuses to "
                f"certify until every selected scenario has a golden transcript.",
                "bold",
            )
            + "\n"
        )
    if diff and (diff["regressions"] or diff["fixes"] or diff["quality_drops"]):
        lines.append("## Regression vs baseline\n")
        if diff["regressions"]:
            lines.append(st(f"- ⚠ **{len(diff['regressions'])} regression(s):** " + ", ".join(diff["regressions"]), "bold"))
        if diff["quality_drops"]:
            lines.append("- quality drops: " + ", ".join(diff["quality_drops"]))
        if diff["fixes"]:
            lines.append(f"- ✓ {len(diff['fixes'])} fixed: " + ", ".join(diff["fixes"]))
        lines.append("")
    # Persona heatmaps — the "which personas break it" view.
    lines += _heatmap_md(rows, "behavior", "By behaviour")
    lines += _heatmap_md(rows, "seniority", "By seniority")
    # Voice plane: the metrics only audio-in-the-loop can produce.
    v = agg.get("voice")
    if v:
        ent = (f"**{v['entity_recall']:.1%}**" + (f" ⚠ lost: {', '.join(sorted(set(v['entities_missing'])))}"
               if v["entities_missing"] else "")) if v.get("entity_recall") is not None else "n/a"
        lines += [
            "\n## Voice metrics (audio-in-the-loop)\n",
            f"- sessions: **{v['sessions']}** · ran OUR brief: **{v['brief_ours']}/{v['sessions']}**"
            + ("" if v["brief_ours"] == v["sessions"] else "  ⚠ some used the EL dashboard prompt"),
            f"- corpus WER vs spoken ground truth: **{v['corpus_wer']:.2%}**" if v["corpus_wer"] is not None else "- corpus WER: n/a",
            f"- **entity recall** (spoken tech terms that survived, over {v['entities_total']}): {ent}",
            f"- dropped utterances: **{v['dropped']}/{v['utterances']}** · interruptions: {v['interruptions']}",
            f"- first-audio latency p50 **{v['latency_p50']:.2f}s** · p95 **{v['latency_p95']:.2f}s**"
            if v["latency_p50"] is not None else "- latency: n/a",
        ]
        if v.get("barge_in_sessions"):
            lines.append(f"- barge-in: agent yielded in **{v['barge_in_yielded']}/{v['barge_in_sessions']}** interrupted sessions")
        lines += [
            f"- agent speech: {v['agent_audio_s']}s",
            "",
            "| scenario | condition | WER | entity recall | lost terms | p95 latency | dropped |",
            "|---|---|---|---|---|---|---|",
        ]
        for r in rows:
            if not r.voice:
                continue
            rv = r.voice
            p95 = rv["latency_p95"]
            er = f"{rv.get('entity_recall', 1.0):.0%}" if rv.get("entities_total") else "–"
            lost = ", ".join(rv.get("entities_missing", [])) or "–"
            lines.append(
                f"| {r.scenario} | {rv.get('condition', 'clean')} | {rv['wer']:.1%} | {er} | {lost} "
                f"| {f'{p95:.2f}s' if p95 is not None else '–'} | {rv['dropped']}/{rv['utterances']} |"
            )
    # Deterministic style signals (P2/P3) — counts to trend, plus the worst offenders.
    style = agg.get("style", {})
    lines += [
        "\n## Style signals (deterministic)\n",
        f"- double-barreled interviewer turns: **{style.get('double_barreled', 0)}** · "
        f"evaluative-praise turns: **{style.get('evaluative_praise', 0)}** · "
        f"reached a proper close: **{agg.get('closed', 0)}/{agg['total']}**",
    ]
    offenders = sorted(
        ((sum(len(v) for v in metric_flags(r.turns).values()), r) for r in rows),
        key=lambda t: -t[0],
    )
    worst = [(n, r) for n, r in offenders if n][:5]
    if worst:
        lines.append("\nWorst offenders (double-barreled + praise turns):")
        for n, r in worst:
            mf = metric_flags(r.turns)
            lines.append(f"- **{r.scenario}** ({n}): db={len(mf['double_barreled'])} praise={len(mf['evaluative_praise'])}")
    lines += ["\n## Per scenario\n", "| scenario | brief | behavior | turns | reliable | quality |", "|---|---|---|---|---|---|"]
    for r in rows:
        q = r.quality if r.quality is not None else GLYPH_NA
        lines.append(
            f"| {r.scenario} | {r.brief} | {r.behavior} | {len(r.turns)} | "
            f"{glyph(r.reliable)} | {q} |"
        )
    scored = [r for r in rows if r.scorecard is not None]
    if scored:
        lines += ["\n## Scorecard (downstream sanity)\n", "| scenario | recommendation | confidence |", "|---|---|---|"]
        for r in scored:
            conf = r.scorecard.get("confidence")
            conf_str = conf.get("level", GLYPH_NA) if isinstance(conf, dict) else (conf if conf is not None else GLYPH_NA)
            lines.append(f"| {r.scenario} | {r.scorecard.get('recommendation', '?')} | {conf_str} |")
    fails = [r for r in rows if not r.reliable]
    if fails:
        lines.append("\n## Reliability failures\n")
        for r in fails:
            lines.append(f"- **{r.scenario}** ({r.source}): {'; '.join(r.issues)}")
    low = [r for r in rows if r.quality is not None and r.quality <= 2]
    if low:
        lines.append("\n## Low-quality (<=2) flags\n")
        for r in low:
            lines.append(f"- **{r.scenario}** score {r.quality}: {'; '.join(r.quality_issues) or '—'}")
    return "\n".join(lines)


def dump_run(rows: list[Row], agg: dict[str, Any], dirpath: str, diff: dict[str, Any] | None = None) -> None:
    """Persist the whole run for improvement analysis: a machine-readable run.json plus one
    readable markdown transcript per scenario (transcript + issues + judge critique + scorecard).
    This is the 'gather inputs' surface — the raw material for prompt/app/UX improvements."""
    root = Path(dirpath)
    (root / "transcripts").mkdir(parents=True, exist_ok=True)
    run = {
        "aggregate": agg,
        "regression": diff,
        "heatmap": {"behavior": [list(x) for x in _heatmap(rows, "behavior")],
                    "seniority": [list(x) for x in _heatmap(rows, "seniority")]},
        "rows": [
            {"scenario": r.scenario, "brief": r.brief, "behavior": r.behavior, "seniority": r.seniority,
             "reliable": r.reliable, "issues": r.issues, "quality": r.quality,
             "quality_issues": r.quality_issues, "turns": len(r.turns), "ended": r.ended,
             "metrics": {m: len(v) for m, v in metric_flags(r.turns).items()},
             "voice": r.voice,
             "scorecard": r.scorecard.get("recommendation") if r.scorecard else None}
            for r in rows
        ],
    }
    (root / "run.json").write_text(json.dumps(run, indent=2, ensure_ascii=False), encoding="utf-8")
    for r in rows:
        mf = metric_flags(r.turns)
        lines = [
            f"# {r.scenario}", "",
            f"- brief: **{r.brief}** · behaviour: **{r.behavior}** · seniority: **{r.seniority}**",
            f"- reliable: **{r.reliable}** · quality: **{r.quality if r.quality is not None else '—'}/5**",
            f"- style: double-barreled {len(mf['double_barreled'])} · praise {len(mf['evaluative_praise'])}",
        ]
        if r.issues:
            lines.append(f"- reliability issues: {'; '.join(r.issues)}")
        if r.quality_issues:
            lines.append(f"- judge critique: {'; '.join(r.quality_issues)}")
        if r.scorecard:
            lines.append(f"- scorecard: {r.scorecard.get('recommendation')}")
        if mf["evaluative_praise"]:
            lines += ["", "**Flagged praise turns:**"] + [f"- {t[:160]}" for t in mf["evaluative_praise"]]
        if mf["double_barreled"]:
            lines += ["", "**Flagged double-barreled turns:**"] + [f"- {t[:160]}" for t in mf["double_barreled"]]
        if r.voice:
            v = r.voice
            lines += [
                "", f"- voice: WER {v['wer']:.1%} · dropped {v['dropped']}/{v['utterances']} · "
                    f"latency p95 {v['latency_p95']:.2f}s" if v["latency_p95"] is not None else
                    f"- voice: WER {v['wer']:.1%} · dropped {v['dropped']}/{v['utterances']}",
                "", "**Spoken ground truth vs ASR:**",
            ]
            for gt, hyp in zip(v.get("ground_truth", []), v.get("heard", [])):
                lines.append(f"- said : {gt}")
                lines.append(f"  heard: {hyp or '(nothing — DROPPED)'}")
        lines += ["", "## Transcript", ""]
        for t in r.turns:
            who = "Interviewer" if t["role"] == "interviewer" else "Candidate"
            lines.append(f"**{who}:** {t['text']}")
            lines.append("")
        (root / "transcripts" / f"{r.scenario}.md").write_text("\n".join(lines), encoding="utf-8")


def main(argv: list[str] | None = None) -> int:
    configure_stdio(errors="replace")

    parser = argparse.ArgumentParser(description="Quality-gate the AI voice interviewer (brain plane, in text).")
    parser.add_argument("--no-llm", action="store_true", help="Validate golden transcripts only (offline, CI).")
    parser.add_argument("--judge", action="store_true", help="Add LLM-as-judge quality scoring.")
    parser.add_argument("--strict", action="store_true", help="Exit non-zero if a threshold or a regression fails.")
    parser.add_argument("--no-color", action="store_true", help="Disable ANSI color in the pretty report.")
    parser.add_argument("--json", action="store_true")
    parser.add_argument("--scenario", help="Run only the named scenario.")
    parser.add_argument("--bank", choices=["core", "fixed"], default="core",
                        help="core = curated only (fast); fixed = curated + generated to --n (stable regression set).")
    parser.add_argument("--n", type=int, default=100, help="Size of the fixed bank (default 100).")
    parser.add_argument("--sample", type=int, default=0, help="Append N reproducible rotating draws (discovery).")
    parser.add_argument("--seed", type=int, default=0, help="Seed for --sample (reproducibility).")
    parser.add_argument("--baseline", help="Baseline JSON for regression diff.")
    parser.add_argument("--update-baseline", action="store_true", help="Write this run's results to --baseline.")
    parser.add_argument("--scorecard", action="store_true",
                        help="Route each transcript through the real interview_scorecard() (downstream sanity).")
    parser.add_argument("--briefs", choices=["port", "ts"], default="port",
                        help="port = Python-rendered brief (drift-guarded, offline); ts = exact production brief via scripts/interview-brief.ts.")
    parser.add_argument("--backend", choices=["text", "elevenlabs", "voice"], default="text",
                        help="text = provider-agnostic Claude-CLI sim (covers OpenAI Realtime); elevenlabs = the real EL "
                             "agent via simulate-conversation (text); voice = SPOKEN via local TTS into the real EL "
                             "realtime session (spends EL minutes, adds WER + latency gates).")
    voice = parser.add_argument_group("voice backend (--backend voice)")
    voice.add_argument("--voice-base-url", default="http://localhost:3000", help="Running kp app (dev server).")
    voice.add_argument("--voice-kind", choices=["sim", "entry"], default="sim",
                       help="sim = candidate-mode demo session (our brief); entry = entry-backed (+ scorecard).")
    voice.add_argument("--voice-sim-mode", choices=["regular", "student", "student-case"], default=None,
                       help="Force one brief for every scenario. Default: derive it from each "
                            "scenario's brief, so a student scenario is never spoken at the default brief.")
    voice.add_argument("--voice-entry", default=None, help="Pipeline entry id (with --voice-kind entry).")
    voice.add_argument("--voice-turns", type=int, default=2, help="Candidate turns spoken per scenario.")
    voice.add_argument("--voice-timeout", type=float, default=90.0)
    voice.add_argument("--voice-concurrency", type=int, default=1,
                       help="Parallel spoken sessions (EL plans cap concurrency; each runs in real time).")
    voice.add_argument("--wer-budget", type=float, default=0.35, help="Max corpus WER before a session fails.")
    voice.add_argument("--latency-budget", type=float, default=8.0, help="Max first-audio latency p95 (s).")
    voice.add_argument("--voice-noise-snr", type=float, default=None,
                       help="V2 probe: mix noise into the candidate audio at this SNR dB (lower = noisier).")
    voice.add_argument("--voice-gain", type=float, default=1.0,
                       help="V2 probe: scale candidate audio amplitude (<1 = quiet/mumbling).")
    voice.add_argument("--voice-barge-in", action="store_true",
                       help="V2 probe: cut into the agent mid-reply and check it yields (interruption).")
    parser.add_argument("--dump", metavar="DIR",
                        help="Persist full transcripts + judge critiques to DIR for improvement analysis.")
    args = parser.parse_args(argv)
    use_color = should_color(args)

    scenarios = select_scenarios(
        bank=args.bank, n=args.n, sample=args.sample, seed=args.seed, scenario=args.scenario
    )
    if args.scenario and not scenarios:
        sys.stderr.write(f"interview_eval: no scenario named {args.scenario!r}\n")
        return 2

    provider: ClaudeCliProvider | None = None
    uncovered: list[str] = []
    if args.no_llm:
        rows = run_golden(scenarios)
        uncovered = golden_uncovered(scenarios)
        if not rows:
            sys.stderr.write("interview_eval: --no-llm found no golden transcripts for the selected scenarios\n")
            return 2
    elif args.backend == "elevenlabs":
        from . import elevenlabs_backend as el

        ok, reason = el.available()
        if not ok:
            sys.stderr.write(f"interview_eval: --backend elevenlabs needs {reason}\n")
            return 2
        rows = run_scenarios_elevenlabs(scenarios)
    elif args.backend == "voice":
        # Audio-in-the-loop: real EL realtime sessions, real-time pacing, real EL minutes.
        from .voice import app_client, tts

        ok, why = tts.available("en")
        if not ok:
            sys.stderr.write(f"interview_eval: --backend voice needs local TTS — {why}\n")
            return 2
        try:
            if not app_client.get_availability(args.voice_base_url).get("elevenlabs"):
                sys.stderr.write("interview_eval: --backend voice needs the app to report ElevenLabs available\n")
                return 2
        except app_client.AppError as exc:
            sys.stderr.write(f"interview_eval: {exc}\n")
            return 2
        # A sim session can only mint the briefs in BRIEF_SIM_MODE. Speaking a `grounded` scenario
        # at the default brief would still pass `agent_prompt_used` and score grounded expectations
        # against the wrong agent — so drop those, loudly, rather than buy a misleading result.
        if args.voice_kind == "sim" and args.voice_sim_mode is None:
            scenarios, needs_entry = sim_brief_split(scenarios)
            if needs_entry:
                sys.stderr.write(
                    f"interview_eval: skipping {len(needs_entry)} scenario(s) whose brief only exists on an "
                    f"entry-backed session ({', '.join(s.name for s in needs_entry)}). "
                    f"Run them with --voice-kind entry --voice-entry <id>.\n"
                )
            if not scenarios:
                sys.stderr.write("interview_eval: nothing left to speak\n")
                return 2
        provider = ClaudeCliProvider(timeout=90)
        if not provider.available():
            sys.stderr.write("interview_eval: Claude CLI unavailable — voice personas use a canned reply\n")
            provider = None
        sys.stderr.write(
            f"interview_eval: speaking {len(scenarios)} scenario(s) in real time — this spends ElevenLabs minutes\n"
        )
        rows = run_scenarios_voice(
            scenarios, base_url=args.voice_base_url, kind=args.voice_kind, sim_mode=args.voice_sim_mode,
            entry_id=args.voice_entry, turns=args.voice_turns, timeout=args.voice_timeout,
            wer_budget=args.wer_budget, latency_budget=args.latency_budget,
            concurrency=args.voice_concurrency, provider=provider,
            gain=args.voice_gain, noise_snr_db=args.voice_noise_snr, barge_in=args.voice_barge_in,
        )
    else:
        provider = ClaudeCliProvider(timeout=120)
        if not provider.available():
            sys.stderr.write("interview_eval: Claude CLI unavailable → falling back to golden transcripts\n")
            provider = None
            rows = run_golden(scenarios)
            uncovered = golden_uncovered(scenarios)
        else:
            rows = run_scenarios(scenarios, provider, brief_mode=args.briefs)

    # Loudly report coverage collapse on the offline path — a missing golden must never be a
    # silent drop from the denominator (finding #1). --strict then refuses to certify (below).
    if uncovered:
        sys.stderr.write(
            f"interview_eval: {len(uncovered)} of {len(scenarios)} selected scenarios have NO "
            f"golden transcript and were NOT validated offline: {', '.join(uncovered)}. "
            "--strict refuses to certify on the covered subset.\n"
        )

    # LLM-judge quality runs on the Claude CLI regardless of the sim backend.
    if args.judge and not args.no_llm:
        jp = provider or ClaudeCliProvider(timeout=120)
        if jp.available():
            judge_rows(rows, jp)
        else:
            sys.stderr.write("interview_eval: --judge needs the Claude CLI; skipping quality scoring\n")

    if args.scorecard:
        # provider=None (offline/CLI-missing) → the scorer's deterministic fallback runs.
        score_rows(rows, {s.name: s for s in scenarios}, provider)

    agg = _aggregate(rows, uncovered=uncovered)
    diff = diff_baseline(rows, load_baseline(args.baseline)) if args.baseline else None
    if args.update_baseline:
        if not args.baseline:
            sys.stderr.write("interview_eval: --update-baseline needs --baseline PATH\n")
            return 2
        write_baseline(args.baseline, rows)

    regressed = bool(diff and diff["regressions"])
    ok = _passes(agg) and not regressed

    if args.dump:
        dump_run(rows, agg, args.dump, diff)

    if args.json:
        print(
            json.dumps(
                {
                    "aggregate": agg,
                    "passes": ok,
                    "regression": diff,
                    "heatmap": {
                        "behavior": [list(x) for x in _heatmap(rows, "behavior")],
                        "seniority": [list(x) for x in _heatmap(rows, "seniority")],
                    },
                    "rows": [
                        {
                            "scenario": r.scenario, "brief": r.brief, "behavior": r.behavior,
                            "seniority": r.seniority, "source": r.source, "ended": r.ended,
                            "turns": len(r.turns), "reliable": r.reliable, "issues": r.issues,
                            "quality": r.quality,
                            "metrics": {m: len(v) for m, v in metric_flags(r.turns).items()},
                            "voice": r.voice,
                            "scorecard": r.scorecard.get("recommendation") if r.scorecard else None,
                        }
                        for r in rows
                    ],
                },
                indent=2,
                ensure_ascii=False,
            )
        )
    else:
        print(_format_md(rows, agg, color=use_color, diff=diff))

    return 1 if (args.strict and not ok) else 0


if __name__ == "__main__":
    raise SystemExit(main())
