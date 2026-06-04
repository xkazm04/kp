"""Re-skin the synthetic candidate population onto Česká spořitelna banking-tech
tracks — deterministically, no LLM.

The base population (data/seed_candidates/candidates.json) is generated with
generic stacks (Go, Kentico, …). This aligns each candidate's SKILLS to the real
ČS hiring stacks (Java/Spring/Oracle on the Erste platform, Swift/Kotlin for the
George app, Angular/React for George web, Python/scikit-learn for risk & ML,
BA/PO/Scrum for the tribes) so the seeded analyses and matching reflect a real
banking employer. Names, archetypes, seniority, education, languages, and prior
evidence titles are PRESERVED — these are applicants to ČS, not ČS staff — only
their demonstrated skill stack is aligned to what the bank actually hires for.

    python -m pipeline.jobfit.align_candidates_csas            # rewrites candidates.json
    python -m pipeline.jobfit.align_candidates_csas --dry-run  # print the distribution only

Re-run python -m pipeline.jobfit.seed_analyses afterwards to refresh the analyses.
"""

from __future__ import annotations

import argparse
import json
import random
import sys
from collections import Counter
from pathlib import Path
from typing import Any

from .profile import CandidateProfileV2, normalize_profile

ROOT = Path(__file__).resolve().parents[2]
CANDIDATES_PATH = ROOT / "data" / "seed_candidates" / "candidates.json"

# Banking-tech tracks per role family — curated from CSAS_ROLES (seed_jobs_csas)
# plus the common surrounding skills a real CV in that track carries. `target` is
# the candidate's aspiration; the first skills are the core stack.
Track = dict[str, Any]
TRACKS: dict[str, list[Track]] = {
    "software_engineering": [
        {"target": "Java Backend Engineer", "skills": ["Java", "Spring Boot", "Oracle", "Kafka", "REST APIs", "PostgreSQL", "Microservices", "Docker"]},
        {"target": "iOS Engineer – George", "skills": ["Swift", "SwiftUI", "iOS", "Combine", "REST APIs", "Xcode", "Git"]},
        {"target": "Android Engineer – George", "skills": ["Kotlin", "Android", "Jetpack Compose", "Coroutines", "REST APIs", "Git"]},
        {"target": "Frontend Engineer – George web", "skills": ["TypeScript", "Angular", "React", "JavaScript", "RxJS", "CSS", "REST APIs"]},
        {"target": "Cloud / DevOps Engineer", "skills": ["AWS", "Kubernetes", "Terraform", "Docker", "GitLab CI", "Linux", "Ansible"]},
        {"target": "Site Reliability Engineer", "skills": ["Kubernetes", "Prometheus", "Grafana", "Go", "Linux", "Docker", "Observability"]},
        {"target": "Test Automation Engineer (SDET)", "skills": ["test automation", "Selenium", "Playwright", "Java", "CI/CD", "Appium"]},
        {"target": "Integration Engineer – Payments", "skills": ["Java", "Kafka", "REST APIs", "ISO 20022", "Spring Boot", "SQL"]},
    ],
    "data_ai": [
        {"target": "Data Scientist – retail banking", "skills": ["Python", "scikit-learn", "SQL", "statistics", "pandas", "data visualization"]},
        {"target": "Machine Learning Engineer", "skills": ["Python", "MLflow", "PyTorch", "scikit-learn", "MLOps", "cloud"]},
        {"target": "Data Engineer – Data tribe", "skills": ["Python", "Spark", "SQL", "Airflow", "Snowflake", "Kafka"]},
        {"target": "Risk Data Analyst", "skills": ["SQL", "Python", "statistics", "credit risk", "Power BI", "data analysis"]},
        {"target": "AI Engineer – AI First domain", "skills": ["Python", "LLM", "PyTorch", "MLOps", "prompt engineering", "cloud"]},
    ],
    "product_project": [
        {"target": "Product Owner – George", "skills": ["agile", "product discovery", "roadmapping", "stakeholder management", "Scrum", "Jira"]},
        {"target": "Business Analyst", "skills": ["requirements analysis", "BPMN", "SQL", "stakeholder management", "process mapping", "Jira"]},
        {"target": "Agile Coach / Scrum Master", "skills": ["Scrum", "Kanban", "facilitation", "agile", "stakeholder management", "Jira"]},
        {"target": "IT Project Manager", "skills": ["project management", "delivery", "risk management", "stakeholder management", "budgeting", "Jira"]},
    ],
}

# How many skills + which provenance/levels each archetype carries. Experienced
# hires show a deeper professional stack; early-career carry fewer, mostly
# coursework/project provenance so the provenance-discounted matcher treats them
# fairly rather than like five years in production.
_ARCHE_PROFILE = {
    "bau": {"count": (6, 8), "provenances": ["professional"], "levels": ["strong", "strong", "working"]},
    "student": {"count": (4, 6), "provenances": ["coursework", "academic_project", "self_declared", "personal_project"], "levels": ["working", "foundational"]},
    "career_switcher": {"count": (4, 6), "provenances": ["coursework", "personal_project", "self_declared"], "levels": ["foundational", "working"]},
}


