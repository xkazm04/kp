from __future__ import annotations

import json
import re
import unicodedata
from enum import Enum
from functools import lru_cache
from pathlib import Path
from typing import Any


_DATA_DIR = Path(__file__).resolve().parents[2] / "data"
_BENCHMARKS_PATH = _DATA_DIR / "salary_benchmarks.json"
_TAXONOMY_PATH = _DATA_DIR / "taxonomy.json"


def _load_json(path: Path) -> dict[str, Any]:
    """Load a committed JSON data file as a dict, with actionable errors.

    These files are routinely hand- or LLM-edited, so a clear message that names
    the file and reason beats a bare ``FileNotFoundError`` / ``JSONDecodeError``
    whose traceback points at module import rather than the data.
    """
    try:
        raw = path.read_text(encoding="utf-8")
    except FileNotFoundError as exc:
        raise RuntimeError(f"Required data file is missing: {path}") from exc
    except OSError as exc:
        raise RuntimeError(f"Could not read data file {path}: {exc}") from exc
    try:
        data = json.loads(raw)
    except json.JSONDecodeError as exc:
        raise RuntimeError(f"Invalid JSON in {path}: {exc}") from exc
    if not isinstance(data, dict):
        raise RuntimeError(
            f"Expected a JSON object at the top of {path}, got {type(data).__name__}."
        )
    return data


_BENCHMARKS: dict[str, Any] = _load_json(_BENCHMARKS_PATH)
_TAXONOMY: dict[str, Any] = _load_json(_TAXONOMY_PATH)

# Validate the taxonomy shape up front: every consumer assumes each term has an
# 'id' and a 'match' list, so a missing 'terms' array or a malformed entry is a
# clear, actionable failure here rather than a cryptic KeyError deep in matching.
_raw_terms = _TAXONOMY.get("terms")
if not isinstance(_raw_terms, list) or not _raw_terms:
    raise RuntimeError(
        f"{_TAXONOMY_PATH} must contain a non-empty 'terms' array "
        f"(got {type(_raw_terms).__name__})."
    )
_TERMS: list[dict[str, Any]] = []
for _i, _entry in enumerate(_raw_terms):
    if not isinstance(_entry, dict) or not _entry.get("id") or not isinstance(_entry.get("match"), list):
        raise RuntimeError(
            f"{_TAXONOMY_PATH}: terms[{_i}] must be an object with a non-empty 'id' "
            f"and a 'match' list."
        )
    _TERMS.append(_entry)

# Validate the salary benchmark roles: a non-empty 'roles' array where each role
# names a 'family'. ROLE_FAMILIES[0] is the fallback default, so an empty list
# would otherwise IndexError at import.
_raw_roles = _BENCHMARKS.get("roles")
if not isinstance(_raw_roles, list) or not _raw_roles:
    raise RuntimeError(
        f"{_BENCHMARKS_PATH} must contain a non-empty 'roles' array "
        f"(got {type(_raw_roles).__name__})."
    )
_ROLES: list[dict[str, Any]] = []
for _i, _role in enumerate(_raw_roles):
    if not isinstance(_role, dict) or not _role.get("family"):
        raise RuntimeError(
            f"{_BENCHMARKS_PATH}: roles[{_i}] must be an object with a non-empty 'family'."
        )
    _ROLES.append(_role)

ROLE_FAMILIES: tuple[str, ...] = tuple(role["family"] for role in _ROLES)
ROLE_FAMILY_SET: frozenset[str] = frozenset(ROLE_FAMILIES)
DEFAULT_FAMILY: str = _BENCHMARKS.get("default_family") or ROLE_FAMILIES[0]

RoleFamily = Enum("RoleFamily", {family.upper(): family for family in ROLE_FAMILIES})

# Role-family vocabulary descriptions (data/taxonomy.json::role_families). The
# taxonomy owns the *meaning* of each family; salary_benchmarks.json provides its
# bands. The analysis prompt lists these so the model picks an industry-appropriate
# family instead of collapsing every CV to a technology family (idea P0-1). Every
# benchmark family MUST be described here, or classification has no human anchor.
ROLE_FAMILY_DESCRIPTIONS: dict[str, str] = {
    str(fam): str(desc) for fam, desc in (_TAXONOMY.get("role_families") or {}).items()
}
_undescribed_families = [f for f in ROLE_FAMILIES if f not in ROLE_FAMILY_DESCRIPTIONS]
if _undescribed_families:
    raise RuntimeError(
        f"{_BENCHMARKS_PATH} role families missing a description in "
        f"{_TAXONOMY_PATH}::role_families: {_undescribed_families}. "
        "Add a one-line description for each so the analysis prompt can present it."
    )


