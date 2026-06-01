"""Generate a balanced synthetic Czech-market job corpus via the Claude CLI.

Builds a deterministic spec grid (role family x seniority x work mode x location x
company type, weighted toward a demo-friendly distribution), asks the headless
Claude CLI to flesh each spec into a realistic structured ad, stamps the
controlled dimensions back onto the result so the distribution is guaranteed,
and freezes the raw records as a committed JSON seed.

The freeze is the "deterministic at rest" corpus: regeneration needs the
subscription, but the matching pipeline always loads the same committed file and
runs the deterministic :func:`normalize_job` over it.

    python -m pipeline.jobfit.seed_jobs --count 150 --workers 6
    python -m pipeline.jobfit.seed_jobs --limit 3            # quick validation batch
"""

from __future__ import annotations

import argparse
import json
import random
import sys
import time
from collections import Counter
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path
from typing import Any

from ._summary import format_distribution
from .claude_cli import ClaudeCliError, ClaudeCliProvider
from .jobs import SENIORITIES, WORK_MODES, normalize_job

ROOT = Path(__file__).resolve().parents[2]
DEFAULT_OUT = ROOT / "data" / "seed_jobs" / "jobs.json"

FAMILIES = ("software_engineering", "data_ai", "product_project")
LOCATIONS = ("Praha", "Brno", "Ostrava", "Plzeň", "Hradec Králové", "Olomouc", "Liberec")
COMPANY_TYPES = ("enterprise/corporate", "scaleup", "startup", "agency/consultancy", "public sector")

_SYSTEM = (
    "You are a Czech-market tech recruiter writing realistic 2026 job ads. "
    "You know real technologies, Czech cities, and how junior vs senior postings differ."
)


def build_specs(count: int, *, seed: int = 42) -> list[dict[str, Any]]:
    """Deterministic, weighted spec grid for a balanced (demo-friendly) corpus."""
    rng = random.Random(seed)
    specs: list[dict[str, Any]] = []
    for i in range(count):
        family = rng.choices(FAMILIES, weights=[55, 25, 20])[0]
        seniority = rng.choices(SENIORITIES, weights=[35, 30, 25, 10])[0]
        work_mode = rng.choices(WORK_MODES, weights=[25, 45, 30])[0]
        location = "Remote (CZ)" if work_mode == "remote" else rng.choice(LOCATIONS)
        company_type = rng.choice(COMPANY_TYPES)
        roll = rng.random()
        languages = ["Czech", "English"] if roll < 0.6 else (["English"] if roll < 0.85 else ["Czech", "English", "German"])
        entry_friendly = seniority == "junior" or (seniority == "medior" and rng.random() < 0.3)
        specs.append(
            {
                "id": f"job-{i:03d}",
                "family": family,
                "seniority": seniority,
                "work_mode": work_mode,
                "location": location,
                "company_type": company_type,
                "languages": languages,
                "entry_friendly": entry_friendly,
            }
        )
    return specs


def spec_to_prompt(spec: dict[str, Any]) -> str:
    entry_line = (
        "This is an EARLY-CAREER role: use welcoming language for graduates/students, "
        "offer mentoring/training, set min_years_experience to 0 or 1, and mark MOST "
        "must-have skills hardness=\"learnable\"."
        if spec["entry_friendly"]
        else "This is an experienced role: set a realistic min_years_experience for the "
        "seniority and mark core skills hardness=\"prerequisite\"."
    )
    return f"""Write ONE realistic Czech-market tech job ad as a JSON object with exactly these keys:
{{
  "title": str, "company": str, "location": str,
  "work_mode": "{spec['work_mode']}",
  "employment_type": str,
  "seniority": "{spec['seniority']}",
  "role_family": "{spec['family']}",
  "languages": {json.dumps(spec['languages'])},
  "min_years_experience": number,
  "min_education": "phd|master|bachelor|university|none",
  "description": str,
  "requirements": [ {{ "skill": str, "kind": "must_have|nice_to_have", "hardness": "prerequisite|learnable" }} ]
}}

Constraints:
- Role family: {spec['family']}; seniority: {spec['seniority']}; company type: {spec['company_type']}; location: {spec['location']}.
- 4-8 requirements using REAL technologies appropriate to the family and seniority.
- description: 2-4 sentences on the team/project and a normal day. Czech or English is fine.
- {entry_line}
- For each requirement decide kind (must vs nice) and hardness (prerequisite = cannot do the job without it; learnable = can be picked up on the job).

Output JSON only, no markdown fences, no commentary."""


