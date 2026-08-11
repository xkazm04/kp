"""Candidate -> many-jobs matching engine (Phase 3 of the v2 platform).

Three layers of increasing cost (diagram 06):

  A. KO filter   — cheap, hard gates (seniority floor, education, languages,
                   work-mode preference). Logically a DB query; over the demo
                   corpus (~150) it runs in memory.
  B. Multi-factor scorer — skills (taxonomy hierarchy + provenance-weighted),
                   career fit, personal fit -> weighted total + confidence band.
  C. LLM reasoning — added in Phase 3b on the top-N (cached per candidate x job).

The scorer is archetype-aware via :func:`weights_for`; BAU is wired now,
``early_career`` / ``career_switcher`` profiles plug in for Phases 5/7.
"""

from __future__ import annotations

import json
import math
import re
from functools import lru_cache
from pathlib import Path
from typing import Any, Literal, NamedTuple

from pydantic import Field, field_validator

from . import registry
from .jobs import Job
from .models import _Base
from .taxonomy import (
    DEFAULT_PROVENANCE,
    LANGUAGE_ALIASES,
    _one_side_fallback_score,
    normalize_text,
    provenance_weight,
    resolve_term,
    skill_match_score,
    term_match_score,
    unresolved_pair_score,
)

_SENIORITY_RANK = {"junior": 1, "medior": 2, "senior": 3, "lead": 4}
_EDU_RANK = {"none": 0, "high_school": 1, "university": 2, "bachelor": 3, "master": 4, "phd": 5}

# Language alias buckets so "Czech (native)" satisfies a "Czech" requirement. Now
# data-driven (data/taxonomy.json::language_aliases, loaded + validated in
# taxonomy.py) so a new required language is config, not a code edit here; when a
# required language has no bucket, _has_language falls back to raw matching on the
# requirement string itself.
_LANG_ALIASES = LANGUAGE_ALIASES

# Archetype scoring weights (must sum to 1.0), display labels per slot, and the
# early-career set — all sourced from the shared registry (archetypes.json) so a
# new archetype's scoring is config, and TS/Python can never disagree on which
# archetype is early-career or how its bars are weighted/labelled. For non-BAU
# profiles the "career" slot carries POTENTIAL (readiness) instead of work-history
# fit and "personal" carries motivation/domain fit — see score_job; the labels
# shift accordingly (career -> Potential, personal -> Fit).
WEIGHTS: dict[str, dict[str, float]] = registry.weights_map()
DIMENSION_LABELS: dict[str, dict[str, str]] = registry.dimension_labels_map()
_DIMENSION_KEYS = ("skills", "career", "personal")
_EARLY_CAREER = registry.early_career_archetypes()
# Per-requirement skill_match_score at/above which a requirement counts as
# "matched". 0.5 sits deliberately below 1.0 so taxonomy parent/sibling hits and
# provenance-discounted (e.g. self-declared) skills register as PARTIAL matches
# rather than misses — the matcher credits adjacent/credible skills, not just
# exact tokens. Consequently a "matched" skill at 0.5 is NOT proven hands-on
# possession; matched_skill_strength carries the per-skill score so the UI can
# distinguish a partial hit from an exact (1.0) one and recruiters don't read
# "matched: Kubernetes" as verified Kubernetes experience.
_MATCH_THRESHOLD = 0.5

# Score -> fit tier: the SINGLE SOURCE OF TRUTH for the strong/promising/partial
# banding every match surface renders (match cards, recruiter table, simulation).
# match_reasoning.py reads ``fit_tier_for`` for its verdict wording, and the tier
# rides on MatchResult so the UI bands a score exactly the way the server does —
# FitTierBadge maps the tier to its color/label/icon client-side.
FIT_STRONG_THRESHOLD = 70
FIT_PROMISING_THRESHOLD = 55

FitTier = Literal["strong", "promising", "partial"]


def fit_tier_for(total: int) -> FitTier:
    if total >= FIT_STRONG_THRESHOLD:
        return "strong"
    if total >= FIT_PROMISING_THRESHOLD:
        return "promising"
    return "partial"


class MatchCandidate(_Base):
    skills: list[str] = Field(default_factory=list)
    seniority: str = "medior"
    role_family: str = "software_engineering"
    education_level: str = "unknown"
    languages: list[str] = Field(default_factory=list)
    years_experience: float = 0.0
    traits: list[str] = Field(default_factory=list)
    summary: str = ""
    archetype: str = "bau"
    provenance_default: str = DEFAULT_PROVENANCE
    # per-skill provenance (display skill -> provenance); falls back to provenance_default.
    skill_provenance: dict[str, str] = Field(default_factory=dict)
    # readiness model output (replaces years/seniority for early-career); set by the transform.
    potential_score: float | None = None
    learning_signals: list[str] = Field(default_factory=list)
    aspirations: list[str] = Field(default_factory=list)
    # career-switcher: meta-skills mapped from a prior domain, credited at professional level.
    transferable_skills: list[str] = Field(default_factory=list)
    # career-switcher: how far the prior domain sits from the target role family
    # (transferable.domain_distance: "adjacent" | "moderate" | "far"); informs the
    # bridge narrative + potential, never a hard score multiplier.
    domain_distance: str | None = None
    # preferences (optional KO inputs)
    preferred_work_modes: list[str] = Field(default_factory=list)
    label: str = "Candidate"
    # Compact CV-derived context for the reasoning layer (Layer C) so the rationale
    # can cite a concrete, candidate-specific fact instead of generic boilerplate.
    # Populated by transform.build_match_candidate from the profile's evidence;
    # empty for inline tag-only candidates (the /api/match path).
    experience_highlights: list[str] = Field(default_factory=list)
    work_links: list[str] = Field(default_factory=list)

    @field_validator("potential_score")
    @classmethod
    def _clamp_potential_score(cls, v: float | None) -> float | None:
        """Enforce the 0-1 readiness contract at the trust boundary.

        potential_score is the only candidate-supplied SCORE dimension (it rides
        the early-career ``career`` slot verbatim in score_job). The /api/match
        inline path forwards untrusted client JSON straight into
        ``MatchCandidate.model_validate`` validating only ``limit``, so a
        ``{"potentialScore": 9}`` would push ``total`` far past 100 and corrupt
        the score dial, fit-tier banding, and matrix-cell coloring that all assume
        0-100. Clamping here (validate-on-construction covers build_match_candidate
        too) makes the contract enforced rather than assumed.
        """
        if v is None:
            return None
        return max(0.0, min(1.0, v))


