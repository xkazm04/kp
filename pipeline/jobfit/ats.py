from __future__ import annotations

import re
import unicodedata

from .models import KeywordCoverage, KeywordHit, KeywordStatus
from .taxonomy import skill_keyword_pool


def evaluate_keyword_coverage(
    candidate_text: str,
    job_description_text: str,
    job_skills: list[str],
    matching_skills: list[str],
    missing_skills: list[str],
) -> KeywordCoverage:
    """Compute job-description keyword coverage against the candidate text.

    Slimmed-down successor to the old full ATS analysis: only the keyword
    section was kept after the ATS tab was retired. The hits / missing /
    over-used breakdown now lives inside the Job-fit tab.
    """
    cv_norm = _normalize(candidate_text or "")
    jd_norm = _normalize(job_description_text or "")

    effective_job_skills = list(job_skills) if job_skills else _harvest_jd_keywords(jd_norm)
    hits = _keyword_hits(jd_norm, cv_norm, effective_job_skills, matching_skills)
    matched_count = sum(1 for hit in hits if hit.matched)
    coverage_percent = round(matched_count / max(len(hits), 1) * 100) if hits else 0
    over_used = [hit.keyword for hit in hits if hit.status == "over_used"]

    return KeywordCoverage(
        coverage_percent=coverage_percent,
        hits=hits[:24],
        missing=missing_skills[:12],
        over_used=over_used[:6],
    )


def _keyword_status(matched: bool, in_jd: int, in_cv: int) -> KeywordStatus:
    """Resolve a single per-keyword coverage state.

    ``over_used`` is the one place the keyword-stuffing threshold lives: a
    keyword present in the CV far more often than the JD demands. It implies
    ``matched`` (the term is present), so callers treat it as covered.
    """
    if not matched:
        return "missing"
    if in_cv >= 6 and in_cv > in_jd * 3:
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
    if not needle:
        return 0
    pattern = re.compile(rf"(?<![\w]){re.escape(needle)}(?![\w])", flags=re.UNICODE)
    return len(pattern.findall(haystack))


def _normalize(text: str) -> str:
    return unicodedata.normalize("NFC", text).casefold()
