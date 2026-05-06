from __future__ import annotations

from pydantic import BaseModel, ConfigDict, Field
from pydantic.alias_generators import to_camel


class _Base(BaseModel):
    model_config = ConfigDict(
        populate_by_name=True,
        alias_generator=to_camel,
    )


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


class ScoreBreakdown(_Base):
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


class KeywordHit(_Base):
    keyword: str
    in_jd: int
    in_cv: int
    matched: bool


class KeywordCoverage(_Base):
    coverage_percent: int
    hits: list[KeywordHit] = Field(default_factory=list)
    missing: list[str] = Field(default_factory=list)
    over_used: list[str] = Field(default_factory=list)


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


class AnalysisMetadata(_Base):
    analysis_engine: str
    text_extractor: str
    model: str | None = None
    parsing_notes: list[str] = Field(default_factory=list)
    grounding_sources: list[str] = Field(default_factory=list)
    deterministic_evidence: DeterministicEvidence | None = None


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
