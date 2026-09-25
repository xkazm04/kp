"""Deterministic structuring of a harvested job posting into the matcher's ``Job``.

The job-seeker scan structures EVERY posting this way and reserves the LLM for the
shortlist (docs/features/jobseeker/README.md, ADR 0004: keyless degradation is a
product property). So this module is the floor the matcher always stands on: title,
company, location as the source gave them; work mode, seniority and role family
from the text; requirements as taxonomy term detection (whole-token, the same
primitive matching uses), split into must-have / nice-to-have by the SECTION the
term sits in; a salary only when the posting stated one; years of experience and
languages when named. Then :func:`jobs.normalize_job` stamps the locale defaults
and records every phantom in ``defaulted_fields``, exactly as it does for an
LLM-extracted record — the two paths produce the same shape.

Input is the TypeScript ``RawPosting`` (app/_lib/jobseeker/types.ts) as a dict.
"""

from __future__ import annotations

import re
from typing import Any

from .jobs import Job, normalize_job
from .market_config import ACTIVE_MARKET
from .taxonomy import (
    LANGUAGE_ALIASES,
    classify_role_family,
    contains_whole_token,
    detected_skills,
    normalize_text,
)

# --- work mode ----------------------------------------------------------------------

_REMOTE_RE = re.compile(
    r"(?<!\w)(remote|fully remote|home ?office|z domova|na d[áa]lku|pr[áa]ce z domu|"
    r"t[ée]l[ée]travail|100 ?% remote|remote[- ]first)(?!\w)",
    re.IGNORECASE,
)
_HYBRID_RE = re.compile(r"(?<!\w)(hybrid\w*|hybride)(?!\w)", re.IGNORECASE)
_ONSITE_RE = re.compile(
    r"(?<!\w)(on[- ]?site|in[- ]office|in the office|office[- ]based|v kancel[áa][řr]i|na pracovi[šs]ti|"
    r"vor ort|im b[üu]ro|sur site|en pr[ée]sentiel)(?!\w)",
    re.IGNORECASE,
)


def detect_work_mode(raw: dict[str, Any], text: str) -> str | None:
    """JSON-LD ``jobLocationType == TELECOMMUTE`` wins; then the adapter's own reading;
    then the regexes; else None.

    None, not "onsite": an ad that says nothing about where the work happens has not
    said it is an office job. :func:`jobs.normalize_job` then stamps the locale default
    AND records ``work_mode`` in ``defaulted_fields``, which is what keeps the matcher's
    work-mode gate from knocking out a remote-only seeker on a mode the ad never stated.
    An ad that does state the office ("on-site", "v kanceláři") still reads onsite."""
    jsonld = raw.get("jsonld") or {}
    if isinstance(jsonld, dict) and str(jsonld.get("jobLocationType") or "").upper() == "TELECOMMUTE":
        return "remote"
    stated = raw.get("workMode")
    if stated in ("remote", "hybrid", "onsite"):
        return str(stated)
    if _HYBRID_RE.search(text):
        return "hybrid"
    if _REMOTE_RE.search(text):
        return "remote"
    if _ONSITE_RE.search(text):
        return "onsite"
    return None


# --- seniority ------------------------------------------------------------------------

_SENIORITY_TITLE = (
    ("lead", re.compile(r"(?<!\w)(lead|principal|head of|staff|architect|team ?lead|vedouc[íi]|leiter)(?!\w)", re.IGNORECASE)),
    ("senior", re.compile(r"(?<!\w)(senior|sr\.?|seniorn[íi])(?!\w)", re.IGNORECASE)),
    ("junior", re.compile(r"(?<!\w)(junior|jr\.?|graduate|absolvent\w*|intern(ship)?|trainee|st[áa]žist\w*)(?!\w)", re.IGNORECASE)),
    ("medior", re.compile(r"(?<!\w)(medior|mid[- ]?level|intermediate|mid)(?!\w)", re.IGNORECASE)),
)


