from __future__ import annotations

from .models import KeywordCoverage, KeywordHit, KeywordStatus
from .taxonomy import (
    contains_whole_token,
    count_whole_token,
    detected_skills,
    normalize_text,
    resolve_term,
    skill_keyword_pool,
)


# --- Display caps -----------------------------------------------------------
# The keyword breakdown feeds a side panel, not an exhaustive table, so each
# list is capped before it leaves the pipeline. These are presentation limits,
# NOT analysis limits: ``coverage_percent`` is always computed over the *full*
# hit set (see ``evaluate_keyword_coverage``), and the pre-truncation totals
# travel alongside each list (``KeywordCoverage.*_total``) so the UI can show a
# "+N more" affordance instead of silently presenting a capped list as complete.
MAX_KEYWORD_HITS = 24       # matched/missing terms shown, most JD-relevant first
MAX_MISSING_KEYWORDS = 12   # "add these to your CV" gaps shown
MAX_OVER_USED_KEYWORDS = 6  # possible keyword-stuffing flags shown

# --- Keyword-stuffing threshold ---------------------------------------------
# A term is flagged ``over_used`` when it appears in the CV far more often than
# the job description warrants — the recruiter-visible "keyword stuffing"
# signal. This is a product decision, so it lives here as named constants rather
# than a bare literal. BOTH conditions must hold for a flag:
#   * the term occurs at least KEYWORD_STUFFING_MIN_CV_OCCURRENCES times in the
#     CV (so a term used once or twice is never flagged), AND
#   * it occurs more than KEYWORD_STUFFING_JD_RATIO times its JD frequency (so
#     heavy use is only flagged when it clearly outstrips real JD demand).
# Raise either value to flag fewer terms; lower it to flag more.
KEYWORD_STUFFING_MIN_CV_OCCURRENCES = 6
KEYWORD_STUFFING_JD_RATIO = 3


def evaluate_keyword_coverage(
    candidate_text: str,
    job_description_text: str,
    job_skills: list[str] | None = None,
    matching_skills: list[str] | None = None,
    missing_skills: list[str] | None = None,
) -> KeywordCoverage:
    """Compute job-description keyword coverage against the candidate text.

    Slimmed-down successor to the old full ATS analysis: only the keyword
    section was kept after the ATS tab was retired. The hits / missing /
    over-used breakdown now lives inside the Job-fit tab.

    ``job_skills`` is the *authoritative* set of JD-required keywords for callers
    that have one (e.g. structured job requirements). Omit it (or pass it empty)
    to make this a genuinely INDEPENDENT ATS check: the JD keyword universe is
    then harvested from the JD text itself via :func:`_harvest_jd_keywords` (the
    taxonomy's ``skill_keyword_pool``, matched on word boundaries), so the panel
    can surface a JD keyword the candidate — or the upstream LLM — missed instead
    of only re-checking skills the LLM already labelled. ``matching_skills`` still
    augments literal CV matching (a semantic match the LLM saw); ``missing_skills``
    populates the missing list.
    """
    matching = matching_skills or []
    missing = missing_skills or []
    cv_norm = _normalize(candidate_text or "")
    jd_norm = _normalize(job_description_text or "")

    effective_job_skills = list(job_skills) if job_skills else _harvest_jd_keywords(jd_norm)
    hits = _keyword_hits(jd_norm, cv_norm, effective_job_skills, matching)
    matched_count = sum(1 for hit in hits if hit.matched)
    coverage_percent = round(matched_count / max(len(hits), 1) * 100) if hits else 0
    over_used = [hit.keyword for hit in hits if hit.status == "over_used"]

    return KeywordCoverage(
        coverage_percent=coverage_percent,
        hits=hits[:MAX_KEYWORD_HITS],
        missing=missing[:MAX_MISSING_KEYWORDS],
        over_used=over_used[:MAX_OVER_USED_KEYWORDS],
        # Pre-truncation totals so a capped list isn't misread as the full set.
        hits_total=len(hits),
        missing_total=len(missing),
        over_used_total=len(over_used),
    )


# --- Matching-skill verification (trust gate) -------------------------------
# The LLM's ``matching_skills`` list is NARRATED, not verified — nothing stops it
# claiming a skill the candidate's CV never mentions. A single such hallucinated
# match is the recruiter's hard trust line (it means the model read sample data,
# not the real CV), so the pipeline gates the list against the actual CV text
# BEFORE it reaches any surface: the job-fit chips, this keyword-coverage panel,
# and the interview kit all consume the verified list.