class LabelCode(_Base):
    """A localizable label emitted as a stable CODE plus render params, not prose.

    The Python engine is locale-blind: it names WHICH message to show (``code``)
    and the values to interpolate (``params``), and the TS side renders the actual
    language from a next-intl catalog (the localize-python-seam pattern). Every
    surface that carries a ``LabelCode`` also keeps its legacy English string in a
    parallel field, so an older cached/stored payload without codes — or a code a
    catalog hasn't caught up to yet — still renders instead of going blank.
    """

    code: str
    params: dict[str, Any] = Field(default_factory=dict)


class ScoreDimension(_Base):
    """One row of the weight-aware score breakdown (see build_score_breakdown).

    Every number shares a single 0-100 scale so a bar chart renders with zero
    client-side math and no scale-mismatch guessing:

    * ``percent``      — how well this dimension scored, 0-100.
    * ``weight``       — its share of the total, 0-100 (the three sum to 100).
    * ``contribution`` — the points it adds to ``total`` (= percent x weight / 100;
      the three sum to ~total). This is the value a proportional bar should encode,
      so the highest-weighted, best-scoring dimension reads as visually dominant.

    ``key`` is the stable slot id (skills / career / personal); ``label`` is the
    archetype-aware English display name (see DIMENSION_LABELS); ``label_code`` is
    the locale-independent catalog slug (skills/career/personal for BAU,
    foundation/potential/fit for early-career) the UI localizes via match.dims.*,
    falling back to ``label`` when absent.
    """

    key: str
    label: str
    label_code: str = ""
    percent: int
    weight: int
    contribution: float


class Confidence(_Base):
    """Score uncertainty band plus the human reasons behind its width.

    ``level`` is a plain-language read of the band (tight / moderate / wide) and
    ``drivers`` are the specific reasons it is as wide as it is (early-career,
    thin skills, unknown education, …). The reasons used to be computed and then
    thrown away; surfacing them lets the UI explain a wide band instead of
    showing a bare number range, and stops recruiters over-reading a single
    point score.
    """

    low: int = 0
    high: int = 0
    level: str = "tight"  # tight | moderate | wide
    # Legacy English driver strings (back-compat) + their locale-independent codes.
    # The two arrays are parallel (same order/length by construction), so the UI can
    # zip them: localize driver_codes[i] via match.drivers.*, falling back to
    # drivers[i] for a code a catalog hasn't translated (or an older codeless payload).
    drivers: list[str] = Field(default_factory=list)
    driver_codes: list[LabelCode] = Field(default_factory=list)


class MatchResult(_Base):
    job_id: str
    title: str
    company: str = ""
    location: str = ""
    work_mode: str = ""
    seniority: str = ""
    role_family: str = ""
    salary_band: list[int] = Field(default_factory=list)
    total: int = 0
    # Server-computed banding so cards/recruiter/sim share one badge (see fit_tier_for).
    fit_tier: FitTier = "partial"
    skills_score: float = 0.0
    career_score: float = 0.0
    personal_score: float = 0.0
    # Normalized, weight-aware view of the three scores above so the UI charts the
    # breakdown directly (no re-multiplying by server-side weights, no 0-1 vs 0-100
    # scale guessing). See build_score_breakdown.
    score_breakdown: list[ScoreDimension] = Field(default_factory=list)
    confidence: Confidence = Field(default_factory=Confidence)
    matched_skills: list[str] = Field(default_factory=list)
    matched_skill_provenance: dict[str, str] = Field(default_factory=dict)
    # Per-matched-skill strength in [0,1]: 1.0 is an exact possession, lower
    # values are taxonomy/sibling or provenance-discounted partial hits (see
    # _MATCH_THRESHOLD). Lets the UI mark "matched" skills exact vs partial.
    matched_skill_strength: dict[str, float] = Field(default_factory=dict)
    missing_skills: list[str] = Field(default_factory=list)
    # Claimed-but-UNPROVEN skills: required skills the candidate named (or named a
    # relative of) that scored above 0 but below the match threshold — the honesty
    # boundary between a near-miss specialist and an unsubstantiated claim. ADDITIVE
    # and back-compatible: absent means none. ``unproven_skill_strength`` carries the
    # sub-threshold score; ``unproven_skill_reason`` carries WHY it fell short
    # ("adjacency" | "provenance" | "both"). These skills are, by construction,
    # neither in ``matched_skills`` nor ``missing_skills``.
    unproven_skills: list[str] = Field(default_factory=list)
    unproven_skill_strength: dict[str, float] = Field(default_factory=dict)
    unproven_skill_reason: dict[str, str] = Field(default_factory=dict)
    is_entry_eligible: bool = False
    graduate_friendliness: float = 0.0


class MatchResponse(_Base):
    candidate: dict[str, Any] = Field(default_factory=dict)
    meta: dict[str, Any] = Field(default_factory=dict)
    matches: list[MatchResult] = Field(default_factory=list)


KoReasonKey = Literal["language", "seniority", "early_career", "education", "work_mode"]


class KoReason(_Base):
    """One hard-gate failure, categorized AT BIRTH by ko_filter.

    ``key`` is the stable category rollups group by (aggregate_ko_reasons) — no
    English re-parsing downstream — and ``detail`` is the candidate-facing clause
    naming the specific value that tripped the gate. The two never need to agree
    on wording because the key alone is authoritative.
    """

    key: KoReasonKey
    detail: str


# -- Layer A: KO filter -----------------------------------------------------


def _has_language(candidate_langs: list[str], required: str) -> bool:
    req = required.strip().casefold()
    if not req:
        return True
    # LANGUAGE_ALIASES holds a fixed set of curated buckets (12 today: english,
    # czech, german, slovak, polish, hungarian, romanian, french, spanish, italian,
    # dutch, ukrainian). A required language OUTSIDE that set (e.g. "portuguese") has
    # no bucket, so ``needles`` degrades to the raw requirement string and the gate
    # passes only on a LITERAL substring match ("portuguese" in the candidate's
    # language blob) — no cross-lingual alias expansion (no "português", no "pt"). This
    # is deliberate and honest: an unmodelled language is matched on its bare name
    # rather than silently mishandled. To model a new language properly, add a bucket
    # in data/taxonomy.json::language_aliases (config, not code). Pinned by
    # test_whole_token_classification.UnmodelledLanguageFallsBackToSubstringTest.
    bucket = next((aliases for key, aliases in _LANG_ALIASES.items() if key in req or req in key), None)
    needles = bucket if bucket else (req,)
    blob = " ".join(candidate_langs).casefold()
    return any(n in blob for n in needles)


