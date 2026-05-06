from __future__ import annotations

import re
import unicodedata

from .models import CandidateProfile
from .taxonomy import (
    classify_education,
    classify_role_family,
    has_seniority_lead_signal,
    has_seniority_medior_signal,
    has_seniority_senior_signal,
)


def build_profile(text: str) -> CandidateProfile:
    """Regex-only profile builder used as the no-key classic fallback.

    Skills, traits, and language extraction now come from the LLM payload.
    This builder produces deterministic signals only: years of experience,
    seniority, education, name, and role family.
    """
    normalized = _normalize_for_matching(text)
    years = _estimate_years(normalized)
    seniority = _infer_seniority(normalized, years)
    role_family = classify_role_family([], normalized)
    education = _infer_education(normalized)
    name = _infer_name(text)

    evidence = [
        item
        for item in [
            f"Detected {years:g} years of experience" if years else "No explicit experience duration detected",
            f"Inferred role family: {role_family}",
            f"Education signal: {education}",
        ]
        if item
    ]

    return CandidateProfile(
        name=name,
        raw_text=text,
        years_experience=years,
        current_seniority=seniority,
        role_family=role_family,
        skills=[],
        education_level=education,
        languages=[],
        traits=[],
        evidence=evidence,
    )


def _estimate_years(text: str) -> float:
    text = _collapse_digit_spacing(text)
    year_ranges = re.findall(
        r"(20\d{2}|19\d{2})\s*(?:-|–|—|to|do)\s*(present|now|současnost|dosud|20\d{2})",
        text,
    )
    month_year_ranges = re.findall(
        r"(?:\d{1,2}/)?(20\d{2}|19\d{2})\s*(?:-|–|—|to|do)\s*(present|now|současnost|dosud|(?:\d{1,2}/)?(?:20\d{2}|19\d{2}))",
        text,
    )
    year_ranges.extend((start, re.search(r"(20\d{2}|19\d{2})$", end).group(1) if re.search(r"(20\d{2}|19\d{2})$", end) else end) for start, end in month_year_ranges)
    intervals = []
    for start, end in year_ranges:
        end_year = 2026 if end in {"present", "now", "současnost", "dosud"} else int(end)
        if end_year >= int(start):
            intervals.append((int(start), min(end_year, 2026)))

    explicit = [
        float(match.replace(",", "."))
        for match in re.findall(r"(\d+(?:[\.,]\d+)?)\+?\s*(?:years|yrs|let|rok|roky|roků)\b", text)
    ]
    if intervals:
        return round(min(_merged_years(intervals), 20), 1)
    if explicit:
        return min(max(explicit), 25)
    return 0.0


def _infer_seniority(text: str, years: float) -> str:
    if has_seniority_lead_signal(text):
        return "lead"
    if has_seniority_senior_signal(text) or years >= 7:
        return "senior"
    if has_seniority_medior_signal(text) or years >= 3:
        return "medior"
    return "junior"


def _infer_education(text: str) -> str:
    return classify_education(text)


def _infer_name(text: str) -> str | None:
    for line in text.splitlines()[:5]:
        cleaned = line.strip()
        if 2 <= len(cleaned.split()) <= 4 and not any(char.isdigit() for char in cleaned):
            if not re.search(r"cv|resume|curriculum|experience|skills|zkušenosti|dovednosti", cleaned, re.IGNORECASE):
                return cleaned
    return None


def _normalize_for_matching(text: str) -> str:
    return unicodedata.normalize("NFC", text).casefold()


def _collapse_digit_spacing(text: str) -> str:
    return re.sub(r"(?<=\d)\s+(?=\d)", "", text)


def _merged_years(intervals: list[tuple[int, int]]) -> float:
    merged: list[list[int]] = []
    for start, end in sorted(intervals):
        if not merged or start > merged[-1][1]:
            merged.append([start, end])
        else:
            merged[-1][1] = max(merged[-1][1], end)
    return sum(end - start for start, end in merged)
