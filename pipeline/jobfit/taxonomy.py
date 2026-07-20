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


from .market_config import ACTIVE_MARKET, MarketConfig

_ALL_BENCHMARKS: dict[str, Any] = _load_json(_BENCHMARKS_PATH)
_TAXONOMY: dict[str, Any] = _load_json(_TAXONOMY_PATH)

# Benchmarks are keyed by market_id (``markets``: {market_id: {currency, roles, …}})
# so onboarding a second market is configuration — adding a block — not swapping the
# whole file in lockstep. The consumers below read the ACTIVE market's block; a guard
# test keeps each block's currency in step with its MarketConfig. A legacy flat file
# ({currency, roles, …} with no ``markets`` key — still what scripts/apply-market-
# salaries.mjs writes when it regenerates the CZ bands) is read as the active market's
# block so that regeneration never hard-breaks the pipeline at import.
_raw_markets = _ALL_BENCHMARKS.get("markets")
if isinstance(_raw_markets, dict) and _raw_markets:
    _MARKET_BLOCKS: dict[str, Any] = _raw_markets
elif isinstance(_ALL_BENCHMARKS.get("roles"), list):
    _MARKET_BLOCKS = {ACTIVE_MARKET.market_id: _ALL_BENCHMARKS}
else:
    raise RuntimeError(
        f"{_BENCHMARKS_PATH} must contain either a non-empty 'markets' object keyed by "
        f"market_id, or a legacy top-level 'roles' array — found neither."
    )


def _validate_roles(block: Any, market_id: str) -> list[dict[str, Any]]:
    """Fail-fast validation of one market block's 'roles' array (mirrors the
    original import-time checks): a non-empty list of objects each naming a family."""
    if not isinstance(block, dict):
        raise RuntimeError(
            f"{_BENCHMARKS_PATH}: market {market_id!r} must map to an object "
            f"(got {type(block).__name__})."
        )
    raw_roles = block.get("roles")
    if not isinstance(raw_roles, list) or not raw_roles:
        raise RuntimeError(
            f"{_BENCHMARKS_PATH}: market {market_id!r} must contain a non-empty 'roles' "
            f"array (got {type(raw_roles).__name__})."
        )
    roles: list[dict[str, Any]] = []
    for _i, _role in enumerate(raw_roles):
        if not isinstance(_role, dict) or not _role.get("family"):
            raise RuntimeError(
                f"{_BENCHMARKS_PATH}: market {market_id!r} roles[{_i}] must be an object "
                f"with a non-empty 'family'."
            )
        roles.append(_role)
    return roles


_ROLES_BY_MARKET: dict[str, list[dict[str, Any]]] = {
    _mid: _validate_roles(_block, _mid) for _mid, _block in _MARKET_BLOCKS.items()
}

if ACTIVE_MARKET.market_id not in _MARKET_BLOCKS:
    raise RuntimeError(
        f"{_BENCHMARKS_PATH}: the active market {ACTIVE_MARKET.market_id!r} has no benchmark "
        f"block. Known markets: {sorted(_MARKET_BLOCKS)}."
    )

# The active market's block drives every market-derived global below (ROLE_FAMILIES,
# DEFAULT_FAMILY, the role-family vocabulary). For the Czech default this is the same
# data the flat file exposed, so those globals are byte-identical.
_BENCHMARKS: dict[str, Any] = _MARKET_BLOCKS[ACTIVE_MARKET.market_id]

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

# The active market's validated roles (ROLE_FAMILIES[0] is the fallback default).
_ROLES: list[dict[str, Any]] = _ROLES_BY_MARKET[ACTIVE_MARKET.market_id]

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
# The default when NOTHING is recorded about how a skill was acquired (UAT
# 2026-07-20). This used to be "professional" — the joint-highest trust tier — so
# absence of evidence was read as the STRONGEST possible evidence: a skill the
# candidate merely typed into a list scored identically to one demonstrated for
# five years in production, and a well-written CV therefore outranked a plainly
# written one carrying real artifacts. "self_declared" is the honest reading of an
# uncorroborated claim, and it makes the discount fail SAFE (understate an
# unevidenced claim) instead of fail FLATTERING, matching how the rest of this
# codebase treats missing signal (unscored → excluded, unknown archetype →
# shielded, absent robustness → "not_varied").
#
# This MOVES SCORES. A self-declared exact match scores 0.4 rather than 1.0, which
# is below _MATCH_THRESHOLD, so such a claim now lands in `unproven_skills`
# (contributing 0.4 × weight) instead of `matched_skills`. It never becomes
# `missing` — that stays reserved for a claim the candidate never made — so
# knockout filtering is unaffected. Recruiter-facing thresholds calibrated against
# the old inflated numbers need re-tuning; see docs/SCORING_REBASELINE.md.
DEFAULT_PROVENANCE = "self_declared"

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
# Candidate knows a SIBLING of the requirement — a different child of the same
# direct parent (has SEO, role wants PPC; both are digital_marketing). Domain
# adjacency, but neither the requirement nor its foundation is shown, so it scores
# BELOW a generalization (0.55). Critically it is set below matching._MATCH_THRESHOLD
# (0.5) BY DESIGN: a bare sibling never counts as a "matched" skill — it only nudges
# the skills sub-score as partial, adjacent evidence a recruiter must still verify.
# Only a DIRECT shared parent qualifies; deeper cousins (shared grandparent only)
# stay 0.0 — adjacency decays to noise beyond one hop.
_SIBLING_MATCH = 0.4


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


