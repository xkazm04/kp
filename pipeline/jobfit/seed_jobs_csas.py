"""Re-seed the job corpus to fit Česká spořitelna (Erste Group) — a real target customer.

Grounds the synthetic corpus in ČS's ACTUAL tech/data/product roles (sourced from
kariera.csas.cz, csas.jobs.cz, jobs.cz, LinkedIn): George (their digital banking
platform), the AI First domain, Payments IT, the Data tribe, REICO funds, security,
cloud, agile tribes/domains — all at the largest Czech retail bank, HQ Praha-Michle.

Reuses seed_jobs.generate() via its specs/prompt_fn hook. Roles are mapped onto the app's
three matchable families (software_engineering / data_ai / product_project) so matching,
salary bands (role_band -> realistic CZK), the Matrix and the pipeline all keep working.
ČS's retail-advisory / risk / finance roles are out of the app's current family scope.

    python -m pipeline.jobfit.seed_jobs_csas --count 100 --workers 6 --no-resume
    python -m pipeline.jobfit.seed_jobs_csas --materialize   # rewrite normalized from raw
"""

from __future__ import annotations

import argparse
import json
import random
import sys
from typing import Any

from .jobs import SENIORITIES, WORK_MODES
from .seed_jobs import DEFAULT_OUT, ROOT, generate, summarize, write_normalized

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


def build_specs(count: int, *, seed: int = 42) -> list[dict[str, Any]]:
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
    return specs


_SYSTEM_CTX = (
    "Company context: Česká spořitelna (a.s.) is the largest Czech retail bank and part of Erste Group. "
    "It runs an AGILE TRIBE/DOMAIN organization, its flagship digital platform is GEORGE (web + mobile "
    "banking used by millions), and its HQ is in Praha-Michle. Write a realistic 2026 banking-tech ad."
)


def spec_to_prompt(spec: dict[str, Any]) -> str:
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


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Re-seed the job corpus for Česká spořitelna.")
    parser.add_argument("--count", type=int, default=100)
    parser.add_argument("--workers", type=int, default=6)
    parser.add_argument("--seed", type=int, default=42)
    parser.add_argument("--retries", type=int, default=2)
    parser.add_argument("--limit", type=int, default=None)
    parser.add_argument("--no-resume", action="store_true")
    parser.add_argument("--dry-run", action="store_true")
    parser.add_argument("--materialize", action="store_true", help="Skip generation; rewrite normalized from the raw corpus.")
    args = parser.parse_args(argv)

    out = DEFAULT_OUT
    if args.dry_run:
        for spec in build_specs(args.count, seed=args.seed)[: (args.limit or 3)]:
            print(json.dumps(spec, ensure_ascii=False))
        return 0

    if args.materialize:
        records = json.loads(out.read_text(encoding="utf-8"))
        norm = write_normalized(records, out)
        print(f"Materialized {len(records)} jobs -> {norm.name}", file=sys.stderr)
        print(summarize(records), file=sys.stderr)
        return 0

    specs = build_specs(args.count, seed=args.seed)
    existing: dict[str, dict[str, Any]] = {}
    if out.exists() and not args.no_resume:
        for rec in json.loads(out.read_text(encoding="utf-8")):
            # only resume from records that are already ČS (don't merge the old synthetic corpus)
            if isinstance(rec, dict) and rec.get("id") and rec.get("company") == COMPANY:
                existing[rec["id"]] = rec

    records, failures = generate(
        args.count,
        workers=args.workers,
        seed=args.seed,
        limit=args.limit,
        retries=args.retries,
        existing=existing,
        specs=specs,
        prompt_fn=spec_to_prompt,
    )
    if not records:
        print("No records generated.", file=sys.stderr)
        return 1

    for r in records:  # belt-and-suspenders: the company is fixed for this profile
        r["company"] = COMPANY

    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(records, ensure_ascii=False, indent=2), encoding="utf-8")
    norm = write_normalized(records, out)
    print(f"\nWrote {len(records)} Česká spořitelna jobs -> {out.relative_to(ROOT)} (+ {norm.name}; failures: {dict(failures)})", file=sys.stderr)
    print(summarize(records), file=sys.stderr)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
