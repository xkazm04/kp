"""Generated scenario bank for the role-intake eval — breadth coverage.

The curated bank (intake_scenarios.json) covers requestor BEHAVIOR; this
module covers the MARKET: the office-job space is vast, so the intake dialog
and the RoleBrief schema are exercised across the product's real role-family
taxonomy (``taxonomy.role_family_catalog`` — all 16 families) × seniority ×
need shape, mirroring interview_scenarios_gen.py's approach for the candidate
side.

* ``fixed_bank(n=100)`` — a deterministic, family-balanced bank of exactly
  ``n`` scenarios (same code → same bank; run-to-run comparisons stay
  apples-to-apples). Golden answers are templated from per-family content so
  the offline mode drives realistic dialogs keylessly; live mode uses the
  generated ``requestor_prompt``.

Per-family content is deliberately CONCRETE (real titles, real must-haves,
real 90-day outcomes) — the point of the exercise is that "office jobs" is
not one shape: a shift-planning frontline lead, a licensure-bound nurse
recruiter and a staff engineer stress completely different facets.
"""

from __future__ import annotations

from typing import Any

from ..taxonomy import role_family_catalog

SENIORITIES = ["junior", "medior", "senior"]
SHAPES = ["power_unit", "story"]

# Per-family grounding: titles by seniority, must-haves, a nice-to-have, the
# 90-day outcome, team context, urgency. This table IS the market-breadth
# coverage — grow it here.
FAMILY_CONTENT: dict[str, dict[str, Any]] = {
    "software_engineering": {
        "titles": {"junior": "Junior Backend Developer", "medior": "Backend Developer", "senior": "Senior Platform Engineer"},
        "musts": ["Python", "SQL"], "nice": "Kubernetes",
        "outcome": "Owns one service end to end and ships reviewed changes weekly",
        "team": "a product squad of six", "urgency": "On-call coverage has gaps every sprint",
    },
    "data_ai": {
        "titles": {"junior": "Junior Data Analyst", "medior": "Analytics Engineer", "senior": "Senior Data Scientist"},
        "musts": ["SQL", "dbt"], "nice": "Python",
        "outcome": "The weekly reporting runs without manual work and finance trusts the numbers",
        "team": "a data team of four", "urgency": "Finance asks for numbers we cannot produce",
    },
    "product_project": {
        "titles": {"junior": "Junior Project Coordinator", "medior": "Product Owner", "senior": "Senior Program Manager"},
        "musts": ["backlog management", "stakeholder communication"], "nice": "roadmapping tools",
        "outcome": "The delivery board reflects reality and two releases ship on the promised dates",
        "team": "two delivery squads", "urgency": "Deadlines slip because nobody owns the plan",
    },
    "healthcare_clinical": {
        "titles": {"junior": "Practice Nurse", "medior": "Registered Nurse", "senior": "Head Nurse"},
        "musts": ["valid nursing licence", "patient documentation"], "nice": "geriatric care experience",
        "outcome": "Runs the morning ward round independently and documentation passes audit",
        "team": "a ward team of twelve", "urgency": "Overtime is burning out the current nurses",
    },
    "life_sciences_research": {
        "titles": {"junior": "Lab Technician", "medior": "Research Associate", "senior": "Senior Scientist"},
        "musts": ["wet-lab technique", "protocol documentation"], "nice": "HPLC experience",
        "outcome": "Runs the assay pipeline solo and the lab notebook stands up to review",
        "team": "an R&D group of five", "urgency": "The grant milestone is due next quarter",
    },
    "skilled_trades": {
        "titles": {"junior": "Apprentice Electrician", "medior": "Electrician", "senior": "Site Foreman"},
        "musts": ["electrical certification", "reading technical drawings"], "nice": "PLC basics",
        "outcome": "Handles service calls alone and closes them with clean revision reports",
        "team": "a field crew of three", "urgency": "We are turning down service contracts",
    },
    "operations_logistics": {
        "titles": {"junior": "Warehouse Coordinator", "medior": "Logistics Planner", "senior": "Supply Chain Manager"},
        "musts": ["WMS experience", "shift planning"], "nice": "forklift licence",
        "outcome": "Dispatch runs a full week without escalations and stock counts reconcile",
        "team": "a warehouse crew of fifteen", "urgency": "Peak season starts in ten weeks",
    },
    "frontline_service": {
        "titles": {"junior": "Front Desk Associate", "medior": "Shift Supervisor", "senior": "Store Manager"},
        "musts": ["customer-facing experience", "cash handling"], "nice": "POS administration",
        "outcome": "Runs weekend shifts without a manager on call and mystery-shop scores recover",
        "team": "a store team of eight", "urgency": "Weekend coverage depends on one person",
    },
    "sales_marketing": {
        "titles": {"junior": "Sales Development Rep", "medior": "Account Manager", "senior": "Head of Growth"},
        "musts": ["pipeline discipline", "CRM hygiene"], "nice": "our industry network",
        "outcome": "Owns twenty accounts and the quarter's renewal book closes above target",
        "team": "a commercial team of five", "urgency": "Renewals are slipping to the competition",
    },
    "finance_accounting": {
        "titles": {"junior": "Junior Accountant", "medior": "Accountant", "senior": "Financial Controller"},
        "musts": ["double-entry accounting", "month-end close"], "nice": "our ERP",
        "outcome": "Month-end close lands by day five and the auditors get clean schedules",
        "team": "a finance team of four", "urgency": "Close currently takes twelve days",
    },
    "legal_compliance": {
        "titles": {"junior": "Paralegal", "medior": "Compliance Officer", "senior": "Senior Counsel"},
        "musts": ["contract review", "regulatory tracking"], "nice": "GDPR specialization",
        "outcome": "The contract backlog clears and new regulations land as tracked actions",
        "team": "a two-lawyer legal team", "urgency": "Contracts wait three weeks for review",
    },
    "hr_people": {
        "titles": {"junior": "Recruitment Coordinator", "medior": "Talent Acquisition Partner", "senior": "HR Business Partner"},
        "musts": ["structured interviewing", "ATS fluency"], "nice": "employer branding",
        "outcome": "Owns two searches end to end and hiring managers stop chasing updates",
        "team": "a people team of three", "urgency": "Open roles sit unfilled for a quarter",
    },
    "education_academic": {
        "titles": {"junior": "Teaching Assistant", "medior": "Lecturer", "senior": "Program Director"},
        "musts": ["curriculum delivery", "student assessment"], "nice": "e-learning tools",
        "outcome": "Carries two course groups solo and student feedback stays above four of five",
        "team": "a faculty of ten", "urgency": "The semester starts with an unstaffed course",
    },
    "creative_design": {
        "titles": {"junior": "Junior Graphic Designer", "medior": "UX Designer", "senior": "Creative Lead"},
        "musts": ["Figma", "portfolio of shipped work"], "nice": "motion design",
        "outcome": "The design backlog stops blocking sprints and the brand kit is actually used",
        "team": "a product trio with no designer", "urgency": "Sprints stall on missing designs",
    },
    "customer_support": {
        "titles": {"junior": "Support Agent", "medior": "Support Specialist", "senior": "Head of Support"},
        "musts": ["written customer communication", "ticket triage"], "nice": "our helpdesk stack",
        "outcome": "First-response time halves and the top ten macros are rewritten from real tickets",
        "team": "a support pod of four", "urgency": "SLA breaches doubled last month",
    },
    "general_professional": {
        "titles": {"junior": "Office Coordinator", "medior": "Executive Assistant", "senior": "Operations Manager"},
        "musts": ["calendar and travel management", "vendor coordination"], "nice": "basic bookkeeping",
        "outcome": "The office runs without the founders touching logistics and vendors are consolidated",
        "team": "a thirty-person office", "urgency": "The founders lose a day a week to logistics",
    },
}