def role_family_catalog() -> list[tuple[str, str]]:
    """``(family_id, description)`` for every known role family, benchmark order first.

    Fed to the analysis prompt so the model chooses an industry-appropriate family
    rather than defaulting a non-technology candidate to a technology family.
    """
    seen: set[str] = set()
    catalog: list[tuple[str, str]] = []
    for fam in ROLE_FAMILIES:
        catalog.append((fam, ROLE_FAMILY_DESCRIPTIONS.get(fam, "")))
        seen.add(fam)
    for fam, desc in ROLE_FAMILY_DESCRIPTIONS.items():
        if fam not in seen:
            catalog.append((fam, desc))
    return catalog

# Role-family-keyed surface heuristics for the early-career / career-switcher
# transform (transform.compute_potential, transferable.domain_distance). The
# taxonomy owns them as DATA so all 16 families are covered — a non-tech family is
# no longer silently degraded to an empty tuple the way the old hardcoded 3-family
# dicts in transform.py/transferable.py did. See data/taxonomy.json
# ::_doc_family_heuristics. Every ROLE_FAMILY must appear in both, or the transform
# would quietly score that family's candidates against no evidence at all.
FAMILY_DEGREE_TERMS: dict[str, tuple[str, ...]] = {
    str(fam): tuple(str(t) for t in terms)
    for fam, terms in (_TAXONOMY.get("family_degree_terms") or {}).items()
}
ADJACENT_DOMAIN_SIGNALS: dict[str, tuple[str, ...]] = {
    str(fam): tuple(str(s) for s in sigs)
    for fam, sigs in (_TAXONOMY.get("adjacent_domain_signals") or {}).items()
}
for _map_name, _fam_map in (("family_degree_terms", FAMILY_DEGREE_TERMS), ("adjacent_domain_signals", ADJACENT_DOMAIN_SIGNALS)):
    _missing_families = [f for f in ROLE_FAMILIES if f not in _fam_map]
    if _missing_families:
        raise RuntimeError(
            f"{_TAXONOMY_PATH}::{_map_name} is missing entries for role families "
            f"{_missing_families}. Every family in salary_benchmarks.json must be "
            "covered so the early-career/switcher transform has surface heuristics for it."
        )

# Canonical language -> lowercased needle substrings that satisfy a requirement for
# that language in the KO filter / language-coverage blend (matching._has_language).
# Lives in data (data/taxonomy.json::language_aliases) so a new required language is
# config, not a hardcoded matching.py dict; matching's raw-matching fallback only
# fires for a required language with NO bucket here.
_raw_language_aliases = _TAXONOMY.get("language_aliases")
if not isinstance(_raw_language_aliases, dict) or not _raw_language_aliases:
    raise RuntimeError(
        f"{_TAXONOMY_PATH}::language_aliases must be a non-empty object mapping a "
        "language key to a list of lowercased needle strings."
    )
LANGUAGE_ALIASES: dict[str, tuple[str, ...]] = {}
for _lang, _needles in _raw_language_aliases.items():
    if (
        not isinstance(_needles, list)
        or not _needles
        or not all(isinstance(_n, str) and _n for _n in _needles)
    ):
        raise RuntimeError(
            f"{_TAXONOMY_PATH}::language_aliases[{_lang!r}] must be a non-empty list "
            "of non-empty needle strings."
        )
    # _has_language casefolds the candidate's language blob before substring-testing
    # these needles, so an upper/mixed-case needle is dead config it could never
    # match. Enforce the lowercase invariant at load so an authoring slip on a new
    # language fails loudly here instead of silently never matching.
    _bad_case = [_n for _n in _needles if _n != _n.casefold()]
    if _bad_case:
        raise RuntimeError(
            f"{_TAXONOMY_PATH}::language_aliases[{_lang!r}] needles must be lowercase "
            f"(casefolded); offending: {_bad_case!r}."
        )
    LANGUAGE_ALIASES[str(_lang)] = tuple(_needles)

