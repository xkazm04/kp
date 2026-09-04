"""The LLM-as-judge half of the eval suite — written once, read by both harnesses.

Two things used to be wrong here, and they were wrong in two places at once.

**The judge was the engine.** ``automation_eval`` generated every output with a
provider and then handed the SAME provider object the prompt "you are a strict QA
reviewer", while its module docstring claimed "an independent Claude CLI judge".
A model grading its own work is self-assessment; calling it independence in a
gate that exists to catch quality regressions is the exact success theatre the
rest of this suite refuses. :func:`resolve_judge_provider` now pins the judge to
a DIFFERENT model by default and refuses the same-model case unless the caller
passes ``--allow-same-judge``, which prints what it is doing.

**The quartet was pasted twice.** ``judge_rows`` / score-parsing / the quality
half of ``_passes`` / the quality chip in the banner existed verbatim in
``automation_eval`` and ``interview_eval``, so the fail-closed fix for "the judge
was requested but scored nothing" had to be found, and re-derived, twice. It
lives here now; both harnesses import it.

A row is anything with mutable ``quality`` (``int | None``) and ``quality_issues``
(``list[str]``) attributes — deliberately structural, so neither harness has to
import the other's ``Row``.
"""

from __future__ import annotations

import json
import sys
from dataclasses import dataclass
from typing import Any, Callable, Protocol, Sequence, TextIO

from ..claude_cli import ClaudeCliError, ClaudeCliProvider
from .runner import GLYPH_NA, glyph
from .thresholds import QUALITY_THRESHOLD

# The judge defaults to a model the engine is not using. The Claude CLI's own
# default (model=None) is whatever the operator's subscription resolves to, so
# "different object" is not evidence of independence — only a pinned, named,
# different model is.
DEFAULT_JUDGE_MODEL = "sonnet"


class SameJudgeRefused(RuntimeError):
    """The judge would be the model that produced the outputs, and nobody said that was fine."""


class Scorable(Protocol):
    quality: int | None
    quality_issues: list[str]


# ---------------------------------------------------------------------------
# Independence
# ---------------------------------------------------------------------------


def resolve_judge_provider(
    engine: ClaudeCliProvider | None,
    *,
    judge_model: str | None = None,
    allow_same: bool = False,
    timeout: int = 120,
    stream: TextIO | None = None,
) -> ClaudeCliProvider | None:
    """Return the provider that will JUDGE, never the one that generated.

    ``judge_model=None`` pins :data:`DEFAULT_JUDGE_MODEL`. Passing the engine's own
    model is refused with :class:`SameJudgeRefused` unless ``allow_same`` — and when
    it IS allowed, the concession is printed, because a run whose scores are
    self-assessment must say so in its own log rather than in this docstring.

    Returns ``None`` when the judge model is not available (the caller then fails
    the quality gate closed — see :func:`quality_state`).
    """
    out = stream if stream is not None else sys.stderr
    engine_model = getattr(engine, "model", None)
    wanted = judge_model or DEFAULT_JUDGE_MODEL

    if engine is not None and wanted == engine_model:
        if not allow_same:
            raise SameJudgeRefused(
                f"the judge model ({wanted!r}) is the model that generated these outputs. That is "
                f"self-assessment, not an independent check: pass --judge-provider with a different "
                f"model, or --allow-same-judge if you accept a self-graded run."
            )
        out.write(
            f"judge: --allow-same-judge — grading with {wanted!r}, the SAME model that produced the "
            f"outputs. These scores are SELF-ASSESSMENT, not an independent quality signal.\n"
        )
        return engine

    if engine is not None and engine_model is None and not allow_same:
        # The engine rode the CLI's unpinned default, so we cannot prove the judge is a
        # different model — only that it is a different *pin*. Say so rather than imply
        # an independence we have not established.
        out.write(
            f"judge: the engine ran on the Claude CLI's unpinned default model, so independence "
            f"here is by pin only — judging with --model {wanted}. Pin the engine's model to make "
            f"the separation provable.\n"
        )

    judge = ClaudeCliProvider(timeout=timeout, model=wanted)
    if not judge.available():
        out.write(f"judge: model {wanted!r} is unavailable — NO quality scoring was produced\n")
        return None
    return judge


