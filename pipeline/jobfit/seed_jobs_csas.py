"""Re-seed the job corpus to fit Česká spořitelna (Erste Group) — a real target customer.

Grounds the synthetic corpus in ČS's ACTUAL tech/data/product roles (sourced from
kariera.csas.cz, csas.jobs.cz, jobs.cz, LinkedIn): George (their digital banking
platform), the AI First domain, Payments IT, the Data tribe, REICO funds, security,
cloud, agile tribes/domains — all at the largest Czech retail bank, HQ Praha-Michle.

Reuses seed_jobs.generate() via its specs/prompt_fn hook. The tech roles carry their
true technology families (software_engineering / data_ai / product_project); the bank's
NON-TECH roles now carry their OWN families too — the taxonomy grew a round-4 skill graph
for finance_accounting, operations_logistics, sales_marketing and customer_support, and
this corpus is what exercises it. Every family has a salary band (role_band -> realistic
CZK), so matching, the Matrix and the pipeline keep working for the whole bank, not just IT.

Corpus layout: ids job-000..job-{count-1} are the TECH slice (round-robin over
:data:`CSAS_ROLES`); ids job-100.. are the fixed NON-TECH slice (:data:`CSAS_NONTECH_ROLES`,
one job per archetype). :func:`build_specs` returns both, so the two grow independently.

    # additive top-up (KEEP the frozen tech jobs; generate only the missing non-tech ids):
    python -m pipeline.jobfit.seed_jobs_csas --count 100 --workers 6
    # full regen (regenerates EVERYTHING incl. the tech slice — only when you mean to):
    python -m pipeline.jobfit.seed_jobs_csas --count 100 --workers 6 --no-resume
    python -m pipeline.jobfit.seed_jobs_csas --materialize   # rewrite normalized from raw
"""

from __future__ import annotations

import json
import random
from typing import Any

from .jobs import SENIORITIES, WORK_MODES
from .seed_jobs import run_seed_main

COMPANY = "Česká spořitelna"