# Dimensions we control for distribution; the LLM owns the creative rest.
_STAMPED = ("role_family", "seniority", "work_mode", "location", "languages")


def _stamp(record: dict[str, Any], spec: dict[str, Any]) -> dict[str, Any]:
    record = dict(record)
    record["id"] = spec["id"]
    record["role_family"] = spec["family"]
    record["seniority"] = spec["seniority"]
    record["work_mode"] = spec["work_mode"]
    record["location"] = spec["location"]
    record["languages"] = spec["languages"]
    record["source"] = "synthetic"
    return record


def _gen_one(
    provider: ClaudeCliProvider,
    spec: dict[str, Any],
    *,
    retries: int,
    backoff: float,
    prompt_fn=spec_to_prompt,
) -> tuple[dict[str, Any] | None, str | None]:
    """Generate one stamped record, retrying transient CLI/rate-limit errors."""
    prompt = prompt_fn(spec)
    last = "unknown"
    for attempt in range(retries + 1):
        try:
            parsed = provider.complete(prompt, system=_SYSTEM).json()
            if isinstance(parsed, dict):
                return _stamp(parsed, spec), None
            last = "not-a-dict"
        except ClaudeCliError as exc:
            last = f"cli:{exc.subtype or 'error'}"
        except ValueError:
            last = "unparseable-json"
        if attempt < retries:
            time.sleep(backoff * (attempt + 1))  # linear backoff for rate limits
    return None, last


def generate(
    count: int,
    *,
    workers: int = 4,
    seed: int = 42,
    model: str | None = None,
    limit: int | None = None,
    provider: ClaudeCliProvider | None = None,
    retries: int = 2,
    backoff: float = 3.0,
    existing: dict[str, dict[str, Any]] | None = None,
    specs: list[dict[str, Any]] | None = None,
    prompt_fn=None,
) -> tuple[list[dict[str, Any]], dict[str, int]]:
    """Generate raw job records, resumable + retrying. Returns (records, failure_counts).

    ``existing`` maps already-generated ``id`` -> record; those specs are skipped
    and merged into the output, so a rate-limited run can be re-run to top up.
    Pass ``specs`` + ``prompt_fn`` to drive a different company profile (e.g. seed_jobs_csas).
    """
    provider = provider or ClaudeCliProvider(model=model, timeout=180)
    if not provider.available():
        raise SystemExit("Claude CLI not available on PATH — cannot generate the corpus.")

    prompt_fn = prompt_fn or spec_to_prompt
    specs = specs if specs is not None else build_specs(count, seed=seed)
    if limit:
        specs = specs[:limit]

    records: dict[str, dict[str, Any]] = dict(existing or {})
    todo = [s for s in specs if s["id"] not in records]
    print(
        f"Generating via Claude CLI: specs={len(specs)} existing={len(records)} "
        f"todo={len(todo)} (workers={workers}, retries={retries})…",
        file=sys.stderr,
    )

    failures: Counter[str] = Counter()
    if todo:
        with ThreadPoolExecutor(max_workers=max(1, min(workers, len(todo)))) as pool:
            futures = {
                pool.submit(_gen_one, provider, spec, retries=retries, backoff=backoff, prompt_fn=prompt_fn): spec
                for spec in todo
            }
            done = 0
            for future in as_completed(futures):
                record, err = future.result()
                done += 1
                if record:
                    records[record["id"]] = record
                else:
                    failures[err or "unknown"] += 1
                if done % 20 == 0:
                    print(f"  …{done}/{len(todo)} attempted, {len(records)} total", file=sys.stderr)

    ordered = [records[key] for key in sorted(records)]
    return ordered, dict(failures)


