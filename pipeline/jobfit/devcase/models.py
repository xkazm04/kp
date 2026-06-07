"""Domain model for the Dev case-scenario extension (Phase D1).

Pydantic models on the shared ``_Base`` (camelCase alias, populate_by_name) so they
round-trip cleanly to the TS side. These are the artifacts that flow through the
lifecycle: DevNeed -> NeedAnalysis -> (CaseScenario + RoleSpec) -> Submission ->
(CommitReflection + ToolingSignal) -> CaseEvaluation -> TransferAssessment.
"""

from __future__ import annotations

from pydantic import AliasChoices, Field

from ..models import _Base

# --- 1. Intake -------------------------------------------------------------


class CodebaseRef(_Base):
    """A codebase the role works in — a GitHub URL or a local path."""

    kind: str = "github"  # github | local | description
    ref: str = ""  # URL, path, or prose
    label: str = ""


class DevNeed(_Base):
    """Customer intake: what they actually need a dev for.

    Since the JD-first intake (the dev tab picks a saved job description instead of
    typing metadata), ``jd_text`` carries the full JD body and is the PRIMARY statement
    of the need — ``stack``/``responsibilities`` may legitimately be empty, with the
    analyze step extracting them from the JD. ``jd_slug`` records which library JD the
    need was built from ("" = ad-hoc need typed by hand)."""

    id: str = ""
    title: str = ""
    stack: list[str] = Field(default_factory=list)
    responsibilities: list[str] = Field(default_factory=list)
    codebase_refs: list[CodebaseRef] = Field(default_factory=list)
    seniority_target: str = "medior"  # junior | medior | senior | lead
    role_family: str = "software_engineering"
    notes: str = ""
    jd_slug: str = ""
    jd_text: str = ""


# --- 2. Reality reflection -------------------------------------------------


# Confidence scale — shared by NeedAnalysis, CommitReflection and ToolingSignal.
#
# Each of those artifacts carries a ``confidence`` float in 0..1 that answers HOW MUCH TO
# TRUST this inference — it rates the strength of the EVIDENCE behind the artifact, not the
# quality of the candidate or the need. Read it as:
#   >= 0.7   high     — well-grounded; safe to lean on for a decision.
#   0.4..0.7 moderate — usable, but corroborate before weighting it heavily.
#   <  0.4   low      — thin / ungrounded; treat as a weak hint only.
# The deterministic fallbacks rate themselves DELIBERATELY low (they pattern-match, they do
# not reason): analyze 0.5 grounded / 0.3 ungrounded, reflect 0.3, tooling 0.2 — so a degraded
# run never looks more certain than an LLM one. The LLM path may return any value in 0..1.
# Consumed by devcase_cli, which surfaces the low-confidence steps beside the provenance badge.
LOW_CONFIDENCE = 0.4  # at or below this, a reviewer should be warned the inference is thin


class RepoSnapshot(_Base):
    """Grounded reality pulled from a real codebase (reuses the GitHub fetch layer)."""

    ref: str = ""
    languages: dict[str, float] = Field(default_factory=dict)  # name -> share 0..1
    inferred_stack: list[str] = Field(default_factory=list)
    frameworks: list[str] = Field(default_factory=list)
    top_dirs: list[str] = Field(default_factory=list)
    recent_commit_summaries: list[str] = Field(default_factory=list)
    loc: int = 0
    readme_excerpt: str = ""


class NeedAnalysis(_Base):
    """LLM reflection of the stated need against the REAL codebase."""

    real_stack: list[str] = Field(default_factory=list)
    core_responsibilities: list[str] = Field(default_factory=list)
    stated_vs_real_gaps: list[str] = Field(default_factory=list)
    true_complexity: str = "medium"  # low | medium | high
    risk_areas: list[str] = Field(default_factory=list)
    reflection: str = ""
    confidence: float = 0.0  # 0..1 trust in this inference — see the shared "Confidence scale" above
    prompt_version: str = ""


# --- 3. Artifacts ----------------------------------------------------------


class CoverProbe(_Base):
    """A COVERT tooling-probe baked into the case — never disclosed to the candidate.

    ``reveals`` is the internal note on what a good vs naive handling (or a miss) of this
    probe tells us — it is what makes the probe a probe, so it is MANDATORY. The field
    defaults to ``""`` only so the model stays trivially constructible, but a probe that
    reaches a real case must carry a non-empty ``reveals``: ``design.coerce()`` backfills
    any LLM probe that omits it from a kind-keyed default (``design._PROBE_REVEALS_DEFAULT``),
    and ``lifecycle_eval._check_case`` flags an empty ``reveals`` as a reliability failure.
    """

    id: str = ""
    kind: str = "ambiguity"  # ambiguity | legacy_trap | verification_trap | underspecified
    where: str = ""  # which task / file / requirement it lives in
    reveals: str = ""  # REQUIRED (non-empty in a real case) — what a good vs naive response implies (internal only)
    # The 2-3 DEFENSIBLE options the ambiguity admits (each with a different trade-off).
    # This is what makes the probe an instrument in the LLM era: the submission cannot
    # avoid encoding ONE of these choices, the evaluator classifies which path was taken,
    # and mint_followups anchors an authorship question to that specific choice. Empty on
    # probes designed before the decision-space contract (case-design v4).
    decision_space: list[str] = Field(default_factory=list)


