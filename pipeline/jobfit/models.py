from __future__ import annotations

from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field
from pydantic.alias_generators import to_camel


class _Base(BaseModel):
    model_config = ConfigDict(
        populate_by_name=True,
        alias_generator=to_camel,
    )


class Credential(_Base):
    """A professional license or certification — often the legal gate on a hire
    (RN/medical license, Series 7, OSHA card, board cert, bar admission). First-class
    so it can be surfaced, verified, and gated on, not lost in free-text (P0-4)."""
    name: str
    issuer: str = ""
    identifier: str = ""  # license/cert number, NPI, Series, PIN, …
    expiry: str = ""      # expiry / issue date if stated
    kind: str = "certification"  # license | certification


class Publication(_Base):
    """A publication or patent — the primary signal for scientific/research hires
    that otherwise has nowhere to live (P0-4)."""
    title: str
    venue: str = ""  # journal / conference / patent office
    year: str = ""
    kind: str = "publication"  # publication | patent


class CandidateProfile(_Base):
    name: str | None
    raw_text: str
    years_experience: float
    current_seniority: str
    role_family: str
    skills: list[str]
    education_level: str
    languages: list[str]
    traits: list[str]
    evidence: list[str] = Field(default_factory=list)
    # First-class non-prose signals that often decide the hire (P0-4): licenses/certs,
    # publications/patents, and portfolio/repo/profile links. Nullable so analyses
    # cached BEFORE these fields existed still validate on read (codegen → .nullish());
    # the pipeline always populates them (to [] when none), so fresh analyses carry them.
    credentials: list[Credential] | None = None
    publications: list[Publication] | None = None
    links: list[str] | None = None


class ScoreBreakdown(_Base):
    """Fit score split into a total and its five weighted components.

    Contract: ``total`` is the sum of the five components
    (experience/skills/role_seniority/education/traits), whose maxima
    25/30/23/12/10 add to exactly 100. ``_score_from_payload`` in pipeline.py
    takes the model's own ``total`` (clamped) rather than recomputing it, so a
    bad generation can return a ``total`` that disagrees with its parts. The web
    UI treats the component sum as authoritative for display and pins the score
    dial to it (see ``reconcileScoreTotal`` / the score-breakdown invariant in
    app/_lib/format.ts) so the dial can never contradict the factor breakdown.
    On the Python side ``_score_sanity_checks`` flags a divergence past
    ``SCORE_TOTAL_TOLERANCE`` into ``sanity_checks`` for manual review.
    """

    total: int
    experience: int
    skills: int
    role_seniority: int
    education: int
    traits: int


class SalaryEstimate(_Base):
    currency: str
    period: str
    minimum: int
    maximum: int
    midpoint: int
    confidence: str
    rationale: list[str]
    # Pay beyond base in the candidate's market — equity/options, bonus, commission,
    # tips, allowances, total-comp — or null/"" for base-only. Nullable so analyses
    # cached BEFORE this field existed still validate on read (codegen → .nullish()).
    structure_note: str | None = None


class MarketEvidence(_Base):
    summary: str
    suggested_minimum: int | None = None
    suggested_maximum: int | None = None
    confidence: str = "low"
    sources: list[str] = Field(default_factory=list)
    notes: list[str] = Field(default_factory=list)


class ExtractionQuality(_Base):
    pypdf_skills: int
    gemini_skills: int
    pypdf_letter_spacing_hits: int
    gemini_letter_spacing_hits: int
    pypdf_text_length: int
    gemini_text_length: int
    recommendation: str


class ExtractionComparison(_Base):
    pypdf_text: str
    gemini_text: str


class CompanyCompensationContext(_Base):
    company_type: str
    salary_effect: str
    adjustment_factor: float
    rationale: list[str] = Field(default_factory=list)


class EvidenceTrace(_Base):
    experience: list[str] = Field(default_factory=list)
    skills: list[str] = Field(default_factory=list)
    seniority: list[str] = Field(default_factory=list)
    education: list[str] = Field(default_factory=list)
    salary: list[str] = Field(default_factory=list)


class StarScaffold(_Base):
    situation: str = ""
    task: str = ""
    action: str = ""
    result: str = ""


class InterviewQuestion(_Base):
    bucket: str
    question: str
    evidence_gap: str
    star_scaffold: StarScaffold = Field(default_factory=StarScaffold)


class InterviewKit(_Base):
    summary: str
    questions: list[InterviewQuestion] = Field(default_factory=list)


# Single source of truth for a keyword's coverage state. ``over_used`` is a
# sub-state of matched (it appears in the CV, just disproportionately often), so
# such hits still count toward coverage while flagging possible keyword stuffing.
KeywordStatus = Literal["matched", "missing", "over_used"]


class KeywordHit(_Base):
    keyword: str
    in_jd: int
    in_cv: int
    matched: bool
    status: KeywordStatus


class KeywordCoverage(_Base):
    coverage_percent: int
    hits: list[KeywordHit] = Field(default_factory=list)
    missing: list[str] = Field(default_factory=list)
    over_used: list[str] = Field(default_factory=list)
    # Pre-truncation totals for the capped lists above (see the display caps in
    # ats.py), so the UI can render a "+N more" affordance and a capped list is
    # never read as the full picture. ``None`` on analyses recorded before
    # totals were tracked — treated as "unknown", so no indicator is shown.
    hits_total: int | None = None
    missing_total: int | None = None
    over_used_total: int | None = None