def summarize(records: list[dict[str, Any]]) -> str:
    fam = Counter(r.get("role_family") for r in records)
    sen = Counter(r.get("seniority") for r in records)
    mode = Counter(r.get("work_mode") for r in records)
    entry = 0
    for r in records:
        job = normalize_job(r)
        if job.entry_profile and job.entry_profile.is_entry_eligible:
            entry += 1
    lines = [
        f"total: {len(records)}",
        f"entry-eligible: {entry} ({(entry / max(len(records), 1)) * 100:.0f}%)",
        format_distribution("role_family", fam),
        format_distribution("seniority", sen),
        format_distribution("work_mode", mode),
    ]
    return "\n".join(lines)


def write_normalized(records: list[dict[str, Any]], raw_out: Path) -> Path:
    """Run deterministic normalization and write the sibling the store seeds from.

    The DB stores fully-normalized jobs (resolved taxonomy terms, salary anchor
    band, entry profile) so TypeScript never re-implements Python's logic.
    """
    normalized = [normalize_job(rec).model_dump(by_alias=True, exclude_none=True) for rec in records]
    norm_path = raw_out.with_name(f"{raw_out.stem}.normalized.json")
    norm_path.write_text(json.dumps(normalized, ensure_ascii=False, indent=2), encoding="utf-8")
    return norm_path


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Generate the synthetic job corpus.")
    parser.add_argument("--count", type=int, default=150)
    parser.add_argument("--workers", type=int, default=4)
    parser.add_argument("--seed", type=int, default=42)
    parser.add_argument("--model", default=None)
    parser.add_argument("--retries", type=int, default=2)
    parser.add_argument("--limit", type=int, default=None, help="Generate only the first N specs (validation).")
    parser.add_argument("--out", type=Path, default=DEFAULT_OUT)
    parser.add_argument("--no-resume", action="store_true", help="Ignore any existing output and regenerate all.")
    parser.add_argument("--dry-run", action="store_true", help="Print prompts/specs without calling the CLI.")
    parser.add_argument(
        "--materialize",
        action="store_true",
        help="Skip generation: read the existing raw --out and (re)write the normalized sibling.",
    )
    args = parser.parse_args(argv)

    if args.dry_run:
        for spec in build_specs(args.count, seed=args.seed)[: (args.limit or 3)]:
            print(json.dumps(spec, ensure_ascii=False))
        return 0

    if args.materialize:
        if not args.out.exists():
            print(f"No raw corpus at {args.out}", file=sys.stderr)
            return 1
        records = json.loads(args.out.read_text(encoding="utf-8"))
        norm_path = write_normalized(records, args.out)
        print(f"Materialized {len(records)} jobs -> {norm_path.name}", file=sys.stderr)
        print(summarize(records), file=sys.stderr)
        return 0

    existing: dict[str, dict[str, Any]] = {}
    if args.out.exists() and not args.no_resume:
        try:
            for rec in json.loads(args.out.read_text(encoding="utf-8")):
                if isinstance(rec, dict) and rec.get("id"):
                    existing[rec["id"]] = rec
        except (json.JSONDecodeError, OSError):
            pass

    records, failures = generate(
        args.count,
        workers=args.workers,
        seed=args.seed,
        model=args.model,
        limit=args.limit,
        retries=args.retries,
        existing=existing,
    )
    if not records:
        print("No records generated.", file=sys.stderr)
        return 1

    args.out.parent.mkdir(parents=True, exist_ok=True)
    args.out.write_text(json.dumps(records, ensure_ascii=False, indent=2), encoding="utf-8")
    try:
        shown = args.out.relative_to(ROOT)
    except ValueError:
        shown = args.out
    norm_path = write_normalized(records, args.out)
    print(
        f"\nWrote {len(records)} records to {shown} (+ {norm_path.name}; failures: {dict(failures)})",
        file=sys.stderr,
    )
    print(summarize(records), file=sys.stderr)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
