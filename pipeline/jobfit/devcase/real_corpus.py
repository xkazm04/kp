"""Real-JD corpus for the case-generation calibration harness (Part 1).

The case-design pipeline (analyze -> role -> case) has only ever been exercised on
SYNTHETIC scenarios (scenarios.py). The product's #1 known weakness is that it is
industry-locked to bank/Czech/tech; the generator *claims* to generalise to any
office role (design.py has an explicit "office / non-software role" branch) but
that claim has never been stress-tested against real, broad, cross-industry office
job descriptions. This module supplies that corpus.

It pulls real OFFICE job descriptions from a free public dataset (the Hugging Face
datasets-server REST API — no auth, no key), classifies each by a BROAD office
role-family + seniority, drops non-office/manual roles, and stratifies a
reproducible ~100-JD sample across families (forcing breadth even when the raw set
skews tech). Each JD becomes a devcase ``Scenario``: a ``DevNeed`` carrying the JD
body as ``jd_text`` and NO codebase snapshot — office roles have none, and
``analyze_need`` already handles the "ungrounded" case. The scenarios plug straight
into ``lifecycle_eval.run`` / ``calibrate.py``.

    python -m pipeline.jobfit.devcase.real_corpus --count 100
    python -m pipeline.jobfit.devcase.real_corpus --count 100 --no-resume

Output: data/seed_calibration/jobs.json (the frozen corpus Part 2 also consumes).
"""

from __future__ import annotations

import argparse
import json
import sys
import urllib.parse
import urllib.request
from collections import Counter
from pathlib import Path
from typing import Any

from .._cli import configure_stdio
from .models import DevNeed
from .scenarios import Scenario

ROOT = Path(__file__).resolve().parents[3]
OUT_DIR = ROOT / "data" / "seed_calibration"
JOBS_PATH = OUT_DIR / "jobs.json"
RAW_CACHE = OUT_DIR / "_raw_rows.json"

# Free, auth-less source: the HF datasets-server serves rows of any public dataset
# over HTTPS. Verified shape: row = {position_title, company_name, job_description,
# description_length, model_response}. Broad role types (sales, ops, eng, …).
HF_DATASET = "jacob-hugging-face/job-descriptions"
HF_CONFIG = "default"
HF_SPLIT = "train"
_HF_URL = "https://datasets-server.huggingface.co/rows"
_PAGE = 100  # the datasets-server caps length at 100 rows/request

# --- taxonomy: a BROAD office role-family superset --------------------------
# Keyword -> family. Title is the primary signal (clearest); description is a
# tiebreak. Scored by hit-count so a multi-word title lands in its strongest
# family. This is deliberately wider than scenarios.DOMAINS (which has only
# it/marketing/finance/sales/design) — HR, legal, ops, procurement, customer
# success and admin are exactly the families the synthetic harness never tests.
OFFICE_FAMILIES: dict[str, list[str]] = {
    "software_engineering": ["software engineer", "developer", "programmer", "backend", "front end", "frontend", "full stack", "fullstack", "devops", "site reliability", "sre", "qa engineer", "sdet", "test engineer", "ios", "android", "mobile engineer", "software architect", "web developer"],
    "data_ai": ["data scientist", "data engineer", "data analyst", "machine learning", "ml engineer", "ai engineer", "analytics engineer", "bi developer", "business intelligence", "statistician", "data science"],
    "product": ["product manager", "product owner", "product analyst", "head of product", "product lead"],
    "project_management": ["project manager", "scrum master", "agile coach", "delivery manager", "program manager", "pmo", "project coordinator"],
    "marketing": ["marketing", "seo", "content strategist", "content marketer", "brand", "growth", "social media", "communications", "public relations", "copywriter", "demand generation", "campaign"],
    "sales": ["sales", "account executive", "account manager", "business development", "sales development", "sdr", "bdr", "sales representative", "key account"],
    "finance": ["financial analyst", "fp&a", "finance", "accountant", "accounting", "controller", "bookkeeper", "auditor", "treasury", "payroll", "tax analyst"],
    "hr": ["human resources", "recruiter", "talent acquisition", "people operations", "people partner", "hr business partner", "learning and development", "compensation", "hr manager", "hr generalist"],
    "legal": ["legal counsel", "attorney", "lawyer", "paralegal", "compliance", "contracts manager", "legal analyst", "general counsel"],
    "operations": ["operations manager", "business operations", "supply chain", "logistics coordinator", "procurement", "buyer", "vendor manager", "office operations", "operations analyst"],
    "customer_success": ["customer success", "customer support", "client services", "customer experience", "support specialist", "account coordinator", "client success", "customer service"],
    "design": ["ux designer", "ui designer", "product designer", "graphic designer", "creative director", "ux researcher", "design lead", "visual designer"],
    "administration": ["administrative assistant", "executive assistant", "office manager", "receptionist", "secretary", "data entry", "office administrator", "administrative coordinator"],
    "consulting": ["consultant", "business analyst", "strategy analyst", "management consultant", "advisory"],
}

