"""Shared output-language helper for every LLM prompt site.

The pipeline emits two kinds of text: canonical CODE values the rest of the
system branches on (the {advance, hold, reject} verdict, the junior|medior|
senior|lead seniority, role-family identifiers) and free-form NARRATIVE a human
reads (summaries, rationale, recommendations). i18n applies only to the second
kind: narrative is generated in the requested language, while code values,
technology names, and proper nouns stay verbatim so coercion / matching / cache
keys never break.

This module is the single source of the language vocabulary and the prompt
directive — generalised from the original ``_candidate_lang`` / "Write in the
requested language" pattern in automation.py so every prompt site states the
rule identically. Mirrors the frontend's i18n/locales.ts (en default, cs second).
"""
from __future__ import annotations

DEFAULT_LANG = "en"

# Canonical locale code -> English name of the language, used in prompt
# directives. Kept in sync with LOCALES in the frontend's i18n/locales.ts, which
# ships en/cs/de/fr — so a --lang de|fr request reaches a prompt as German/French
# (its language_directive names the right target) instead of silently collapsing
# to English.
LANG_NAMES: dict[str, str] = {
    "en": "English",
    "cs": "Czech",
    "de": "German",
    "fr": "French",
}


def normalize_lang(value: object) -> str:
    """Coerce an arbitrary lang input to a supported code, defaulting to ``en``.

    Accepts a bare code or a BCP-47 tag and matches on the primary subtag, so
    ``"cs"``, ``"cs-CZ"``, and ``"CS"`` all resolve to ``"cs"``; anything
    unrecognised (or non-string) falls back to the default. The single guard so
    a fat-fingered ``--lang`` can never reach a prompt as an unknown language.
    """
    if not isinstance(value, str):
        return DEFAULT_LANG
    primary = value.strip().lower().split("-")[0]
    return primary if primary in LANG_NAMES else DEFAULT_LANG


def language_name(value: object) -> str:
    """English name ("English" / "Czech") of a (normalised) locale code."""
    return LANG_NAMES[normalize_lang(value)]


def language_directive(value: object) -> str:
    """One-line instruction telling the model which language to write in.

    Stated identically at every prompt site so the contract can't drift: narrative
    in the requested language, but schema/code values and proper nouns verbatim.
    For the default (en) the instruction reads "in English" — behaviour-preserving
    for callers that don't pass a locale.
    """
    name = language_name(value)
    return (
        f"Write all human-readable / free-form text in {name}. "
        "Keep technology names, skill names, and proper nouns verbatim. "
        "Keep every enumerated / code value defined by the schema "
        "(e.g. advance|hold|reject, junior|medior|senior|lead, role-family identifiers) "
        "exactly as written — never translate or localize those."
    )