def ko_filter(candidate: MatchCandidate, job: Job) -> tuple[bool, list[KoReason]]:
    """Hard gates. Returns (passed, structured reasons-it-failed).

    Each failure is categorized at birth with a stable ``key`` (see KoReason), so
    rollups group by category directly instead of re-parsing English prose.
    """
    reasons: list[KoReason] = []
    cand_rank = _SENIORITY_RANK.get(candidate.seniority, 2)
    job_rank = _SENIORITY_RANK.get(job.seniority, 2)
    entry_ok = bool(job.entry_profile and job.entry_profile.is_entry_eligible)

    if candidate.archetype in _EARLY_CAREER:
        # Early-career: the seniority floor is REPLACED by "is the role open to
        # early-career?" (the precomputed entry lens). No seniority-gap penalty.
        if not entry_ok:
            reasons.append(KoReason(key="early_career", detail="role not open to early-career"))
    elif candidate.archetype not in WEIGHTS:
        # Unclassified archetype (e.g. a saved analysis matched without a detected
        # v2 profile, passed as "unknown"). FAIL CLOSED: never auto-KO on seniority
        # a candidate we cannot classify — the same fairness stance as the TS
        # `isFairnessProtected` gate. Scoring still uses neutral BAU weights
        # (weights_for falls back to bau); we just don't hard-gate them out of
        # senior roles on a seniority floor we can't justify for an unknown class.
        pass
    else:
        # BAU seniority floor: don't surface roles two+ levels above the candidate,
        # unless the role is explicitly open to early-career.
        if not entry_ok and (job_rank - cand_rank) >= 2:
            reasons.append(KoReason(key="seniority", detail=f"seniority gap ({candidate.seniority} candidate vs {job.seniority} role)"))

    # Minimum education (skip when the candidate's level is unknown — uncertainty).
    if job.min_education and job.min_education != "none":
        cand_edu = _EDU_RANK.get(candidate.education_level)
        if cand_edu is not None and cand_edu < _EDU_RANK.get(job.min_education, 0):
            reasons.append(KoReason(key="education", detail=f"below minimum education ({job.min_education})"))

    # Required languages (lenient: skip when the candidate lists none).
    if candidate.languages:
        for lang in job.languages:
            if not _has_language(candidate.languages, lang):
                reasons.append(KoReason(key="language", detail=f"missing required language ({lang})"))

    # Work-mode preference — only when the candidate expressed one AND the ad
    # actually STATED a work mode. A work_mode normalize_job stamped from
    # DEFAULT_POLICY (recorded in ``job.defaulted_fields``) is a PHANTOM the ad
    # never asserted; like campaign.py's ``_job_facts`` and the salary coach it is
    # treated as absent and must NEVER act as a hard gate. Otherwise a blind ad
    # that stated no mode silently KO's every remote-only candidate on an assumed
    # "onsite", removing them from the survivor pool before they are ever scored.
    if (
        candidate.preferred_work_modes
        and job.work_mode
        and "work_mode" not in job.defaulted_fields
    ):
        if job.work_mode not in candidate.preferred_work_modes:
            reasons.append(KoReason(key="work_mode", detail=f"work mode {job.work_mode} not preferred"))

    return (len(reasons) == 0, reasons)


# -- Layer B: multi-factor scorer -------------------------------------------


# Why a claimed-but-unproven skill fell short of the match threshold. ``adjacency``
# — the candidate offered a RELATED skill (taxonomy specialization / generalization
# / sibling), so even at full provenance it caps below 1.0: a near-miss specialist.
# ``provenance`` — the candidate named the EXACT skill, but its evidence source
# (self-declared / coursework …) discounted it below the bar: an unsubstantiated
# claim. ``both`` — a related skill AND weak evidence together sank it. The three
# let a recruiter tell a near-miss specialist from an unsupported claim, which the
# old single "unproven" limbo could not.
UnprovenReason = Literal["adjacency", "provenance", "both"]


def _classify_unproven(cand_skill: str, req_skill: str, provenance: str | None) -> UnprovenReason:
    """Diagnose WHY a below-threshold claim fell short: taxonomy distance
    (adjacency), a provenance discount, or both. Mirrors skill_match_score's own
    resolve-then-hierarchy / string-equality-fallback so the verdict is consistent
    with the score that produced it."""
    ct = resolve_term(cand_skill)
    rt = resolve_term(req_skill)
    if ct and rt:
        base = term_match_score(ct, rt)
    elif ct or rt:
        # Exactly one side resolves: mirror skill_match_score's one-side bounded token
        # fallback so the verdict matches the score. A below-threshold token overlap
        # (0 < base < 1) reads as "adjacency" — a modelled term vs its unmodelled
        # variant is a genuine fractional signal, not an exact-but-discounted claim.
        a = normalize_text(cand_skill or "").strip()
        b = normalize_text(req_skill or "").strip()
        if a and a == b:
            base = 1.0
        else:
            resolved_id = ct or rt
            unresolved_surface = req_skill if ct else cand_skill
            base = _one_side_fallback_score(resolved_id, unresolved_surface or "")
    else:
        # Neither side is modelled: mirror skill_match_score's graded token fallback
        # so the verdict is consistent with the score that produced it. A below-
        # threshold token overlap (0 < base < 1) reads as "adjacency" — a genuine
        # fractional signal exists, just not enough — exactly how the TS side
        # (MatchTypes.unprovenSkillReason) already renders a near-miss. Reusing the
        # existing label keeps the wire vocabulary {adjacency, provenance, both}.
        base = unresolved_pair_score(cand_skill, req_skill)
    adjacency = base < 1.0  # a related, non-exact skill (base==0 can't reach here)
    discounted = provenance_weight(provenance) < 1.0
    if adjacency and discounted:
        return "both"
    return "adjacency" if adjacency else "provenance"