class RubricDimension(_Base):
    name: str = ""  # framing | tooling | judgment | architecture | transfer
    label: str = ""  # human-readable name for the UI (e.g. "Problem framing")
    weight: float = 0.2
    description: str = ""


# Canonical, ORDERED rubric for the five durable capabilities — the single source of
# truth for dimension order, human labels, weights (sum to 1.0) and descriptions. design.py
# seeds CaseScenario.rubricDimensions from this; evaluate.py echoes it (annotated with the
# achieved score) into CaseEvaluation.dimensions so the UI never has to hardcode any of it.
RUBRIC_DIMENSIONS: list[dict] = [
    {"name": "framing", "label": "Problem framing", "weight": 0.2, "description": "Turns an ambiguous need into a sound plan."},
    {"name": "tooling", "label": "Tooling fluency", "weight": 0.25, "description": "Drives the model/tools well; iterates and verifies."},
    {"name": "judgment", "label": "Judgment", "weight": 0.25, "description": "Catches model mistakes; validates; pushes back."},
    {"name": "architecture", "label": "Architecture", "weight": 0.15, "description": "Structure + trade-offs that fit the real codebase."},
    {"name": "transfer", "label": "Transfer", "weight": 0.15, "description": "Capability transfers to THIS role's stack/responsibilities."},
]


class CaseScenario(_Base):
    """The designed assignment, grounded in the supplied reality (a codebase for software
    roles; the role's own materials — documents, models, designs, … — for other domains)."""

    id: str = ""
    title: str = ""
    brief: str = ""
    # The starting materials handed to the candidate — domain-NEUTRAL despite the name.
    # `repoSeed` is the legacy wire name kept ONLY for back-compat round-trips (the TS side and
    # stored cases read `repoSeed`, and design.py emits it); the `startingMaterials` validation
    # alias names what the field actually holds. On input any of `repoSeed`, `startingMaterials`
    # or the snake field name is accepted; `model_dump(by_alias=True)` always emits `repoSeed`
    # so the round-trip stays unbroken. The domain contract lives in `description` below — read
    # that, NOT the name — so models.py readers stop assuming this is always a repository.
    repo_seed: str = Field(
        default="",
        validation_alias=AliasChoices("repoSeed", "startingMaterials"),
        serialization_alias="repoSeed",
        alias_priority=2,  # keep our explicit aliases; don't let _Base's to_camel overwrite them
        description=(
            "Domain-neutral starting materials handed to the candidate — NOT necessarily a "
            "repository. A codebase/repo fixture for software roles, but the role's own materials "
            "in any other domain: documents, spreadsheets, dashboards, designs, recordings, a CRM "
            "export, a financial model, a content/campaign library, etc. Named `repoSeed` for "
            "legacy reasons only; describe it in the role's own terms, not as a 'repo'."
        ),
    )
    tasks: list[str] = Field(default_factory=list)
    cover_probes: list[CoverProbe] = Field(default_factory=list)
    rubric_dimensions: list[RubricDimension] = Field(default_factory=list)
    timebox_hours: float = 4.0
    prompt_version: str = ""


class RoleSpec(_Base):
    """Bridges the need to the existing Job model."""

    title: str = ""
    seniority: str = "medior"
    role_family: str = "software_engineering"
    must_haves: list[str] = Field(default_factory=list)
    nice_to_haves: list[str] = Field(default_factory=list)
    responsibilities: list[str] = Field(default_factory=list)
    languages: list[str] = Field(default_factory=list)
    prompt_version: str = ""


# --- 4. Submission + evaluation -------------------------------------------


class Submission(_Base):
    candidate_ref: str = ""  # candidate id / label
    case_id: str = ""
    repo_ref: str = ""  # URL of the completed work
    notes: str = ""
    received_at: str = ""


class CommitReflection(_Base):
    """'Where the candidate mentally went' — inferred from the git trace. Hedged."""

    narrative: str = ""
    iteration_pattern: str = ""  # exploratory | linear | big-bang | test-driven | unclear
    dead_ends: list[str] = Field(default_factory=list)
    read_before_write: float = 0.0  # 0..1 evidence they read before generating
    verification_habits: list[str] = Field(default_factory=list)
    confidence: float = 0.0  # 0..1 trust in this inference — see the shared "Confidence scale" above