def detect_seniority(title: str) -> str | None:
    """Title heuristics only — the body of an ad names every level it does NOT want."""
    for level, pattern in _SENIORITY_TITLE:
        if pattern.search(title):
            return level
    return None


# --- requirement sections ---------------------------------------------------------------

_REQ_HEADER_RE = re.compile(
    r"^\W*(po[žz]adujeme|po[žz]adavky|co (od v[áa]s )?o[čc]ek[áa]v[áa]me|co by(s|ste) m[ěe]l[ia]? um[ěe]t|"
    r"requirements?|what (you|we) (bring|need|expect|are looking for)|you (have|bring)|must[- ]haves?|qualifications|"
    r"your profile|skills( and experience)?|anforderungen|ihr profil|das bringen sie mit|was sie mitbringen|"
    r"exigences|profil recherch[ée]|comp[ée]tences requises)\b",
    re.IGNORECASE,
)
_NICE_HEADER_RE = re.compile(
    r"^\W*(v[ýy]hodou|nice[- ]to[- ]haves?|bonus|plus|preferred|w[üu]nschenswert|von vorteil|atouts?|un plus)\b",
    re.IGNORECASE,
)
_OTHER_HEADER_RE = re.compile(
    r"^\W*(nab[íi]z[íi]me|benefity|n[áa]pl[ňn] pr[áa]ce|co v[áa]s [čc]ek[áa]|o n[áa]s|"
    r"we offer|benefits|perks|responsibilities|what you('ll| will) do|about (us|the role|the team)|the role|your (role|mission)|"
    r"wir bieten|aufgaben|ihre aufgaben|[üu]ber uns|nous offrons|missions|vos missions|[àa] propos)\b",
    re.IGNORECASE,
)
_MAX_HEADER_CHARS = 60


def split_sections(body: str) -> dict[str, str]:
    """Bucket the body's lines by the section header above them: ``must`` for a
    requirements block, ``nice`` for a nice-to-have block, ``other`` otherwise. A
    header is a SHORT line matching one of the vocabularies (Czech, English, German,
    French); a long line never switches the bucket."""
    buckets = {"must": [], "nice": [], "other": []}  # type: dict[str, list[str]]
    current = "other"
    for line in body.splitlines():
        stripped = line.strip()
        if not stripped:
            continue
        if len(stripped) <= _MAX_HEADER_CHARS:
            if _NICE_HEADER_RE.match(stripped):
                current = "nice"
                continue
            if _REQ_HEADER_RE.match(stripped):
                current = "must"
                continue
            if _OTHER_HEADER_RE.match(stripped):
                current = "other"
                continue
        buckets[current].append(stripped)
    return {k: "\n".join(v) for k, v in buckets.items()}


def detect_requirements(body: str) -> list[dict[str, str]]:
    """Taxonomy skill terms present in the body (whole-token), each tagged must_have when
    it sits inside a requirements section, nice_to_have otherwise. Inline "is a plus" /
    "výhodou" on the SAME line as the term demotes it to nice_to_have."""
    sections = split_sections(body)
    must_n = normalize_text(sections["must"])
    nice_n = normalize_text(sections["nice"])
    out: list[dict[str, str]] = []
    for surface in detected_skills(body):
        surface_n = normalize_text(surface)
        in_must = contains_whole_token(must_n, surface_n)
        in_nice = contains_whole_token(nice_n, surface_n)
        kind = "must_have" if in_must and not (in_nice and not in_must) else "nice_to_have"
        if in_must and _inline_plus(sections["must"], surface_n):
            kind = "nice_to_have"
        out.append({"skill": surface, "kind": kind})
    return out


_INLINE_PLUS_RE = re.compile(r"(v[ýy]hodou|is a plus|a plus|nice to have|bonus|von vorteil|w[üu]nschenswert|un plus|appr[ée]ci[ée])", re.IGNORECASE)


def _inline_plus(section: str, surface_n: str) -> bool:
    for line in section.splitlines():
        if contains_whole_token(normalize_text(line), surface_n) and _INLINE_PLUS_RE.search(line):
            return True
    return False