# Real ČS tech/data/product role archetypes (title base, family, anchoring stack, team context).
CSAS_ROLES: list[dict[str, Any]] = [
    # --- software_engineering ---
    {"t": "Java Backend Engineer", "f": "software_engineering", "stack": ["Java", "Spring Boot", "Oracle", "Kafka", "REST"], "ctx": "core banking services on the Erste platform"},
    {"t": "Fullstack Engineer (Node.js & AI)", "f": "software_engineering", "stack": ["Node.js", "TypeScript", "React", "Express", "REST APIs"], "ctx": "AI-powered digital solutions"},
    {"t": "iOS Engineer – George", "f": "software_engineering", "stack": ["Swift", "SwiftUI", "iOS", "Combine"], "ctx": "the George mobile banking app"},
    {"t": "Android Engineer – George", "f": "software_engineering", "stack": ["Kotlin", "Android", "Coroutines", "Jetpack Compose"], "ctx": "the George mobile banking app"},
    {"t": "Mobile QA Engineer – George", "f": "software_engineering", "stack": ["test automation", "Appium", "Java", "CI/CD"], "ctx": "quality for the George app"},
    {"t": "SDET / Test Automation Engineer", "f": "software_engineering", "stack": ["Playwright", "Selenium", "Java", "CI/CD"], "ctx": "automated quality gates across the tribes"},
    {"t": "Cloud Engineer", "f": "software_engineering", "stack": ["AWS", "Kubernetes", "Terraform", "Docker"], "ctx": "the bank's cloud adoption"},
    {"t": "DevOps Engineer", "f": "software_engineering", "stack": ["Kubernetes", "GitLab CI", "Docker", "Ansible"], "ctx": "platform delivery for the product tribes"},
    {"t": "Site Reliability Engineer", "f": "software_engineering", "stack": ["Kubernetes", "Prometheus", "Grafana", "Go"], "ctx": "reliability of George and core banking services"},
    {"t": "Security Engineer (bezpečnostní technologie)", "f": "software_engineering", "stack": ["application security", "SIEM", "threat modeling", "Python"], "ctx": "the security technologies team"},
    {"t": "Integration Engineer – Payments", "f": "software_engineering", "stack": ["Java", "Kafka", "REST", "ISO 20022"], "ctx": "Payments IT — cards, ATMs and instant payments"},
    {"t": "Frontend Engineer – George web", "f": "software_engineering", "stack": ["TypeScript", "Angular", "React", "CSS"], "ctx": "the George web banking front-end"},
    {"t": "Principal Software Engineer – AI First Domain", "f": "software_engineering", "stack": ["Java", "Python", "microservices", "LLM integration"], "ctx": "the AI First domain decomposing the monolith"},
    # --- data_ai ---
    {"t": "Data Engineer", "f": "data_ai", "stack": ["Python", "Spark", "SQL", "Snowflake", "Airflow"], "ctx": "the Data tribe's pipelines"},
    {"t": "Datový analytik – Data Governance & Reporting", "f": "data_ai", "stack": ["SQL", "Power BI", "data governance", "cloud"], "ctx": "business reporting and data governance"},
    {"t": "Risk Data Analyst", "f": "data_ai", "stack": ["SQL", "Python", "statistics", "credit risk"], "ctx": "the risk analytics team"},
    {"t": "Analytics Engineer – CRM & Campaigns", "f": "data_ai", "stack": ["dbt", "SQL", "Snowflake", "CRM"], "ctx": "CRM and campaign analytics"},
    {"t": "AI Engineer – AI First Domain", "f": "data_ai", "stack": ["Python", "LLM", "PyTorch", "MLOps"], "ctx": "the AI First domain (GenAI and the voicebot)"},
    {"t": "Machine Learning Engineer", "f": "data_ai", "stack": ["Python", "MLflow", "scikit-learn", "cloud"], "ctx": "productionizing models for retail banking"},
    {"t": "Research Data Analyst (Insight & Storytelling)", "f": "data_ai", "stack": ["SQL", "data visualization", "Python", "storytelling"], "ctx": "customer insight and storytelling"},
    {"t": "BI Developer", "f": "data_ai", "stack": ["Power BI", "SQL", "DAX", "Tableau"], "ctx": "self-service BI for the business"},
    {"t": "Data Scientist", "f": "data_ai", "stack": ["Python", "scikit-learn", "SQL", "statistics"], "ctx": "data science for retail banking products"},
    # --- product_project ---
    {"t": "Product Owner – George", "f": "product_project", "stack": ["agile", "product discovery", "roadmapping", "stakeholder management"], "ctx": "a George product tribe"},
    {"t": "IT Domain Lead (Tribe)", "f": "product_project", "stack": ["agile leadership", "delivery", "stakeholder management", "architecture awareness"], "ctx": "leading an IT domain within a tribe"},
    {"t": "Technical Portfolio Coordinator – REICO", "f": "product_project", "stack": ["portfolio management", "project delivery", "reporting"], "ctx": "the REICO investment funds arm"},
    {"t": "Agile Coach / Scrum Master", "f": "product_project", "stack": ["Scrum", "Kanban", "facilitation", "agile"], "ctx": "coaching the product tribes"},
    {"t": "IT Project Manager", "f": "product_project", "stack": ["project management", "delivery", "risk management", "stakeholder management"], "ctx": "IT delivery across domains"},
    {"t": "Business Analyst", "f": "product_project", "stack": ["requirements analysis", "BPMN", "SQL", "stakeholder management"], "ctx": "bridging business and IT in a tribe"},
    {"t": "Program Manager", "f": "product_project", "stack": ["program management", "governance", "delivery", "budgeting"], "ctx": "cross-tribe programs"},
]

_LOCATIONS = ["Praha – Michle", "Praha – Krč", "Praha", "Brno", "Ostrava", "Hradec Králové"]
_LOC_WEIGHTS = [40, 15, 15, 15, 10, 5]