# Low-collision tokens for clearly non-office / manual / clinical / field roles —
# this corpus is OFFICE-based ("desk/knowledge work") by the user's scope.
NON_OFFICE: tuple[str, ...] = (
    "warehouse", "forklift", "driver", "cashier", "barista", "waiter", "waitress",
    "janitor", "housekeeping", "custodian", "plumber", "electrician", "welder",
    "carpenter", "mechanic", "machinist", "assembler", "nurse", "nursing",
    "caregiver", "phlebotomist", "construction", "laborer", "labourer", "picker",
    "packer", "line cook", "chef", "dishwasher", "landscaper", "technician",
)

# Title keywords -> seniority. First strong hit wins; default "medior".
_SENIORITY_HINTS: list[tuple[str, str]] = [
    ("intern", "junior"), ("graduate", "junior"), ("junior", "junior"), ("entry", "junior"), ("trainee", "junior"), ("associate", "junior"),
    ("principal", "lead"), ("staff", "lead"), ("head of", "lead"), ("director", "lead"), ("vp ", "lead"), ("vice president", "lead"), ("chief", "lead"), ("lead", "lead"),
    ("senior", "senior"), ("sr.", "senior"), ("sr ", "senior"), ("manager", "senior"),
]


def classify_family(title: str, description: str = "") -> str | None:
    """Best office family for a posting, or None if it isn't office knowledge-work.

    Scores each family by keyword hits (title weighted 3x, description 1x) and
    returns the strongest. Returns None when the title clearly names a manual/
    clinical/field role and no office family scores, so those drop out of the
    OFFICE corpus."""
    t = (title or "").lower()
    d = (description or "").lower()[:1500]
    scores: dict[str, int] = {}
    for fam, kws in OFFICE_FAMILIES.items():
        hits = sum(3 for kw in kws if kw in t) + sum(1 for kw in kws if kw in d)
        if hits:
            scores[fam] = hits
    if scores:
        # max score; ties broken by family order in OFFICE_FAMILIES (stable, deterministic)
        best = max(scores, key=lambda f: (scores[f], -list(OFFICE_FAMILIES).index(f)))
        return best
    # No office family matched — keep only if it doesn't read as a manual/field role.
    if any(tok in t for tok in NON_OFFICE):
        return None
    return None


def is_office(title: str) -> bool:
    """Cheap pre-filter: drop clearly non-office titles before classification."""
    return not any(tok in (title or "").lower() for tok in NON_OFFICE)


def classify_seniority(title: str) -> str:
    t = (title or "").lower()
    for kw, sen in _SENIORITY_HINTS:
        if kw in t:
            return sen
    return "medior"


# --- fetch (network) --------------------------------------------------------


def _fetch_page(offset: int, length: int) -> dict[str, Any]:
    qs = urllib.parse.urlencode(
        {"dataset": HF_DATASET, "config": HF_CONFIG, "split": HF_SPLIT, "offset": offset, "length": length}
    )
    req = urllib.request.Request(f"{_HF_URL}?{qs}", headers={"User-Agent": "kp-calibration/1.0"})
    with urllib.request.urlopen(req, timeout=60) as resp:  # noqa: S310 — fixed, trusted HTTPS host
        return json.loads(resp.read().decode("utf-8"))


def fetch_rows(*, limit: int | None = None, resume: bool = True) -> list[dict[str, Any]]:
    """All (or ``limit``) raw rows from the dataset, cached to RAW_CACHE.

    With ``resume`` (default) a present cache is reused — the corpus source is a
    one-time pull, so we don't re-hit the network on every regeneration."""
    if resume and RAW_CACHE.exists():
        cached = json.loads(RAW_CACHE.read_text(encoding="utf-8"))
        if cached:
            return cached if limit is None else cached[:limit]

    first = _fetch_page(0, _PAGE)
    total = int(first.get("num_rows_total") or 0)
    rows: list[dict[str, Any]] = [r.get("row", {}) for r in first.get("rows", [])]
    target = total if limit is None else min(limit, total)
    offset = _PAGE
    while len(rows) < target and offset < total:
        page = _fetch_page(offset, _PAGE)
        batch = [r.get("row", {}) for r in page.get("rows", [])]
        if not batch:
            break
        rows.extend(batch)
        offset += _PAGE

    OUT_DIR.mkdir(parents=True, exist_ok=True)
    RAW_CACHE.write_text(json.dumps(rows, ensure_ascii=False), encoding="utf-8")
    return rows if limit is None else rows[:limit]


# --- classify + stratify (pure) ---------------------------------------------


def _row_fields(row: dict[str, Any]) -> tuple[str, str, str]:
    title = str(row.get("position_title") or row.get("title") or "").strip()
    company = str(row.get("company_name") or row.get("company") or "").strip()
    jd = str(row.get("job_description") or row.get("description") or "").strip()
    return title, company, jd