def role_band(
    family: str, seniority: str, *, market: MarketConfig = ACTIVE_MARKET
) -> tuple[int, int] | None:
    """Look up the monthly gross anchor band for a (role_family, seniority) pair,
    in ``market``'s currency (defaults to the ACTIVE market — CZK for the pilot).

    The bands come from ``market``'s benchmark block (``markets[market.market_id]``),
    so re-homing the market reads ITS anchor bands rather than the Czech ones.
    Returns ``None`` when the family is unknown, the seniority key is missing, or
    the band entry is short / non-numeric (tolerated by skipping rather than
    raising). Used by the deterministic-evidence pre-pass to anchor Gemini's
    salary range.
    """
    roles = _ROLES_BY_MARKET.get(market.market_id, _ROLES)
    for role in roles:
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
    - candidate knows a *sibling* — a different child of the requirement's direct
      parent (has SEO, role wants PPC) -> ``0.4`` (domain-adjacent, sub-threshold)
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
    # Siblings: share at least one DIRECT parent (immediate, not transitive), so the
    # two are peers under the same umbrella. Deeper cousins (only a shared ancestor
    # further up) are intentionally excluded — _PARENTS is the direct-edge map.
    cand_parents = _PARENTS.get(candidate_term)
    req_parents = _PARENTS.get(required_term)
    if cand_parents and req_parents and not set(cand_parents).isdisjoint(req_parents):
        return _SIBLING_MATCH
    return 0.0


def provenance_weight(provenance: str | None) -> float:
    """Confidence discount in ``[0, 1]`` for where a skill claim comes from."""
    if not provenance:
        return PROVENANCE_WEIGHTS["unknown"]
    key = provenance.strip().lower().replace(" ", "_").replace("-", "_")
    return PROVENANCE_WEIGHTS.get(key, PROVENANCE_WEIGHTS["unknown"])


# --- Graded fallback for UNRESOLVED skill pairs ----------------------------
# When BOTH surfaces are absent from _SURFACE_TO_TERM the hierarchy has no opinion,
# so skill_match_score historically collapsed to normalized string equality (1.0 or
# 0.0, nothing between). That's exactly the vocabulary the taxonomy hasn't modelled
# — creative/life-sciences/general-professional families still at zero terms, and
# any brand-new tech term ("LangGraph") — where a token-overlap partial is the only
# honest signal available. This gives such pairs a deterministic, BOUNDED fractional
# score that feeds the existing additive machinery as sub-threshold, "adjacency"-
# grade credit; it never manufactures a "matched" claim.

_FALLBACK_TOKEN_RE = re.compile(r"[^\W_]+", re.UNICODE)

# Generic, non-discriminative tokens: an overlap on ONLY these earns no credit, so
# "management of X" vs "management of Y" (X≠Y) does NOT score — the distinctive
# tokens (X, Y) carry the meaning and they differ. Deliberately small and
# conservative: articles/prepositions/conjunctions (EN + common Czech glue) plus the
# most generic role-noun filler. Anything OUTSIDE this set counts as a distinctive
# token that can anchor a partial — the required shared "head".
_FALLBACK_STOPWORDS: frozenset[str] = frozenset({
    # English glue
    "of", "and", "or", "the", "a", "an", "for", "to", "in", "on", "with", "at",
    "by", "from", "as", "its", "your",
    # Czech glue
    "v", "ve", "na", "pro", "se", "si", "o", "z", "ze", "do", "po", "k", "u", "i", "s",
    # generic role / skill filler (a shared "engineer"/"management" is not a skill)
    "management", "manager", "engineer", "engineering", "developer", "development",
    "specialist", "analyst", "coordinator", "administrator", "officer", "assistant",
    "senior", "junior", "medior", "lead", "principal", "general", "professional",
    "experience", "skills", "knowledge", "work", "working", "team", "support",
})