# The bank's NON-TECH families. Activated by the round-4 taxonomy skill graph
# (finance_accounting / operations_logistics / sales_marketing / customer_support).
# frontline_service is intentionally NOT used: the taxonomy models it with role
# titles but no skill terms, so its bank roles (branch advisor, personal banker,
# teller) are homed on the family whose SKILL vocabulary their day actually
# exercises — customer_support (servicing, complaints, onboarding) or
# sales_marketing (acquisition, cross-sell, relationship banking).
_NONTECH_FAMILIES = frozenset(
    {"finance_accounting", "operations_logistics", "sales_marketing", "customer_support"}
)

# Real ČS non-tech role archetypes, one job each (NOT round-robin — a fixed slice
# with an explicit seniority so family/level coverage is deterministic). ``stack``
# lists the real banking skills the ad should anchor on; they are phrased to land
# on the taxonomy's phase-1 skill terms so requirement resolution actually improves.
CSAS_NONTECH_ROLES: list[dict[str, Any]] = [
    # --- finance_accounting ---
    {"t": "Credit Risk Analyst (Rizikový analytik)", "f": "finance_accounting", "sen": "medior", "entry": False,
     "stack": ["credit analysis", "credit scoring", "underwriting", "IFRS 9", "financial analysis"],
     "ctx": "the retail credit-risk team modelling loan portfolios"},
    {"t": "Účetní (Accountant)", "f": "finance_accounting", "sen": "medior", "entry": False,
     "stack": ["účetnictví", "general ledger", "accounts payable", "bank reconciliation", "financial reporting", "VAT"],
     "ctx": "the general ledger and month-end close in Finance"},
    {"t": "Finanční controller / Controlling Specialist", "f": "finance_accounting", "sen": "senior", "entry": False,
     "stack": ["controlling", "budgeting", "financial forecasting", "financial modeling", "management reporting"],
     "ctx": "planning & controlling for a business line"},
    {"t": "AML / Compliance Analyst", "f": "finance_accounting", "sen": "medior", "entry": False,
     "stack": ["AML", "KYC", "transaction monitoring", "sanctions screening", "customer due diligence"],
     "ctx": "the financial-crime prevention (AML) unit"},
    {"t": "Specialista vymáhání pohledávek (Collections Specialist)", "f": "finance_accounting", "sen": "junior", "entry": True,
     "stack": ["collections", "credit analysis", "customer due diligence", "negotiation", "reporting"],
     "ctx": "early-stage retail collections"},
    # --- operations_logistics ---
    {"t": "Specialista back-office plateb (Payments Back-Office)", "f": "operations_logistics", "sen": "junior", "entry": True,
     "stack": ["order processing", "data entry", "document management", "standard operating procedures", "process documentation"],
     "ctx": "the payments back-office processing settlement exceptions"},
    {"t": "Úvěrová administrativa (Loan Administration Specialist)", "f": "operations_logistics", "sen": "medior", "entry": False,
     "stack": ["document management", "records management", "standard operating procedures", "data entry", "process improvement"],
     "ctx": "loan administration and drawdown operations"},
    {"t": "Card Operations Specialist", "f": "operations_logistics", "sen": "medior", "entry": False,
     "stack": ["order processing", "process documentation", "quality control", "scheduling", "records management"],
     "ctx": "card issuing and ATM operations"},
    {"t": "Specialista provozní excelence (Operational Excellence)", "f": "operations_logistics", "sen": "senior", "entry": False,
     "stack": ["process improvement", "lean management", "six sigma", "standard operating procedures", "kaizen"],
     "ctx": "continuous-improvement of back-office processes"},
    {"t": "Nákupčí / Procurement Specialist", "f": "operations_logistics", "sen": "medior", "entry": False,
     "stack": ["procurement", "purchasing", "supplier management", "contract negotiation", "invoicing"],
     "ctx": "indirect procurement and supplier management"},
    # --- sales_marketing ---
    {"t": "Firemní bankéř (Corporate Relationship Banker)", "f": "sales_marketing", "sen": "senior", "entry": False,
     "stack": ["account management", "relationship building", "B2B sales", "cross-selling", "negotiation"],
     "ctx": "the corporate & SME banking desk owning a client portfolio"},
    {"t": "Osobní bankéř (Personal Banker)", "f": "sales_marketing", "sen": "medior", "entry": False,
     "stack": ["customer acquisition", "upselling", "relationship building", "sales", "account management"],
     "ctx": "retail advisory at a flagship branch, cross-selling George products"},
    {"t": "Digital Marketing Specialist", "f": "sales_marketing", "sen": "medior", "entry": False,
     "stack": ["digital marketing", "SEO", "PPC", "social media marketing", "content marketing"],
     "ctx": "acquisition marketing for the George platform"},
    {"t": "Product Marketing Specialist", "f": "sales_marketing", "sen": "medior", "entry": False,
     "stack": ["market research", "marketing", "campaign management", "sales reporting", "content marketing"],
     "ctx": "go-to-market for retail banking products"},
    {"t": "Business Development Manager", "f": "sales_marketing", "sen": "senior", "entry": False,
     "stack": ["business development", "lead generation", "pipeline management", "partnership development", "deal closing"],
     "ctx": "new-partnership development for the bank's ecosystem"},
    # --- customer_support ---
    {"t": "Specialista klientského centra (Contact Center)", "f": "customer_support", "sen": "junior", "entry": True,
     "stack": ["customer service", "inbound calls", "call handling", "ticketing", "complaint resolution"],
     "ctx": "the retail contact centre handling inbound client requests"},
    {"t": "Specialista reklamací (Complaints Specialist)", "f": "customer_support", "sen": "medior", "entry": False,
     "stack": ["reklamace", "complaint resolution", "escalation management", "conflict resolution", "SLA management"],
     "ctx": "the complaints & disputes team"},
    {"t": "Client Service Specialist", "f": "customer_support", "sen": "medior", "entry": False,
     "stack": ["account servicing", "customer onboarding", "back office support", "email support", "knowledge base"],
     "ctx": "servicing retail clients across channels"},
    {"t": "Customer Retention Specialist", "f": "customer_support", "sen": "senior", "entry": False,
     "stack": ["customer retention", "customer success", "CSAT", "NPS", "customer feedback"],
     "ctx": "the retention team reducing churn on George"},
    {"t": "Digital Support Specialist – George", "f": "customer_support", "sen": "medior", "entry": False,
     "stack": ["live chat", "omnichannel support", "troubleshooting", "product support", "knowledge base"],
     "ctx": "in-app chat support for the George mobile & web banking app"},
]

