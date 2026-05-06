from __future__ import annotations

import re
import unicodedata

from .models import KeywordCoverage, KeywordHit
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
    over_used = [hit.keyword for hit in hits if hit.in_cv >= 6 and hit.in_cv > hit.in_jd * 3]

    return KeywordCoverage(
        coverage_percent=coverage_percent,
        hits=hits[:24],
        missing=missing_skills[:12],
        over_used=over_used[:6],
    )


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
        in_jd = _occurrences(jd_norm, key)
        in_cv = _occurrences(cv_norm, key)
        matched = key in matched_set or in_cv > 0
        hits.append(
            KeywordHit(
                keyword=skill,
                in_jd=max(in_jd, 1),
                in_cv=in_cv,
                matched=matched,
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
