"""Domain model for the Dev case-scenario extension (Phase D1).

Pydantic models on the shared ``_Base`` (camelCase alias, populate_by_name) so they
round-trip cleanly to the TS side. These are the artifacts that flow through the
lifecycle: DevNeed -> NeedAnalysis -> (CaseScenario + RoleSpec) -> Submission ->
(CommitReflection + ToolingSignal) -> CaseEvaluation -> TransferAssessment.
"""

from __future__ import annotations

from pydantic import AliasChoices, Field, model_validator

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


# Confidence scale — the EVIDENCE-strength self-rating carried by NeedAnalysis, CommitReflection
# and ToolingSignal, and PROPAGATED onward to CaseEvaluation and TransferAssessment.
#
# Each SELF-RATING artifact carries a ``confidence`` float in 0..1 that answers HOW MUCH TO
# TRUST this inference — it rates the strength of the EVIDENCE behind the artifact, not the
# quality of the candidate or the need. Read it as:
#   >= 0.7   high     — well-grounded; safe to lean on for a decision.
#   0.4..0.7 moderate — usable, but corroborate before weighting it heavily.
#   <  0.4   low      — thin / ungrounded; treat as a weak hint only.
# The deterministic fallbacks rate themselves DELIBERATELY low (they pattern-match, they do
# not reason): analyze 0.5 grounded / 0.3 ungrounded, reflect 0.3, tooling 0.2 — so a degraded
# run never looks more certain than an LLM one. The LLM path may return any value in 0..1.
#
# The final DECISION artifacts do NOT self-rate: CaseEvaluation and TransferAssessment carry a
# PROPAGATED confidence instead. An evaluation is built ENTIRELY from the reflection + tooling
# signals, so it can be no more trustworthy than its weakest input — evaluate.py sets it to the
# MIN of the upstream confidences (transfer then inherits the evaluation's). MIN, not mean, keeps
# the invariant above intact end-to-end: a high-confidence reflection can't average away a
# confidence-0.2 deterministic tooling signal, so a decision resting on degraded/fallback evidence
# is never presented as authoritatively as one from high-confidence LLM signals.
# Consumed by devcase_cli, which surfaces every step's confidence (and flags the low ones) beside
# the provenance badge.
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


class MidFlightUpdate(_Base):
    """A mid-flight requirement change revealed to the candidate DURING the session
    (LLM-era controls #5). One-shot generation is structurally impossible against a
    brief that changes at T+N minutes: the reveal lands only after ``after_minutes``
    of session age (server-decided, recorded as an observed event), and how the
    candidate ADAPTS — re-plans, revisits earlier decisions, logs the trade-off —
    becomes gradeable evidence. ``reveals`` is the internal note (what good vs poor
    adaptation looks like), never disclosed."""

    after_minutes: int = 20
    update: str = ""  # candidate-facing: the requirement change, in-world voice
    reveals: str = ""  # internal only — what adaptation quality this measures


class RubricDimension(_Base):
    name: str = ""  # framing | tooling | judgment | architecture | transfer
    label: str = ""  # human-readable name for the UI (e.g. "Problem framing")
    weight: float = 0.2
    description: str = ""


