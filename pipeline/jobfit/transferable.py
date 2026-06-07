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

# Prior-role surface signals (CZ + EN) -> transferable meta-skills.
_TRANSFERABLE_MAP: tuple[tuple[tuple[str, ...], tuple[str, ...]], ...] = (
    (("teacher", "lecturer", "tutor", "educator", "učitel", "lektor", "pedagog", "trenér"),
     ("mentoring", "communication", "curriculum design", "public speaking")),
    (("analyst", "analytik", "analytička"),
     ("analytical thinking", "data analysis", "requirements gathering")),
    (("manager", "lead", "vedoucí", "head of", "ředitel", "supervisor"),
     ("leadership", "delivery", "stakeholder management", "prioritization")),
    (("coordinator", "koordinátor", "project", "projektový", "pmo", "scrum"),
     ("project management", "delivery", "stakeholder management")),
    (("sales", "account", "obchod", "prodej", "business development"),
     ("communication", "stakeholder management", "negotiation")),
    (("support", "podpora", "helpdesk", "customer", "zákaznick"),
     ("communication", "problem solving", "customer focus")),
    (("marketing", "pr ", "content", "social media"),
     ("communication", "content", "stakeholder management")),
    (("finance", "účet", "accountant", "controller", "controlling", "audit"),
     ("analytical thinking", "attention to detail", "reporting")),
    (("consultant", "konzultant", "poradce"),
     ("stakeholder management", "communication", "problem solving")),
    (("nurse", "doctor", "zdravot", "lékař", "sestra"),
     ("attention to detail", "stress management", "communication")),
    (("lawyer", "právník", "advokát", "legal"),
     ("analytical thinking", "attention to detail", "negotiation")),
    (("military", "police", "voják", "policie", "hasič"),
     ("discipline", "stress management", "teamwork", "ownership")),
)

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
# job/internship evidence text — the same mechanism as _TRANSFERABLE_MAP.
_ADJACENT_SIGNALS: dict[str, tuple[str, ...]] = {
    "data_ai": (
        "analyst", "analytik", "finance", "účet", "controller", "controlling", "audit",
        "research", "statist", "math", "excel", "sql", "reporting", "bi ",
    ),
    "software_engineering": (
        "develop", "vývoj", "program", "engineer", "inženýr", "qa", "test",
        "support", "helpdesk", "admin", "it ", "analyst", "analytik", "data",
    ),
    "product_project": (
        "manager", "vedoucí", "coordinator", "koordinátor", "project", "projekt",
        "product", "produkt", "marketing", "sales", "obchod", "consultant",
        "konzultant", "business",
    ),
}

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
