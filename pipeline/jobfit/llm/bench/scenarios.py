"""Benchmark scenarios built from SEEDED data through REAL production paths.

A Scenario is (id, use_case, run, contract): ``run(provider)`` invokes the
actual production function — same prompts, same coercion, same fallbacks — and
returns its ``(payload, source)``. Inputs come from the seed corpus
(data/seed_jobs via matching.load_corpus, data/seed_candidates/candidates.json)
so runs are reproducible across sessions and comparable across providers.

Covered use cases (v1): match_reasoning, automation_screen,
automation_outreach, automation_rejection, campaign_pack.

Extension points (same pattern — add a builder + a contract, register below):
automation_prep, automation_scorecard, automation_offer, jd_ingest,
profile_draft, devcase_analyze / role_design / case_design.
"""

from __future__ import annotations

import json
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Callable

from ...automation import draft_outreach, draft_rejection, screen_candidate
from ...campaign import draft_campaign_pack
from ...match_reasoning import generate
from ...matching import MatchCandidate, load_corpus, score_job
from ...profile import CandidateProfileV2
from ...transform import build_match_candidate
from . import contracts

_ROOT = Path(__file__).resolve().parents[4]
CANDIDATES_SEED = _ROOT / "data" / "seed_candidates" / "candidates.json"

# Benchmark scenario ids → the registry use case they exercise (capabilities /
# default-model lookups key on the registry name).
REGISTRY_USE_CASE = {
    "match_reasoning": "match_reasoning",
    "automation_screen": "automation",
    "automation_outreach": "automation",
    "automation_rejection": "automation",
    "campaign_pack": "campaign_pack",
}


@dataclass(frozen=True)
class Scenario:
    id: str
    use_case: str
    run: Callable[[Any], tuple[dict[str, Any], str]]
    contract: Callable[[Any], list[str]]
    meta: dict[str, Any] = field(default_factory=dict)


def load_seed_candidates(limit: int | None = None) -> list[MatchCandidate]:
    """Seed CandidateProfileV2 rows → MatchCandidate, via the same transform
    production uses for --profile-json input. Malformed rows are skipped —
    benchmark inputs are best-effort, not a seed validator."""
    raw = json.loads(CANDIDATES_SEED.read_text(encoding="utf-8"))
    out: list[MatchCandidate] = []
    for item in raw if isinstance(raw, list) else []:
        try:
            out.append(build_match_candidate(CandidateProfileV2.model_validate(item)))
        except Exception:  # noqa: BLE001 — skip, don't fail the suite
            continue
        if limit is not None and len(out) >= limit:
            break
    return out


def load_seed_jobs(limit: int | None = None) -> list[Any]:
    jobs = load_corpus(None)
    return jobs[:limit] if limit is not None else jobs


def _pairs(limit: int) -> list[tuple[MatchCandidate, Any]]:
    """Deterministic candidate×job pairs: candidates in seed order, jobs
    round-robin — varied pairings without randomness (reproducible ids)."""
    candidates = load_seed_candidates(limit)
    jobs = load_seed_jobs()
    if not candidates or not jobs:
        return []
    return [(candidate, jobs[i % len(jobs)]) for i, candidate in enumerate(candidates)]


def match_reasoning_scenarios(*, limit: int = 8, lang: str = "en") -> list[Scenario]:
    out: list[Scenario] = []
    for i, (candidate, job) in enumerate(_pairs(limit)):
        m = score_job(candidate, job)

        def run(provider: Any, candidate=candidate, job=job, m=m, lang=lang):
            return generate(candidate, job, m, lang=lang, provider=provider)

        out.append(
            Scenario(
                id=f"match_reasoning#{i:02d}:{job.id}",
                use_case="match_reasoning",
                run=run,
                contract=contracts.match_reasoning,
                meta={"jobId": job.id, "candidate": candidate.label, "matchTotal": m.total, "lang": lang},
            )
        )
    return out


def automation_screen_scenarios(*, limit: int = 8, lang: str = "en") -> list[Scenario]:
    del lang  # screening output is recruiter-facing English; kept for a uniform builder signature
    out: list[Scenario] = []
    for i, (candidate, job) in enumerate(_pairs(limit)):
        m = score_job(candidate, job)

        def run(provider: Any, candidate=candidate, job=job, m=m):
            return screen_candidate(candidate, job, m, provider=provider)

        out.append(
            Scenario(
                id=f"automation_screen#{i:02d}:{job.id}",
                use_case="automation_screen",
                run=run,
                contract=contracts.automation_screen,
                meta={"jobId": job.id, "candidate": candidate.label, "matchTotal": m.total},
            )
        )
    return out


def automation_outreach_scenarios(*, limit: int = 8, lang: str = "en") -> list[Scenario]:
    del lang  # outreach language follows the candidate's own languages
    out: list[Scenario] = []
    for i, (candidate, job) in enumerate(_pairs(limit)):
        m = score_job(candidate, job)
        strengths = m.matched_skills[:3]

        def run(provider: Any, candidate=candidate, job=job, strengths=strengths):
            return draft_outreach(candidate, job, strengths, provider=provider)

        out.append(
            Scenario(
                id=f"automation_outreach#{i:02d}:{job.id}",
                use_case="automation_outreach",
                run=run,
                contract=contracts.automation_outreach,
                meta={"jobId": job.id, "candidate": candidate.label},
            )
        )
    return out


def automation_rejection_scenarios(*, limit: int = 8, lang: str = "en") -> list[Scenario]:
    del lang  # rejection language follows the candidate's own languages
    out: list[Scenario] = []
    for i, (candidate, job) in enumerate(_pairs(limit)):
        m = score_job(candidate, job)

        def run(provider: Any, candidate=candidate, job=job, m=m):
            return draft_rejection(candidate, job, m, "Screened", provider=provider)

        out.append(
            Scenario(
                id=f"automation_rejection#{i:02d}:{job.id}",
                use_case="automation_rejection",
                run=run,
                contract=contracts.automation_rejection,
                meta={"jobId": job.id, "candidate": candidate.label},
            )
        )
    return out


def campaign_pack_scenarios(*, limit: int = 8, lang: str = "en") -> list[Scenario]:
    out: list[Scenario] = []
    for i, job in enumerate(load_seed_jobs(limit)):

        def run(provider: Any, job=job, lang=lang):
            return draft_campaign_pack(
                job, lang=lang, apply_url=f"https://example.invalid/apply/{job.id}/quick", provider=provider
            )

        out.append(
            Scenario(
                id=f"campaign_pack#{i:02d}:{job.id}",
                use_case="campaign_pack",
                run=run,
                contract=contracts.campaign_pack,
                meta={"jobId": job.id, "lang": lang},
            )
        )
    return out


SCENARIO_BUILDERS: dict[str, Callable[..., list[Scenario]]] = {
    "match_reasoning": match_reasoning_scenarios,
    "automation_screen": automation_screen_scenarios,
    "automation_outreach": automation_outreach_scenarios,
    "automation_rejection": automation_rejection_scenarios,
    "campaign_pack": campaign_pack_scenarios,
}


def scenarios_for(use_case: str, *, limit: int = 8, lang: str = "en") -> list[Scenario]:
    builder = SCENARIO_BUILDERS.get(use_case)
    if builder is None:
        raise ValueError(f"unknown bench use case {use_case!r} (known: {sorted(SCENARIO_BUILDERS)})")
    return builder(limit=limit, lang=lang)