def score_skills(
    candidate: MatchCandidate, job: Job
) -> tuple[float, list[str], list[str], dict[str, float], dict[str, dict[str, Any]]]:
    must_w, nice_w = 1.0, 0.4
    acc = 0.0
    total_w = 0.0
    matched: list[str] = []
    missing: list[str] = []
    strength: dict[str, float] = {}  # matched skill -> its best match score (1.0 exact, lower = partial)
    # req.skill -> {"score": float, "reason": UnprovenReason} for claims that scored
    # ABOVE zero but BELOW the match threshold (the honesty-boundary bucket).
    unproven: dict[str, dict[str, Any]] = {}
    for req in job.requirements:
        weight = must_w if req.kind == "must_have" else nice_w
        best = 0.0
        best_cs: str | None = None
        for cs in candidate.skills:
            prov = candidate.skill_provenance.get(cs, candidate.provenance_default)
            s = skill_match_score(cs, req.skill, prov)
            if s > best:
                best = s
                best_cs = cs
        acc += best * weight
        total_w += weight
        if best >= _MATCH_THRESHOLD:
            matched.append(req.skill)
            strength[req.skill] = round(best, 2)
        elif best > 0.0:
            # Claimed but UNPROVEN: the candidate DID name (or name a relative of)
            # this skill, but it scored below the partial-match threshold — a
            # self-declared exact match discounted to 0.4, an adjacent taxonomy /
            # sibling hit, or both. This is NOT absence, so it never belonged in
            # ``missing`` (which would overstate the gap and, via _confidence's
            # "Misses N must-haves", widen the band for the fairness-protected
            # early-career cohort). Surface it in its own bucket, tagged with WHY it
            # fell short, so a near-miss specialist reads differently from an
            # unsubstantiated claim. It already contributed ``best * weight`` to the
            # sub-score above, so exposing it changes no total.
            prov = candidate.skill_provenance.get(best_cs, candidate.provenance_default) if best_cs else None
            unproven[req.skill] = {
                "score": round(best, 2),
                "reason": _classify_unproven(best_cs or "", req.skill, prov),
            }
        elif req.kind == "must_have":
            # best == 0.0: no claim whatsoever to a required skill — a true miss.
            missing.append(req.skill)
    score = (acc / total_w) if total_w else 0.0
    return round(score, 4), matched, missing, strength, unproven


def score_career(candidate: MatchCandidate, job: Job) -> float:
    family = 1.0 if candidate.role_family == job.role_family else 0.35
    cand_rank = _SENIORITY_RANK.get(candidate.seniority, 2)
    job_rank = _SENIORITY_RANK.get(job.seniority, 2)
    seniority_proximity = 1.0 - abs(cand_rank - job_rank) / 3.0
    return round(0.6 * family + 0.4 * max(0.0, seniority_proximity), 4)


# Word splitter for the description-overlap heuristic: alphanumeric runs only, so
# both the description and each candidate token reduce to whole words and matching
# is never substring-based.
_WORD_RE = re.compile(r"[a-z0-9]+")


def _term_in_words(term: str, desc_words: frozenset[str] | set[str]) -> bool:
    """Whole-word containment: every alphanumeric word-part of ``term`` must appear
    as a standalone word in the description, never merely as a substring (so "Rust"
    no longer hits the "rust" inside "trust")."""
    parts = _WORD_RE.findall(term.casefold())
    return bool(parts) and all(part in desc_words for part in parts)


@lru_cache(maxsize=512)
def _description_words(description: str) -> frozenset[str]:
    """Tokenize a job description once and reuse it across candidates
    (idea-c749455b). ``score_personal`` runs once per (candidate, job) cell —
    the matrix calls it N x M times — and the regex pass over long ad text was
    its heaviest per-cell cost, recomputed identically for every candidate row.
    Keyed by the description string itself (so an edited ad re-tokenizes); the
    cache spans one CLI process, exactly the scope of a matrix/recruiter run."""
    return frozenset(_WORD_RE.findall(description.casefold()))


# Overlap-term calibration for :func:`score_personal`. ``_OVERLAP_DENOM_FLOOR`` is
# the floor of the saturation denominator (the ad's must-have count scales it up);
# ``_NEUTRAL_LANGUAGE_COVERAGE`` is the coverage imputed when an ad states no
# language requirement, so an absent language signal neither gifts nor penalizes.
_OVERLAP_DENOM_FLOOR = 5
_NEUTRAL_LANGUAGE_COVERAGE = 0.5


def _personal_embed_pair(candidate: MatchCandidate, job: Job) -> tuple[str, str]:
    """The (candidate text, job text) score_personal's semantic term embeds.

    Single-sourced so ``embedding_texts_for`` can pre-warm the exact same strings
    the scorer will look up — a drifted copy here would silently miss the cache
    and re-embed one text per candidate."""
    return " ".join(candidate.traits + candidate.skills), job.description or ""


def _motivation_embed_pair(candidate: MatchCandidate, job: Job) -> tuple[str, str] | None:
    """score_motivation's semantic pair, or None when there is no aspiration text
    to embed (the scorer skips the bridge entirely in that case)."""
    asp = " ".join(candidate.aspirations).casefold()
    if not asp.strip():
        return None
    return asp, f"{job.title or ''} {job.description or ''}"


def embedding_texts_for(candidate: MatchCandidate, job: Job) -> list[str]:
    """Every text ``score_job(..., embedder=...)`` would embed for this candidate.

    Lets a caller holding the whole pool (recruiter.rank_candidates_for_job) batch
    them into ONE provider round-trip via ``embedding_bridge.prewarm`` instead of
    paying two sequential single-item calls per candidate. Mirrors
    ``_score_dimensions``' archetype split, so it never warms a text the scorer
    won't ask for."""
    if candidate.archetype in _EARLY_CAREER:
        pair = _motivation_embed_pair(candidate, job)
        return list(pair) if pair else []
    return list(_personal_embed_pair(candidate, job))