COMPANY_ADJUSTMENTS: dict[str, dict[str, Any]] = dict(_TAXONOMY.get("company_adjustments", {}))
COMPANY_MODIFIER_EFFECTS: dict[str, dict[str, Any]] = dict(_TAXONOMY.get("company_modifier_effects", {}))
SALARY_SIGNAL_RATIONALE: dict[str, str] = {
    signal: meta.get("rationale", "")
    for signal, meta in _TAXONOMY.get("salary_signals", {}).items()
}


def normalize_text(text: str) -> str:
    """NFC-normalize + casefold — the single accent/case-insensitive normalizer.

    The canonical normalization primitive: taxonomy's own scans AND ats.py (which
    used to reimplement a byte-identical copy) both fold surface text through this,
    so "C++"/"C#"/".NET"/"Registered Nurse" normalize the same everywhere.
    """
    return unicodedata.normalize("NFC", text).casefold()


# Internal alias kept for the many existing call sites in this module.
_normalize = normalize_text


def _compact(text: str) -> str:
    return re.sub(r"\W+", "", text, flags=re.UNICODE)


def _word_boundary_pattern(surface_norm: str, *, flexible_ws: bool) -> "re.Pattern[str] | None":
    """Compile a whole-token matcher for an already-normalized surface form.

    Non-word lookarounds (``(?<!\\w)…(?!\\w)``) so a short or special-charactered
    skill ("R", "Go", "C++", "C#", ".NET") matches as a standalone token and never
    inside an unrelated word. ``flexible_ws`` joins the surface's word-parts with
    ``\\s+`` (a line-wrapped "machine learning" still matches); otherwise the
    surface is matched with its literal spacing. Returns ``None`` for an empty
    surface so callers treat it as "no match" rather than matching everything.
    """
    if flexible_ws:
        parts = [re.escape(p) for p in surface_norm.split() if p]
        if not parts:
            return None
        body = r"\s+".join(parts)
    else:
        if not surface_norm:
            return None
        body = re.escape(surface_norm)
    return re.compile(rf"(?<!\w){body}(?!\w)", flags=re.UNICODE)


def contains_whole_token(text_norm: str, surface_norm: str) -> bool:
    """Whitespace-flexible whole-token presence of ``surface_norm`` in ``text_norm``
    (both already :func:`normalize_text`-folded)."""
    pattern = _word_boundary_pattern(surface_norm, flexible_ws=True)
    return pattern is not None and pattern.search(text_norm) is not None


def count_whole_token(text_norm: str, surface_norm: str) -> int:
    """Whole-token occurrence count of ``surface_norm`` in ``text_norm`` (both
    already :func:`normalize_text`-folded), literal spacing."""
    pattern = _word_boundary_pattern(surface_norm, flexible_ws=False)
    return len(pattern.findall(text_norm)) if pattern is not None else 0


def _term_match_strings(term: dict[str, Any]) -> list[str]:
    return [_normalize(form) for form in term.get("match", [])]


def _text_contains(text: str, compact_text: str, surface: str) -> bool:
    if not surface:
        return False
    normalized = _normalize(surface)
    # Whole-token literal match (reuses contains_whole_token, the same primitive
    # ats.py uses): the surface must appear as a standalone token, never as a raw
    # substring inside an unrelated word. The old ``normalized in text`` had NO
    # length guard, so a 2-char surface form (a language/skill alias like "go" or
    # "hr") matched inside words like "goal"/"chráněný" and misrouted the role
    # family / salary signal. ``text`` is already normalize_text-folded by callers.
    if contains_whole_token(text, normalized):
        return True
    compact_form = _compact(normalized)
    # Only fall back to spaceless/compact matching for forms of length >= 3. A 1-2
    # char compact form (e.g. "c#" -> "c", "c++" -> "c", "go") is a substring of
    # countless unrelated words and would match almost any text — which silently
    # voted software_engineering on every CV via the "c#" term. Such short skills
    # still match precisely through the whole-token branch above.
    return len(compact_form) >= 3 and compact_form in compact_text


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