class JobFitResult(_Base):
    score: int
    summary: str
    matching_skills: list[str]
    missing_skills: list[str]
    seniority_alignment: str
    role_alignment: str
    salary_assessment: str
    recommendations: list[str]
    interview_talking_points: list[str] = Field(default_factory=list)
    cv_rewrite_suggestions: list[str] = Field(default_factory=list)
    must_prove_evidence: list[str] = Field(default_factory=list)
    negotiation_angle: str = ""
    recruiter_risk_flags: list[str] = Field(default_factory=list)


class DeterministicEvidence(_Base):
    detected_role_family: str
    detected_seniority: str | None = None
    anchor_band: list[int] = Field(default_factory=list)
    detected_signals: list[str] = Field(default_factory=list)
    detected_skills: list[str] = Field(default_factory=list)
    detected_company_type: str | None = None
    detected_company_modifiers: list[str] = Field(default_factory=list)


class RunCost(_Base):
    """The metered cost of the flagship LLM call that produced this analysis, so
    the saved report can show what the run actually cost (not a UI re-guess).
    ``cost_usd`` is priced from the shared MTOK_PRICES table (llm.base.price_usd),
    the SAME mechanism the usage ledger uses — an ESTIMATE (``estimated`` true),
    non-contractual, like the voice per-minute prices. ``cost_usd`` is null when
    the model isn't in the price book (visible-but-unpriced, never a silent 0)."""
    model: str | None = None
    input_tokens: int = 0
    output_tokens: int = 0
    cached_tokens: int | None = None
    cost_usd: float | None = None
    estimated: bool = True


class AnalysisMetadata(_Base):
    analysis_engine: str
    text_extractor: str
    model: str | None = None
    parsing_notes: list[str] = Field(default_factory=list)
    grounding_sources: list[str] = Field(default_factory=list)
    deterministic_evidence: DeterministicEvidence | None = None
    # Per-run metered LLM cost estimate (surfaced on the saved report). None when
    # no token usage was reported for the run.
    run_cost: RunCost | None = None


# --- Soft-signal panel (SCOR1) -------------------------------------------------
# The model classes live HERE (not in soft_signals.py, which defines the
# detectors and re-exports these) so AnalysisResult can reference SoftSignalPanel
# without the models.py -> soft_signals.py -> profile.py -> models.py cycle that
# forced v2_profile to stay an untyped dict. Keeping them on the result as a real
# model means codegen emits a typed zod schema for the panel for free.

# Signal sources, in ascending order of trust.
CV_HYPOTHESIS = "cv-hypothesis"    # an LLM/heuristic guess from document text
CV_STRUCTURAL = "cv-structural"    # a structural fact about the evidence itself
BEHAVIORAL = "behavioral"          # evidence from a work sample (devcase) — highest trust

ANTIPATTERN = "antipattern"
STRENGTH = "strength"


class SoftSignal(_Base):
    key: str
    kind: str                       # ANTIPATTERN | STRENGTH
    label: str
    detail: str = ""
    evidence: list[str] = Field(default_factory=list)
    confidence: float = 0.5         # 0..1
    source: str = CV_STRUCTURAL
    needs_confirmation: bool = True
    suggested_probe: str = ""       # an interview question / work-sample to confirm it
    probe_kind: str | None = None   # devcase covert-probe kind, when one fits


class SoftSignalPanel(_Base):
    display_name: str | None = None
    antipatterns: list[SoftSignal] = Field(default_factory=list)
    strengths: list[SoftSignal] = Field(default_factory=list)
    summary: str = ""

    def to_interview_checklist(self) -> list[str]:
        """Recruiter-facing 'what to confirm' list — the data the interview UI consumes."""
        out: list[str] = []
        for s in self.antipatterns + self.strengths:
            if s.needs_confirmation and s.suggested_probe:
                tag = "RED FLAG" if s.kind == ANTIPATTERN else "STRENGTH"
                out.append(f"[{tag}] {s.label} — {s.suggested_probe}")
        return out


class AnalysisResult(_Base):
    candidate: CandidateProfile
    score: ScoreBreakdown
    salary: SalaryEstimate
    strengths: list[str]
    gaps: list[str]
    recommendations: list[str]
    explanation: str
    sanity_checks: list[str]
    job_fit: JobFitResult | None = None
    metadata: AnalysisMetadata | None = None
    market_evidence: MarketEvidence | None = None
    extraction_quality: ExtractionQuality | None = None
    extraction_comparison: ExtractionComparison | None = None
    company_context: CompanyCompensationContext | None = None
    evidence_trace: EvidenceTrace | None = None
    interview_kit: InterviewKit | None = None
    keyword_coverage: KeywordCoverage | None = None
    # Antipattern / hidden-strength hypotheses with interview probes (SCOR1) —
    # built by soft_signals.build_soft_signal_panel as a best-effort add-on.
    soft_signals: SoftSignalPanel | None = None
    # Archetype-aware v2 profile (dict, to avoid a profile.py<->models.py import
    # cycle) — drives fair, archetype-routed matching for CV-uploaded candidates.
    v2_profile: dict[str, Any] | None = None