class ProbeOutcome(_Base):
    probe_id: str = ""
    # Public-safe descriptors echoed from the case's CoverProbe so a 'Probe results'
    # panel renders self-contained — never the internal `reveals`.
    kind: str = ""  # mirrors CoverProbe.kind (ambiguity | legacy_trap | verification_trap | underspecified)
    where: str = ""  # mirrors CoverProbe.where
    detected: bool = False
    handled_well: bool = False
    note: str = ""


class ToolingSignal(_Base):
    """How the candidate DROVE the tools. Using tools is never a penalty."""

    fluency: float = 0.0  # 0..1
    probe_outcomes: list[ProbeOutcome] = Field(default_factory=list)
    over_reliance_flags: list[str] = Field(default_factory=list)
    evidence: list[str] = Field(default_factory=list)
    confidence: float = 0.0  # 0..1 trust in this inference — see the shared "Confidence scale" above


class DimensionScore(_Base):
    """One self-describing row of the evaluation breakdown: the canonical rubric metadata
    (ordered) annotated with the achieved score, so the UI draws the radar/bar breakdown
    without hardcoding dimension order, human labels or weights."""

    name: str = ""  # framing | tooling | judgment | architecture | transfer
    label: str = ""  # human-readable name
    weight: float = 0.0  # rubric weight 0..1
    score: int = 0  # achieved score 0..100
    description: str = ""


class CaseEvaluation(_Base):
    """Scores the five durable capabilities — not lines/correctness."""

    dimension_scores: dict[str, int] = Field(default_factory=dict)
    # Ordered, weight-annotated mirror of dimension_scores (see DimensionScore) — what the UI reads.
    dimensions: list[DimensionScore] = Field(default_factory=list)
    strengths: list[str] = Field(default_factory=list)
    concerns: list[str] = Field(default_factory=list)
    summary: str = ""
    commit_reflection: CommitReflection | None = None
    tooling_signal: ToolingSignal | None = None
    prompt_version: str = ""


class TransferAssessment(_Base):
    """Does the demonstrated capability transfer to THIS role?"""

    transfer_score: int = 0  # 0..100
    transfers: list[str] = Field(default_factory=list)
    gaps: list[str] = Field(default_factory=list)
    role_fit_rationale: str = ""
    prompt_version: str = ""


class FollowupQuestion(_Base):
    """A candidate-specific interview probe minted AFTER evaluating their submission.

    The submission is treated as a RECORD OF DECISIONS, not proof of authorship — an LLM
    can write the code, the commit narrative and the decision log on the candidate's
    behalf, so no technical evaluation of the artifact verifies anything by itself. Each
    followup targets ONE concrete decision/assumption observed in THIS submission and is
    asked live, where delegation can't answer: ``question`` probes the why / the rejected
    alternative / the counterfactual, ``listen_for`` describes what a genuine author
    sounds like, and ``red_flag`` the answer pattern of delegated work (both internal —
    never disclosed to the candidate)."""

    id: str = ""
    probe_id: str = ""  # the cover probe / decision point it traces to ("" = general)
    decision: str = ""  # the specific observed decision/assumption being verified
    question: str = ""
    listen_for: str = ""  # internal: what a genuine author sounds like
    red_flag: str = ""  # internal: the answer pattern suggesting the decision wasn't theirs


# --- 5. Case-designed interview ---------------------------------------------


class ScenarioPhase(_Base):
    """One phase of a case-designed interview: the canonical six-phase skeleton
    (pipeline/jobfit/interview-script.json) with the case-grounded phases
    (mechanism / counterfactual / coachability) instantiated from a designed
    CaseScenario. Personal phases pass through unchanged."""

    phase: str = ""
    minutes: str = ""
    goal: str = ""
    probe: str = ""
    listen_for: str = ""
    feeds: list[str] = Field(default_factory=list)
    case_grounded: bool = False
    case_ref: str = ""  # which case element this instantiates (e.g. "tasks[0]"); "" = personal


class InterviewScenario(_Base):
    """The material for a live AI-led interview generated FROM a designed case —
    every candidate on the role hears the same caseIntro and faces the same
    instantiated probes, so ratings stay comparable. Rendered into the agent
    brief by app/_lib/student-interview.caseGroundedInterviewerInstructions."""

    case_id: str = ""
    role_title: str = ""
    case_intro: str = ""  # 1-2 minutes of narration introducing the shared material
    phases: list[ScenarioPhase] = Field(default_factory=list)
    duration_min: int = 22
    prompt_version: str = ""