# The non-tech slice starts here so its ids never collide with the tech slice
# (job-000..job-{count-1}); the tech corpus is <=100, giving a clear gap.
_NONTECH_ID_START = 100


def build_specs(count: int, *, seed: int = 42) -> list[dict[str, Any]]:
    # The tech slice numbers job-000..job-{count-1} and the non-tech slice starts at
    # job-100, so a count above _NONTECH_ID_START mints DUPLICATE ids. generate()
    # keys its output dict on the id, so the two specs race: the corpus that lands
    # depends on which LLM call returned last (two runs of the same command differ)
    # and one of the two roles is silently dropped. Refuse instead of racing.
    if count > _NONTECH_ID_START:
        raise ValueError(
            f"--count {count} exceeds the tech-slice ceiling ({_NONTECH_ID_START}): ids job-"
            f"{_NONTECH_ID_START:03d}.. are reserved for the fixed non-tech slice "
            f"(CSAS_NONTECH_ROLES). Raise _NONTECH_ID_START to grow the tech corpus."
        )
    rng = random.Random(seed)
    specs: list[dict[str, Any]] = []
    for i in range(count):
        role = CSAS_ROLES[i % len(CSAS_ROLES)]  # round-robin for even role coverage
        seniority = rng.choices(SENIORITIES, weights=[28, 32, 28, 12])[0]
        work_mode = rng.choices(WORK_MODES, weights=[10, 70, 20])[0]  # a bank is hybrid-heavy
        location = "Remote (CZ)" if work_mode == "remote" else rng.choices(_LOCATIONS, weights=_LOC_WEIGHTS)[0]
        roll = rng.random()
        languages = ["Czech", "English"] if roll < 0.7 else (["English"] if roll < 0.85 else ["Czech", "English", "German"])
        entry_friendly = seniority == "junior" or (seniority == "medior" and rng.random() < 0.25)
        specs.append(
            {
                "id": f"job-{i:03d}",
                "title_base": role["t"],
                "family": role["f"],
                "stack": role["stack"],
                "ctx": role["ctx"],
                "seniority": seniority,
                "work_mode": work_mode,
                "location": location,
                "languages": languages,
                "entry_friendly": entry_friendly,
            }
        )
    return specs + build_nontech_specs(seed=seed)


