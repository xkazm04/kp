"""Turn seeded candidates into CVs, run the real analysis pipeline, score the
result against seed-derived expectations, and persist it to the app DB.

This bridges the two halves of the product: the *matching* side owns structured
candidate profiles (``data/seed_candidates``), the *CV-analysis* side owns the
Gemini pipeline (:func:`pipeline.jobfit.service.analyze`). For each pipeline
candidate we

1. render a natural-language CV from the profile (Claude CLI),
2. run the real (Gemini) analysis, conditioned on that candidate's matched ČS
   job so the result carries ``job_fit``,
3. score the four golden axes (role / seniority / salary / skill) vs.
   seed-derived expectations using the canonical :mod:`runner` helpers, and
4. save the analysis to the ``analyses`` table so it shows up in the History tab.

The CV + expectations are also written as a ``fixtures_csas/`` fixture pair, so
the canonical harness can re-score them deterministically later:

    python -m pipeline.jobfit.eval.seed_cv_fixtures --pilot      # 8 spanning candidates
    python -m pipeline.jobfit.eval.seed_cv_fixtures --all        # all 50
    python -m pipeline.jobfit.eval.seed_cv_fixtures --pilot --no-persist   # eval only
    python -m pipeline.jobfit.eval --fixtures-dir pipeline/jobfit/eval/fixtures_csas --strict

Requires GEMINI_API_KEY (analysis) and the Claude CLI on PATH (CV rendering).
"""
from __future__ import annotations

import argparse
import json
import sqlite3
import sys
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from ..claude_cli import ClaudeCliProvider
from ..gemini import load_local_env
from ..service import analyze
from ..taxonomy import role_band
from .runner import (
    FixtureResult,
    Report,
    _format_markdown,
    _range_overlap,
    _safe_int,
    _skill_recall,
)
from .thresholds import PASS_THRESHOLDS

ROOT = Path(__file__).resolve().parents[3]
CANDIDATES = ROOT / "data" / "seed_candidates" / "candidates.json"
PIPELINE = ROOT / "data" / "seed_pipeline" / "pipeline.json"
JOBS_NORM = ROOT / "data" / "seed_jobs" / "jobs.normalized.json"
FIXTURES_OUT = Path(__file__).resolve().parent / "fixtures_csas"
DB_PATH = ROOT / "data" / "kp.sqlite"

LADDER = ["junior", "medior", "senior", "lead", "staff", "principal"]
FAMILIES = ["software_engineering", "data_ai", "product_project"]
ARCHETYPES = ["bau", "student", "career_switcher"]

CSAS_CONTEXT = (
    "Česká spořitelna (Erste Group) — the largest retail bank in the Czech Republic. "
    "Agile tribe/domain organisation; flagship George digital banking platform; an AI First "
    "domain; Payments IT and a central Data tribe. HQ in Praha-Michle. Salaries quoted gross "
    "monthly in CZK."
)

# The analyses table, mirrored from app/_lib/db.ts so a direct write lands a row
# the History tab reads identically (the app re-creates the rest of the schema,
# idempotently, on its next boot).
_ANALYSES_DDL = """
CREATE TABLE IF NOT EXISTS analyses (
  slug TEXT PRIMARY KEY,
  candidate_label TEXT NOT NULL,
  jd_slug TEXT,
  score INTEGER,
  role_family TEXT,
  seniority TEXT,
  payload_json TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_analyses_created_at ON analyses (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_analyses_jd_slug ON analyses (jd_slug);
"""


def _load(path: Path) -> Any:
    return json.loads(path.read_text(encoding="utf-8"))


def _human(text: str | None) -> str:
    return (text or "").replace("_", " ").strip()


def seniority_base(c: dict[str, Any]) -> str:
    """Best ground-truth seniority for a candidate.

    Many seed candidates (students, career switchers) carry no explicit
    ``seniority`` — derive it from the archetype, then from years.
    """
    s = c.get("seniority")
    if isinstance(s, str) and s in LADDER:
        return s
    if c.get("archetype") == "student":
        return "junior"
    years = c.get("yearsExperience")
    if not isinstance(years, (int, float)):
        return "junior"  # career switcher / no professional experience yet
    if years < 3:
        return "junior"
    if years < 6:
        return "medior"
    if years < 10:
        return "senior"
    return "lead"