# --- salary ---------------------------------------------------------------------------

_CURRENCY_TOKENS = {
    "czk": "CZK", "kč": "CZK", "kc": "CZK", "korun": "CZK",
    "eur": "EUR", "€": "EUR", "euro": "EUR",
    "usd": "USD", "$": "USD",
    "gbp": "GBP", "£": "GBP",
    "pln": "PLN", "zł": "PLN", "chf": "CHF",
}
_CURRENCY_RE = re.compile(r"(czk|k[čc]\b|korun\w*|eur\b|euro\b|€|usd\b|\$|gbp\b|£|pln\b|z[łl]\b|chf\b)", re.IGNORECASE)
# The thousands suffix must not be a letter run's first character ("250 Kč" is not 250k).
_NUMBER_RE = re.compile(r"(?<![\d.,])(\d{1,3}(?:[  .,]\d{3})+|\d+(?:[.,]\d+)?)\s*(k(?![^\W\d_])|tis\.?|tisíc)?(?![\d])", re.IGNORECASE)
_YEAR_RE = re.compile(r"(ro[čc]n[ěe]|per (year|annum)|p\.\s?a\.|annual\w*|yearly|/\s?(year|yr|rok)|j[äa]hrlich|pro jahr|par an|annuel\w*|brutto/jahr)", re.IGNORECASE)
_HOUR_RE = re.compile(r"(hodin\w*|hod\.?(?!\w)|/\s?h(?!\w)|per hour|hourly|st[üu]ndl\w*|/\s?heure|hodinov\w*)", re.IGNORECASE)
_SALARY_WINDOW = 48
_MIN_PLAUSIBLE = 1_000
# An hourly rate lives two orders of magnitude below a monthly one (250 Kč/hod), so the
# monthly floor would reject every one of them. Only applied inside a window that
# already matched _HOUR_RE, so it never loosens the monthly/yearly reading.
_MIN_PLAUSIBLE_HOUR = 50
_MAX_PLAUSIBLE = 10_000_000
_MONTHS_PER_YEAR = 12


def _to_amount(number: str, suffix: str | None) -> float | None:
    digits = re.sub(r"[  ]", "", number)
    if re.search(r"[.,]\d{1,2}$", digits) and not re.search(r"[.,]\d{3}$", digits):
        digits = re.sub(r"[.,](?=\d{3}(?:[.,]|$))", "", digits).replace(",", ".")
    else:
        digits = re.sub(r"[.,]", "", digits)
    try:
        value = float(digits)
    except ValueError:
        return None
    if suffix:
        value *= 1000
    return value


def detect_salary(raw: dict[str, Any], body: str) -> dict[str, Any] | None:
    """``raw["salary"]`` (the adapter's JSON-LD / feed parse) wins. Otherwise a regex
    over salaryText then the body: a currency token with one or two amounts within a
    short window; monthly unless a yearly marker sits in the window; an hourly figure is
    read as ``period="hour"`` but only as a LAST resort, after every monthly/yearly
    mention in the text has been tried. Never invents one.

    An hourly figure used to be dropped entirely, which reached the seeker's salary flag
    as "posting states no pay" — a falsehood about an ad that stated its pay per hour.
    No band is built from it (:func:`structure_posting`); the period is what carries the
    truth."""
    given = raw.get("salary")
    if isinstance(given, dict) and given.get("currency") and (given.get("min") is not None or given.get("max") is not None):
        period = given.get("period") if given.get("period") in ("month", "year", "hour") else "month"
        return {"min": given.get("min"), "max": given.get("max"), "currency": str(given["currency"]).upper(), "period": period}
    for text in (raw.get("salaryText") or "", body or ""):
        if not text:
            continue
        found = _salary_in_text(text)
        if found:
            return found
    return None


