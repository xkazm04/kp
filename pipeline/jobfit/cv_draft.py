"""Deterministic CV -> profile draft: the keyless twin of the profile_draft prompt.

profile_draft_cli asks a model to read free text into DRAFT_SCHEMA. Without a
provider (no key, KP_OFFLINE, a misconfigured route) that used to be a hard error,
which meant a self-hosted install could not import a CV at all — the one thing the
job-seeker module starts with. This module reads the same text with the pipeline's
own deterministic readers (taxonomy skill terms, language aliases, the years / city
/ seniority regexes the posting structurer already trusts) and returns a payload in
the SAME shape, so ``build_draft`` sanitises and routes it exactly like a model's.

It is honest about what it is: every skill claim carries provenance
``self_declared`` (nothing here proves anything), ``years_experience`` is the first
stated figure or None, and blocks it could not read are simply absent — a thin draft
is a thin draft, never a fabricated one (cv-parsing standard: loss must never
masquerade as absence, so the caller shows ``source: "deterministic"``).

It is also honest about what a skill IS: the handful of taxonomy terms that are role
words rather than abilities (:data:`_ROLE_WORD_TERMS`) inform the role family and are
never written as skill claims.
"""

from __future__ import annotations

import re
from typing import Any

from .jobseeker import parse_locations
from .posting_structure import detect_languages, detect_min_years, detect_requirements, detect_seniority
from .taxonomy import classify_role_family, resolve_term

_EMAIL = re.compile(r"[\w.+-]+@[\w-]+\.[\w.-]+")
_PHONE = re.compile(r"(?:\+?\d[\d\s().-]{7,}\d)")
_URL = re.compile(r"https?://\S+|www\.\S+", re.I)
_EDU = (
    ("phd", re.compile(r"(?<!\w)(ph\.?d|doktor|dr\.|doctorate)(?!\w)", re.I)),
    ("master", re.compile(r"(?<!\w)(master|ing\.|mgr\.|msc|m\.sc|magistr|diplom)(?!\w)", re.I)),
    ("bachelor", re.compile(r"(?<!\w)(bachelor|bc\.|bsc|b\.sc|bakal)\w*", re.I)),
    ("university", re.compile(r"\b(universit|vysok[áa] [šs]kola|v[šs]e|[čc]vut|fakult|faculty|hochschule|universidad|université)\w*", re.I)),
)
_SENIOR_TO_LEVEL = {"junior": "working", "medior": "working", "senior": "strong", "lead": "strong"}
_ASPIRATION = re.compile(
    r"(?:looking for|seeking|hled[áa]m|chci|target|open to|suche|cherche)\s+(?:an?\s+|the\s+)?([^.\n,;]{4,60})",
    re.I,
)
_STUDENT = re.compile(r"\b(student|studuj|studying|enrolled|expected graduation|absolvuji|absolvent 20\d\d)\b", re.I)

# Taxonomy terms that are ROLE WORDS wearing the ``skill`` category: they say what a
# person IS, not what they can do. Every CV names them — they are what a job title is
# made of ("Senior backend engineer", "vývojář") — so detect_requirements fires on the
# title line of every role in the history and the draft came back claiming "backend",
# "engineer" and "developer" as self-declared SKILLS beside java and postgresql. A
# reviewer reading that list learns nothing, and the claims dilute every real one.
#
# They are filtered out of ``skill_claims`` only. ``classify_role_family`` still hears
# the FULL detected list, because for the family vote a role word is the strongest
# signal there is — that is the job it is actually good at.
#
# The taxonomy is not edited: ``role_title`` is a CV-side vocabulary (29 terms) whose
# reclassification would move these surfaces out of ``detected_skills`` for the matcher
# and the posting structurer too, and a job AD that says "backend" IS stating a
# requirement. The exclusion belongs where the claim is written, not in the shared
# vocabulary. Ids, not surfaces: ``resolve_term`` folds "Backend"/"back-end"/"vývojář".
_ROLE_WORD_TERMS = frozenset({"frontend", "backend", "fullstack", "developer", "engineer", "architect", "vyvoj"})


def is_role_word(surface: str) -> bool:
    """True when ``surface`` resolves to one of :data:`_ROLE_WORD_TERMS`."""
    return resolve_term(surface) in _ROLE_WORD_TERMS


def _display_name(text: str) -> str | None:
    """The first short line that is not contact data and has no digits — the name in
    every CV genre we have seen; None when the first lines look like a heading."""
    for line in text.splitlines()[:6]:
        s = line.strip(" -•|\t")
        if not s or len(s) > 60 or _EMAIL.search(s) or _URL.search(s) or _PHONE.search(s):
            continue
        if any(ch.isdigit() for ch in s):
            continue
        words = s.split()
        if 1 < len(words) <= 5 and all(w[:1].isalpha() for w in words):
            return s
    return None