_BASE_MUST_HOLD = ["completed", "one_question_per_turn", "no_premature_end", "grounded_readback", "brief_core"]


def _golden_answers(shape: str, seniority: str, content: dict[str, Any]) -> list[str]:
    # Every list ends with the confirm turn answering the read-back — the close
    # is a separate exchange by contract (UAT L1-CONV-2).
    title = content["titles"][seniority]
    musts = ", ".join(content["musts"])
    if shape == "power_unit":
        return [
            f"It's a backfill — our {title.lower()} left {content['team']}, we need the same again",
            title,
            content["outcome"],
            musts,
            seniority,
            "skip",
            "ok",
        ]
    return [
        f"We've never had this role and we're not sure of the exact shape — {content['urgency'].lower()}",
        title,
        content["outcome"],
        musts,
        content["nice"],
        seniority,
        "Czech, English",
        content["team"].capitalize(),
        content["urgency"],
        "skip",
        "ok",
    ]


def _requestor_prompt(shape: str, seniority: str, family_label: str, content: dict[str, Any]) -> str:
    title = content["titles"][seniority]
    if shape == "power_unit":
        return (
            f"You are a manager backfilling a {title} who just left {content['team']} "
            f"({family_label.split('—')[0].strip()}). You know exactly what you need and answer concretely "
            f"in 1-2 sentences. Must-haves: {', '.join(content['musts'])}. 90-day expectation: {content['outcome']}."
        )
    return (
        f"You are a manager creating a first-ever {title} role for {content['team']} "
        f"({family_label.split('—')[0].strip()}). You hedge at first ('we've never had this role'), the real pressure is: "
        f"{content['urgency']}. When the interviewer reflects and asks concrete questions you land on: must-haves "
        f"{', '.join(content['musts'])}, nice-to-have {content['nice']}, 90-day outcome: {content['outcome']}. 1-3 sentences per reply."
    )