def score_personal(candidate: MatchCandidate, job: Job, *, embedder: Any | None = None) -> float:
    """Keyword heuristic by default; the embedding bridge when opted in.

    Blends language coverage with the overlap of the candidate's traits/skills
    against the role description. The overlap TERM has two implementations:

    * default — whole-word keyword overlap (never substrings). The old length
      guard that skipped <=3-char tokens was a blunt fix for substring false
      positives (a bare ``t in desc`` made C/R/Go/AI match almost any ad); now
      that ``_term_in_words`` matches on word boundaries it is redundant AND
      discriminatory — it silently dropped legitimately short skill names
      (Go, R, C, C++, SQL, AI, k8s), the exact tokens a focused ad is built
      around. Deterministic and offline: the reproducible baseline.
    * ``embedder`` passed (the opt-in embedding bridge, recruiter_cli
      ``--embeddings``) — embedding cosine between the candidate's own words and
      the ad, so paraphrases finally meet without sharing a token. Fail-open:
      any bridge failure falls back to the keyword term.
    """
    overlap: float | None = None
    if embedder is not None:
        from .embedding_bridge import semantic_overlap

        overlap = semantic_overlap(*_personal_embed_pair(candidate, job), embedder)
    if overlap is None:
        desc_words = _description_words(job.description or "")
        # Keep every non-empty token: _term_in_words is word-boundary based, so a
        # short skill like "Go"/"C"/"SQL" only matches a STANDALONE word in the ad,
        # never a substring. Dropping the old len>3 guard restores credit for whole
        # skill families with short canonical names.
        tokens = [t for t in (candidate.traits + candidate.skills) if t]
        hits = sum(1 for t in tokens if _term_in_words(t, desc_words))
        # Saturation denominator, formerly a bare ``/5.0``: a fixed constant tied to
        # NEITHER the ad's demand nor its keyword surface, so a focused ad and a
        # keyword-dense one both maxed out at 5 hits and an 8-token overlap could
        # never out-score a 5-token one (a 5-keyword CV tied a 50-keyword one).
        # Scale it with the ad's must-have count, floored at _OVERLAP_DENOM_FLOOR to
        # preserve the prior calibration for a typical ad, so a keyword-rich role
        # genuinely separates a broad candidate from a narrow one.
        n_must_have = sum(1 for r in job.requirements if r.kind == "must_have")
        overlap = min(1.0, hits / max(_OVERLAP_DENOM_FLOOR, n_must_have))
    # Language coverage joins the blend only when the ad STATES a language
    # requirement. An ad naming none carries no language signal, so rather than the
    # old free full-credit 1.0 — a fixed 0.5 gift to `personal` on every
    # language-less role — the dimension is imputed NEUTRAL (0.5): it neither
    # rewards nor penalizes, and the overlap term drives all candidate SEPARATION
    # on such a role (the language term is then a constant across candidates).
    # (_language_coverage still returns 1.0 for score_motivation, unchanged.)
    lang_cov = _language_coverage(candidate, job) if job.languages else _NEUTRAL_LANGUAGE_COVERAGE
    return round(0.5 * lang_cov + 0.5 * overlap, 4)


def _language_coverage(candidate: MatchCandidate, job: Job) -> float:
    if not job.languages:
        return 1.0
    covered = sum(1 for lang in job.languages if _has_language(candidate.languages, lang))
    return covered / len(job.languages)


def score_motivation(candidate: MatchCandidate, job: Job, *, embedder: Any | None = None) -> float:
    """Early-career 'personal' dimension: aspirations + domain fit + language coverage.

    Replaces the BAU description-keyword heuristic — a student's fit is better
    read from whether the role matches their stated target and field than from
    keyword overlap with an experience-oriented ad. The aspiration TERM follows
    the same opt-in pattern as score_personal: title-token containment by
    default; with the embedding bridge, a cosine between the stated aspirations
    and the role's title+description ("aiming for data work" can meet an
    "Analytics Engineer" ad). Fail-open to the token heuristic.
    """
    family_hit = 1.0 if candidate.role_family == job.role_family else 0.3
    asp = " ".join(candidate.aspirations).casefold()
    title = (job.title or "").casefold()
    aspiration_hit: float | None = None
    pair = _motivation_embed_pair(candidate, job) if embedder is not None else None
    if pair is not None:
        from .embedding_bridge import semantic_overlap

        aspiration_hit = semantic_overlap(*pair, embedder)
    if aspiration_hit is None:
        asp_tokens = [t for t in asp.replace("/", " ").split() if len(t) > 3]
        aspiration_hit = 1.0 if asp_tokens and any(t in title for t in asp_tokens) else 0.0
    lang_cov = _language_coverage(candidate, job)
    return round(0.4 * family_hit + 0.35 * aspiration_hit + 0.25 * lang_cov, 4)


def weights_for(archetype: str) -> dict[str, float]:
    return WEIGHTS.get(archetype, WEIGHTS["bau"])


def dimension_labels(archetype: str) -> dict[str, str]:
    return DIMENSION_LABELS.get(archetype, DIMENSION_LABELS["bau"])


def build_score_breakdown(
    archetype: str, skills: float, career: float, personal: float, *, weights: dict[str, float] | None = None
) -> list[ScoreDimension]:
    """Project the three 0-1 dimension scores + weights into a single 0-100
    breakdown the UI can chart directly.

    ``contribution`` and ``total`` are computed from the same un-rounded inputs, so
    the contributions sum to ``total`` (modulo independent rounding of each row).
    ``weights`` overrides the archetype baseline (a resolved dynamic vector); when
    omitted the archetype's static weights are used, so the breakdown is unchanged.
    """
    w = weights or weights_for(archetype)
    labels = dimension_labels(archetype)
    scores = {"skills": skills, "career": career, "personal": personal}
    return [
        ScoreDimension(
            key=key,
            label=labels[key],
            label_code=_dim_label_code(archetype, key),
            percent=round(100 * scores[key]),
            weight=round(100 * w[key]),
            contribution=round(100 * w[key] * scores[key], 1),
        )
        for key in _DIMENSION_KEYS
    ]


# Early-career renames the three slots (career -> Potential, personal -> Fit,
# skills -> Foundation); BAU keeps the slot id. The code is the locale-independent
# catalog slug the UI localizes via match.dims.*, so the archetype-aware DISPLAY
# label is chosen language-side, not hard-coded English in the payload.
_DIM_SLUG_EARLY = {"skills": "foundation", "career": "potential", "personal": "fit"}


def _dim_label_code(archetype: str, key: str) -> str:
    return _DIM_SLUG_EARLY[key] if archetype in _EARLY_CAREER else key


# --- Dynamic weighting (bounded; hybrid + fairness-matrix) -----------------
# Per-candidate weights let demonstrated, role-relevant skill evidence count for
# more for the candidate who actually has it — a student with a relevant part-time
# job (or an observed live-case skill) vs a peer without. To stay fair and
# comparable the weights are BOUNDED: a proposal may move each slot at most
# _WEIGHT_MAX_DELTA from the archetype baseline and never past _WEIGHT_FLOOR /
# _WEIGHT_CEIL, so one strong signal can neither erase a dimension nor let it
# dominate. The deterministic propose_weights below (and, later, an LLM proposer)
# feed resolve_weights, which enforces the bounds. score_job applies a resolved
# vector ONLY when one is passed in, so default scoring is byte-identical to before;
# cross-candidate comparison of differently-weighted candidates uses fairness_matrix.
_WEIGHT_MAX_DELTA = 0.15
_WEIGHT_FLOOR = 0.10
_WEIGHT_CEIL = 0.60