# Tokens shorter than this are too ambiguous to anchor a match: they are substrings
# of countless words and defeat the whole-token discipline the rest of the module
# enforces. Critically this neutralizes the short-skill hazard — "c" vs "c++" both
# tokenize to the 1-char {"c"} and are dropped to the empty set, so they score 0.0
# rather than a spurious 1.0.
_FALLBACK_MIN_TOKEN_LEN = 3
# Hard ceiling on the fallback: strictly below _SIBLING_MATCH (0.4) and matching's
# _MATCH_THRESHOLD (0.5), so a token-overlap pair can never reach "matched" and the
# pinned ordering exact(1.0) > specialization(0.9) > generalization(0.55) >
# sibling(0.4) > token-fallback(≤0.3) > nothing(0.0) holds.
_FALLBACK_CAP = 0.3


def _fallback_tokens(surface: str) -> frozenset[str]:
    """Distinctive, normalized token set of ``surface`` for the graded fallback:
    :func:`normalize_text`-folded (so Czech diacritics/case fold the same way they
    do everywhere else), split on non-word boundaries, then stripped of sub-length
    noise and generic stopwords so only meaning-bearing tokens survive."""
    norm = normalize_text(surface)
    return frozenset(
        t
        for t in _FALLBACK_TOKEN_RE.findall(norm)
        if len(t) >= _FALLBACK_MIN_TOKEN_LEN and t not in _FALLBACK_STOPWORDS
    )


def _token_overlap_score(candidate_surface: str, required_surface: str) -> float:
    """Capped Jaccard over the two surfaces' *distinctive* token sets — the shared
    core of BOTH the neither-side and the one-side fallbacks.

    Requires at least one shared distinctive ("head") token; scales
    ``|shared| / |union|`` into ``(0, _FALLBACK_CAP]`` so a partial overlap earns
    bounded, sub-threshold credit and no shared head earns ``0.0``. It NEVER returns
    the exact-match ``1.0`` — that outcome is owned by the callers (literal string
    equality for a wholly unmodelled pair; hierarchy resolution when a surface is
    modelled), so no fallback path can manufacture a full match. All the hazard
    discipline lives in :func:`_fallback_tokens` (head token, stopwords, min length),
    so both fallbacks inherit it identically."""
    ca = _fallback_tokens(candidate_surface or "")
    cb = _fallback_tokens(required_surface or "")
    shared = ca & cb
    if not shared:  # no distinctive token in common -> no signal (also handles the
        return 0.0  # short-token hazard, where the filtered sets are empty)
    jaccard = len(shared) / len(ca | cb)
    # jaccard ∈ (0, 1] so this is structurally ≤ _FALLBACK_CAP; the min() is a
    # belt-and-suspenders guard should the formula ever change.
    return round(min(_FALLBACK_CAP, _FALLBACK_CAP * jaccard), 4)


@lru_cache(maxsize=16384)
def unresolved_pair_score(candidate_skill: str | None, required_skill: str | None) -> float:
    """Graded token-overlap score in ``[0, 1]`` for a skill pair the taxonomy CANNOT
    resolve (NEITHER surface is in ``_SURFACE_TO_TERM``).

    Applied ONLY as skill_match_score's neither-side-resolves fallback — a pair where
    either side resolves keeps its unchanged hierarchy / string-equality outcome.

    - exact normalized string match -> ``1.0`` (a real, if unmodelled, match — the
      legacy fallback outcome, preserved; NOT capped)
    - otherwise a Jaccard over the *distinctive* token sets, requiring at least one
      shared distinctive ("head") token, scaled into ``(0, _FALLBACK_CAP]`` — so a
      partial token overlap earns bounded, sub-threshold credit that classifies as
      "adjacency", never a match
    - no shared distinctive token -> ``0.0``

    Design rationale — why token-set Jaccard with a required head token:
    * Jaccard (|shared| / |union|) is symmetric, deterministic, and penalizes both
      missing and extra tokens, so "apache airflow" vs "airflow" (0.15) scores below
      a reordered near-identical pair — degree of overlap, not mere presence.
    * The head-token requirement (a shared token that survives the stopword + min-
      length filter) is what stops the classic false positive: "management of X" vs
      "management of Y" share only stopwords, so the distinctive sets are disjoint
      and the score is 0.0. It also forbids substring traps — "java" vs "javascript"
      are distinct whole tokens (no share), and a negation like "non-relational" vs
      "relational" keeps its "non" token in the union, dragging the score DOWN
      rather than matching. All whole-token, never substring.
    """
    a = normalize_text(candidate_skill or "").strip()
    b = normalize_text(required_skill or "").strip()
    if not a or not b:
        return 0.0
    if a == b:
        return 1.0  # exact string match of an unmodelled term — legacy 1.0 preserved
    return _token_overlap_score(candidate_skill or "", required_skill or "")


