"""A landscape of synthetic hiring scenarios across DOMAINS to exercise the Dev pipeline.

Domain-pluggable: IT is one domain; marketing / finance / sales / design are non-IT domains.
The thesis is domain-independent (assume 100% LLM-generated work → grade judgment, verification,
tooling fluency, transfer — not raw output), so the same scenario shape applies everywhere. A
non-IT "codebase" is the body of work the role acts on (a content library, a financial model,
a CRM, a design system); we map it onto the existing RepoSnapshot fields (inferredStack=skills,
topDirs=work areas, recentCommitSummaries=recent activity, loc=corpus size).

Deterministic (varied by index, no RNG). `planted` records the injected defects (mismatch /
incoherent / sparse / ambiguous) so the eval can check whether the pipeline catches them.
Expandable: add a domain/family/archetype to the tables below.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any

from ._synth import SENIORITIES, pick as _pick
from .models import DevNeed, RepoSnapshot

# Each domain: families (role -> titles/skills/responsibilities) + work-context archetypes.
DOMAINS: dict[str, dict[str, Any]] = {
    "it": {
        "label": "software",
        "context_noun": "codebase",
        "families": {
            "software_engineering": {
                "titles": ["Backend Engineer", "Fullstack Engineer", "Frontend Engineer"],
                "stacks": [["Python", "Django", "PostgreSQL"], ["Node.js", "TypeScript", "React"], ["Java", "Spring", "Kafka"], ["Go", "gRPC", "PostgreSQL"]],
                "resp": ["Build and own services", "Design and review APIs", "Review PRs", "Cut tech debt"],
            },
            "data_ai": {
                "titles": ["Data Scientist", "ML Engineer", "Data Engineer"],
                "stacks": [["Python", "pandas", "scikit-learn"], ["Python", "PyTorch", "MLflow"], ["SQL", "dbt", "Snowflake"]],
                "resp": ["Build and ship models", "Own data pipelines", "Define metrics"],
            },
            "devops_sre": {
                "titles": ["DevOps Engineer", "Site Reliability Engineer", "Platform Engineer"],
                "stacks": [["Kubernetes", "Terraform", "AWS"], ["Docker", "Ansible", "GCP"], ["Go", "Prometheus", "Grafana"]],
                "resp": ["Own CI/CD", "Run the clusters", "Improve reliability/SLOs"],
            },
            "mobile": {
                "titles": ["iOS Engineer", "Android Engineer", "Mobile Engineer"],
                "stacks": [["Swift", "iOS", "Combine"], ["Kotlin", "Android", "Coroutines"], ["React Native", "TypeScript"], ["Flutter", "Dart"]],
                "resp": ["Ship app features", "Own the release train", "Improve app performance"],
            },
            "qa": {
                "titles": ["QA Engineer", "SDET", "Test Automation Engineer"],
                "stacks": [["Playwright", "TypeScript"], ["Selenium", "Java"], ["pytest", "Python"]],
                "resp": ["Build test suites", "Own quality gates", "Reduce flakiness"],
            },
            "security": {
                "titles": ["Security Engineer", "AppSec Engineer"],
                "stacks": [["Python", "Burp", "SIEM"], ["Go", "eBPF", "Falco"]],
                "resp": ["Threat modeling", "Pentest", "Harden services"],
            },
        },
        "archetypes": {
            "greenfield": {"size": (2_000, 9_000), "areas": ["src", "tests"], "activity": ["init project", "add core module", "wire CI", "first feature end-to-end"]},
            "legacy": {"size": (60_000, 200_000), "areas": ["src", "legacy", "scripts", "vendor"], "activity": ["Merge branch 'stable'", "fix deprecation warning", "bump dependency", "hotfix prod"]},
            "service": {"size": (8_000, 40_000), "areas": ["cmd", "internal", "pkg", "deploy"], "activity": ["add endpoint", "structured logging", "add metrics", "fix data race"]},
        },
    },
    "marketing": {
        "label": "marketing",
        "context_noun": "content & campaign library",
        "families": {
            "content_marketing": {
                "titles": ["Content Marketer", "Content Strategist", "SEO Specialist"],
                "stacks": [["SEO", "copywriting", "analytics"], ["content strategy", "editorial", "CMS"], ["SEO", "keyword research", "link building"]],
                "resp": ["Own the content calendar", "Grow organic traffic", "Brief and edit writers"],
            },
            "growth_marketing": {
                "titles": ["Growth Marketer", "Performance Marketer", "Lifecycle Marketer"],
                "stacks": [["paid ads", "analytics", "A/B testing"], ["email", "CRM", "automation"], ["funnel analysis", "SQL", "experimentation"]],
                "resp": ["Run paid acquisition", "Own the funnel", "Design experiments"],
            },
            "brand": {
                "titles": ["Brand Manager", "Communications Lead"],
                "stacks": [["brand strategy", "messaging", "PR"], ["social", "community", "storytelling"]],
                "resp": ["Steward the brand", "Own messaging", "Run campaigns"],
            },
        },
        "archetypes": {
            "established_brand": {"size": (200, 2_000), "areas": ["campaigns", "brand-guidelines", "content-library", "analytics"], "activity": ["refresh brand voice doc", "launch Q3 campaign", "update style guide", "quarterly performance review"]},
            "early_stage": {"size": (20, 200), "areas": ["website-copy", "social", "email"], "activity": ["write first landing page", "set up welcome email", "draft positioning"]},
            "content_heavy": {"size": (500, 5_000), "areas": ["blog", "seo", "content-calendar", "guides"], "activity": ["publish weekly post", "refresh old posts for SEO", "build pillar page"]},
        },
    },
    "finance": {
        "label": "finance",
        "context_noun": "financial model & reporting pack",
        "families": {
            "fpna": {
                "titles": ["Financial Analyst", "FP&A Analyst", "Finance Business Partner"],
                "stacks": [["Excel", "financial modeling", "forecasting"], ["SQL", "BI", "variance analysis"], ["budgeting", "scenario planning", "Excel"]],
                "resp": ["Own the forecast", "Partner with the business", "Explain the variances"],
            },
            "accounting": {
                "titles": ["Accountant", "Controller", "Accounts Lead"],
                "stacks": [["GAAP", "month-end close", "reconciliation"], ["AP/AR", "ERP", "controls"]],
                "resp": ["Run the close", "Own reconciliations", "Strengthen controls"],
            },
        },
        "archetypes": {
            "mature_model": {"size": (40, 400), "areas": ["model", "actuals", "board-pack", "reconciliations"], "activity": ["close the month", "refresh the forecast", "reconcile the bank", "prep the board pack"]},
            "messy_startup": {"size": (10, 80), "areas": ["sheets", "invoices", "exports"], "activity": ["first revenue model", "categorise expenses", "fix a broken formula"]},
        },
    },
    "sales": {
        "label": "sales",
        "context_noun": "CRM pipeline & playbooks",
        "families": {
            "account_exec": {
                "titles": ["Account Executive", "Enterprise AE", "Sales Manager"],
                "stacks": [["prospecting", "negotiation", "CRM"], ["demos", "MEDDIC", "forecasting"]],
                "resp": ["Own the number", "Run the sales cycle", "Forecast accurately"],
            },
            "sdr": {
                "titles": ["SDR", "Business Development Rep"],
                "stacks": [["outbound", "email sequencing", "CRM"], ["cold calling", "qualification", "research"]],
                "resp": ["Book qualified meetings", "Own outbound", "Keep CRM clean"],
            },
        },
        "archetypes": {
            "established_motion": {"size": (50, 500), "areas": ["pipeline", "playbooks", "call-recordings", "sequences"], "activity": ["update the pipeline", "write an outreach sequence", "run a QBR", "log a closed-won"]},
            "new_motion": {"size": (5, 50), "areas": ["leads", "scripts"], "activity": ["draft first cold email", "build a target list", "first discovery call"]},
        },
    },
    "design": {
        "label": "design",
        "context_noun": "design system & research repo",
        "families": {
            "product_design": {
                "titles": ["Product Designer", "UX Designer", "Design Lead"],
                "stacks": [["Figma", "design systems", "prototyping"], ["interaction design", "UX", "accessibility"]],
                "resp": ["Own the product UX", "Maintain the design system", "Ship flows"],
            },
            "ux_research": {
                "titles": ["UX Researcher", "Design Researcher"],
                "stacks": [["user research", "usability testing", "synthesis"], ["surveys", "interviews", "analysis"]],
                "resp": ["Run studies", "Synthesize insight", "Inform the roadmap"],
            },
        },
        "archetypes": {
            "mature_system": {"size": (100, 1_000), "areas": ["design-system", "flows", "research", "tokens"], "activity": ["audit the design system", "run a usability test", "redesign onboarding", "reconcile tokens"]},
            "early_product": {"size": (10, 120), "areas": ["wireframes", "explorations"], "activity": ["first wireframes", "explore onboarding", "set up a component library"]},
        },
    },
}

_DOMAIN_KEYS = list(DOMAINS)

# Back-compat aliases — the IT domain is the original landscape (other modules import these).
FAMILIES = DOMAINS["it"]["families"]
ARCHETYPES = DOMAINS["it"]["archetypes"]


@dataclass
class Scenario:
    id: str
    label: str
    need: DevNeed
    snapshot: RepoSnapshot | None
    planted: dict[str, Any] = field(default_factory=dict)


def _loc(rng: tuple[int, int], i: int) -> int:
    lo, hi = rng
    return lo + (i * 9_973) % (hi - lo)


def _context(domain: str, skills: list[str], archetype: str, i: int) -> RepoSnapshot:
    dom = DOMAINS[domain]
    arch = dom["archetypes"][archetype]
    share = round(1.0 / max(1, len(skills)), 2)
    return RepoSnapshot(
        ref=f"{domain}/{archetype}-{i}",
        languages={s: share for s in skills},
        inferred_stack=skills,
        frameworks=skills[1:2],
        top_dirs=arch["areas"],
        recent_commit_summaries=arch["activity"],
        loc=_loc(arch["size"], i),
        readme_excerpt=f"A {archetype} {dom['label']} {dom['context_noun']}.",
    )


def _make_scenario(domain: str, i: int) -> Scenario:
    dom = DOMAINS[domain]
    fam_keys = list(dom["families"])
    arch_keys = list(dom["archetypes"])
    fam = _pick(fam_keys, i)
    spec = dom["families"][fam]
    skills = _pick(spec["stacks"], i // max(1, len(fam_keys)))
    seniority = _pick(SENIORITIES, i)
    archetype = _pick(arch_keys, i)
    title = _pick(spec["titles"], i)

    ambiguous = i % 5 == 0
    sparse = i % 11 == 0
    incoherent = (i % 7 == 3) and not sparse  # context from a DIFFERENT domain (can't host the role)
    mismatch = (i % 3 == 0) and not sparse and not incoherent  # same domain, different family (realistic transfer)

    responsibilities = [] if ambiguous else spec["resp"][: 2 + (i % 3)]
    need = DevNeed(
        id=f"{domain}-{i:03d}",
        title=title,
        stack=skills,
        responsibilities=responsibilities,
        seniority_target=seniority,
        role_family=fam,
        notes="" if not ambiguous else "Small team, move fast — details TBD.",
        codebase_refs=[],
    )

    snapshot: RepoSnapshot | None = None
    if not sparse:
        if incoherent:
            other_dom = _pick([d for d in _DOMAIN_KEYS if d != domain], i)
            of = _pick(list(DOMAINS[other_dom]["families"]), i)
            osk = _pick(DOMAINS[other_dom]["families"][of]["stacks"], i)
            oa = _pick(list(DOMAINS[other_dom]["archetypes"]), i)
            snapshot = _context(other_dom, osk, oa, i)
        elif mismatch:
            ofam = _pick([f for f in fam_keys if f != fam], i)
            osk = _pick(dom["families"][ofam]["stacks"], i)
            snapshot = _context(domain, osk, archetype, i)
        else:
            snapshot = _context(domain, skills, archetype, i)

    tags = "".join(
        [" · MISMATCH" if mismatch else "", " · INCOHERENT" if incoherent else "", " · SPARSE" if sparse else "", " · AMBIG" if ambiguous else ""]
    )
    return Scenario(
        id=need.id,
        label=f"{seniority} {title} · {domain}/{fam} · {archetype}{tags}",
        need=need,
        snapshot=snapshot,
        planted={"domain": domain, "family": fam, "archetype": archetype, "mismatch": mismatch, "incoherent": incoherent, "sparse": sparse, "ambiguous": ambiguous},
    )


def generate_scenarios(n: int = 100, domain: str = "it") -> list[Scenario]:
    """Scenarios within one domain (default IT, for back-compat)."""
    return [_make_scenario(domain, i) for i in range(n)]


def generate_mixed(n: int = 100) -> list[Scenario]:
    """Scenarios spread across ALL domains (IT + non-IT), round-robin."""
    return [_make_scenario(_DOMAIN_KEYS[i % len(_DOMAIN_KEYS)], i) for i in range(n)]
