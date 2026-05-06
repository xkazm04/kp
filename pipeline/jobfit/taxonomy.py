from __future__ import annotations

import json
import re
import unicodedata
from enum import Enum
from pathlib import Path
from typing import Any, Iterable


_DATA_DIR = Path(__file__).resolve().parents[2] / "data"
_BENCHMARKS_PATH = _DATA_DIR / "salary_benchmarks.json"
_TAXONOMY_PATH = _DATA_DIR / "taxonomy.json"


def _load_json(path: Path) -> dict[str, Any]:
    return json.loads(path.read_text(encoding="utf-8"))


_BENCHMARKS: dict[str, Any] = _load_json(_BENCHMARKS_PATH)
_TAXONOMY: dict[str, Any] = _load_json(_TAXONOMY_PATH)
_TERMS: list[dict[str, Any]] = list(_TAXONOMY["terms"])

ROLE_FAMILIES: tuple[str, ...] = tuple(role["family"] for role in _BENCHMARKS["roles"])
ROLE_FAMILY_SET: frozenset[str] = frozenset(ROLE_FAMILIES)
DEFAULT_FAMILY: str = _BENCHMARKS.get("default_family") or ROLE_FAMILIES[0]

RoleFamily = Enum("RoleFamily", {family.upper(): family for family in ROLE_FAMILIES})

COMPANY_ADJUSTMENTS: dict[str, dict[str, Any]] = dict(_TAXONOMY.get("company_adjustments", {}))
COMPANY_MODIFIER_EFFECTS: dict[str, dict[str, Any]] = dict(_TAXONOMY.get("company_modifier_effects", {}))
SALARY_SIGNAL_RATIONALE: dict[str, str] = {
    signal: meta.get("rationale", "")
    for signal, meta in _TAXONOMY.get("salary_signals", {}).items()
}


def _normalize(text: str) -> str:
    return unicodedata.normalize("NFC", text).casefold()


def _compact(text: str) -> str:
    return re.sub(r"\W+", "", text, flags=re.UNICODE)


def _term_match_strings(term: dict[str, Any]) -> list[str]:
    return [_normalize(form) for form in term.get("match", [])]


def _text_contains(text: str, compact_text: str, surface: str) -> bool:
    if not surface:
        return False
    normalized = _normalize(surface)
    if normalized in text:
        return True
    compact_form = _compact(normalized)
    return bool(compact_form) and compact_form in compact_text


def _term_in_text(term: dict[str, Any], text: str, compact_text: str) -> bool:
    return any(_text_contains(text, compact_text, surface) for surface in term["match"])


def _terms_by_category(category: str) -> list[dict[str, Any]]:
    return [term for term in _TERMS if category in term.get("categories", [])]


_SKILL_WEIGHTS: dict[str, dict[str, float]] = {family: {} for family in ROLE_FAMILIES}
for _term in _TERMS:
    for _family, _weight in _term.get("role_family_votes", {}).items():
        if _family in ROLE_FAMILY_SET:
            for _form in _term["match"]:
                _SKILL_WEIGHTS[_family][_form] = float(_weight)


def skill_keyword_pool() -> list[str]:
    """Flat list of all known skill tokens (and their surface forms) across role families."""
    seen: set[str] = set()
    pool: list[str] = []
    for term in _terms_by_category("skill"):
        for form in term["match"]:
            key = _normalize(form)
            if key in seen:
                continue
            seen.add(key)
            pool.append(form)
    return pool


def role_band(family: str, seniority: str) -> tuple[int, int] | None:
    """Look up the CZK monthly gross anchor band for a (role_family, seniority) pair.

    Returns ``None`` when the family is unknown or the seniority key is missing.
    Used by the deterministic-evidence pre-pass to anchor Gemini's salary range.
    """
    for role in _BENCHMARKS["roles"]:
        if role["family"] != family:
            continue
        band = role.get(seniority)
        if isinstance(band, list) and len(band) == 2:
            return int(band[0]), int(band[1])
    return None


def detected_skills(text: str, limit: int = 40) -> list[str]:
    """Surface forms of skill terms present in ``text``.

    Used by the deterministic pre-pass to give Gemini a starting list it can
    confirm or correct. Not authoritative — Gemini's extraction wins.
    """
    text_n = _normalize(text)
    compact = _compact(text_n)
    found: list[str] = []
    seen: set[str] = set()
    for term in _terms_by_category("skill"):
        for form in term["match"]:
            normalized = _normalize(form)
            if normalized in seen:
                continue
            if _text_contains(text_n, compact, form):
                seen.add(normalized)
                found.append(form)
                break
        if len(found) >= limit:
            break
    return found