def expected_seniority_set(c: dict[str, Any]) -> list[str]:
    """Tolerant ±1-notch set — a one-rung read (senior↔lead) is not a quality miss."""
    base = seniority_base(c)
    i = LADDER.index(base)
    lo, hi = max(0, i - 1), min(len(LADDER) - 1, i + 1)
    return LADDER[lo : hi + 1]


def _band_span(family: str | None, sen_set: list[str]) -> tuple[int, int]:
    """Salary band spanning every seniority we'd accept — so the salary axis
    isn't pinned tighter than the (tolerant) seniority axis it depends on."""
    bands = [b for b in (role_band(family, s) for s in sen_set) if b]
    if not bands:
        return (40000, 250000)
    return (min(b[0] for b in bands), max(b[1] for b in bands))


def expectations(c: dict[str, Any]) -> dict[str, Any]:
    family = c.get("roleFamily")
    skills = [sc["skill"] for sc in c.get("skillClaims", []) if sc.get("skill")]
    # Career switchers carry prior-career years, so their seniority is genuinely
    # ambiguous (junior in the new field, or credited for transferable years).
    if c.get("archetype") == "career_switcher":
        sen_set = ["junior", "medior", "senior"]
    else:
        sen_set = expected_seniority_set(c)
    # The salary band must span the SAME seniorities the seniority axis tolerates,
    # otherwise a defensible one-rung-up read (senior→lead) fails salary by design.
    band = _band_span(family, sen_set)
    exp: dict[str, Any] = {
        "label": f"{c.get('displayName')} — {_human(family)} / {seniority_base(c)} ({c.get('archetype')})",
        "expected_role_family": family,
        "expected_seniority": sen_set,
        "expected_salary_range": [band[0], band[1]],
        "expected_skills_subset": skills[:5],
    }
    edu = c.get("educationLevel")
    if isinstance(edu, str) and edu:
        exp["expected_education"] = edu
    return exp


def select_pilot(cands: list[dict[str, Any]], n: int) -> list[dict[str, Any]]:
    """Deterministic spanning sample: cover family × archetype combos first."""
    by_id = sorted(cands, key=lambda c: c["id"])
    picked: list[dict[str, Any]] = []
    used: set[str] = set()
    for family in FAMILIES:
        for arch in ARCHETYPES:
            if len(picked) >= n:
                break
            for c in by_id:
                if c["id"] in used:
                    continue
                if c.get("roleFamily") == family and c.get("archetype") == arch:
                    picked.append(c)
                    used.add(c["id"])
                    break
    for c in by_id:  # top up if some combos were empty
        if len(picked) >= n:
            break
        if c["id"] not in used:
            picked.append(c)
            used.add(c["id"])
    return picked[:n]


def _cv_prompt(c: dict[str, Any], job_title: str | None) -> str:
    skills = "; ".join(
        f"{sc.get('skill')} ({sc.get('level', 'working')})" for sc in c.get("skillClaims", []) if sc.get("skill")
    )
    ev_lines = []
    for e in c.get("evidence", []):
        sk = ", ".join(e.get("skills", []))
        ev_lines.append(f"- [{e.get('kind')}] {e.get('title')}: {e.get('text')}" + (f"  (skills: {sk})" if sk else ""))
    evidence = "\n".join(ev_lines) or "(no prior roles — early career / portfolio projects)"
    aspirations = "; ".join(c.get("aspirations", []))
    target = f"Targeting roles like: {job_title}." if job_title else ""
    return f"""Write a realistic CV as PLAIN TEXT (no markdown, no code fences) for a real Czech candidate.
Use natural CV structure and phrasing. Czech or English is fine; keep technology names in English.
Do NOT invent employers, dates, degrees, or skills beyond the FACTS — you may phrase them naturally,
add conventional section headings, and turn each experience item into a short role entry with 1-3 bullets.

FACTS
Name: {c.get('displayName')}
Location: {c.get('location')}
Field: {_human(c.get('roleFamily'))}
Profile: {c.get('archetype')}, ~{c.get('yearsExperience') or 'entry-level'} years of experience
Aspiration: {aspirations}
Education: {c.get('educationDetail') or c.get('educationLevel')}
Languages: {', '.join(c.get('languages', []))}
Skills (self-rated): {skills}
Experience / evidence:
{evidence}
{target}

Produce: a header line (name + a one-line professional title), a 2-3 sentence summary,
an Experience section, a Skills section, Education, and Languages. ~250-400 words.
Output ONLY the CV text."""