def build_nontech_specs(*, seed: int = 42) -> list[dict[str, Any]]:
    """The fixed NON-TECH slice (ids job-100..), one job per :data:`CSAS_NONTECH_ROLES`.

    Deterministic: seniority is fixed per role, only work-mode/location/languages
    are drawn from ``seed`` so a re-run reproduces the same corpus. Bank non-tech
    roles skew onsite/hybrid (branch, contact centre, back office) — a teller is
    never remote — so the work-mode weights differ from the tech slice.
    """
    rng = random.Random(seed + 1)  # own stream so it can't perturb the tech draw
    specs: list[dict[str, Any]] = []
    for j, role in enumerate(CSAS_NONTECH_ROLES):
        work_mode = rng.choices(WORK_MODES, weights=[45, 50, 5])[0]  # mostly onsite/hybrid
        location = "Remote (CZ)" if work_mode == "remote" else rng.choices(_LOCATIONS, weights=_LOC_WEIGHTS)[0]
        roll = rng.random()
        languages = ["Czech", "English"] if roll < 0.75 else (["Czech"] if roll < 0.9 else ["Czech", "English", "German"])
        specs.append(
            {
                "id": f"job-{_NONTECH_ID_START + j:03d}",
                "title_base": role["t"],
                "family": role["f"],
                "stack": role["stack"],
                "ctx": role["ctx"],
                "seniority": role["sen"],
                "work_mode": work_mode,
                "location": location,
                "languages": languages,
                "entry_friendly": role["entry"],
            }
        )
    return specs


_SYSTEM_CTX = (
    "Company context: Česká spořitelna (a.s.) is the largest Czech retail bank and part of Erste Group. "
    "It runs an AGILE TRIBE/DOMAIN organization, its flagship digital platform is GEORGE (web + mobile "
    "banking used by millions), and its HQ is in Praha-Michle. Write a realistic 2026 banking-tech ad."
)

# Non-tech roles live in the same bank but their day is a business craft, not a
# tech stack — so the ad must NOT invent "technologies". It anchors on the real
# banking skills in the spec's ``stack`` (credit analysis, AML/KYC, reklamace,
# collections, controlling, …) so the extracted requirements land on the
# taxonomy's phase-1 non-tech skill graph instead of degrading to raw strings.
_NONTECH_SYSTEM_CTX = (
    "Company context: Česká spořitelna (a.s.) is the largest Czech retail bank and part of Erste Group. "
    "Its flagship platform is GEORGE (web + mobile banking) and its HQ is in Praha-Michle. This is a "
    "BUSINESS role (finance / operations / sales / client service), NOT an engineering role — do NOT "
    "invent programming languages, frameworks or cloud tools. Write a realistic 2026 Czech bank job ad."
)