# ---------------------------------------------------------------------------
# Scoring
# ---------------------------------------------------------------------------


def parse_judgement(payload: Any) -> tuple[int | None, list[str]]:
    """``(score, issues)`` from a judge reply; ``(None, [])`` for anything unusable.

    Only a real 1-5 score is accepted. The old ``int(score, 0)`` clamped a missing
    score to 1 — a fake one-star rating that dragged the mean of every run whose
    judge went quiet.
    """
    if not isinstance(payload, dict):
        return None, []
    try:
        score = int(payload.get("score"))
    except (TypeError, ValueError):
        score = None
    if score is not None and not (1 <= score <= 5):
        score = None
    issues = [str(x) for x in (payload.get("issues") or [])][:3]
    return score, issues


def apply_judgements(rows: Sequence[Scorable], results: Sequence[Any]) -> int:
    """Write parsed scores onto ``rows``; returns how many rows got a real score."""
    scored = 0
    for row, res in zip(rows, results):
        if isinstance(res, ClaudeCliError):
            continue
        try:
            payload = res.json()
        except Exception:  # noqa: BLE001 — an unparseable judge reply leaves the row un-scored, never faked
            continue
        score, issues = parse_judgement(payload)
        if score is not None:
            row.quality = score
            scored += 1
        row.quality_issues = issues
    return scored


def run_judge(
    rows: Sequence[Scorable],
    provider: ClaudeCliProvider,
    build_prompt: Callable[[Any], str],
    *,
    max_workers: int = 4,
) -> int:
    """Batch one judge prompt per row and apply the scores. Returns rows scored."""
    prompts = [build_prompt(row) for row in rows]
    if not prompts:
        return 0
    return apply_judgements(rows, provider.map(prompts, max_workers=max_workers))


JSON_CONTRACT = 'Return JSON: { "score": int 1-5, "issues": [str] }. JSON only.'


def render_output(payload: Any, *, limit: int = 1500) -> str:
    return json.dumps(payload, ensure_ascii=False)[:limit]


# ---------------------------------------------------------------------------
# The gate + the banner chip
# ---------------------------------------------------------------------------


@dataclass(frozen=True)
class QualityState:
    """How the quality axis stands for one run — the ONE reading both banners use."""

    judged: bool
    judge_missing: bool
    ok: bool
    mean: float | None

    @property
    def counted(self) -> bool:
        """Whether the quality axis contributes a check to the banner's count."""
        return self.judged or self.judge_missing

    @property
    def chip(self) -> str:
        if self.judged:
            return f"quality {self.mean} {glyph(self.ok)}"
        if self.judge_missing:
            # Requested but unavailable → a FAILED check, not an absent one.
            return f"quality {GLYPH_NA} {glyph(False)}"
        return f"quality {GLYPH_NA}"


def quality_state(quality_mean: float | None, judge_requested: bool = False, threshold: float = QUALITY_THRESHOLD) -> QualityState:
    judged = quality_mean is not None
    return QualityState(
        judged=judged,
        judge_missing=judge_requested and not judged,
        ok=judged and quality_mean >= threshold,
        mean=quality_mean,
    )


def quality_passes(quality_mean: float | None, judge_requested: bool = False, threshold: float = QUALITY_THRESHOLD) -> bool:
    """The quality half of both harnesses' ``_passes``.

    A ``--judge`` run that produced ZERO usable scores is NOT the same as "judge
    not requested": it means the judge was down or every reply was unparseable, so
    the axis is unmeasured and the gate fails closed instead of certifying on
    reliability alone (bug-ui-scan-2026-07-09).
    """
    if judge_requested and quality_mean is None:
        return False
    return quality_mean is None or quality_mean >= threshold
