"""Cohort Studio's comparative pass (Analyze v2): the RARE cell comment, the per-dimension
note and the top-N narrative over a cohort that code has already compared.

The claims — who leads a dimension, whether the lead clears the noise, whether the overall
leader survives a reweighting — are DECIDED BY CODE (app/features/tools/analyze/cohort/
cohortClaims.ts) and arrive here as fixed inputs. This module may only write prose about
them: it never changes a claim, never names a leader the claims do not name, and never
ranks. Comments are rare on purpose — at most one per four members — and exist only where
a number on its own would mislead.

The caller (app/_lib/analyze-cohort-run.ts) runs this twice, in two presentation orders,
and keeps only what survives both; this module knows nothing about that.

Keyless (no provider, or a provider that failed): the deterministic fallback writes no
cell comments, a templated note per dimension from the claims and a templated narrative
naming what it covers and how many it leaves out — in the report language — and says
``engine: "keyless"``. The model use case is ``group_compare`` (the registry's comparative
-read row, llm/capabilities.py): one Models-tab pin governs both comparison surfaces.
"""

from __future__ import annotations

import json
import re
from typing import Any, Callable

from .devcase.provenance import _complete_json as complete_json_expecting
from .devcase.provenance import describe_fallback, fenced_untrusted
from .i18n import language_directive, normalize_lang

COHORT_COMPARE_PROMPT_VERSION = "cohort-compare-v1"
COHORT_COMPARE_EXPECTED_KEYS: tuple[str, ...] = ("cells", "notes", "narrative")

DIMENSIONS: tuple[str, ...] = ("fit", "skills", "experience", "signals", "trust", "salary", "publicWork")
COMMENT_MAX_CHARS = 90
NOTE_MAX_CHARS = 160
NARRATIVE_MAX_CHARS = 900
# The facts block is candidate-derived text; bounded so one verbose CV cannot bill a
# whole cohort's prompt.
FACTS_MAX_CHARS = 24_000