def _aligned_skill_claims(track: Track, archetype: str, rng: random.Random) -> list[dict[str, str]]:
    cfg = _ARCHE_PROFILE.get(archetype, _ARCHE_PROFILE["bau"])
    lo, hi = cfg["count"]
    n = min(len(track["skills"]), rng.randint(lo, hi))
    # A deterministic RANDOM subset (not a prefix) of the track stack, so a
    # candidate may genuinely lack one of the role's core skills — which surfaces
    # as a realistic gap when scored against the role JD, instead of everyone
    # matching every requirement.
    chosen = rng.sample(track["skills"], n)
    claims = []
    for i, skill in enumerate(chosen):
        claims.append(
            {
                "skill": skill,
                "level": cfg["levels"][min(i, len(cfg["levels"]) - 1)],
                "provenance": cfg["provenances"][i % len(cfg["provenances"])],
            }
        )
    return claims


def _aspirations(track: Track, archetype: str, seniority: str | None) -> list[str]:
    target = track["target"]
    if archetype == "bau" and seniority in ("senior", "lead"):
        return [target, f"Tech lead / architect within a Česká spořitelna tribe"]
    if archetype == "student":
        return [f"Junior {target}", "Grow into a core engineering role at a bank"]
    if archetype == "career_switcher":
        return [target, "Apply prior-domain experience in a banking-tech team"]
    return [target]


def align_record(record: dict[str, Any], idx: int) -> dict[str, Any]:
    family = record.get("roleFamily") if record.get("roleFamily") in TRACKS else "software_engineering"
    tracks = TRACKS[family]
    track = tracks[idx % len(tracks)]
    archetype = str(record.get("archetype") or "bau")
    rng = random.Random(1000 + idx)

    claims = _aligned_skill_claims(track, archetype, rng)
    record["skillClaims"] = claims

    # Re-point each evidence item's demonstrated skills at a rolling window of the
    # track stack, so the strongest-provenance match credits the aligned skills.
    stack = track["skills"]
    for j, ev in enumerate(record.get("evidence") or []):
        if not isinstance(ev, dict):
            continue
        window = [stack[(j + k) % len(stack)] for k in range(2 + (j % 2))]
        ev["skills"] = list(dict.fromkeys(window))

    record["aspirations"] = _aspirations(track, archetype, record.get("seniority"))

    # Re-validate + normalize so evidence provenance defaults and completeness are
    # recomputed against the aligned content.
    profile = CandidateProfileV2.model_validate(record)
    score, _missing = normalize_profile(profile)  # stamp + reuse the score
    out = profile.model_dump(by_alias=True, exclude_none=True)
    out["id"] = record.get("id")
    out["displayName"] = record.get("displayName")
    out["completeness"] = score
    # The ČS role this candidate is aligned to — seed_analyses reads it to score
    # them against the matching role JD (not a generic family one). Extra,
    # non-model key; CandidateProfileV2 ignores it, so it never reaches scoring.
    out["targetRole"] = track["target"]
    return out


def main(argv: list[str] | None = None) -> int:
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8")
        sys.stderr.reconfigure(encoding="utf-8")

    parser = argparse.ArgumentParser(description="Align seeded candidates onto Česká spořitelna banking-tech tracks.")
    parser.add_argument("--path", type=Path, default=CANDIDATES_PATH)
    parser.add_argument("--dry-run", action="store_true", help="Print the track distribution without writing.")
    args = parser.parse_args(argv)

    if not args.path.exists():
        print(f"No candidate seed at {args.path}", file=sys.stderr)
        return 1
    records = json.loads(args.path.read_text(encoding="utf-8"))
    if not isinstance(records, list):
        print("Candidate seed is not a JSON array.", file=sys.stderr)
        return 1

    aligned: list[dict[str, Any]] = []
    targets: Counter[str] = Counter()
    for idx, rec in enumerate(records):
        if not isinstance(rec, dict):
            continue
        out = align_record(dict(rec), idx)
        aligned.append(out)
        fam = rec.get("roleFamily") if rec.get("roleFamily") in TRACKS else "software_engineering"
        targets[TRACKS[fam][idx % len(TRACKS[fam])]["target"]] += 1

    print(f"Aligned {len(aligned)} candidates onto ČS tracks:", file=sys.stderr)
    for target, n in targets.most_common():
        print(f"  {n:2}  {target}", file=sys.stderr)

    if args.dry_run:
        print("(dry run — candidates.json not written)", file=sys.stderr)
        return 0

    args.path.write_text(json.dumps(aligned, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"\nWrote {args.path.relative_to(ROOT)}", file=sys.stderr)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