def _score(name: str, expected: dict[str, Any], payload: dict[str, Any], duration_s: float) -> FixtureResult:
    candidate = payload.get("candidate", {}) or {}
    salary = payload.get("salary", {}) or {}
    actual_role = candidate.get("roleFamily")
    actual_sen = candidate.get("currentSeniority")
    actual_skills = candidate.get("skills", []) or []
    actual_edu = candidate.get("educationLevel")
    a_min, a_max = _safe_int(salary.get("minimum")), _safe_int(salary.get("maximum"))

    role_set = expected["expected_role_family"]
    role_set = [role_set] if isinstance(role_set, str) else role_set
    sen_set = expected["expected_seniority"]
    sen_set = [sen_set] if isinstance(sen_set, str) else sen_set
    rng = expected.get("expected_salary_range") or [0, 0]
    overlap = _range_overlap((a_min, a_max), (_safe_int(rng[0]), _safe_int(rng[1])))

    edu_match: bool | None
    if expected.get("expected_education"):
        edu_match = actual_edu == expected["expected_education"]
    else:
        edu_match = None

    return FixtureResult(
        name=name,
        label=str(expected.get("label", name)),
        duration_s=duration_s,
        role_family_match=actual_role in role_set,
        seniority_match=actual_sen in sen_set,
        salary_overlap=overlap,
        skill_recall=_skill_recall(actual_skills, expected.get("expected_skills_subset", [])),
        education_match=edu_match,
        signals_recall=None,
        actual={
            "roleFamily": actual_role,
            "seniority": actual_sen,
            "salary": [a_min, a_max],
            "skills": actual_skills,
            "education": actual_edu,
        },
        expected=expected,
    )


def _persist(conn: sqlite3.Connection, *, slug: str, label: str, jd_slug: str | None, payload: dict[str, Any]) -> None:
    candidate = payload.get("candidate", {}) or {}
    score = payload.get("score", {}) or {}
    created_at = datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")
    conn.execute(
        """INSERT OR REPLACE INTO analyses
             (slug, candidate_label, jd_slug, score, role_family, seniority, payload_json, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)""",
        (
            slug,
            label,
            jd_slug,
            score.get("total"),
            candidate.get("roleFamily"),
            candidate.get("currentSeniority"),
            json.dumps(payload, ensure_ascii=False),
            created_at,
        ),
    )


