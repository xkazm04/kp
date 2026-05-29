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
