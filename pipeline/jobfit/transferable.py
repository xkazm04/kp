"""Transferable-skill mapper for career-switchers (Phase 7, diagram 12).

A switcher's prior-domain (A) experience is genuine professional maturity even if
the target domain (B) is new. This maps prior-role signals to domain-agnostic
META-SKILLS (communication, leadership, delivery, analytical rigor, ...) that
transfer to B, so they can be credited at PROFESSIONAL provenance — the key
difference from a true beginner. Target-domain hard skills are still treated
like a student's (foundation, provenance-discounted) by the normal transform.
"""

from __future__ import annotations

from typing import Iterable

from .taxonomy import ADJACENT_DOMAIN_SIGNALS, feminine_probe_forms, normalize_text

_SignalGroups = tuple[tuple[tuple[str, ...], tuple[str, ...]], ...]

# Prior-role surface signals (CZ + EN) -> transferable meta-skills. This is the
# AUTHORED table; ``_TRANSFERABLE_MAP`` below is what ``map_transferable`` reads.
#
# GENDERED FORMS: Czech job titles inflect for gender, and a substring signal that
# only covers the masculine silently credits a man and not the woman who did the
# identical job. Most masculine forms are a prefix of their feminine counterpart so
# one token covers both ("učitel" ⊃ "učitelka", "ředitel" ⊃ "ředitelka"); where the
# stem CHANGES it does not. Those feminines are DERIVED at import
# (:func:`with_feminine_forms`) and ``taxonomy_check.scan_transferable_gender_gaps``
# fails the build on a Czech signal whose feminine nothing reaches, so a new
# masculine-only signal cannot be written. Two kinds of hand-written entry remain:
#
# * the INFLECTION stems "pedagož", "právnič", "vojačk": the derivation adds the
#   full nominatives ("pedagožka", "právnice", …) because a stem such as "právnic"
#   would substring-hit "právnických osob"; a nominative, though, does not reach
#   the case forms a CV is actually written in ("praxe pedagožky", "práce
#   právničky"), and these stems do. They stay beside the derived forms.
# * "poradkyn(ě)": the probe vocabulary has no -ce -> -kyně rule, so
#   ``feminine_probe_forms("poradce")`` is empty and the feminine can only be authored.
#
# An adjective is truncated to its gender-neutral stem ("projektov" covers
# "projektový manažer" AND "projektová manažerka").
_AUTHORED_TRANSFERABLE_MAP: _SignalGroups = (
    (("teacher", "lecturer", "tutor", "educator", "učitel", "lektor", "pedagog", "pedagož", "trenér"),
     ("mentoring", "communication", "curriculum design", "public speaking")),
    (("analyst", "analytik", "analytička"),
     ("analytical thinking", "data analysis", "requirements gathering")),
    (("manager", "lead", "vedoucí", "head of", "ředitel", "supervisor"),
     ("leadership", "delivery", "stakeholder management", "prioritization")),
    (("coordinator", "koordinátor", "project", "projektov", "pmo", "scrum"),
     ("project management", "delivery", "stakeholder management")),
    (("sales", "account", "obchod", "prodej", "business development"),
     ("communication", "stakeholder management", "negotiation")),
    (("support", "podpora", "helpdesk", "customer", "zákaznick"),
     ("communication", "problem solving", "customer focus")),
    (("marketing", "pr ", "content", "social media"),
     ("communication", "content", "stakeholder management")),
    (("finance", "účet", "accountant", "controller", "controlling", "audit"),
     ("analytical thinking", "attention to detail", "reporting")),
    (("consultant", "konzultant", "poradce", "poradkyn"),
     ("stakeholder management", "communication", "problem solving")),
    (("nurse", "doctor", "zdravot", "lékař", "sestra"),
     ("attention to detail", "stress management", "communication")),
    (("lawyer", "právník", "právnič", "advokát", "legal"),
     ("analytical thinking", "attention to detail", "negotiation")),
    (("military", "police", "voják", "vojačk", "policie", "hasič"),
     ("discipline", "stress management", "teamwork", "ownership")),
)


def feminine_signal_forms(signal: str) -> tuple[str, ...]:
    """The full feminine word(s) a Czech agent-noun ``signal`` names, or ``()``.

    Full nominatives (:func:`taxonomy.feminine_probe_forms`), never the
    ``feminine_variants`` stems: this map matches by raw substring, and the stem
    "právnic" would credit every CV mentioning "právnických osob". English and
    non-agent signals derive nothing.
    """
    return feminine_probe_forms(normalize_text(signal))


