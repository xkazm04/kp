"""A landscape of synthetic IT hiring scenarios to exercise the Dev pipeline.

Deterministic (varied by index, no RNG) so runs are reproducible. Each scenario is a
{need, snapshot, planted} triple. `planted` records the variations we deliberately
injected (stack mismatch / ungrounded / ambiguous) so the eval can check whether the
pipeline *caught* them. Data-driven + expandable — adding a family/archetype (IT today,
non-IT later) just extends the tables below.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any

from .models import DevNeed, RepoSnapshot

# --- the landscape (axes) --------------------------------------------------

FAMILIES: dict[str, dict[str, Any]] = {
    "software_engineering": {
        "titles": ["Backend Engineer", "Fullstack Engineer", "Frontend Engineer", "Software Engineer"],
        "stacks": [
            ["Python", "Django", "PostgreSQL"],
            ["Node.js", "TypeScript", "React"],
            ["Java", "Spring", "Kafka"],
            ["Go", "gRPC", "PostgreSQL"],
            ["C#", ".NET", "SQL Server"],
            ["Ruby", "Rails", "Sidekiq"],
        ],
        "resp": ["Build and own services", "Design and review APIs", "Review PRs", "Mentor juniors", "Cut tech debt"],
    },
    "data_ai": {
        "titles": ["Data Scientist", "ML Engineer", "Data Engineer", "MLOps Engineer"],
        "stacks": [
            ["Python", "pandas", "scikit-learn"],
            ["Python", "PyTorch", "MLflow"],
            ["SQL", "dbt", "Snowflake"],
            ["Spark", "Scala", "Airflow"],
        ],
        "resp": ["Build and ship models", "Own data pipelines", "Productionize ML", "Define metrics"],
    },
    "devops_sre": {
        "titles": ["DevOps Engineer", "Site Reliability Engineer", "Platform Engineer"],
        "stacks": [
            ["Kubernetes", "Terraform", "AWS"],
            ["Docker", "Ansible", "GCP"],
            ["Go", "Prometheus", "Grafana"],
        ],
        "resp": ["Own CI/CD", "Run the clusters", "Improve reliability/SLOs", "On-call"],
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
        "resp": ["Threat modeling", "Pentest", "Harden services", "Triage findings"],
    },
}

ARCHETYPES: dict[str, dict[str, Any]] = {
    "greenfield": {"loc": (2_000, 9_000), "dirs": ["src", "tests"], "commits": ["init project", "add core module", "wire CI", "first feature end-to-end"]},
    "legacy": {"loc": (60_000, 200_000), "dirs": ["src", "legacy", "scripts", "docs", "vendor"], "commits": ["Merge branch 'stable'", "fix deprecation warning", "bump dependency", "hotfix prod incident"]},
    "monorepo": {"loc": (80_000, 400_000), "dirs": ["apps", "packages", "services", "libs", "tools", "infra"], "commits": ["chore: bump build tooling", "feat(api): new endpoint", "Merge pull request #842", "refactor shared lib"]},
    "library": {"loc": (5_000, 30_000), "dirs": ["src", "tests", "docs", "examples"], "commits": ["release 2.x", "fix edge case in parser", "add type hints", "deprecate old API"]},
    "service": {"loc": (8_000, 40_000), "dirs": ["cmd", "internal", "pkg", "deploy"], "commits": ["add endpoint", "structured logging", "add metrics", "fix data race"]},
    "data_pipeline": {"loc": (6_000, 35_000), "dirs": ["dags", "jobs", "sql", "notebooks", "tests"], "commits": ["add DAG", "backfill historical", "fix schema drift", "tune slow query"]},
}

SENIORITIES = ["junior", "medior", "senior", "lead"]
_FAMILY_KEYS = list(FAMILIES)
_ARCH_KEYS = list(ARCHETYPES)


@dataclass
class Scenario:
    id: str
    label: str
    need: DevNeed
    snapshot: RepoSnapshot | None
    planted: dict[str, Any] = field(default_factory=dict)


def _pick(seq: list, i: int):
    return seq[i % len(seq)]


def _loc(rng: tuple[int, int], i: int) -> int:
    lo, hi = rng
    return lo + (i * 9_973) % (hi - lo)  # deterministic spread


def _snapshot(stack: list[str], archetype: str, i: int) -> RepoSnapshot:
    arch = ARCHETYPES[archetype]
    share = round(1.0 / max(1, len(stack)), 2)
    return RepoSnapshot(
        ref=f"acme/{archetype}-{i}",
        languages={s: share for s in stack},
        inferred_stack=stack,
        frameworks=stack[1:2],
        top_dirs=arch["dirs"],
        recent_commit_summaries=arch["commits"],
        loc=_loc(arch["loc"], i),
        readme_excerpt=f"A {archetype} {stack[0]} codebase.",
    )


def generate_scenarios(n: int = 100) -> list[Scenario]:
    """Spread n scenarios across the landscape, planting known defects to test detection."""
    out: list[Scenario] = []
    for i in range(n):
        fam = _pick(_FAMILY_KEYS, i)
        spec = FAMILIES[fam]
        stack = _pick(spec["stacks"], i // len(_FAMILY_KEYS))
        seniority = _pick(SENIORITIES, i)
        archetype = _pick(_ARCH_KEYS, i)
        title = _pick(spec["titles"], i)

        ambiguous = i % 5 == 0
        sparse = i % 11 == 0  # ungrounded: no codebase snapshot
        incoherent = (i % 7 == 3) and not sparse  # cross-domain: codebase can't host the role (rare, realistic edge)
        mismatch = (i % 3 == 0) and not sparse and not incoherent  # SAME family, different framework (realistic transfer)

        responsibilities = [] if ambiguous else spec["resp"][: 2 + (i % 3)]

        need = DevNeed(
            id=f"scn-{i:03d}",
            title=title,
            stack=stack,
            responsibilities=responsibilities,
            seniority_target=seniority,
            role_family=fam,
            notes="" if not ambiguous else "Smallish team, move fast — details TBD.",
            codebase_refs=[],
        )

        snapshot: RepoSnapshot | None = None
        if not sparse:
            if incoherent:
                # codebase from a DIFFERENT family — the role's work can't be done on it
                other_fam = _pick([f for f in _FAMILY_KEYS if f != fam], i)
                snapshot = _snapshot(_pick(FAMILIES[other_fam]["stacks"], i), archetype, i)
            elif mismatch:
                # SAME family, a DIFFERENT framework/stack — realistic transfer test
                fam_stacks = spec["stacks"]
                idx = (fam_stacks.index(stack) + 1) % len(fam_stacks)
                snapshot = _snapshot(fam_stacks[idx], archetype, i)
            else:
                snapshot = _snapshot(stack, archetype, i)

        tags = "".join(
            [" · MISMATCH" if mismatch else "", " · INCOHERENT" if incoherent else "", " · SPARSE" if sparse else "", " · AMBIG" if ambiguous else ""]
        )
        out.append(
            Scenario(
                id=need.id,
                label=f"{seniority} {title} · {fam} · {archetype}{tags}",
                need=need,
                snapshot=snapshot,
                planted={
                    "family": fam,
                    "archetype": archetype,
                    "mismatch": mismatch,
                    "incoherent": incoherent,
                    "sparse": sparse,
                    "ambiguous": ambiguous,
                },
            )
        )
    return out