def run(count: int, *, persist: bool, refresh: bool, skip_existing: bool = False, retries: int = 1) -> int:
    load_local_env()
    import os

    if not (os.getenv("GEMINI_API_KEY") or os.getenv("GOOGLE_API_KEY")):
        sys.stderr.write("seed_cv_fixtures: GEMINI_API_KEY not set — cannot analyze.\n")
        return 1

    provider = ClaudeCliProvider(timeout=180)
    if not provider.available():
        sys.stderr.write("seed_cv_fixtures: Claude CLI not on PATH — cannot render CVs.\n")
        return 1

    cands = _load(CANDIDATES)
    pipe_by_cand = {e["candidateId"]: e for e in _load(PIPELINE)}
    jobs_by_id = {j.get("id"): j for j in _load(JOBS_NORM)}

    pilot = select_pilot(cands, count)
    FIXTURES_OUT.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(DB_PATH) if persist else None
    if conn is not None:
        conn.executescript(_ANALYSES_DDL)

    print(
        f"Seeding {len(pilot)} candidate CV analyses "
        f"(persist={'on' if persist else 'off'}) → {FIXTURES_OUT.name}/\n",
        file=sys.stderr,
    )

    report = Report()
    saved = 0
    for c in pilot:
        cid = c["id"]
        if skip_existing and conn is not None and conn.execute(
            "SELECT 1 FROM analyses WHERE slug = ?", (f"cv-{cid}",)
        ).fetchone():
            continue  # resume: an earlier run already persisted this one
        entry = pipe_by_cand.get(cid, {})
        job = jobs_by_id.get(entry.get("jobId"), {})
        job_title = entry.get("jobTitle") or job.get("title")
        job_desc = job.get("description")

        cv_path = FIXTURES_OUT / f"{cid}.txt"
        json_path = FIXTURES_OUT / f"{cid}.json"
        exp = expectations(c)
        json_path.write_text(json.dumps(exp, ensure_ascii=False, indent=2), encoding="utf-8")

        if cv_path.exists() and not refresh:
            cv = cv_path.read_text(encoding="utf-8")
            note = "reused CV"
        else:
            try:
                cv = provider.complete(_cv_prompt(c, job_title), system="You are a professional CV writer.").text.strip()
            except Exception as exc:  # noqa: BLE001 — one bad render shouldn't abort the batch
                sys.stderr.write(f"  {cid}: CV render failed — {exc}\n")
                continue
            cv_path.write_text(cv, encoding="utf-8")
            note = "rendered CV"

        started = time.monotonic()
        payload = None
        last_err: Exception | None = None
        for attempt in range(retries + 1):  # Gemini can transiently return empty/non-JSON; retry before giving up
            try:
                payload = analyze(cv_path, job_description_text=job_desc, company_text=CSAS_CONTEXT)
                break
            except Exception as exc:  # noqa: BLE001 — keep the batch going
                last_err = exc
        if payload is None:
            sys.stderr.write(f"  {cid}: analysis failed after {retries + 1} attempt(s) — {last_err}\n")
            report.fixtures.append(
                FixtureResult(cid, exp["label"], time.monotonic() - started, False, False, 0.0, 0.0, None, None, {}, exp, str(last_err))
            )
            continue

        result = _score(cid, exp, payload, time.monotonic() - started)
        report.fixtures.append(result)

        if conn is not None:
            label = f"{c.get('displayName')}" + (f" → {job_title}" if job_title else "")
            _persist(conn, slug=f"cv-{cid}", label=label, jd_slug=None, payload=payload)
            conn.commit()
            saved += 1

        print(
            f"  {cid} {c.get('displayName'):22.22} {note:11} → "
            f"role={'OK' if result.role_family_match else 'XX'} "
            f"sen={'OK' if result.seniority_match else 'XX'} "
            f"sal={result.salary_overlap:.0%} skill={result.skill_recall:.0%} "
            f"score={payload.get('score', {}).get('total')}",
            file=sys.stderr,
        )

    if conn is not None:
        conn.execute("PRAGMA wal_checkpoint(TRUNCATE)")
        conn.close()

    print("\n" + _format_markdown(report, color=False))
    agg = report.aggregate()
    print("\n## Pilot summary\n")
    print(f"- candidates analyzed: **{len(report.fixtures)}**")
    print(f"- analyses persisted to DB: **{saved}**" if persist else "- persistence: **off**")
    print(f"- passes golden thresholds: **{report.passes()}** ({PASS_THRESHOLDS})")
    (FIXTURES_OUT / "_pilot_report.json").write_text(
        json.dumps({"aggregate": agg, "passes": report.passes(), "persisted": saved}, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )
    return 0


def main(argv: list[str] | None = None) -> int:
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")
        sys.stderr.reconfigure(encoding="utf-8", errors="replace")
    p = argparse.ArgumentParser(description="Render seeded candidate CVs, analyze, score, and persist.")
    g = p.add_mutually_exclusive_group()
    g.add_argument("--pilot", action="store_true", help="8 spanning candidates (default).")
    g.add_argument("--all", action="store_true", help="All candidates in the corpus.")
    p.add_argument("--count", type=int, default=None, help="Explicit candidate count.")
    p.add_argument("--no-persist", action="store_true", help="Score only; do not write to the DB.")
    p.add_argument("--refresh", action="store_true", help="Re-render CVs even if a fixture .txt already exists.")
    p.add_argument("--skip-existing", action="store_true", help="Resume: skip candidates already persisted to the DB.")
    p.add_argument("--retries", type=int, default=1, help="Re-attempts on a transient Gemini failure (default: 1).")
    args = p.parse_args(argv)

    if args.count is not None:
        count = args.count
    elif args.all:
        count = len(_load(CANDIDATES))
    else:
        count = 8
    return run(count, persist=not args.no_persist, refresh=args.refresh, skip_existing=args.skip_existing, retries=args.retries)


if __name__ == "__main__":
    raise SystemExit(main())
