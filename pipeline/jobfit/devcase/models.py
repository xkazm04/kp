"""Domain model for the Dev case-scenario extension (Phase D1).

Pydantic models on the shared ``_Base`` (camelCase alias, populate_by_name) so they
round-trip cleanly to the TS side. These are the artifacts that flow through the
lifecycle: DevNeed -> NeedAnalysis -> (CaseScenario + RoleSpec) -> Submission ->
(CommitReflection + ToolingSignal) -> CaseEvaluation -> TransferAssessment.
"""

from __future__ import annotations

from pydantic import Field

from ..models import _Base

# --- 1. Intake -------------------------------------------------------------


class CodebaseRef(_Base):
    """A codebase the role works in — a GitHub URL or a local path."""

    kind: str = "github"  # github | local | description
    ref: str = ""  # URL, path, or prose
    label: str = ""


class DevNeed(_Base):
    """Customer intake: what they actually need a dev for."""

    id: str = ""
    title: str = ""
    stack: list[str] = Field(default_factory=list)
    responsibilities: list[str] = Field(default_factory=list)
    codebase_refs: list[CodebaseRef] = Field(default_factory=list)
    seniority_target: str = "medior"  # junior | medior | senior | lead
    role_family: str = "software_engineering"
    notes: str = ""


# --- 2. Reality reflection -------------------------------------------------


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
    confidence: float = 0.0
    prompt_version: str = ""


# --- 3. Artifacts ----------------------------------------------------------


class CoverProbe(_Base):
    """A COVERT tooling-probe baked into the case — never disclosed to the candidate.

    `reveals` is the internal note on what handling/missing this probe tells us.
    """

    id: str = ""
    kind: str = "ambiguity"  # ambiguity | legacy_trap | verification_trap | underspecified
    where: str = ""  # which task / file / requirement it lives in
    reveals: str = ""  # what a good vs naive response implies (internal only)


class RubricDimension(_Base):
    name: str = ""  # framing | tooling | judgment | architecture | transfer
    weight: float = 0.2
    description: str = ""


class CaseScenario(_Base):
    """The designed assignment, grounded in the real codebase."""

    id: str = ""
    title: str = ""
    brief: str = ""
    repo_seed: str = ""  # what code / fixture the candidate is handed
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
    confidence: float = 0.0


class ProbeOutcome(_Base):
    probe_id: str = ""
    detected: bool = False
    handled_well: bool = False
    note: str = ""


class ToolingSignal(_Base):
    """How the candidate DROVE the tools. Using tools is never a penalty."""

    fluency: float = 0.0  # 0..1
    probe_outcomes: list[ProbeOutcome] = Field(default_factory=list)
    over_reliance_flags: list[str] = Field(default_factory=list)
    evidence: list[str] = Field(default_factory=list)
    confidence: float = 0.0


class CaseEvaluation(_Base):
    """Scores the five durable capabilities — not lines/correctness."""

    structure_score: int = 0  # 0..100
    judgment_score: int = 0
    architecture_score: int = 0
    dimension_scores: dict[str, int] = Field(default_factory=dict)
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