def _salary_in_text(text: str) -> dict[str, Any] | None:
    hourly: dict[str, Any] | None = None
    for cur in _CURRENCY_RE.finditer(text):
        token = cur.group(1).lower().rstrip(".")
        currency = None
        for key, code in _CURRENCY_TOKENS.items():
            if token.startswith(key) or key.startswith(token):
                currency = code
                break
        if not currency:
            continue
        lo = max(0, cur.start() - _SALARY_WINDOW)
        hi = min(len(text), cur.end() + _SALARY_WINDOW)
        window = text[lo:hi]
        is_hourly = bool(_HOUR_RE.search(window))
        floor = _MIN_PLAUSIBLE_HOUR if is_hourly else _MIN_PLAUSIBLE
        amounts = []
        for m in _NUMBER_RE.finditer(window):
            value = _to_amount(m.group(1), m.group(2))
            if value is not None and floor <= value <= _MAX_PLAUSIBLE:
                amounts.append(value)
        if not amounts:
            continue
        low, high = min(amounts), max(amounts)
        if is_hourly:
            # Held back, not returned: an ad that quotes an hourly rate AND a monthly
            # range must be read as the monthly one.
            if hourly is None:
                hourly = {"min": low, "max": high, "currency": currency, "period": "hour"}
            continue
        period = "year" if _YEAR_RE.search(window) else "month"
        return {"min": low, "max": high, "currency": currency, "period": period}
    return hourly


# --- experience + languages -----------------------------------------------------------------

_YEARS_RE = re.compile(r"(?<!\d)(\d{1,2})\s*\+?\s*(?:-\s*\d{1,2}\s*)?(years?|yrs?|let|rok[yů]?|jahren?|ans|ann[ée]es?)(?!\w)", re.IGNORECASE)
_MAX_YEARS = 30


def detect_min_years(text: str) -> float | None:
    """The FIRST "N+ years/let/Jahre/ans" figure under 30; a range takes its lower end."""
    for m in _YEARS_RE.finditer(text):
        n = int(m.group(1))
        if 0 < n <= _MAX_YEARS:
            return float(n)
    return None


_LANGUAGE_LABELS = {
    "english": "English", "czech": "Czech", "german": "German", "slovak": "Slovak", "french": "French",
    "spanish": "Spanish", "italian": "Italian", "polish": "Polish", "russian": "Russian", "ukrainian": "Ukrainian",
    "dutch": "Dutch", "portuguese": "Portuguese", "hungarian": "Hungarian",
}


# The taxonomy's aliases are CV-side (a Czech or English CV names its languages); a
# German or French AD names them in its own language, so those forms are added here.
_EXTRA_LANGUAGE_NEEDLES: dict[str, tuple[str, ...]] = {
    "english": ("englisch", "anglais"),
    "german": ("allemand", "němčin", "nemcin"),
    "french": ("französisch", "franzoesisch", "français", "francais", "francouz"),
    "czech": ("tschechisch", "tchèque", "tcheque"),
    "slovak": ("slowakisch", "slovaque"),
    "spanish": ("spanisch", "espagnol", "španěl", "spanel"),
    "italian": ("italienisch", "italien", "ital"),
    "polish": ("polnisch", "polonais", "polsk"),
}


def detect_languages(text: str) -> list[str]:
    """Language names via the taxonomy's own alias table (``language_aliases``) plus the
    German/French ad-side forms above; a needle under four characters must stand as a
    whole word so "en " does not fire on Czech prose, and a longer one is a STEM that
    must start a word ("italsky", "Italienisch") — never a substring inside one, which
    read "dig-ital" as Italian on every CV and ad that mentioned digital work."""
    folded = text.casefold()
    out: list[str] = []
    for lang, needles in LANGUAGE_ALIASES.items():
        hit = False
        for needle in (*needles, *_EXTRA_LANGUAGE_NEEDLES.get(lang, ())):
            n = needle.strip()
            if not n:
                continue
            if len(n) < 4:
                if re.search(rf"(?<!\w){re.escape(n)}(?!\w)", folded):
                    hit = True
                    break
            elif re.search(rf"(?<!\w){re.escape(n)}", folded):
                hit = True
                break
        if hit:
            out.append(_LANGUAGE_LABELS.get(lang, lang.capitalize()))
    return out