def _first_sentences(text: str, n: int = 2) -> str:
    parts = re.split(r"(?<=[.!?])\s+", " ".join(text.split()))
    return " ".join(p for p in parts[:n] if p).strip()[:240]


# --- dated roles ------------------------------------------------------------------------
#
# A CV's experience is a list of DATED roles, and the keyless draft used to return one
# blob titled "Summary": the matcher then read a career as one sentence, and a generated
# CV had no entries to lay out. Roles are split where a line carries a date range, inside
# an experience section only (an education line's "2012 - 2019" is not a job), and the
# total is the UNION of the dated intervals, never their sum (registry technique
# tenure-and-date-range-reading): overlapping roles do not inflate it, a range that runs
# backwards is dropped rather than subtracted, and a year-only end is read at mid-year.

_MONTH_YEAR = r"(?:(?:0?[1-9]|1[0-2])[./](?:19|20)\d\d)"
_YEAR = r"(?:19|20)\d\d"
_OPEN_END = r"(?:present|now|current|today|dosud|současnost|soucasnost|nyní|nyni|heute|aktuell|aujourd'hui|actuel|actuellement)"
_POINT = rf"(?:{_MONTH_YEAR}|{_YEAR})"
_DATE_RANGE = re.compile(rf"({_POINT})\s*(?:-|–|—|to|až|bis|à)\s*({_POINT}|{_OPEN_END})", re.I)
_EXPERIENCE_HEADINGS = ("experience", "work experience", "employment", "prior experience", "career", "zkušenosti", "pracovní zkušenosti", "praxe", "berufserfahrung", "erfahrung", "expérience", "expérience professionnelle")
_OTHER_HEADINGS = ("education", "skills", "languages", "profile", "summary", "projects", "certifications", "interests", "vzdělání", "dovednosti", "jazyky", "profil", "ausbildung", "kenntnisse", "sprachen", "formation", "compétences", "langues", "projekty", "projets", "projekte")


_SINGLE_YEAR = re.compile(rf"^({_YEAR})(?!\d)\s*[:–—-]?\s*(?=\S)")


def _heading_of(line: str) -> str | None:
    """'experience' / 'other' for a line that IS a section heading (dates allowed on it).
    An unknown ALL-CAPS label ("SW ANALYSIS", "LLM RELATED") is a heading too — of some
    other section — so a sidebar's skill groups never run on inside the last role."""
    bare = _DATE_RANGE.sub("", line).strip().strip(":：-–—#*_ ").casefold()
    if not bare or len(bare) > 40:
        return None
    if bare in _EXPERIENCE_HEADINGS:
        return "experience"
    if bare in _OTHER_HEADINGS:
        return "other"
    raw = _DATE_RANGE.sub("", line).strip().strip(":：-–—#*_ ")
    letters = [ch for ch in raw if ch.isalpha()]
    if len(letters) >= 4 and len(raw) <= 30 and all(ch.isupper() for ch in letters):
        return "other"
    return None


def _point_value(raw: str, now: float, *, end: bool) -> float | None:
    raw = raw.strip()
    if re.fullmatch(_OPEN_END, raw, re.I):
        return now
    m = re.fullmatch(r"(0?[1-9]|1[0-2])[./]((?:19|20)\d\d)", raw)
    if m:
        return int(m.group(2)) + (int(m.group(1)) - (0 if end else 1)) / 12
    if re.fullmatch(_YEAR, raw):
        return int(raw) + 0.5  # year precision: the midpoint, never a padded January
    return None


def _union_years(ranges: list[tuple[float, float]]) -> float:
    total = 0.0
    cur: tuple[float, float] | None = None
    for a, b in sorted(ranges):
        if cur and a <= cur[1] + 1 / 12:  # adjacent across a month boundary: one stretch
            cur = (cur[0], max(cur[1], b))
            continue
        if cur:
            total += cur[1] - cur[0]
        cur = (a, b)
    if cur:
        total += cur[1] - cur[0]
    return total