def weight_bounds(archetype: str) -> dict[str, tuple[float, float]]:
    """Allowed [min, max] for each slot: a band around the archetype baseline,
    clamped to the absolute floor/ceiling."""
    base = weights_for(archetype)
    return {
        k: (
            max(_WEIGHT_FLOOR, round(base[k] - _WEIGHT_MAX_DELTA, 4)),
            min(_WEIGHT_CEIL, round(base[k] + _WEIGHT_MAX_DELTA, 4)),
        )
        for k in _DIMENSION_KEYS
    }


def resolve_weights(archetype: str, proposed: dict[str, float] | None = None) -> dict[str, float]:
    """Enforce the contract on a proposed weight vector: clamp each slot to its
    bounds, then make it sum to 1.0 by pushing the residual onto slots that still
    have headroom in the needed direction — so the result both sums to 1 AND stays
    inside the bounds (a plain clamp-then-divide can renormalize a slot back past
    its ceiling). Returns the archetype baseline unchanged when no proposal is
    given, so default scoring is identical to before; idempotent on a resolved
    vector."""
    base = weights_for(archetype)
    if not proposed:
        return dict(base)
    bounds = weight_bounds(archetype)
    w = {k: min(bounds[k][1], max(bounds[k][0], float(proposed.get(k, base[k])))) for k in _DIMENSION_KEYS}
    for _ in range(8):  # bounded simplex projection; converges in a couple passes for 3 slots
        residual = round(1.0 - sum(w.values()), 6)
        if abs(residual) < 1e-6:
            break
        # add weight -> slots below their ceiling; remove weight -> slots above their floor
        headroom = {
            k: (bounds[k][1] - w[k]) if residual > 0 else (w[k] - bounds[k][0])
            for k in _DIMENSION_KEYS
        }
        total_head = sum(h for h in headroom.values() if h > 0)
        if total_head <= 1e-9:
            break
        for k in _DIMENSION_KEYS:
            if headroom[k] > 0:
                w[k] += residual * (headroom[k] / total_head)
    return {k: round(w[k], 4) for k in _DIMENSION_KEYS}


def propose_weights(candidate: MatchCandidate, job: Job) -> tuple[dict[str, float], list[str]]:
    """Deterministic, relevance-driven weight proposal — the fallback an LLM
    proposer will later refine. Shifts weight toward demonstrated skill when the
    candidate backs the role's must-haves with HIGH-TRUST evidence (observed /
    professional / internship / open-source), so a student with a relevant
    part-time job or an observed live-case skill is scored more on proven ability
    and less on the potential prior. Returns the (pre-bounds) vector + reasons;
    resolve_weights enforces the bounds afterwards."""
    base = dict(weights_for(candidate.archetype))
    notes: list[str] = []
    musts = [r.skill for r in job.requirements if r.kind == "must_have"]
    high_trust = {"observed", "professional", "internship", "open_source"}
    relevant_strong = [
        s
        for s in candidate.skills
        if candidate.skill_provenance.get(s, candidate.provenance_default) in high_trust
        and any(skill_match_score(s, m, "professional") >= _MATCH_THRESHOLD for m in musts)
    ]
    if relevant_strong:
        bump = min(0.12, round(0.04 * len(relevant_strong), 4))
        base["skills"] += bump
        base["career"] -= bump / 2
        base["personal"] -= bump / 2
        notes.append(
            f"{len(relevant_strong)} must-have skill(s) backed by high-trust evidence "
            "— weighting demonstrated skill higher"
        )
    else:
        # Always give the proposal an auditable reason — a silent empty list read
        # as "no rationale" everywhere it surfaced (fairness matrix, the LLM
        # proposer's per-candidate backfill, the 2026-08-11 bench).
        notes.append(
            f"Baseline {candidate.archetype} weights kept — no high-trust must-have "
            "evidence to shift on"
        )
    return base, notes


# Band-width labels keyed off the total spread. The base spread is 4 and each
# driver adds 4-6, so a "wide" band always carries >=2 drivers and "moderate"
# carries >=1 — the label and the reasons stay in sync.
_BAND_MODERATE_AT = 8
_BAND_WIDE_AT = 12


def _confidence(candidate: MatchCandidate, total: int, missing_musts: list[str]) -> Confidence:
    """Honest score band + the specific reasons it is wide.

    Each uncertainty source both widens the band and records a recruiter-readable
    driver, so the UI can explain *why* a score is uncertain rather than leaving
    a bare ``low–high`` range to be misread.
    """
    spread = 4
    drivers: list[str] = []
    driver_codes: list[LabelCode] = []

    def add(text: str, code: str, **params: Any) -> None:
        drivers.append(text)
        driver_codes.append(LabelCode(code=code, params=params))

    has_observed = any(p == "observed" for p in candidate.skill_provenance.values())
    if candidate.archetype in _EARLY_CAREER:
        if has_observed:
            # Directly observed skills (live case / interview) de-risk the thin
            # paper trail — the early-career band stays tighter than a CV-only one.
            spread += 2
            add("Early-career, but some skills were directly observed (live case/interview)", "earlyCareerObserved")
        else:
            spread += 6  # thinner, less-verifiable evidence -> wider honest band
            add("Early-career: thinner, less-verifiable track record", "earlyCareerThin")
    if len(candidate.skills) < 3:
        spread += 6
        add("Fewer than 3 skills listed", "fewSkills")
    if candidate.education_level == "unknown":
        spread += 4
        add("Education level unknown", "eduUnknown")
    if not candidate.languages:
        spread += 4
        add("No languages listed", "noLanguages")
    if len(missing_musts) > 2:
        spread += 5
        add(f"Misses {len(missing_musts)} must-have skills", "missesMusts", count=len(missing_musts))
    level = "wide" if spread >= _BAND_WIDE_AT else "moderate" if spread >= _BAND_MODERATE_AT else "tight"
    return Confidence(
        low=max(0, total - spread),
        high=min(100, total + spread),
        level=level,
        drivers=drivers,
        driver_codes=driver_codes,
    )


class _Dimensions(NamedTuple):
    """The three scheme-INDEPENDENT dimension scores + the skill breakdown lists.

    Extracted so the weight-independent work (score_skills/career/personal — the
    expensive part) is computed once per (candidate, job) and reused across every
    weight scheme, instead of being recomputed inside the fairness matrix's O(n^2)
    cells. See :func:`_weighted_total` for the cheap weight combination step.
    """

    skills: float
    career: float
    personal: float
    matched: list[str]
    missing: list[str]
    matched_strength: dict[str, float]
    unproven: dict[str, dict[str, Any]]


