"""Generate a synthetic candidate population via the Claude CLI (Phase 11).

Mirrors seed_jobs.py: a deterministic, weighted spec grid (archetype x role family
x level) is fleshed out by the headless Claude CLI into realistic CandidateProfileV2
records, normalized (provenance + completeness), and frozen as a committed seed.
The DB seeds these into the `profiles` table so every module (Profile, Match,
Pipeline) shows an enterprise-like load instead of one personal CV.

    python -m pipeline.jobfit.seed_candidates --count 50 --workers 4
    python -m pipeline.jobfit.seed_candidates --limit 3   # quick validation
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
from .profile import CandidateProfileV2, normalize_profile

ROOT = Path(__file__).resolve().parents[2]
DEFAULT_OUT = ROOT / "data" / "seed_candidates" / "candidates.json"

FAMILIES = ("software_engineering", "data_ai", "product_project")
ARCHETYPES = ("bau", "student", "career_switcher")

# Independent LLM calls keep defaulting to the same few common Czech names, so we
# STAMP a guaranteed-unique name onto every candidate (like seed_jobs stamps the
# controlled dimensions). Gendered first names pair with gendered surnames.
_FEMALE_FIRST = (
    "Tereza", "Markéta", "Kristýna", "Lucie", "Klára", "Adéla", "Veronika", "Eliška",
    "Barbora", "Kateřina", "Anna", "Jana", "Petra", "Hana", "Zuzana", "Nikola",
    "Michaela", "Aneta", "Karolína", "Denisa", "Simona", "Gabriela", "Monika", "Lenka",
)
_MALE_FIRST = (
    "Tomáš", "Vojtěch", "Ondřej", "Jakub", "Jan", "Petr", "Martin", "Lukáš",
    "David", "Filip", "Marek", "Pavel", "Jiří", "Michal", "Adam", "Štěpán",
    "Daniel", "Matěj", "Roman", "Tadeáš", "Vít", "Radek", "Dominik", "Patrik",
)
# Masculine base form; the feminine form is derived below.
_SURNAMES = (
    "Novák", "Svoboda", "Novotný", "Dvořák", "Černý", "Procházka", "Kučera", "Veselý",
    "Horák", "Němec", "Pokorný", "Pospíšil", "Hájek", "Jelínek", "Král", "Růžička",
    "Beneš", "Fiala", "Sedláček", "Zeman", "Kolář", "Navrátil", "Čermák", "Vaněk",
    "Urban", "Blažek", "Kříž", "Kovář", "Bartoš", "Vlček", "Polák", "Konečný",
    "Mareš", "Šimek", "Tichý", "Bureš", "Sýkora", "Malý", "Holub", "Beránek",
)


def _feminize(surname: str) -> str:
    """Masculine Czech surname -> feminine form (Novák->Nováková, Černý->Černá, Svoboda->Svobodová)."""
    if surname.endswith(("ý", "í")):
        return surname[:-1] + "á"
    if surname.endswith("a"):
        return surname[:-1] + "ová"
    return surname + "ová"


def unique_czech_names(n: int, *, seed: int = 7) -> list[str]:
    """``n`` deterministic, gender-consistent, UNIQUE Czech full names."""
    rng = random.Random(seed)
    used: set[str] = set()
    out: list[str] = []
    guard = 0
    while len(out) < n and guard < n * 200:
        guard += 1
        if rng.random() < 0.5:
            full = f"{rng.choice(_FEMALE_FIRST)} {_feminize(rng.choice(_SURNAMES))}"
        else:
            full = f"{rng.choice(_MALE_FIRST)} {rng.choice(_SURNAMES)}"
        if full not in used:
            used.add(full)
            out.append(full)
    return out

_SYSTEM = (
    "You invent realistic but fictional Czech tech-job candidates. Use varied Czech names. "
    "Never reuse a real person. Output strict JSON only."
)

_COMMON_KEYS = (
    '"displayName": str, "roleFamily": "{family}", "educationLevel": "phd|master|bachelor|university|unknown",\n'
    '  "educationDetail": str, "languages": [str], "location": str, "aspirations": [str],\n'
    '  "skillClaims": [ {{ "skill": str, "level": "foundational|working|strong", '
    '"provenance": str }} ],\n'
    '  "evidence": [ {{ "kind": str, "title": str, "text": str, "skills": [str], "link": str|null }} ]'
)


def _prompt(spec: dict[str, Any]) -> str:
    family = spec["family"]
    base = "Generate ONE fictional candidate as a JSON object with keys:\n{\n  " + _COMMON_KEYS.format(family=family) + "\n}\n"
    if spec["archetype"] == "student":
        flavor = (
            f"Profile a STUDENT / recent graduate targeting {family}. No real work history "
            "(at most an off-field part-time job). 4-6 skillClaims with provenance in "
            "coursework/self_declared/academic_project. 2-3 evidence items of kind thesis/project/"
            "course/internship/extracurricular with realistic titles, a short text, and skills; "
            "give projects a 'link'. Include educationDetail (programme + Czech university + year) "
            "and aspirations. Omit seniority/yearsExperience."
        )
    elif spec["archetype"] == "career_switcher":
        flavor = (
            f"Profile a CAREER-SWITCHER moving INTO {family} from a different field. Include "
            "\"yearsExperience\": number (their prior-career years) and 1-2 evidence items of kind "
            "\"job\" describing that PRIOR (non-tech) role, plus 3-5 target-domain skillClaims learned "
            "via coursework/projects and 1-2 project/course evidence items with links. aspirations = target role."
        )
    else:
        flavor = (
            f"Profile an EXPERIENCED {family} professional. Include \"yearsExperience\": number and "
            "\"seniority\": \"junior|medior|senior|lead\" (bias to medior/senior), 5-8 skillClaims with "
            "provenance \"professional\", and 1-2 evidence items of kind \"job\" with employer-style titles and skills."
        )
    return f"{base}\n{flavor}\nReturn JSON only — no markdown, no commentary."


def build_specs(count: int, *, seed: int = 7) -> list[dict[str, Any]]:
    rng = random.Random(seed)
    names = unique_czech_names(count, seed=seed)
    specs: list[dict[str, Any]] = []
    for i in range(count):
        archetype = rng.choices(ARCHETYPES, weights=[40, 40, 20])[0]
        family = rng.choices(FAMILIES, weights=[55, 25, 20])[0]
        specs.append({"id": f"cand-{i:03d}", "archetype": archetype, "family": family, "display_name": names[i]})
    return specs


def _gen_one(provider: ClaudeCliProvider, spec: dict[str, Any], *, retries: int, backoff: float):
    last = "unknown"
    for attempt in range(retries + 1):
        try:
            raw = provider.complete(_prompt(spec), system=_SYSTEM).json()
            if isinstance(raw, dict):
                profile = CandidateProfileV2.model_validate(raw)
                profile.archetype = spec["archetype"]  # guarantee the distribution
                profile.role_family = spec["family"]
                score, _missing = normalize_profile(profile)  # stamp + reuse the score
                rec = profile.model_dump(by_alias=True, exclude_none=True)
                rec["id"] = spec["id"]
                rec["displayName"] = spec["display_name"]  # stamp the guaranteed-unique name
                rec["completeness"] = score
                return rec, None
            last = "not-a-dict"
        except ClaudeCliError as exc:
            last = f"cli:{exc.subtype or 'error'}"
        except ValueError:
            last = "unparseable-json"
        except Exception as exc:  # schema/validation
            last = f"invalid:{type(exc).__name__}"
        if attempt < retries:
            time.sleep(backoff * (attempt + 1))
    return None, last


def generate(
    count: int,
    *,
    workers: int = 4,
    seed: int = 7,
    limit: int | None = None,
    retries: int = 2,
    backoff: float = 3.0,
    existing: dict[str, dict[str, Any]] | None = None,
    provider: ClaudeCliProvider | None = None,
) -> tuple[list[dict[str, Any]], dict[str, int]]:
    provider = provider or ClaudeCliProvider(timeout=180)
    if not provider.available():
        raise SystemExit("Claude CLI not available on PATH.")
    specs = build_specs(count, seed=seed)
    if limit:
        specs = specs[:limit]
    records: dict[str, dict[str, Any]] = dict(existing or {})
    todo = [s for s in specs if s["id"] not in records]
    print(f"Candidates: specs={len(specs)} existing={len(records)} todo={len(todo)} (workers={workers})…", file=sys.stderr)

    failures: Counter[str] = Counter()
    if todo:
        with ThreadPoolExecutor(max_workers=max(1, min(workers, len(todo)))) as pool:
            futures = {pool.submit(_gen_one, provider, s, retries=retries, backoff=backoff): s for s in todo}
            done = 0
            for fut in as_completed(futures):
                rec, err = fut.result()
                done += 1
                if rec:
                    records[rec["id"]] = rec
                else:
                    failures[err or "unknown"] += 1
                if done % 15 == 0:
                    print(f"  …{done}/{len(todo)} attempted, {len(records)} total", file=sys.stderr)

    ordered = [records[k] for k in sorted(records)]
    return ordered, dict(failures)


def summarize(records: list[dict[str, Any]]) -> str:
    arche = Counter(r.get("archetype") for r in records)
    fam = Counter(r.get("roleFamily") for r in records)
    avg_complete = sum(r.get("completeness", 0) for r in records) / max(len(records), 1)
    return "\n".join(
        [
            f"total: {len(records)}",
            format_distribution("archetype", arche),
            format_distribution("role_family", fam),
            f"avg completeness: {avg_complete:.2f}",
        ]
    )


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Generate the synthetic candidate population.")
    parser.add_argument("--count", type=int, default=50)
    parser.add_argument("--workers", type=int, default=4)
    parser.add_argument("--seed", type=int, default=7)
    parser.add_argument("--retries", type=int, default=2)
    parser.add_argument("--limit", type=int, default=None)
    parser.add_argument("--out", type=Path, default=DEFAULT_OUT)
    parser.add_argument("--no-resume", action="store_true")
    parser.add_argument(
        "--rename-only",
        action="store_true",
        help="Reassign deterministic UNIQUE names to the existing seed (no LLM) and exit. "
        "Profiles are kept; only displayName changes.",
    )
    args = parser.parse_args(argv)

    if args.rename_only:
        if not args.out.exists():
            print(f"No candidate seed at {args.out}", file=sys.stderr)
            return 1
        records = json.loads(args.out.read_text(encoding="utf-8"))
        records.sort(key=lambda r: r.get("id", ""))
        names = unique_czech_names(len(records), seed=args.seed)
        for rec, name in zip(records, names):
            rec["displayName"] = name
        args.out.write_text(json.dumps(records, ensure_ascii=False, indent=2), encoding="utf-8")
        distinct = len({r["displayName"] for r in records})
        print(f"Renamed {len(records)} candidates to {distinct} unique names.", file=sys.stderr)
        return 0 if distinct == len(records) else 1

    existing: dict[str, dict[str, Any]] = {}
    if args.out.exists() and not args.no_resume:
        try:
            for rec in json.loads(args.out.read_text(encoding="utf-8")):
                if isinstance(rec, dict) and rec.get("id"):
                    existing[rec["id"]] = rec
        except (json.JSONDecodeError, OSError):
            pass

    records, failures = generate(
        args.count, workers=args.workers, seed=args.seed, limit=args.limit, retries=args.retries, existing=existing
    )
    if not records:
        print("No candidates generated.", file=sys.stderr)
        return 1

    args.out.parent.mkdir(parents=True, exist_ok=True)
    args.out.write_text(json.dumps(records, ensure_ascii=False, indent=2), encoding="utf-8")
    try:
        shown = args.out.relative_to(ROOT)
    except ValueError:
        shown = args.out
    print(f"\nWrote {len(records)} candidates to {shown} (failures: {dict(failures)})", file=sys.stderr)
    print(summarize(records), file=sys.stderr)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