# --- the entry point -------------------------------------------------------------------------


def _to_market_period(amount: float | None, period: str) -> float | None:
    """``amount`` restated in the ACTIVE market's pay period, or None when the two
    periods are not a x12 apart (an hourly figure, or an exotic market period).

    The ONLY arithmetic this module does to a stated figure, and it exists so a
    CZK/year ad in a CZK/month market yields a band instead of a shrug. It touches the
    BAND only — ``Job.salary_period`` keeps the period the ad wrote."""
    if amount is None:
        return None
    if period == ACTIVE_MARKET.period:
        return amount
    if period == "year" and ACTIVE_MARKET.period == "month":
        return amount / _MONTHS_PER_YEAR
    if period == "month" and ACTIVE_MARKET.period == "year":
        return amount * _MONTHS_PER_YEAR
    return None


def structure_posting(raw: dict[str, Any], *, job_id: str | None = None) -> tuple[Job, list[str]]:
    """RawPosting dict → (Job, notes). Notes name what was NOT taken as a band (a salary
    in a currency the market cannot compare, an hourly figure) and what was restated to
    reach one (``salary_period_converted:year->month``), so the caller can show
    "unknown" honestly instead of a converted or invented number. The stated
    currency/period always survive on the Job."""
    if not isinstance(raw, dict):
        raise ValueError("raw posting must be an object")
    title = str(raw.get("title") or "").strip()
    if not title:
        raise ValueError("raw posting has no title")
    body = str(raw.get("bodyText") or "")
    text = f"{title}\n{body}"
    notes: list[str] = []

    requirements = detect_requirements(body)
    skills = [r["skill"] for r in requirements]
    role_family = classify_role_family(skills, text)
    salary = detect_salary(raw, body)

    record: dict[str, Any] = {
        "title": title,
        "company": raw.get("company") or None,
        "location": raw.get("location") or None,
        "work_mode": detect_work_mode(raw, text),
        "seniority": detect_seniority(title),
        "role_family": role_family,
        "languages": detect_languages(body),
        "min_years_experience": detect_min_years(body),
        "description": body[:20_000],
        "requirements": requirements,
        "source": "posting",
    }
    if salary:
        # What the ad STATED travels on the Job itself, always — even when no band can
        # be built from it. The reader is then told "hourly pay stated" or "not
        # comparable: CZK vs EUR" instead of the falsehood "posting states no pay".
        record["salary_currency"] = salary["currency"]
        record["salary_period"] = salary["period"]
        # salary_band stays denominated in the ACTIVE market's currency AND period, so
        # every consumer (the plausibility ceiling, market stats, the matcher's salary
        # flag) reads one unit. A foreign currency is still "not comparable" — no FX,
        # ever (types.ts SalaryFloor contract). A foreign PERIOD in the market's own
        # currency is comparable: x12 is arithmetic, not a rate, and it is applied to
        # the BAND only; ``salary_period`` keeps what the ad actually said.
        if salary["currency"] != ACTIVE_MARKET.currency:
            notes.append(f"salary_not_comparable:{salary['currency']}/{salary['period']}")
        elif salary["period"] == "hour":
            notes.append(f"salary_hourly:{salary['currency']}")
        else:
            lo = salary.get("min")
            hi = salary.get("max")
            if lo is None:
                lo = hi
            if hi is None:
                hi = lo
            lo = _to_market_period(lo, salary["period"])
            hi = _to_market_period(hi, salary["period"])
            if lo is None or hi is None:
                notes.append(f"salary_not_comparable:{salary['currency']}/{salary['period']}")
            else:
                if salary["period"] != ACTIVE_MARKET.period:
                    notes.append(f"salary_period_converted:{salary['period']}->{ACTIVE_MARKET.period}")
                record["salary_min"] = lo
                record["salary_max"] = hi
    job = normalize_job(record, job_id=job_id)
    return job, notes