def _score_dimensions(candidate: MatchCandidate, job: Job, *, embedder: Any | None = None) -> _Dimensions:
    skills, matched, missing, matched_strength, unproven = score_skills(candidate, job)
    if candidate.archetype in _EARLY_CAREER:
        # career slot carries POTENTIAL (readiness); personal carries motivation/domain fit.
        career = candidate.potential_score if candidate.potential_score is not None else score_career(candidate, job)
        # potential_score is validated to [0,1] only at the Pydantic boundary; a candidate
        # built outside it (model_construct / direct field set) could overflow the career
        # bar (and a NaN would slip past the headline min/max). Clamp defensively here so
        # every dimension is in-contract before it reaches the weighted total + breakdown.
        career = max(0.0, min(1.0, career)) if math.isfinite(career) else 0.0
        personal = score_motivation(candidate, job, embedder=embedder)
    else:
        career = score_career(candidate, job)
        personal = score_personal(candidate, job, embedder=embedder)
    return _Dimensions(skills, career, personal, matched, missing, matched_strength, unproven)


def _weighted_total(skills: float, career: float, personal: float, weights: dict[str, float]) -> int:
    # Clamp the headline to the 0-100 contract every downstream surface (score dial,
    # fit-tier banding, matrix coloring) assumes. With dimensions already in [0,1]
    # this is a no-op; it's the belt-and-suspenders guard against a future
    # out-of-range dimension or a misbehaving readiness model.
    return max(0, min(100, round(100 * (weights["skills"] * skills + weights["career"] * career + weights["personal"] * personal))))


def score_job(
    candidate: MatchCandidate,
    job: Job,
    *,
    weights: dict[str, float] | None = None,
    embedder: Any | None = None,
) -> MatchResult:
    dims = _score_dimensions(candidate, job, embedder=embedder)
    skills, career, personal = dims.skills, dims.career, dims.personal
    matched, missing, matched_strength = dims.matched, dims.missing, dims.matched_strength
    unproven = dims.unproven
    # `weights` is an optional resolved dynamic vector; default = archetype static
    # weights, so passing nothing reproduces the prior score exactly.
    w = weights or weights_for(candidate.archetype)
    total = _weighted_total(skills, career, personal, w)
    breakdown = build_score_breakdown(candidate.archetype, skills, career, personal, weights=w)
    tier = fit_tier_for(total)
    ep = job.entry_profile
    return MatchResult(
        job_id=job.id,
        title=job.title,
        company=job.company,
        location=job.location,
        work_mode=job.work_mode,
        seniority=job.seniority,
        role_family=job.role_family,
        salary_band=job.salary_band,
        total=total,
        fit_tier=tier,
        skills_score=skills,
        career_score=career,
        personal_score=personal,
        score_breakdown=breakdown,
        confidence=_confidence(candidate, total, missing),
        matched_skills=matched,
        # DISPLAY provenance — deliberately NOT `provenance_default` (UAT RECON-02).
        # provenance_default is "professional" for every BAU candidate, so falling
        # back to it here tagged a skill the candidate merely LISTED with the
        # joint-highest trust tier, which the recruiter surfaces then rendered as a
        # confident PROFESSIONAL badge: an affirmative claim of verification that was
        # never performed. The honest fallback is `self_declared` — precisely what
        # every consumer already assumes for a skill missing from this map
        # (`prov[s] ?? "self_declared"` in RecruiterCandidates / AnalysisSummaryModal /
        # ComparisonCells), so Python now agrees with the UI instead of contradicting it.
        #
        # SCORING IS UNAFFECTED and must stay that way: score_skills and the dynamic
        # high-trust weighting read `candidate.skill_provenance` + `provenance_default`
        # directly, never this field. Whether an unevidenced claim should also be
        # DISCOUNTED in the score is a separate, score-moving decision.
        matched_skill_provenance={
            s: candidate.skill_provenance.get(s, "self_declared") for s in matched
        },
        matched_skill_strength=matched_strength,
        missing_skills=missing,
        unproven_skills=list(unproven.keys()),
        unproven_skill_strength={k: v["score"] for k, v in unproven.items()},
        unproven_skill_reason={k: v["reason"] for k, v in unproven.items()},
        is_entry_eligible=bool(ep and ep.is_entry_eligible),
        graduate_friendliness=ep.graduate_friendliness if ep else 0.0,
    )


def fairness_matrix(pairs: list[tuple[MatchCandidate, dict[str, float] | None]], job: Job) -> dict:
    """Rank a pool whose candidates may carry DIFFERENT (bounded) weight vectors.

    A single weighted scalar drawn from different yardsticks isn't comparable, so
    instead of trusting each candidate's score under their own weights we score
    every candidate under EVERY candidate's scheme and rank by the mean — a
    candidate who stays strong under everyone's weights is robustly strong, not
    just flattered by their own. ``own`` is each candidate's score under their own
    scheme (the matrix diagonal). Each input weight vector is run through
    resolve_weights, so callers may pass raw proposals."""
    schemes = [resolve_weights(c.archetype, w) for c, w in pairs]
    labels = [c.label for c, _w in pairs]
    # Each candidate's dimension scores are scheme-INDEPENDENT, so compute them once
    # per candidate (n calls) and combine with every scheme's weights (n^2 cheap
    # multiply-adds) — instead of the old n^2 full score_job calls that recomputed
    # the expensive skills/career/personal pass once per (candidate, scheme). The
    # per-cell value is byte-identical: score_job derives .total via the same
    # _score_dimensions + _weighted_total helpers.
    dims = [_score_dimensions(c, job) for c, _w in pairs]
    matrix = [
        [_weighted_total(d.skills, d.career, d.personal, scheme) for scheme in schemes]
        for d in dims
    ]
    own = [matrix[i][i] for i in range(len(pairs))]
    mean = [round(sum(row) / len(row)) for row in matrix] if pairs else []
    order = sorted(range(len(pairs)), key=lambda i: mean[i], reverse=True)
    return {
        "labels": labels,
        "schemes": schemes,
        "matrix": matrix,
        "own": own,
        "mean": mean,
        "ranking": [labels[i] for i in order],
    }