# --- Hierarchy graph (taxonomy v3) -----------------------------------------
# A term's ``parents`` are broader/superset skills; the term itself is a
# specialization (swiftui -> swift, fastapi -> python). The matching engine
# uses these edges so a foundational or adjacent skill counts as a partial
# match instead of a miss. Built once at import.

_TERM_BY_ID: dict[str, dict[str, Any]] = {term["id"]: term for term in _TERMS}
_PARENTS: dict[str, tuple[str, ...]] = {
    term["id"]: tuple(p for p in term.get("parents", []) if p in {t["id"] for t in _TERMS})
    for term in _TERMS
}

def _transitive_closure(seed: str, edges: dict[str, tuple[str, ...]]) -> frozenset[str]:
    """All nodes reachable from ``seed`` via ``edges`` (excluding ``seed``). Cycle-safe."""
    seen: set[str] = set()
    stack = list(edges.get(seed, ()))
    while stack:
        node = stack.pop()
        if node in seen:
            continue
        seen.add(node)
        stack.extend(edges.get(node, ()))
    return frozenset(seen)


_ANCESTORS: dict[str, frozenset[str]] = {
    tid: _transitive_closure(tid, _PARENTS) for tid in _TERM_BY_ID
}

# Normalized surface form (literal + word-compact) -> canonical term id.
# First writer wins, so earlier terms own a surface on the rare collision.
_SURFACE_TO_TERM: dict[str, str] = {}
for _term in _TERMS:
    for _form in _term["match"]:
        _literal = _normalize(_form).strip()
        if _literal:
            _SURFACE_TO_TERM.setdefault(_literal, _term["id"])
        _compact_form = _compact(_normalize(_form))
        if _compact_form:
            _SURFACE_TO_TERM.setdefault(_compact_form, _term["id"])


# How an evidence's source discounts a skill claim. A skill used five years in
# production (professional) is stronger evidence than the same skill named in a
# self-rated list or touched once in a school project. Consumed by the student
# transformation/scoring layers; defaults to ``professional`` for BAU.
PROVENANCE_WEIGHTS: dict[str, float] = {
    # Highest trust: a skill demonstrated FIRST-HAND in a live case or confirmed
    # in the interview — observed directly, not taken on the candidate's word.
    # The multiplier is capped at 1.0 (full match credit, like professional) so it
    # never inflates a score past the base skill match; its extra value over
    # professional is realized in the confidence band (matching._confidence
    # narrows when a skill is observed) and in consolidation (it outranks the
    # self-declared / coursework evidence a zero-experience student typically has).
    # Set by the live-case / interview-scorecard producers — never self-declared.
    "observed": 1.0,
    "professional": 1.0,
    "open_source": 0.85,
    "internship": 0.85,
    "thesis": 0.75,
    "academic_project": 0.7,
    "personal_project": 0.7,
    "extracurricular": 0.6,
    "certification": 0.6,
    "coursework": 0.5,
    "self_declared": 0.4,
    "unknown": 0.6,
}
DEFAULT_PROVENANCE = "professional"

# The user-selectable provenance values, in dropdown display order (weakest →
# strongest evidence). A curated SUBSET of PROVENANCE_WEIGHTS: it omits
# "observed" (set only by the live-case / interview-scorecard producers, never
# picked by a candidate) and "unknown" (the scoring fallback, not a real choice).
# This is the single source of truth the frontend dropdown is generated from —
# codegen.py emits it into app/_lib/taxonomy.generated.ts (idea-ba28f11b), so a
# value added here reaches the UI, and a value the UI offers always has a weight.
UI_PROVENANCE: tuple[str, ...] = (
    "self_declared",
    "coursework",
    "academic_project",
    "thesis",
    "personal_project",
    "open_source",
    "internship",
    "professional",
    "certification",
    "extracurricular",
)

# Fail fast if a selectable provenance has no scoring weight — otherwise it would
# silently score as PROVENANCE_WEIGHTS["unknown"] downstream with no error.
_unweighted_ui_provenance = [p for p in UI_PROVENANCE if p not in PROVENANCE_WEIGHTS]
if _unweighted_ui_provenance:
    raise RuntimeError(
        "UI_PROVENANCE values missing from PROVENANCE_WEIGHTS: "
        f"{_unweighted_ui_provenance}"
    )