def build_pool() -> list[dict]:
    """The full deterministic pool: family × seniority × shape (16×3×2 = 96)."""
    pool: list[dict] = []
    labels = dict(role_family_catalog())
    for family, content in FAMILY_CONTENT.items():
        label = labels.get(family, family)
        for seniority in SENIORITIES:
            for shape in SHAPES:
                expect: dict[str, Any] = {"shape": shape, "must_hold": list(_BASE_MUST_HOLD)}
                if shape == "power_unit":
                    expect["max_agent_turns"] = 8
                pool.append(
                    {
                        "name": f"{family}__{seniority}__{shape}",
                        "family": family,
                        "behavior": f"{shape} need in {family}",
                        "lang": "en",
                        "requestor_prompt": _requestor_prompt(shape, seniority, label, content),
                        "golden_answers": _golden_answers(shape, seniority, content),
                        "expect": expect,
                    }
                )
    return pool


def fixed_bank(n: int = 100) -> list[dict]:
    """Exactly ``n`` deterministic scenarios: the 96-strong pool, topped up (or
    trimmed) family-round-robin with a 'lead'-seniority story variant so the
    bank reaches the target without RNG."""
    pool = build_pool()
    if n <= len(pool):
        return pool[:n]
    labels = dict(role_family_catalog())
    extras: list[dict] = []
    for family, content in FAMILY_CONTENT.items():
        if len(pool) + len(extras) >= n:
            break
        label = labels.get(family, family)
        # A lead-level exploratory variant — the "complex story" end of the axis.
        senior_title = content["titles"]["senior"]
        lead = {
            **content,
            "titles": {**content["titles"], "senior": f"Lead {senior_title.removeprefix('Senior ').removeprefix('Head of ')}"},
        }
        extras.append(
            {
                "name": f"{family}__lead__story",
                "family": family,
                "behavior": f"lead-level story need in {family}",
                "lang": "en",
                "requestor_prompt": _requestor_prompt("story", "senior", label, lead),
                "golden_answers": _golden_answers("story", "senior", lead),
                "expect": {"shape": "story", "must_hold": list(_BASE_MUST_HOLD)},
            }
        )
    return pool + extras