def _candidate_assumption_pairs(candidate: MatchCandidate) -> list[tuple[str, LabelCode]]:
    """The single source for candidate assumptions: each is an English string (the
    legacy/back-compat form) paired with its locale-independent code (match.assumptions.*).
    candidate_assumptions returns the strings; candidate_assumption_codes returns the
    codes — same order, so the UI can zip them and fall back string->code cleanly."""
    out: list[tuple[str, LabelCode]] = []

    def add(text: str, code: str) -> None:
        out.append((text, LabelCode(code=code)))

    if candidate.education_level == "unknown":
        add("Education level unknown — not penalized (absence of evidence, not a fail).", "eduUnknown")
    if not candidate.languages:
        add("No languages listed — language KO skipped rather than failed.", "noLanguages")
    if candidate.archetype in _EARLY_CAREER:
        add("Early-career: potential replaces years of experience; only entry-eligible roles are considered.", "earlyCareer")
        if "self_declared" in set(candidate.skill_provenance.values()):
            add("Some skills are self-declared — discounted; validate them in interview.", "selfDeclared")
    if any(p == "observed" for p in candidate.skill_provenance.values()):
        add("Some skills were directly observed (live case / interview) — high-confidence, not self-reported.", "observed")
    if len(candidate.skills) < 3:
        add("Thin skill profile — scores carry a wide confidence band.", "thinProfile")
    return out


def candidate_assumptions(candidate: MatchCandidate) -> list[str]:
    """Imputations / uncertainties the recruiter should see to judge a score fairly."""
    return [text for text, _ in _candidate_assumption_pairs(candidate)]


def candidate_assumption_codes(candidate: MatchCandidate) -> list[LabelCode]:
    """The assumptions as locale-independent codes (match.assumptions.*), parallel
    to candidate_assumptions so the UI localizes language-side with a string fallback."""
    return [code for _, code in _candidate_assumption_pairs(candidate)]


# Candidate-facing clause shown after "{n} role(s)" for each KO category. The
# category KEY is recorded at birth by ko_filter (KoReason.key) — no English
# re-parsing — so this map is purely presentation. Declaration order is the
# tie-break when counts are equal; the count drives the real ranking.
_KO_REASON_CLAUSES: tuple[tuple[KoReasonKey, str], ...] = (
    ("language", "required a language not in the profile"),
    ("seniority", "sat outside the candidate's seniority range"),
    ("early_career", "weren't open to early-career candidates"),
    ("education", "required a higher education level"),
    ("work_mode", "didn't match the work-mode preference"),
)
_KO_CLAUSE_BY_KEY: dict[str, str] = dict(_KO_REASON_CLAUSES)
_KO_KEY_ORDER: dict[str, int] = {key: i for i, (key, _) in enumerate(_KO_REASON_CLAUSES)}


def aggregate_ko_reasons(reason_lists: list[list[KoReason]], *, top: int = 4) -> list[dict[str, Any]]:
    """Roll per-job KO reasons up into ranked ``{key, label, count}`` buckets.

    A job can trip several gates; each *category* it trips is counted once, so a
    count reads as "N roles were blocked by <reason>" rather than a raw hit total.
    Reasons carry their key from ko_filter, so this groups by key directly.
    Sorted by count desc, then the declaration order above for stability.
    """
    counts: dict[str, int] = {}
    for reasons in reason_lists:
        for key in {r.key for r in reasons}:  # one count per category per job
            counts[key] = counts.get(key, 0) + 1
    ranked = sorted(counts, key=lambda k: (-counts[k], _KO_KEY_ORDER.get(k, len(_KO_KEY_ORDER))))
    return [
        {"key": k, "label": _KO_CLAUSE_BY_KEY.get(k, "were filtered out for other reasons"), "count": counts[k]}
        for k in ranked[:top]
    ]


def match(
    candidate: MatchCandidate,
    jobs: list[Job],
    *,
    limit: int = 50,
    weights: dict[str, float] | None = None,
) -> MatchResponse:
    """Run the full KO -> score -> rank pipeline over a job corpus.

    ``weights`` is an optional recruiter override (MAT1): a single bounded vector
    resolved ONCE against the candidate's archetype and applied to every job, so
    the whole ranking re-weights consistently. Omitted -> the archetype baseline
    (scoring identical to before). The resolved vector + the archetype's allowed
    bounds ride back on the candidate block so the UI can render bounded sliders
    seeded at the values actually used."""
    survivors: list[Job] = []
    ko_reason_lists: list[list[KoReason]] = []
    for job in jobs:
        passed, reasons = ko_filter(candidate, job)
        if passed:
            survivors.append(job)
        else:
            ko_reason_lists.append(reasons)

    # Resolve once (clamp to the archetype's bounds + renormalize to sum 1) so the
    # whole pool is ranked under one comparable yardstick, not a per-job vector.
    resolved = resolve_weights(candidate.archetype, weights)
    scored = sorted(
        (score_job(candidate, job, weights=resolved) for job in survivors),
        key=lambda m: m.total,
        reverse=True,
    )
    top = scored[:limit]
    return MatchResponse(
        candidate={
            "label": candidate.label,
            "seniority": candidate.seniority,
            "roleFamily": candidate.role_family,
            "archetype": candidate.archetype,
            "skills": len(candidate.skills),
            "potentialScore": candidate.potential_score,
            # SCOR3 — the WHY behind potentialScore. These already feed the score
            # math and the LLM reasoning prompt; returning them lets the UI
            # explain the number instead of showing a bare percentage.
            "learningSignals": candidate.learning_signals,
            "transferableSkills": candidate.transferable_skills,
            "domainDistance": candidate.domain_distance,
            "assumptions": candidate_assumptions(candidate),
            # Locale-independent codes parallel to `assumptions` (localize-python-seam):
            # the UI renders match.assumptions.* in the session locale, falling back to
            # the English string above for an older payload or an un-translated code.
            "assumptionCodes": [{"code": c.code, "params": c.params} for c in candidate_assumption_codes(candidate)],
            # MAT1: the weights actually used + the bounds the UI must respect.
            "weights": resolved,
            "weightBounds": {k: list(v) for k, v in weight_bounds(candidate.archetype).items()},
        },
        meta={
            "evaluated": len(jobs),
            "koFiltered": len(ko_reason_lists),
            "survivors": len(survivors),
            "returned": len(top),
            # Top KO blockers (with counts) so a 0/thin result can explain itself.
            "koReasons": aggregate_ko_reasons(ko_reason_lists),
        },
        matches=top,
    )


# -- corpus loading ---------------------------------------------------------

_DEFAULT_CORPUS = Path(__file__).resolve().parents[2] / "data" / "seed_jobs" / "jobs.normalized.json"


def load_corpus(path: Path | None = None) -> list[Job]:
    """Load the normalized job corpus into :class:`Job` objects."""
    source = path or _DEFAULT_CORPUS
    records = json.loads(source.read_text(encoding="utf-8"))
    return [Job.model_validate(rec) for rec in records]