@lru_cache(maxsize=16384)
def _one_side_fallback_score(resolved_term_id: str, unresolved_surface: str) -> float:
    """Bounded token-overlap credit for a pair where EXACTLY ONE surface is modelled.

    The unresolved surface is scored against the resolved term's FULL alias set
    (``match[]``), taking the MAX over aliases — so an unmodelled variant of a
    modelled term (e.g. "data science" vs the ``data_scientist`` alias "data
    scientist") earns the same capped, sub-threshold ``≤_FALLBACK_CAP`` adjacency
    credit the neither-side fallback gives, instead of a false hard zero. It can
    never reach the match threshold and never returns ``1.0``: an exact surface
    would have RESOLVED, so the pair would not be one-sided in the first place.

    Keyed on ``resolved_term_id`` (NOT the alias list) so the cache key stays small
    and hashable; the aliases are derived from the immutable ``_TERM_BY_ID`` built at
    import, so the id fully determines them (the direction's cache-key caveat)."""
    term = _TERM_BY_ID.get(resolved_term_id)
    if not term:
        return 0.0
    best = 0.0
    for alias in term.get("match", ()):  # max token overlap over the term's surfaces
        best = max(best, _token_overlap_score(unresolved_surface, alias))
        if best >= _FALLBACK_CAP:  # already at the ceiling — no alias can beat it
            break
    return best


@lru_cache(maxsize=16384)
def skill_match_score(
    candidate_skill: str,
    required_skill: str,
    provenance: str | None = DEFAULT_PROVENANCE,
) -> float:
    """Provenance-weighted skill match between two surface forms, in ``[0, 1]``.

    Resolves both surfaces to taxonomy terms and scores via the hierarchy
    (:func:`term_match_score`). When NEITHER surface is modelled, falls back to
    :func:`unresolved_pair_score` — exact string equality still yields ``1.0`` (a
    non-modelled skill matches itself) and a token overlap earns a bounded, sub-
    threshold partial (``≤0.3``) instead of a bare 0/1. When exactly ONE side
    resolves the same bounded token fallback applies via
    :func:`_one_side_fallback_score` — the unresolved surface is scored against the
    resolved term's alias set, so a modelled term vs its own unmodelled variant
    ("data scientist" vs "data science") earns capped, sub-threshold adjacency credit
    instead of a false hard zero; it can never reach "matched". The base score is
    then discounted by :func:`provenance_weight` so a skill shown only in a school
    project counts for less than one used in production.
    """
    candidate_term = resolve_term(candidate_skill)
    required_term = resolve_term(required_skill)
    if candidate_term and required_term:
        base = term_match_score(candidate_term, required_term)
    elif candidate_term or required_term:
        # Exactly one side resolves. An exact surface match is impossible here — an
        # equal surface would resolve to the SAME term and take the branch above — so
        # the legacy outcome was a hard 0.0, a FALSE ZERO for a modelled term vs its
        # own unmodelled variant. Extend the bounded token fallback to this branch:
        # score the UNRESOLVED surface against the RESOLVED term's alias set, capped
        # ≤_FALLBACK_CAP, never "matched". (The a==b guard is defensive/unreachable
        # while resolve_term stays deterministic.)
        a = _normalize(candidate_skill or "").strip()
        b = _normalize(required_skill or "").strip()
        if a and a == b:
            base = 1.0
        else:
            resolved_id = candidate_term or required_term
            unresolved_surface = required_skill if candidate_term else candidate_skill
            base = _one_side_fallback_score(resolved_id, unresolved_surface or "")
    else:
        base = unresolved_pair_score(candidate_skill, required_skill)
    if base <= 0.0:
        return 0.0
    return round(base * provenance_weight(provenance), 4)


