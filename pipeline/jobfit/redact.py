"""PII redaction for blind-screening mode (idea-b8d711c4).

An opt-in pre-pass that masks identity signals from the CV text BEFORE it reaches
the LLM, so the score, salary and job-fit are produced against an anonymized
document; the real name is re-attached only in the final result. What it masks:
the candidate's name, contact details (email / phone / profile links), gender-coded
pronouns and titles, and explicit age / birth-year markers. (The candidate's PHOTO
is removed implicitly: blind mode sends the redacted TEXT to the model instead of
uploading the original file.)

Pure + deterministic so the redaction is unit-testable and stable across recruiter
locales. Best-effort by design — it reduces, not eliminates, identity leakage —
which is why blind mode records WHAT it redacted as a sanity-check note the
recruiter can see.
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field

_EMAIL = re.compile(r"[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}")
_URL = re.compile(r"\b(?:https?://|www\.)\S+|\b(?:linkedin\.com|github\.com|gitlab\.com)/\S+", re.IGNORECASE)
# A run of digits with phone-ish separators (>= ~9 digits), not glued to a word.
_PHONE = re.compile(r"(?<!\w)\+?\d[\d\s().\-]{7,}\d(?!\w)")
# Gender-coded pronouns / honorifics, EN + CS, whole word, case-insensitive.
_PRONOUN = re.compile(
    r"\b(he|she|him|her|hers|his|mr|mrs|ms|miss|on|ona|jeho|jeji|její|pan|pani|paní|slecna|slečna)\b",
    re.IGNORECASE,
)
# Explicit age / birth markers (EN + CS).
_AGE = re.compile(
    r"\b(?:age|věk|vek)\s*[:\-]?\s*\d{1,2}\b"
    r"|\b(?:born|narozen[aý]?|date of birth|datum narození|datum narozeni)\b[^\n]{0,24}\b(?:19|20)\d{2}\b",
    re.IGNORECASE,
)

# A title-cased name token (incl. common diacritics); a CV header name line is 2-4 of these.
_NAME_TOKEN = re.compile(r"^[A-ZÁ-Ž][A-Za-zÀ-ž'\-]+$")
_TITLE_WORDS = {"curriculum", "vitae", "cv", "résumé", "resume", "profile", "contact", "životopis"}


def _guess_name_line(text: str) -> str | None:
    """The first top-of-document line that reads like a 2-4 word personal name
    (no digits, no email, not a 'Curriculum Vitae'-style header). Best-effort —
    None when nothing qualifies."""
    for raw in text.splitlines()[:8]:
        line = raw.strip()
        if not line or len(line) > 40 or "@" in line or any(ch.isdigit() for ch in line):
            continue
        tokens = line.split()
        if not (2 <= len(tokens) <= 4):
            continue
        if any(t.lower() in _TITLE_WORDS for t in tokens):
            continue
        if all(_NAME_TOKEN.match(t) for t in tokens):
            return line
    return None


@dataclass
class RedactResult:
    text: str
    categories: list[str] = field(default_factory=list)
    detected_name: str | None = None


def redact_pii(text: str) -> RedactResult:
    """Mask identity signals from ``text``. Returns the redacted text, the list of
    categories actually redacted (for the recruiter-visible note), and the detected
    name (so the caller can re-attach it to the final result)."""
    categories: list[str] = []
    detected_name = _guess_name_line(text)
    redacted = text

    if detected_name:
        redacted = redacted.replace(detected_name, "[NAME]")
        # Also mask each name token elsewhere (e.g. a "Dear Jane," later on); skip
        # very short tokens to avoid clobbering unrelated words.
        for token in detected_name.split():
            if len(token) >= 3:
                redacted = re.sub(rf"\b{re.escape(token)}\b", "[NAME]", redacted)
        categories.append("name")

    for pattern, tag, cat in (
        (_EMAIL, "[EMAIL]", "email"),
        (_URL, "[LINK]", "profile links"),
        (_PHONE, "[PHONE]", "phone"),
        (_AGE, "[REDACTED]", "age / birth year"),
    ):
        new, n = pattern.subn(tag, redacted)
        if n:
            redacted = new
            categories.append(cat)

    new, n = _PRONOUN.subn("[REDACTED]", redacted)
    if n:
        redacted = new
        categories.append("gendered terms")

    return RedactResult(text=redacted, categories=categories, detected_name=detected_name)
