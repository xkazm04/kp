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

from .taxonomy import detected_seniority_levels, detected_skills

_EMAIL = re.compile(r"[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}")
_URL = re.compile(r"\b(?:https?://|www\.)\S+|\b(?:linkedin\.com|github\.com|gitlab\.com)/\S+", re.IGNORECASE)
# A run of digits with phone-ish separators (>= ~9 digits), not glued to a word.
_PHONE = re.compile(r"(?<!\w)\+?\d[\d\s().\-]{7,}\d(?!\w)")
# Gender-coded STANDALONE pronouns, EN + CS, whole word, case-insensitive.
# NOTE: Czech "on" (he) is deliberately EXCLUDED — it collides with the ubiquitous
# English preposition "on", so \bon\b would redact every "on" in an English CV,
# shredding the blind-scored text (a far bigger harm than missing the rare Czech
# pronoun). Czech "ona" (she) has no common English whole-word collision and stays.
# Honorific TITLES (Mr/Mrs/Ms/Miss/pan/paní/…) are NOT here — see _HONORIFIC. A bare
# "MS"/"MR" token is far more often "MS" (Master of Science, MS SQL, MS Office) or an
# initialism than the title "Ms", so the standalone token must never be redacted.
_PRONOUN = re.compile(
    r"\b(he|she|him|her|hers|his|ona|jeho|jeji|její)\b",
    re.IGNORECASE,
)
# Honorific titles, redacted ONLY when they PREFIX a capitalized name ("Mr Smith",
# "Ms. Nováková", "paní Dvořák") — the gender-revealing usage. English titles match
# CASE-SENSITIVELY in title-case (Mr|Mrs|Ms|Miss), so the all-caps "MS"/"MR"
# degree/product token ("MS SQL", "MS Office", "MSc", "M.S.", "Master of Science") is
# never touched; the Czech titles (pan/paní/slečna) match case-insensitively. Only
# the title itself is masked (the trailing name is left for the name pass). A
# standalone title with no following capitalized name is not redacted at all.
_HONORIFIC = re.compile(
    r"\b(?:Mr|Mrs|Ms|Miss|(?i:pan|pani|paní|slecna|slečna))\.?(?=\s+[A-ZÁ-Ž])"
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
# Separators that delimit a name from a same-line job title ("Jane Doe | CTO",
# "Jan Novák — Senior Engineer"). The spaced hyphen " - " is included but a glued
# hyphen is not, so a hyphenated name ("Anne-Marie") is never split.
_NAME_SEPARATOR = re.compile(r"\s*[|•·–—,/]\s*|\s+-\s+")


def _looks_like_role_headline(cand: str) -> bool:
    """True when a title-cased line reads as a role / seniority / skill HEADLINE
    ("Machine Learning Engineer", "Senior Software Developer") rather than a personal
    name. Matched against the SHARED taxonomy vocabulary already used for scoring
    (seniority markers + skill/role terms), so a headline is neither masked as
    ``[NAME]`` across the document — which would blank those common CV words from the
    blind-scored text — nor re-attached as the candidate's name. Best-effort: reuses
    the taxonomy rather than a bespoke stop-list, so it tracks the vocabulary."""
    if detected_seniority_levels(cand):
        return True
    if detected_skills(cand, limit=1):
        return True
    return False


def _guess_name_line(text: str) -> str | None:
    """The first top-of-document fragment that reads like a 2-4 word personal name
    (no digits, no email, not a 'Curriculum Vitae'-style header). Tries the whole
    line AND the leading segment before a name/title separator, so a name followed by
    a role on the same line ("Jane Doe — Senior Engineer") still yields "Jane Doe".
    Best-effort — None when nothing qualifies."""
    for raw in text.splitlines()[:8]:
        line = raw.strip()
        if not line:
            continue
        # Full line first; then the part before the first name/title separator.
        candidates = [line]
        head = _NAME_SEPARATOR.split(line, 1)[0].strip()
        if head and head != line:
            candidates.append(head)
        for cand in candidates:
            if len(cand) > 40 or "@" in cand or any(ch.isdigit() for ch in cand):
                continue
            tokens = cand.split()
            if not (2 <= len(tokens) <= 4):
                continue
            if any(t.lower() in _TITLE_WORDS for t in tokens):
                continue
            if not all(_NAME_TOKEN.match(t) for t in tokens):
                continue
            # A clean 2-4 title-cased-token line can still be a role/skill HEADLINE
            # ("Machine Learning Engineer") rather than a name. Reject it against the
            # taxonomy vocabulary so its common CV words aren't masked as [NAME]
            # throughout the blind text and it isn't re-attached as the name.
            if _looks_like_role_headline(cand):
                continue
            return cand
    return None


@dataclass
class RedactResult:
    text: str
    categories: list[str] = field(default_factory=list)
    detected_name: str | None = None
    # Explicit "did we find a name to redact?" signal (cv-extraction-pipeline #1). A
    # False here with blind mode on means the real name is still in `text` and reached
    # the model, so the caller must NOT claim "identity redacted". Equivalent to
    # detected_name is not None / "name" in categories, surfaced as its own flag so
    # the fail-open case can't be missed.
    name_detected: bool = False


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

    # Gendered signals in two precise passes: standalone pronouns (he/she/…) and
    # honorific titles that prefix a capitalized name (Mr/Ms/paní …). Keeping them
    # separate is what lets the ubiquitous "MS" (Master of Science / MS SQL / MS
    # Office) survive — only a title before a name is masked, never a bare token.
    gendered_hits = 0
    for pattern in (_PRONOUN, _HONORIFIC):
        new, n = pattern.subn("[REDACTED]", redacted)
        if n:
            redacted = new
            gendered_hits += n
    if gendered_hits:
        categories.append("gendered terms")

    return RedactResult(
        text=redacted,
        categories=categories,
        detected_name=detected_name,
        name_detected=detected_name is not None,
    )