def with_feminine_forms(groups: _SignalGroups) -> _SignalGroups:
    """``groups`` with each group's derived feminine forms APPENDED.

    Additive: every authored signal stays, in order, so the authored inflection
    stems keep matching case forms the nominatives cannot reach.
    """
    out = []
    for signals, skills in groups:
        derived = [f for sig in signals for f in feminine_signal_forms(sig)]
        out.append((tuple(dict.fromkeys((*signals, *derived))), skills))
    return tuple(out)


_TRANSFERABLE_MAP: _SignalGroups = with_feminine_forms(_AUTHORED_TRANSFERABLE_MAP)

# Any prior professional role implies these baseline meta-skills.
_GENERIC_PROFESSIONAL = ("teamwork", "communication", "ownership", "delivery")


def map_transferable(evidence: Iterable) -> list[tuple[str, str]]:
    """From prior job/internship evidence, infer (meta_skill, source) pairs.

    ``evidence`` items are profile.Evidence objects; only ``job``/``internship``
    kinds are read (the prior-domain professional track). First source wins per
    skill so the reasoning can cite where it came from.
    """
    found: dict[str, str] = {}
    has_prior_role = False
    for ev in evidence:
        if getattr(ev, "kind", "") not in ("job", "internship"):
            continue
        has_prior_role = True
        text = f"{getattr(ev, 'title', '')} {getattr(ev, 'text', '')}".casefold()
        for signals, skills in _TRANSFERABLE_MAP:
            if any(sig in text for sig in signals):
                for skill in skills:
                    found.setdefault(skill, getattr(ev, "title", "") or "prior role")
    if has_prior_role:
        for skill in _GENERIC_PROFESSIONAL:
            found.setdefault(skill, "prior professional experience")
    return list(found.items())


# --- Domain distance ---------------------------------------------------------------

# Which prior-role surface signals sit ADJACENT to which target role families: a
# finance analyst moving into data work crosses a far shorter bridge than a nurse
# into backend engineering, and a binary "wants_domain_change" can't tell those
# apart. Token lists are surface substrings (CZ + EN) matched against prior
# job/internship evidence text — the same mechanism as _TRANSFERABLE_MAP. They now
# live in data/taxonomy.json (taxonomy.ADJACENT_DOMAIN_SIGNALS) covering all 16
# role families, so a switch INTO a non-tech family is graded, not defaulted FAR.
_ADJACENT_SIGNALS = ADJACENT_DOMAIN_SIGNALS

DISTANCE_ADJACENT = "adjacent"
DISTANCE_MODERATE = "moderate"
DISTANCE_FAR = "far"


def domain_distance(evidence: Iterable, target_family: str) -> tuple[str, str]:
    """Grade how far a switcher's prior domain sits from the target role family.

    Returns ``(distance, reason)``:
      * ``adjacent`` — prior job/internship evidence carries surface signals that
        neighbour the target family (a finance analyst → data work): the hard
        skills are closer than provenance discounting alone suggests.
      * ``moderate`` — a recognized professional background whose META-skills map
        (the _TRANSFERABLE_MAP groups) but whose domain doesn't neighbour the
        target: the bridge is real but runs through meta-skills.
      * ``far`` — no prior role at all (nothing to bridge FROM is the farthest
        case) or a field sharing no surface signals with the target.

    Deterministic and surface-level by design — the honest alternative to
    pretending we can measure semantic domain similarity we have no data for.
    """
    prior = [e for e in evidence if getattr(e, "kind", "") in ("job", "internship")]
    if not prior:
        return DISTANCE_FAR, "no prior professional role to bridge from"
    text = " ".join(f"{getattr(e, 'title', '')} {getattr(e, 'text', '')}" for e in prior).casefold()
    for sig in _ADJACENT_SIGNALS.get(target_family, ()):
        if sig in text:
            return DISTANCE_ADJACENT, f"prior role signals '{sig.strip()}' neighbour {target_family}"
    if any(any(sig in text for sig in signals) for signals, _skills in _TRANSFERABLE_MAP):
        return DISTANCE_MODERATE, "recognized professional background; meta-skills transfer, the domain does not"
    return DISTANCE_FAR, "prior field shares no surface signals with the target"