# Hierarchy match weights (base, before provenance).
_SPECIALIZATION_MATCH = 0.9   # candidate knows a specialization of the requirement
_GENERALIZATION_MATCH = 0.55  # candidate knows only the broader / foundational skill


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

    Returns ``None`` when the family is unknown, the seniority key is missing, or
    the band entry is short / non-numeric (tolerated by skipping rather than
    raising). Used by the deterministic-evidence pre-pass to anchor Gemini's
    salary range.
    """
    for role in _ROLES:
        if role.get("family") != family:
            continue
        band = role.get(seniority)
        if not isinstance(band, (list, tuple)) or len(band) < 2:
            return None
        try:
            return int(band[0]), int(band[1])
        except (TypeError, ValueError):
            return None
    return None


# Default cap on the skill surface-forms returned by ``detected_skills``.
# Generous by design: the list only *seeds* Gemini's extraction (which wins),
# so it errs toward recall. Callers feeding a size-sensitive prompt may pass a
# smaller ``limit`` (see ``DETECTED_SKILLS_PREPASS_LIMIT`` in pipeline.py).
DEFAULT_DETECTED_SKILLS_LIMIT = 40


def detected_skills(text: str, limit: int = DEFAULT_DETECTED_SKILLS_LIMIT) -> list[str]:
    """Surface forms of skill terms present in ``text``.

    Used by the deterministic pre-pass to give Gemini a starting list it can
    confirm or correct. Not authoritative — Gemini's extraction wins. The list
    is capped at ``limit`` (default ``DEFAULT_DETECTED_SKILLS_LIMIT``); the cap
    bounds prompt size and is not surfaced to the user, so no "+N more" applies.
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
    # Normalize the text up front (case/diacritic-fold) the same way detected_skills
    # does — _text_contains only folds the surface form, so a raw mixed-case CV would
    # otherwise miss "Registered Nurse"/"Account Manager" on the literal branch.
    text_n = _normalize(text)
    compact_text = _compact(text_n)
    recent_n = _normalize(recent_text) if recent_text else ""
    compact_recent = _compact(recent_n) if recent_n else ""

    scores: dict[str, float] = {family: 0.0 for family in ROLE_FAMILIES}
    for term in _TERMS:
        votes = term.get("role_family_votes")
        if not votes:
            continue
        forms = _term_match_strings(term)
        in_skills = any(form in skill_set for form in forms)
        in_text = any(_text_contains(text_n, compact_text, form) for form in term["match"])
        in_recent = bool(recent_n) and any(
            _text_contains(recent_n, compact_recent, form) for form in term["match"]
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


def scan_category(text: str, category: str, attr: str) -> list[str]:
    """Generic taxonomy scan: every ``attr`` value whose term in ``category``
    matches ``text``, in declaration order, de-duplicated.

    This is the single primitive behind classify_company_type / company_modifiers
    / classify_education and the seniority-signal helpers — each is the same
    normalize -> compact -> iterate-terms scan with a different attribute, so a
    taxonomy schema change is made here once instead of in four copy-pasted clones.
    """
    text_n = _normalize(text)
    compact = _compact(text_n)
    found: list[str] = []
    for term in _terms_by_category(category):
        if not _term_in_text(term, text_n, compact):
            continue
        value = term.get(attr)
        if value and value not in found:
            found.append(value)
    return found


def detected_seniority_levels(text: str) -> set[str]:
    """The seniority levels (junior/medior/senior/lead) whose markers appear in ``text``."""
    return set(scan_category(text, "seniority", "seniority_level"))


def classify_company_type(text: str) -> str:
    found = scan_category(text, "company_type", "company_type")
    return found[0] if found else "unknown"


def company_modifiers(text: str) -> list[str]:
    return scan_category(text, "company_modifier", "company_modifier")


_EDUCATION_PRIORITY = ["phd", "master", "bachelor", "university"]


def classify_education(text: str) -> str:
    found = set(scan_category(text, "education", "education_level"))
    for level in _EDUCATION_PRIORITY:
        if level in found:
            return level
    return "unknown"


def has_seniority_lead_signal(text: str) -> bool:
    return "lead" in detected_seniority_levels(text)


def has_seniority_senior_signal(text: str) -> bool:
    return "senior" in detected_seniority_levels(text)


def has_seniority_medior_signal(text: str) -> bool:
    return "medior" in detected_seniority_levels(text)


def has_seniority_junior_signal(text: str) -> bool:
    """Entry-level marker (student/intern/trainee/junior/graduate).

    High-precision self-description: you say "student"/"intern" about yourself
    only when you are one. Used as a floor when anchoring salary so a stray
    senior/lead token can't anchor an entry-level CV above its band.
    """
    return "junior" in detected_seniority_levels(text)


# --- Hierarchy + provenance API (taxonomy v3) ------------------------------


@lru_cache(maxsize=8192)
def resolve_term(surface: str) -> str | None:
    """Map a skill surface form (e.g. ``"k8s"``, ``"ReactJS"``) to its canonical term id.

    Returns ``None`` for surfaces not present in the taxonomy (e.g. a niche tool
    Gemini extracted that we don't model). Matching falls back to string equality
    for those — see :func:`skill_match_score`.

    Memoized: the surface->term map (``_SURFACE_TO_TERM``) is built once at import and
    never mutates, so resolution is a pure function of ``surface``. The O(n^2)
    fairness/winnability paths resolve the same handful of skills thousands of times;
    caching turns each into a single lookup.
    """
    if not surface:
        return None
    literal = _normalize(surface).strip()
    if literal in _SURFACE_TO_TERM:
        return _SURFACE_TO_TERM[literal]
    return _SURFACE_TO_TERM.get(_compact(literal))


def ancestors(term_id: str) -> frozenset[str]:
    """Transitive broader/superset terms of ``term_id`` (swiftui -> {swift})."""
    return _ANCESTORS.get(term_id, frozenset())


def is_subset_of(child_term: str, parent_term: str) -> bool:
    """True if ``child_term`` is a (transitive) specialization of ``parent_term``.

    Example: ``is_subset_of("swiftui", "swift")`` — "SwiftUI is a subset of Swift".
    """
    return parent_term in _ANCESTORS.get(child_term, frozenset())


@lru_cache(maxsize=16384)
def term_match_score(candidate_term: str | None, required_term: str | None) -> float:
    """Base skill-overlap score in ``[0, 1]`` from the hierarchy, ignoring provenance.

    - exact term -> ``1.0``
    - candidate knows a *specialization* of the requirement (has SwiftUI, role
      wants Swift) -> ``0.9`` (the specific skill implies the general one)
    - candidate knows only a *generalization* / foundation (has Swift, role wants
      SwiftUI) -> ``0.55`` (foundation present, specific framework not shown)
    - otherwise -> ``0.0``
    """
    if not candidate_term or not required_term:
        return 0.0
    if candidate_term == required_term:
        return 1.0
    if required_term in _ANCESTORS.get(candidate_term, frozenset()):
        return _SPECIALIZATION_MATCH
    if candidate_term in _ANCESTORS.get(required_term, frozenset()):
        return _GENERALIZATION_MATCH
    return 0.0


def provenance_weight(provenance: str | None) -> float:
    """Confidence discount in ``[0, 1]`` for where a skill claim comes from."""
    if not provenance:
        return PROVENANCE_WEIGHTS["unknown"]
    key = provenance.strip().lower().replace(" ", "_").replace("-", "_")
    return PROVENANCE_WEIGHTS.get(key, PROVENANCE_WEIGHTS["unknown"])


@lru_cache(maxsize=16384)
def skill_match_score(
    candidate_skill: str,
    required_skill: str,
    provenance: str | None = DEFAULT_PROVENANCE,
) -> float:
    """Provenance-weighted skill match between two surface forms, in ``[0, 1]``.

    Resolves both surfaces to taxonomy terms and scores via the hierarchy
    (:func:`term_match_score`); when a surface is not in the taxonomy, falls back
    to normalized string equality so non-modelled skills still match themselves.
    The base score is then discounted by :func:`provenance_weight` so a skill
    shown only in a school project counts for less than one used in production.
    """
    candidate_term = resolve_term(candidate_skill)
    required_term = resolve_term(required_skill)
    if candidate_term and required_term:
        base = term_match_score(candidate_term, required_term)
    else:
        a = _normalize(candidate_skill or "").strip()
        b = _normalize(required_skill or "").strip()
        base = 1.0 if a and a == b else 0.0
    if base <= 0.0:
        return 0.0
    return round(base * provenance_weight(provenance), 4)