# Canonical, ORDERED rubric for the five durable capabilities — the single source of
# truth for dimension order, human labels, weights (sum to 1.0) and descriptions. design.py
# seeds CaseScenario.rubricDimensions from this; evaluate.py echoes it (annotated with the
# achieved score) into CaseEvaluation.dimensions so the UI never has to hardcode any of it.
# Descriptions are DOMAIN-NEUTRAL on purpose: this rubric grades any office role, not
# just software, so they read in the role's own terms ("real materials", "tools") rather
# than software residue ("codebase", "stack"). The dimension names/labels/weights are the
# stable contract (validated by lifecycle_eval._check_case and mirrored into DimensionScore),
# so only the descriptions were de-industry-locked.
RUBRIC_DIMENSIONS: list[dict] = [
    {"name": "framing", "label": "Problem framing", "weight": 0.2, "description": "Turns an ambiguous need into a sound plan."},
    {"name": "tooling", "label": "Tooling fluency", "weight": 0.25, "description": "Drives AI and other tools well; iterates and verifies."},
    {"name": "judgment", "label": "Judgment", "weight": 0.25, "description": "Catches AI/tooling mistakes; validates; pushes back."},
    {"name": "architecture", "label": "Architecture", "weight": 0.15, "description": "Structure and trade-offs that fit the real materials and constraints."},
    {"name": "transfer", "label": "Transfer", "weight": 0.15, "description": "Capability transfers to THIS role's tools and responsibilities."},
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
    # LLM-era controls #5 — the requirement change revealed mid-session (None on
    # cases designed before case-design v6 or when the designer judged it unfit).
    mid_flight_update: MidFlightUpdate | None = None
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
    """Scores the five durable capabilities — not lines/correctness.

    CANONICAL SCORE CONTRACT — the single authoritative representation is ``dimension_scores``.
      * ``dimension_scores`` (dict name -> 0..100) is THE source of truth for every capability
        number. Everything that needs a score reads it from here: ``evaluate.score_transfer``
        averages it, ``submission_eval`` validates/ranks on it, and the UI's legacy fallback
        reads it. There are deliberately NO per-capability scalar fields — the old
        ``structure_score`` / ``judgment_score`` / ``architecture_score`` scalars were dropped
        because they duplicated this dict and could silently diverge from it (e.g. a reviewer
        reading ``judgment_score`` vs ``dimension_scores['judgment']`` getting two numbers).
        Note there is no "structure" capability at all: the rubric's five names are
        framing/tooling/judgment/architecture/transfer (models.RUBRIC_DIMENSIONS), and the
        STRUCTURAL axis is ``architecture`` — ``structure_score`` meant nothing distinct.
      * ``dimensions`` is a DERIVED, ordered, weight-annotated MIRROR of ``dimension_scores``
        (see DimensionScore + evaluate._ordered_dimensions) — it adds canonical order + human
        label + rubric weight + description for the UI, but each row's ``score`` is, by
        contract, exactly ``dimension_scores[row.name]``. It is a pure projection, never an
        independently authored number. ``_mirror_dimension_scores`` below force-syncs it on
        every construct/validate so the two representations can never disagree.
    """

    dimension_scores: dict[str, int] = Field(default_factory=dict)
    # DERIVED ordered mirror of dimension_scores (see DimensionScore + the canonical-score
    # contract above) — what the UI reads. Each row's `score` is force-synced from
    # dimension_scores by `_mirror_dimension_scores`, so it is a projection, never its own score.
    dimensions: list[DimensionScore] = Field(default_factory=list)
    strengths: list[str] = Field(default_factory=list)
    concerns: list[str] = Field(default_factory=list)
    # Deliberate empty-state flag (serialized as `hasFindings`). True when the evaluator
    # produced any strengths/concerns, False when it intentionally produced none — so the UI
    # renders a real empty state instead of a bare em-dash bullet that reads as a render bug.
    # evaluate.py emits this on both the LLM and deterministic paths; declared here so the
    # model stays the source of truth and round-trips it (mirrors DevTypes.ts CaseEval.hasFindings).
    has_findings: bool = False
    summary: str = ""
    # Decision-confidence (0..1) PROPAGATED from the upstream evidence — NOT a self-rating. The
    # evaluation is fused ENTIRELY from the reflection + tooling signals, so it can be no more
    # trustworthy than its weakest input: evaluate.evaluate_submission sets this to the MIN of
    # those two confidences (see the shared "Confidence scale" above and evaluate._propagated_confidence).
    # MIN, not mean, is deliberate — it stops a high-confidence reflection from masking a
    # confidence-0.2 deterministic-fallback tooling signal, so an evaluation built on thin/degraded
    # evidence never looks as authoritative as one from high-confidence LLM signals. devcase_cli
    # surfaces it beside the provenance badge (and flags it when at/below LOW_CONFIDENCE).
    confidence: float = 0.0
    commit_reflection: CommitReflection | None = None
    tooling_signal: ToolingSignal | None = None
    prompt_version: str = ""

    @model_validator(mode="after")
    def _mirror_dimension_scores(self) -> "CaseEvaluation":
        """Enforce the canonical-score contract: dimension_scores is the single source of truth,
        so every ordered-mirror row whose capability is scored in the dict takes its score FROM
        the dict. This makes the two representations structurally incapable of diverging — on
        plain construction AND on model_validate of any stored/LLM-produced artifact — so the
        latent 'which number is right?' trap can't reappear. A mirror row for a capability absent
        from dimension_scores is left untouched (evaluate._ordered_dimensions already seeds it
        with the documented MISSING_DIMENSION_SCORE neutral midpoint)."""
        for d in self.dimensions:
            if d.name in self.dimension_scores:
                d.score = self.dimension_scores[d.name]
        return self


class TransferAssessment(_Base):
    """Does the demonstrated capability transfer to THIS role?"""

    transfer_score: int = 0  # 0..100
    transfers: list[str] = Field(default_factory=list)
    gaps: list[str] = Field(default_factory=list)
    # Deliberate empty-state flag (serialized as `hasTransfers`). True when at least one
    # transfer was found, False when the evaluator intentionally produced none — so the UI
    # shows a real empty state, not a stray em-dash. score_transfer emits this on both the LLM
    # and deterministic paths; declared here so the model stays the source of truth and
    # round-trips it (mirrors DevTypes.ts Transfer.hasTransfers).
    has_transfers: bool = False
    role_fit_rationale: str = ""
    # Decision-confidence (0..1) PROPAGATED from the evaluation this scores — NOT a self-rating.
    # Transfer is derived purely from the evaluation's dimension scores + summary, so it INHERITS
    # the evaluation's confidence (evaluate.score_transfer; see CaseEvaluation.confidence and the
    # "Confidence scale" above). Surfaced beside the provenance badge like the other steps.
    confidence: float = 0.0
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