def classify_rows(rows: list[dict[str, Any]]) -> dict[str, list[dict[str, Any]]]:
    """Group office postings by family. Drops non-office and JD-less rows.

    Within each family, rows are sorted deterministically (title, then jd) so the
    downstream stratified sample is reproducible run-to-run."""
    by_family: dict[str, list[dict[str, Any]]] = {}
    for row in rows:
        title, company, jd = _row_fields(row)
        if not title or not jd or not is_office(title):
            continue
        fam = classify_family(title, jd)
        if fam is None:
            continue
        by_family.setdefault(fam, []).append(
            {"title": title, "company": company, "jd_text": jd, "role_family": fam, "seniority": classify_seniority(title)}
        )
    for fam in by_family:
        by_family[fam].sort(key=lambda r: (r["title"].lower(), r["jd_text"][:80]))
    return by_family


def stratify(by_family: dict[str, list[dict[str, Any]]], n: int) -> list[dict[str, Any]]:
    """Round-robin across families so breadth is forced even on a tech-skewed set.

    Deterministic: families in sorted order, rows already sorted within family.
    Naturally caps any one family and tops up from the rest until ``n`` (or the
    pool) is exhausted."""
    families = sorted(by_family)
    idx = {f: 0 for f in families}
    picked: list[dict[str, Any]] = []
    while len(picked) < n and any(idx[f] < len(by_family[f]) for f in families):
        for f in families:
            if len(picked) >= n:
                break
            if idx[f] < len(by_family[f]):
                picked.append(by_family[f][idx[f]])
                idx[f] += 1
    return picked


def build_jobs(picked: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Stamp stable ids + source provenance onto the stratified sample."""
    return [
        {
            "id": f"cal-{i:03d}",
            "title": r["title"],
            "company": r["company"],
            "jd_text": r["jd_text"],
            "role_family": r["role_family"],
            "seniority": r["seniority"],
            "source": f"hf:{HF_DATASET}",
        }
        for i, r in enumerate(picked)
    ]


# --- Scenario adapter (feeds lifecycle_eval / calibrate) --------------------


def scenarios_from_jobs(jobs: list[dict[str, Any]]) -> list[Scenario]:
    """Each real JD -> a devcase Scenario with NO codebase snapshot.

    ``snapshot=None`` is correct: an office role has no repository, and
    ``analyze_need`` already handles the ungrounded case (analyze.py). ``planted``
    is empty (nothing is injected — these are real defects-in-the-wild), with
    ``real=True`` so a report can tell real-JD rows from synthetic ones."""
    out: list[Scenario] = []
    for j in jobs:
        need = DevNeed(
            id=j["id"],
            title=j["title"],
            stack=[],
            responsibilities=[],
            seniority_target=j["seniority"],
            role_family=j["role_family"],
            jd_text=j["jd_text"],
            notes=f"Real JD from {j.get('company') or 'an undisclosed company'}.",
        )
        out.append(
            Scenario(
                id=j["id"],
                label=f"{j['seniority']} {j['title']} · {j['role_family']} · real",
                need=need,
                snapshot=None,
                planted={"family": j["role_family"], "real": True},
            )
        )
    return out


def load_jobs() -> list[dict[str, Any]]:
    if not JOBS_PATH.exists():
        raise FileNotFoundError(
            f"{JOBS_PATH} not found — build the corpus first: python -m pipeline.jobfit.devcase.real_corpus"
        )
    return json.loads(JOBS_PATH.read_text(encoding="utf-8"))


def build_corpus(count: int, *, resume: bool = True, fetch_limit: int | None = None) -> list[dict[str, Any]]:
    rows = fetch_rows(limit=fetch_limit, resume=resume)
    by_family = classify_rows(rows)
    picked = stratify(by_family, count)
    jobs = build_jobs(picked)
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    JOBS_PATH.write_text(json.dumps(jobs, ensure_ascii=False, indent=2), encoding="utf-8")
    return jobs


def main(argv: list[str] | None = None) -> int:
    configure_stdio(errors="replace")
    p = argparse.ArgumentParser(description="Build a real, broad cross-industry office-JD corpus.")
    p.add_argument("--count", type=int, default=100, help="Target corpus size (stratified across families).")
    p.add_argument("--no-resume", action="store_true", help="Ignore the raw cache and re-fetch from the dataset.")
    p.add_argument("--fetch-limit", type=int, default=None, help="Cap raw rows fetched (debug / quick runs).")
    args = p.parse_args(argv)

    jobs = build_corpus(args.count, resume=not args.no_resume, fetch_limit=args.fetch_limit)

    dist = Counter(j["role_family"] for j in jobs)
    sen = Counter(j["seniority"] for j in jobs)
    print(f"Wrote {len(jobs)} jobs to {JOBS_PATH.relative_to(ROOT).as_posix()}", file=sys.stderr)
    print(f"  families ({len(dist)}): {dict(dist.most_common())}", file=sys.stderr)
    print(f"  seniority: {dict(sen.most_common())}", file=sys.stderr)
    if len(dist) < 6:
        print("  WARNING: <6 families — corpus is narrow; the raw dataset may be skewed.", file=sys.stderr)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