def dated_roles(text: str, now: float | None = None) -> tuple[list[dict[str, Any]], float | None]:
    """(roles, union_years). Each role is ``{title, text, dates}``; ``union_years`` is the
    measure of the union of the parsed intervals (None when no range parsed)."""
    import time

    clock = now if now is not None else time.gmtime().tm_year + (time.gmtime().tm_mon - 1) / 12
    lines = [ln.strip() for ln in (text or "").splitlines()]
    roles: list[dict[str, Any]] = []
    intervals: list[tuple[float, float]] = []
    section: str | None = None
    current: dict[str, Any] | None = None

    def close() -> None:
        nonlocal current
        if current:
            current["text"] = " ".join(current.pop("lines")).strip()[:600]
            roles.append(current)
        current = None

    for line in lines:
        if not line:
            close()  # a blank line ends an entry: the sidebar that follows is not its text
            continue
        kind = _heading_of(line)
        if kind:
            close()
            section = kind
            continue
        m = _DATE_RANGE.search(line)
        single = None if m else _SINGLE_YEAR.match(line)
        if section == "experience" and (m or single):
            close()
            if m:
                start = _point_value(m.group(1), clock, end=False)
                stop = _point_value(m.group(2), clock, end=True)
                dates = m.group(0).strip()
                head = (line[: m.start()] + " " + line[m.end() :]).strip(" :–—-|,")
            else:
                year = int(single.group(1))
                start, stop = float(year), year + 1.0  # one year-precision year
                dates = single.group(1)
                head = line[single.end() :].strip(" :–—-|,")
            if start is not None and stop is not None and stop >= start:
                intervals.append((start, stop))
            current = {"head": head, "role": None, "dates": dates, "lines": []}
            continue
        if current is None:
            continue
        if current["role"] is None and not current["lines"] and len(line) <= 70 and not line.endswith((".", ";")):
            current["role"] = line
            continue
        current["lines"].append(line)
    close()

    out: list[dict[str, Any]] = []
    for r in roles:
        role, head = r.get("role"), r.get("head") or ""
        # "2019 - 2020: Moneta, a.s." carries the org on the date line and the role under it;
        # a role line may itself be "Role - detail", which stays whole.
        title = f"{role} — {head}" if role and head else (role or head or "Role")
        out.append({"title": f"{title} ({r['dates']})"[:160], "text": r["text"], "dates": r["dates"]})
    return out, (round(_union_years(intervals), 1) if intervals else None)


def deterministic_draft(text: str, lang: str = "en") -> dict[str, Any]:
    """A DRAFT_SCHEMA payload read from ``text`` with no model. Pure."""
    body = text or ""
    # ``detected`` is what the taxonomy saw and is what votes on the role family;
    # ``skills`` is what the draft CLAIMS, so the role words are dropped from it.
    detected = [r["skill"] for r in detect_requirements(body)]
    skills = list(dict.fromkeys(s.strip() for s in detected if s.strip() and not is_role_word(s)))
    seniority = detect_seniority(_first_sentences(body, 3)) or detect_seniority(body[:400])
    level = _SENIOR_TO_LEVEL.get(seniority or "", "working")
    roles, union_years = dated_roles(body)
    # A stated figure ("8 years of …") wins; else the union of the dated roles.
    years = detect_min_years(body)
    if years is None and union_years is not None:
        years = union_years
    languages = detect_languages(body)
    name = _display_name(body)
    # Places are read from the header lines only (a CV names its city up top; the body
    # names every city the person ever worked in), never from the name line itself,
    # and a "place" longer than three words is a sentence fragment, not a city.
    # A section heading ("PROFILE", "Experience") is never a place.
    # The header ends at the first section heading: a "PROFILE" label and the paragraph
    # under it are never where the CV states its place.
    header_lines: list[str] = []
    for ln in body.splitlines()[:6]:
        if _heading_of(ln) is not None:
            break
        if ln.strip() and (not name or name not in ln or " - " in ln or "," in ln):
            header_lines.append(ln)
    header = chr(10).join(header_lines)
    places = parse_locations(header.replace(name, " ") if name else header)
    candidates = [
        p
        for p in places["locations"]
        if 0 < len(p.split()) <= 3 and p != name and p[:1].isupper() and not _EMAIL.search(p) and not _PHONE.search(p)
    ]
    location = candidates[0] if candidates else None
    education = "unknown"
    detail = ""
    for label, pattern in _EDU:
        m = pattern.search(body)
        if m:
            education = label
            line = next((ln.strip() for ln in body.splitlines() if pattern.search(ln)), "")
            detail = line[:120]
            break
    aspirations = []
    for m in _ASPIRATION.finditer(body):
        a = m.group(1).strip()
        if a and a.lower() not in {x.lower() for x in aspirations}:
            aspirations.append(a)
        if len(aspirations) >= 3:
            break
    experiences: list[dict[str, Any]] = []
    for role in roles:
        found = [s for s in (r["skill"] for r in detect_requirements(role["text"] + " " + role["title"])) if not is_role_word(s)]
        experiences.append({"kind": "job", "title": role["title"], "text": role["text"], "skills": found[:8], "link": None})
    if not experiences:
        summary = _first_sentences(body)
        if summary:
            experiences.append({"kind": "job", "title": "Summary", "text": summary, "skills": skills[:6], "link": None})
    enrolled = bool(_STUDENT.search(body))
    return {
        "display_name": name,
        "role_family": classify_role_family(detected, body),
        "education_level": education,
        "education_detail": detail,
        "languages": languages,
        "location": location,
        "availability": None,
        "years_experience": years,
        "aspirations": aspirations,
        "skill_claims": [{"skill": s, "level": level, "provenance": "self_declared"} for s in skills],
        "experiences": experiences,
        "is_enrolled": enrolled,
        "expected_graduation": None,
        "wants_domain_change": False,
        "has_substantial_experience": bool(years and years >= 2) or seniority in ("senior", "lead"),
    }