def _nontech_prompt(spec: dict[str, Any]) -> str:
    entry_line = (
        "This is an EARLY-CAREER role: welcoming language for graduates/students, training provided, "
        'min_years_experience 0-1, and MOST must-have skills hardness="learnable".'
        if spec["entry_friendly"]
        else 'This is an experienced role: a realistic min_years_experience for the seniority and core '
        'skills hardness="prerequisite".'
    )
    return f"""{_NONTECH_SYSTEM_CTX}

Write ONE realistic job ad for ČESKÁ SPOŘITELNA as a JSON object with exactly these keys:
{{
  "title": str, "company": "Česká spořitelna", "location": "{spec['location']}",
  "work_mode": "{spec['work_mode']}",
  "employment_type": str,
  "seniority": "{spec['seniority']}",
  "role_family": "{spec['family']}",
  "languages": {json.dumps(spec['languages'], ensure_ascii=False)},
  "min_years_experience": number,
  "min_education": "phd|master|bachelor|university|none",
  "description": str,
  "requirements": [ {{ "skill": str, "kind": "must_have|nice_to_have", "hardness": "prerequisite|learnable" }} ]
}}

Constraints:
- company MUST be exactly "Česká spořitelna".
- title: base it on "{spec['title_base']}", adapting the seniority naturally (Junior/Senior/Lead). Keep it a realistic bank title (Czech or English).
- 5-8 requirements anchored on THESE real banking skills: {json.dumps(spec['stack'], ensure_ascii=False)} (you may add 1-2 adjacent business skills). Name the skills PLAINLY (e.g. "credit analysis", "AML", "KYC", "reklamace", "collections", "controlling") — a skill string is the competency itself, not a sentence.
- description: 2-4 sentences grounding the role in {spec['ctx']} at Česká spořitelna, a normal day, and the team. Czech or English is fine.
- {entry_line}
- For each requirement decide kind (must vs nice) and hardness (prerequisite = cannot do the job without it; learnable = can be picked up).

Output JSON only, no markdown fences, no commentary."""


def spec_to_prompt(spec: dict[str, Any]) -> str:
    if spec["family"] in _NONTECH_FAMILIES:
        return _nontech_prompt(spec)
    entry_line = (
        "This is an EARLY-CAREER role: welcoming language for graduates/students, mentoring/training, "
        'min_years_experience 0-1, and MOST must-have skills hardness="learnable".'
        if spec["entry_friendly"]
        else 'This is an experienced role: a realistic min_years_experience for the seniority and core '
        'skills hardness="prerequisite".'
    )
    return f"""{_SYSTEM_CTX}

Write ONE realistic job ad for ČESKÁ SPOŘITELNA as a JSON object with exactly these keys:
{{
  "title": str, "company": "Česká spořitelna", "location": "{spec['location']}",
  "work_mode": "{spec['work_mode']}",
  "employment_type": str,
  "seniority": "{spec['seniority']}",
  "role_family": "{spec['family']}",
  "languages": {json.dumps(spec['languages'], ensure_ascii=False)},
  "min_years_experience": number,
  "min_education": "phd|master|bachelor|university|none",
  "description": str,
  "requirements": [ {{ "skill": str, "kind": "must_have|nice_to_have", "hardness": "prerequisite|learnable" }} ]
}}

Constraints:
- company MUST be exactly "Česká spořitelna".
- title: base it on "{spec['title_base']}", adapting the seniority naturally (e.g. Junior/Senior/Lead). Keep it a realistic bank title.
- 4-8 requirements anchored on THIS real stack: {json.dumps(spec['stack'], ensure_ascii=False)} (add 1-2 more you judge appropriate). Use REAL technologies.
- description: 2-4 sentences grounding the role in {spec['ctx']} at Česká spořitelna / Erste, a normal day, and the tribe/George context. Czech or English is fine.
- {entry_line}
- For each requirement decide kind (must vs nice) and hardness (prerequisite = cannot do the job without it; learnable = can be picked up).

Output JSON only, no markdown fences, no commentary."""


def _stamp_company(records: list[dict[str, Any]]) -> None:
    # belt-and-suspenders: the company is fixed for this profile
    for rec in records:
        rec["company"] = COMPANY


def main(argv: list[str] | None = None) -> int:
    return run_seed_main(
        build_specs,
        spec_to_prompt,
        default_count=100,
        default_workers=6,
        description="Re-seed the job corpus for Česká spořitelna.",
        # only resume from records that are already ČS (don't merge the old synthetic corpus)
        resume_filter=lambda rec: rec.get("company") == COMPANY,
        finalize=_stamp_company,
        summary_label="Česká spořitelna jobs",
        argv=argv,
    )


if __name__ == "__main__":
    raise SystemExit(main())