def _skill_in_text(cv_norm: str, skill_norm: str) -> bool:
    """Whole-token literal presence of a skill in already-normalized CV text.

    Delegates to the shared taxonomy word-boundary primitive
    (:func:`taxonomy.contains_whole_token`): internal whitespace matches any run so
    a line-wrapped "machine learning" still matches, and non-word boundaries keep a
    short or special-charactered skill ("R", "Go", "C++", "C#", ".NET") matching as
    a standalone token, never inside an unrelated word. One implementation, shared
    with the taxonomy so verdicts can't drift.
    """
    return contains_whole_token(cv_norm, skill_norm)


def verify_skills_in_cv(
    matching_skills: list[str], candidate_text: str
) -> tuple[list[str], list[str]]:
    """Split LLM-claimed matching skills into ``(verified, withheld)`` vs the CV.

    A skill is *verified* when EITHER:

    * its canonical taxonomy term is also detected in the CV text — alias-aware,
      so a claimed "JavaScript" is confirmed by a CV that only writes "JS", and
      "Kubernetes" by a CV that says "k8s"; OR
    * (for a skill the taxonomy does not model) it appears literally in the CV —
      accent/case-insensitive, whitespace-flexible, on word boundaries.

    Anything else is *withheld*: it cannot be confirmed in the CV, so it must
    never be shown as a confirmed match. Input order and casing are preserved in
    both lists; duplicates (by normalized form) collapse to their first occurrence.
    """
    cv_norm = _normalize(candidate_text or "")
    # Canonical taxonomy terms the CV actually evidences (alias-aware). A high cap
    # so verification sees every detected skill, not the prompt-sized default.
    detected_terms = {
        resolve_term(form) for form in detected_skills(candidate_text or "", limit=1000)
    }
    detected_terms.discard(None)

    verified: list[str] = []
    withheld: list[str] = []
    seen: set[str] = set()
    for skill in matching_skills:
        key = _normalize(skill)
        if not key or key in seen:
            continue
        seen.add(key)
        term = resolve_term(skill)
        confirmed = (term is not None and term in detected_terms) or _skill_in_text(cv_norm, key)
        (verified if confirmed else withheld).append(skill)
    return verified, withheld


def _keyword_status(matched: bool, in_jd: int, in_cv: int) -> KeywordStatus:
    """Resolve a single per-keyword coverage state.

    ``over_used`` applies the keyword-stuffing threshold (documented on
    ``KEYWORD_STUFFING_MIN_CV_OCCURRENCES`` / ``KEYWORD_STUFFING_JD_RATIO``): a
    keyword present in the CV far more often than the JD demands. It implies
    ``matched`` (the term is present), so callers treat it as covered.
    """
    if not matched:
        return "missing"
    if (
        in_cv >= KEYWORD_STUFFING_MIN_CV_OCCURRENCES
        and in_cv > in_jd * KEYWORD_STUFFING_JD_RATIO
    ):
        return "over_used"
    return "matched"


def _keyword_hits(
    jd_norm: str,
    cv_norm: str,
    job_skills: list[str],
    matching_skills: list[str],
) -> list[KeywordHit]:
    matched_set = {_normalize(skill) for skill in matching_skills if skill}
    hits: list[KeywordHit] = []
    seen: set[str] = set()
    for skill in job_skills:
        key = _normalize(skill)
        if not key or key in seen:
            continue
        seen.add(key)
        in_jd = max(_occurrences(jd_norm, key), 1)
        in_cv = _occurrences(cv_norm, key)
        matched = key in matched_set or in_cv > 0
        hits.append(
            KeywordHit(
                keyword=skill,
                in_jd=in_jd,
                in_cv=in_cv,
                matched=matched,
                status=_keyword_status(matched, in_jd, in_cv),
            )
        )
    hits.sort(key=lambda hit: (not hit.matched, -hit.in_jd, hit.keyword))
    return hits


def _harvest_jd_keywords(jd_norm: str) -> list[str]:
    pool = skill_keyword_pool()
    return [token for token in pool if _occurrences(jd_norm, _normalize(token)) > 0]


def _occurrences(haystack: str, needle: str) -> int:
    # Shared taxonomy word-boundary count (literal spacing) — same non-word
    # boundaries as _skill_in_text, so "C++"/"C#"/".NET"/"Go" are counted as whole
    # tokens and never as substrings of a larger word.
    return count_whole_token(haystack, needle)


def _normalize(text: str) -> str:
    # The one normalization primitive, owned by the taxonomy (NFC + casefold).
    return normalize_text(text)