def comment_cap(member_count: int) -> int:
    """At most ~1 comment per 4 members (and at least one when there are members)."""
    return max(1, member_count // 4) if member_count > 0 else 0


# ---- localized templates (the keyless floor) -----------------------------------------

_DIM_NAMES: dict[str, dict[str, str]] = {
    "en": {"fit": "overall fit", "skills": "skills", "experience": "experience", "signals": "signals", "trust": "trust", "salary": "salary", "publicWork": "public work"},
    "cs": {"fit": "celková shoda", "skills": "dovednosti", "experience": "praxe", "signals": "signály", "trust": "důvěryhodnost", "salary": "mzda", "publicWork": "veřejná práce"},
    "de": {"fit": "Gesamtpassung", "skills": "Kompetenzen", "experience": "Erfahrung", "signals": "Signale", "trust": "Vertrauen", "salary": "Gehalt", "publicWork": "öffentliche Arbeit"},
    "fr": {"fit": "adéquation globale", "skills": "compétences", "experience": "expérience", "signals": "signaux", "trust": "fiabilité", "salary": "salaire", "publicWork": "travaux publics"},
}

# Counted sentences carry their plural forms: "one" / "few" (Czech 2-4 only) / "other".
_T: dict[str, dict[str, Any]] = {
    "en": {
        "clears": "{leader} leads on {dim}, clear of the rest ({rated} rated).",
        "noise": {"other": "{n} candidates rated on {dim}; the order sits inside the uncertainty, so no leader is named."},
        "floor": "Fewer than two candidates rated on {dim}: no comparison.",
        "covers": {
            "one": "This summary covers the strongest candidate by overall fit: {names}.",
            "other": "This summary covers the strongest {n} candidates by overall fit: {names}.",
        },
        "stable": "{leader} leads overall, and the lead holds under every weighting.",
        "sensitive": "{leader} leads overall, but the lead changes under some weightings.",
        "undetermined": "{leader} leads overall; whether the lead survives a reweighting could not be determined.",
        "overall_noise": "No overall leader: the top of the field sits inside the uncertainty.",
        "overall_floor": "Too few rated candidates for an overall comparison.",
        "leaves": {"one": "It leaves out one more candidate.", "other": "It leaves out {n} more candidates."},
    },
    "cs": {
        "clears": "V oblasti „{dim}“ vede {leader} s jasným odstupem (hodnoceno: {rated}).",
        "noise": {
            "few": "V oblasti „{dim}“ jsou hodnoceni {n} kandidáti; pořadí leží v pásmu nejistoty, proto nikdo není označen za vedoucího.",
            "other": "V oblasti „{dim}“ je hodnoceno {n} kandidátů; pořadí leží v pásmu nejistoty, proto nikdo není označen za vedoucího.",
        },
        "floor": "V oblasti „{dim}“ jsou hodnoceni méně než dva kandidáti, srovnání proto není možné.",
        "covers": {
            "one": "Shrnutí zahrnuje nejsilnějšího kandidáta podle celkové shody: {names}.",
            "few": "Shrnutí zahrnuje {n} nejsilnější kandidáty podle celkové shody: {names}.",
            "other": "Shrnutí zahrnuje {n} nejsilnějších kandidátů podle celkové shody: {names}.",
        },
        "stable": "Celkově vede {leader} a náskok platí při každém vážení.",
        "sensitive": "Celkově vede {leader}, při některém vážení se však pořadí mění.",
        "undetermined": "Celkově vede {leader}; zda náskok obstojí i při jiném vážení, nelze určit.",
        "overall_noise": "Celkově nevede nikdo: špička pole leží v pásmu nejistoty.",
        "overall_floor": "Pro celkové srovnání je hodnoceno příliš málo kandidátů.",
        "leaves": {
            "one": "Jednoho dalšího kandidáta shrnutí nezahrnuje.",
            "few": "Další {n} kandidáty shrnutí nezahrnuje.",
            "other": "Dalších {n} kandidátů shrnutí nezahrnuje.",
        },
    },
    "de": {
        "clears": "Bei {dim} liegt {leader} klar vorn ({rated} bewertet).",
        "noise": {"other": "{n} Kandidaten bei {dim} bewertet; die Reihenfolge liegt innerhalb der Unsicherheit, daher wird niemand als führend genannt."},
        "floor": "Weniger als zwei Kandidaten bei {dim} bewertet: kein Vergleich möglich.",
        "covers": {
            "one": "Diese Zusammenfassung umfasst den stärksten Kandidaten nach Gesamtpassung: {names}.",
            "other": "Diese Zusammenfassung umfasst die {n} stärksten Kandidaten nach Gesamtpassung: {names}.",
        },
        "stable": "{leader} liegt insgesamt vorn, und der Vorsprung hält bei jeder Gewichtung.",
        "sensitive": "{leader} liegt insgesamt vorn, doch bei manchen Gewichtungen ändert sich das.",
        "undetermined": "{leader} liegt insgesamt vorn; ob der Vorsprung eine andere Gewichtung übersteht, ließ sich nicht bestimmen.",
        "overall_noise": "Niemand liegt insgesamt vorn: die Spitze des Feldes liegt innerhalb der Unsicherheit.",
        "overall_floor": "Zu wenige bewertete Kandidaten für einen Gesamtvergleich.",
        "leaves": {"one": "Ein weiterer Kandidat ist nicht enthalten.", "other": "{n} weitere Kandidaten sind nicht enthalten."},
    },
    "fr": {
        "clears": "Sur « {dim} », {leader} est en tête avec une avance nette ({rated} évalués).",
        "noise": {"other": "{n} candidats évalués sur « {dim} » ; l’ordre reste dans la marge d’incertitude, donc personne n’est désigné en tête."},
        "floor": "Moins de deux candidats évalués sur « {dim} » : pas de comparaison.",
        "covers": {
            "one": "Cette synthèse couvre le meilleur candidat selon l’adéquation globale : {names}.",
            "other": "Cette synthèse couvre les {n} meilleurs candidats selon l’adéquation globale : {names}.",
        },
        "stable": "{leader} est en tête au global, et l’avance tient quelle que soit la pondération.",
        "sensitive": "{leader} est en tête au global, mais l’avance change selon certaines pondérations.",
        "undetermined": "{leader} est en tête au global ; la tenue de l’avance à une autre pondération n’a pas pu être établie.",
        "overall_noise": "Personne n’est en tête au global : le haut du classement reste dans la marge d’incertitude.",
        "overall_floor": "Trop peu de candidats évalués pour une comparaison globale.",
        "leaves": {"one": "Elle laisse de côté un autre candidat.", "other": "Elle laisse de côté {n} autres candidats."},
    },
}


def _plural(lang: str, key: str, n: int, **values: Any) -> str:
    """The counted sentence in its grammatical form (Czech: 1 / 2-4 / 5+)."""
    forms = _T[lang][key]
    if n == 1 and "one" in forms:
        form = "one"
    elif lang == "cs" and 2 <= n <= 4 and "few" in forms:
        form = "few"
    else:
        form = "other"
    return forms[form].format(n=n, **values)


def _members(context: dict[str, Any]) -> list[dict[str, Any]]:
    m = context.get("members")
    return [x for x in m if isinstance(x, dict) and isinstance(x.get("memberId"), str)] if isinstance(m, list) else []


def _labels(context: dict[str, Any]) -> dict[str, str]:
    return {m["memberId"]: str(m.get("label") or m["memberId"]) for m in _members(context)}


def _claims(context: dict[str, Any]) -> dict[str, Any]:
    c = context.get("claims")
    return c if isinstance(c, dict) else {}


def _by_dimension(context: dict[str, Any]) -> dict[str, dict[str, Any]]:
    b = _claims(context).get("byDimension")
    return {k: v for k, v in b.items() if isinstance(v, dict)} if isinstance(b, dict) else {}


def _overall(context: dict[str, Any]) -> dict[str, Any]:
    o = _claims(context).get("overall")
    return o if isinstance(o, dict) else {}


def _narrative_top(context: dict[str, Any]) -> list[str]:
    ids = set(_labels(context))
    top = context.get("narrativeTop")
    return [x for x in top if isinstance(x, str) and x in ids] if isinstance(top, list) else []


def _leaves_out(context: dict[str, Any]) -> int:
    v = context.get("leavesOut")
    return v if isinstance(v, int) and not isinstance(v, bool) and v >= 0 else 0


def _named_leader(claim: dict[str, Any]) -> str | None:
    """The memberId a claim lets anyone NAME as leading: only a lead that clears the noise."""
    leader = claim.get("leader")
    return leader if isinstance(leader, str) and claim.get("separation") == "clears" else None


def template_note(dim: str, claim: dict[str, Any], labels: dict[str, str], lang: str) -> str:
    t = _T[lang]
    name = _DIM_NAMES[lang][dim]
    rated = claim.get("rated") if isinstance(claim.get("rated"), int) else 0
    leader = _named_leader(claim)
    if claim.get("separation") == "belowFloor" or rated < 2:
        return t["floor"].format(dim=name)
    if leader and leader in labels:
        return t["clears"].format(leader=labels[leader], dim=name, rated=rated)
    return _plural(lang, "noise", rated, dim=name)


def template_narrative(context: dict[str, Any], lang: str) -> dict[str, Any]:
    t = _T[lang]
    labels = _labels(context)
    top = _narrative_top(context)
    overall = _overall(context)
    parts: list[str] = []
    if top:
        parts.append(_plural(lang, "covers", len(top), names=", ".join(labels[i] for i in top)))
    leader = _named_leader(overall)
    if overall.get("separation") == "belowFloor" or not top:
        parts.append(t["overall_floor"])
    elif leader and leader in labels:
        robustness = overall.get("robustness")
        key = robustness if robustness in ("stable", "sensitive", "undetermined") else "undetermined"
        parts.append(t[key].format(leader=labels[leader]))
    else:
        parts.append(t["overall_noise"])
    k = _leaves_out(context)
    if k > 0:
        parts.append(_plural(lang, "leaves", k))
    return {"covers": top, "leavesOut": k, "text": " ".join(parts)[:NARRATIVE_MAX_CHARS]}


def deterministic_comparison(context: dict[str, Any], lang: str = "en") -> dict[str, Any]:
    """The keyless floor: no cell comments, a templated note per dimension, a templated
    narrative. Never crowns anyone the claims do not name."""
    lang = normalize_lang(lang)
    labels = _labels(context)
    by_dim = _by_dimension(context)
    notes = {dim: template_note(dim, by_dim[dim], labels, lang) for dim in DIMENSIONS if dim in by_dim}
    return {"cells": [], "notes": notes, "narrative": template_narrative(context, lang)}


# ---- the claim guard -------------------------------------------------------------------

# Words that crown somebody, in the four report languages. A sentence carrying one may
# name only the member the claims name; with no named leader it may not exist at all.
_CROWN = re.compile(
    r"\b(lead|leads|leading|leader|strongest|best|top candidate|winner|frontrunner|front-runner|"
    r"ahead of|outperform\w*|vede|vedoucí|nejsilnější|nejlepší|lídr|vítěz\w*|führt|führend|"
    r"stärkste\w*|beste\w*|vorn|vorne|spitze|en tête|meilleur\w*|le plus fort|la plus forte|gagnant\w*|devance\w*)\b",
    re.IGNORECASE,
)
# A numbered list (a line opening "1." / "2)" / "#3") is a ranking whatever its words say.
_RANKING = re.compile(r"(?m)^\s*#?\d+[.)]\s")


def _sentences(text: str) -> list[str]:
    return [s for s in re.split(r"(?<=[.!?;])\s+", text) if s.strip()]


def contradicts_claim(text: str, claim: dict[str, Any], labels: dict[str, str]) -> bool:
    """True when prose crowns someone the claim does not name, or ranks the field."""
    if _RANKING.search(text):
        return True
    leader = _named_leader(claim)
    for sentence in _sentences(text):
        if not _CROWN.search(sentence):
            continue
        if leader is None:
            return True
        mentioned = {mid for mid, label in labels.items() if label and label.lower() in sentence.lower()}
        if mentioned - {leader}:
            return True
    return False


# ---- the model path ----------------------------------------------------------------------


def _system_prompt() -> str:
    return (
        "You annotate a comparison of job candidates that has ALREADY been decided by code. "
        "The claims you are given (who leads each dimension, whether the lead is clear of the "
        "noise, whether the overall leader survives a reweighting) are FIXED: never change "
        "them, never name a leader they do not name, never rank or order the candidates, and "
        "never invent a number. Candidate labels are identifiers, nothing more: never infer or "
        "use gender, ethnicity, nationality, age, religion, disability or any protected "
        "attribute from a label or any other field. Write in the requested language."
    )


def build_prompt(context: dict[str, Any], lang: str) -> str:
    members = _members(context)
    facts = {
        "roleTitle": context.get("jdTitle"),
        "claims": _claims(context),
        "narrativeTop": _narrative_top(context),
        "leavesOut": _leaves_out(context),
    }
    return (
        "The comparison's fixed claims (decided by code — do not contradict them):\n"
        f"{json.dumps(facts, ensure_ascii=False, indent=2)}\n\n"
        f"{fenced_untrusted('CANDIDATE_FACTS', members, max_chars=FACTS_MAX_CHARS)}\n\n"
        "Return JSON with exactly these keys:\n"
        '{ "cells": [ {"memberId": str, "dimension": str, "comment": str} ],\n'
        '  "notes": { "<dimension>": str },\n'
        '  "narrative": { "covers": [memberId], "text": str } }\n'
        "Rules:\n"
        f"- cells: RARE. At most {comment_cap(len(members))} in total. Comment on a cell ONLY where its "
        f"number on its own would mislead a recruiter (e.g. a high rating resting on thin evidence). "
        f"Each comment at most {COMMENT_MAX_CHARS} characters. memberId and dimension must be ones given. "
        f"Dimensions: {', '.join(DIMENSIONS)}.\n"
        f"- notes: at most one per dimension, at most {NOTE_MAX_CHARS} characters, describing what the "
        "dimension shows across the field. A note may name a leader ONLY where that dimension's claim "
        "has separation \"clears\", and then only that leader.\n"
        f"- narrative: at most {NARRATIVE_MAX_CHARS} characters about the candidates in narrativeTop "
        "(covers = those ids, in the order you discuss them), and say how many it leaves out "
        "(leavesOut). Name an overall leader only if claims.overall.separation is \"clears\"; if its "
        "robustness is \"sensitive\", say the lead depends on the weighting.\n"
        "- Never number, order or rank the candidates. A null rating means NOT MEASURED — never a zero.\n"
        f"{language_directive(lang)}\n"
        "JSON only."
    )


def _coerce(payload: Any, context: dict[str, Any], lang: str) -> tuple[dict[str, Any], bool]:
    """Validate the model answer against the inputs and the claims. Returns (comparison,
    model_wrote_something). Anything invalid is DROPPED; a missing or claim-contradicting
    narrative is replaced by the template (and then the narrative is not the model's)."""
    labels = _labels(context)
    by_dim = _by_dimension(context)
    overall = _overall(context)
    fallback = deterministic_comparison(context, lang)
    if not isinstance(payload, dict):
        return fallback, False

    cells: list[dict[str, str]] = []
    seen: set[tuple[str, str]] = set()
    raw_cells = payload.get("cells") if isinstance(payload.get("cells"), list) else []
    for c in raw_cells:
        if len(cells) >= comment_cap(len(labels)):
            break
        if not isinstance(c, dict):
            continue
        mid, dim, text = c.get("memberId"), c.get("dimension"), c.get("comment")
        if not (isinstance(mid, str) and mid in labels and dim in DIMENSIONS and isinstance(text, str) and text.strip()):
            continue
        text = text.strip()
        if len(text) > COMMENT_MAX_CHARS or (mid, dim) in seen:
            continue
        if contradicts_claim(text, by_dim.get(dim, {}), labels):
            continue
        seen.add((mid, dim))
        cells.append({"memberId": mid, "dimension": dim, "comment": text})

    notes: dict[str, str] = {}
    raw_notes = payload.get("notes") if isinstance(payload.get("notes"), dict) else {}
    for dim, text in raw_notes.items():
        if dim not in DIMENSIONS or not isinstance(text, str) or not text.strip():
            continue
        text = text.strip()
        if len(text) > NOTE_MAX_CHARS or contradicts_claim(text, by_dim.get(dim, {}), labels):
            continue
        notes[dim] = text

    narrative = None
    raw = payload.get("narrative")
    top = _narrative_top(context)
    if isinstance(raw, dict) and isinstance(raw.get("text"), str) and raw["text"].strip():
        text = raw["text"].strip()
        if len(text) <= NARRATIVE_MAX_CHARS and not contradicts_claim(text, overall, labels):
            covers = [x for x in raw.get("covers", []) if isinstance(x, str) and x in top] if isinstance(raw.get("covers"), list) else []
            narrative = {"covers": covers or top, "leavesOut": _leaves_out(context), "text": text}

    model_narrative = narrative is not None
    return (
        {"cells": cells, "notes": notes, "narrative": narrative if model_narrative else fallback["narrative"]},
        model_narrative,
    )


def generate(
    context: dict[str, Any],
    *,
    lang: str = "en",
    provider: Any | None = None,
    on_fallback: Callable[[str], None] | None = None,
) -> dict[str, Any]:
    """The comparative pass. Returns {cells, notes, narrative, engine}: ``engine`` is
    "model" only when the NARRATIVE on the wire is the model's."""
    lang = normalize_lang(lang)
    if provider is None or len(_members(context)) < 2:
        return {**deterministic_comparison(context, lang), "engine": "keyless"}
    try:
        payload = complete_json_expecting(
            provider, build_prompt(context, lang), _system_prompt(), COHORT_COMPARE_EXPECTED_KEYS
        )
        comparison, model_narrative = _coerce(payload, context, lang)
        return {**comparison, "engine": "model" if model_narrative else "keyless"}
    except Exception as exc:  # noqa: BLE001 — a provider failure is the keyless floor, coded
        if on_fallback is not None:
            on_fallback(describe_fallback(exc))
        return {**deterministic_comparison(context, lang), "engine": "keyless"}