def detected_signals(text: str) -> list[str]:
    """Salary-signal keys whose terms are present in ``text``."""
    text_n = _normalize(text)
    compact = _compact(text_n)
    signals: list[str] = []
    seen: set[str] = set()
    for term in _TERMS:
        signal = term.get("salary_signal")
        if not signal or signal in seen:
            continue
        for form in term["match"]:
            if _text_contains(text_n, compact, form):
                signals.append(signal)
                seen.add(signal)
                break
    return signals


def classify_role_family(skills: list[str], text: str, recent_text: str = "") -> str:
    skill_set = {_normalize(skill) for skill in skills}
    compact_text = _compact(text)
    compact_recent = _compact(recent_text) if recent_text else ""

    scores: dict[str, float] = {family: 0.0 for family in ROLE_FAMILIES}
    for term in _TERMS:
        votes = term.get("role_family_votes")
        if not votes:
            continue
        forms = _term_match_strings(term)
        in_skills = any(form in skill_set for form in forms)
        in_text = any(_text_contains(text, compact_text, form) for form in term["match"])
        in_recent = bool(recent_text) and any(
            _text_contains(recent_text, compact_recent, form) for form in term["match"]
        )
        for family, weight in votes.items():
            if family not in ROLE_FAMILY_SET:
                continue
            w = float(weight)
            if in_skills:
                scores[family] += w
            elif in_text:
                scores[family] += w if w < 0 else w * 0.7
            if in_recent:
                scores[family] += w if w < 0 else w * 0.5

    best = DEFAULT_FAMILY
    best_score = 0.0
    for family in ROLE_FAMILIES:
        if scores[family] > best_score:
            best_score = scores[family]
            best = family
    return best


def signal_term_ids(signal: str) -> set[str]:
    """Canonical ids of terms tagged with the given salary signal (e.g. 'ai', 'cloud')."""
    return {
        term["id"]
        for term in _TERMS
        if term.get("salary_signal") == signal
    }


def signal_surface_forms(signal: str) -> set[str]:
    """All normalized surface forms (incl. Czech variants) of terms with the given signal."""
    forms: set[str] = set()
    for term in _TERMS:
        if term.get("salary_signal") != signal:
            continue
        for form in term["match"]:
            forms.add(_normalize(form))
    return forms


def has_any_signal(values: Iterable[str], signal: str) -> bool:
    """True if any item in `values` (skills/traits/languages) matches a term tagged with `signal`."""
    surface = signal_surface_forms(signal)
    return any(_normalize(value) in surface for value in values)


def category_surface_forms(category: str) -> set[str]:
    """All normalized surface forms (incl. Czech variants) of terms in the given category."""
    forms: set[str] = set()
    for term in _terms_by_category(category):
        for form in term["match"]:
            forms.add(_normalize(form))
    return forms


def has_any_in_category(values: Iterable[str], category: str) -> bool:
    """True if any item in `values` matches a term in the given category."""
    surface = category_surface_forms(category)
    return any(_normalize(value) in surface for value in values)


def has_any_in_text(text: str, category: str) -> bool:
    text_n = _normalize(text)
    compact = _compact(text_n)
    return any(_term_in_text(term, text_n, compact) for term in _terms_by_category(category))


def classify_company_type(text: str) -> str:
    text_n = _normalize(text)
    compact = _compact(text_n)
    for term in _terms_by_category("company_type"):
        if _term_in_text(term, text_n, compact):
            return term["company_type"]
    return "unknown"


def company_modifiers(text: str) -> list[str]:
    text_n = _normalize(text)
    compact = _compact(text_n)
    found: list[str] = []
    for term in _terms_by_category("company_modifier"):
        if _term_in_text(term, text_n, compact):
            modifier = term["company_modifier"]
            if modifier not in found:
                found.append(modifier)
    return found


_EDUCATION_PRIORITY = ["phd", "master", "bachelor", "university"]


def classify_education(text: str) -> str:
    text_n = _normalize(text)
    compact = _compact(text_n)
    found: set[str] = set()
    for term in _terms_by_category("education"):
        if _term_in_text(term, text_n, compact):
            found.add(term["education_level"])
    for level in _EDUCATION_PRIORITY:
        if level in found:
            return level
    return "unknown"


def has_seniority_lead_signal(text: str) -> bool:
    text_n = _normalize(text)
    compact = _compact(text_n)
    for term in _terms_by_category("seniority"):
        if term.get("seniority_level") != "lead":
            continue
        if _term_in_text(term, text_n, compact):
            return True
    return False


def has_seniority_senior_signal(text: str) -> bool:
    text_n = _normalize(text)
    compact = _compact(text_n)
    for term in _terms_by_category("seniority"):
        if term.get("seniority_level") != "senior":
            continue
        if _term_in_text(term, text_n, compact):
            return True
    return False


def has_seniority_medior_signal(text: str) -> bool:
    text_n = _normalize(text)
    compact = _compact(text_n)
    for term in _terms_by_category("seniority"):
        if term.get("seniority_level") != "medior":
            continue
        if _term_in_text(term, text_n, compact):
            return True
    return False


