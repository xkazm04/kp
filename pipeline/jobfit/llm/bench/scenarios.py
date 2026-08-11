"""Benchmark scenarios built from SEEDED data through REAL production paths.

A Scenario is (id, use_case, run, contract): ``run(provider)`` invokes the
actual production function — same prompts, same coercion, same fallbacks — and
returns its ``(payload, source)``. Inputs come from the seed corpus
(data/seed_jobs via matching.load_corpus, data/seed_candidates/candidates.json)
so runs are reproducible across sessions and comparable across providers.

Covered use cases: match_reasoning, automation_screen/outreach/rejection/offer,
interview_prep, interview_scorecard, weight_proposal, jd_ingest, devcase_analyze /
role_design / case_design / interview_scenario, group_compare, campaign_pack.

Extension points (same pattern — add a builder + a contract, register below):
profile_draft and any remaining registry ops that need their own seed inputs.
"""

from __future__ import annotations

import json
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Callable

from ...automation import (
    draft_offer,
    draft_outreach,
    draft_rejection,
    interview_prep,
    interview_scorecard,
    screen_candidate,
)
from ...campaign import draft_campaign_pack
from ...devcase.analyze import analyze_need
from ...devcase.design import design_case, design_role
from ...devcase.interview_scenario import scenario_from_case
from ...devcase.models import CaseScenario, DevNeed, NeedAnalysis, RoleSpec
from ...group_compare import generate as group_compare_generate
from ...jobs import ingest_raw_ad
from ...match_reasoning import generate
from ...matching import MatchCandidate, load_corpus, score_job
from ...profile import CandidateProfileV2
from ...transform import build_match_candidate
from ...weight_proposal import generate as weight_proposal_generate, proposal_context
from . import contracts

# A generic interviewer transcript used to seed the interview_scorecard op — role-agnostic
# so the same input can be scored across every seed candidate×job pair reproducibly.
_SEED_TRANSCRIPT = (
    "Interviewer: Tell me about a recent project you're proud of.\n"
    "Candidate: I led the rebuild of our data-ingestion pipeline. The old one dropped events under load, "
    "so I introduced a bounded queue and idempotent writes. I profiled it first to find the real bottleneck "
    "rather than guessing.\n"
    "Interviewer: How did you verify it worked?\n"
    "Candidate: I wrote a load test that replayed a day of traffic and asserted zero dropped events, and I "
    "watched the metrics for a week after deploy. When a race condition showed up I reproduced it in a test "
    "before fixing it.\n"
    "Interviewer: Where did you struggle?\n"
    "Candidate: The rollout — I underestimated the migration and had to pause it once. I should have shipped it "
    "behind a flag from the start.\n"
    "Interviewer: How do you work with others?\n"
    "Candidate: I open small PRs, write the why in the description, and ask for review early, not at the end."
)

_ROOT = Path(__file__).resolve().parents[4]
CANDIDATES_SEED = _ROOT / "data" / "seed_candidates" / "candidates.json"
# 100 real JDs {id, title, company, jd_text, role_family, seniority} — seeds jd_ingest + devcase_analyze.
CALIBRATION_JOBS_SEED = _ROOT / "data" / "seed_calibration" / "jobs.json"


def load_calibration_jobs(limit: int | None = None) -> list[dict[str, Any]]:
    raw = json.loads(CALIBRATION_JOBS_SEED.read_text(encoding="utf-8"))
    jobs = raw if isinstance(raw, list) else list(raw.values())
    return jobs[:limit] if limit is not None else jobs


# Pre-built devcase artifacts {job, analysis, role, case} — let the LATER design steps run
# without re-running the earlier ones (feed the preloaded analysis/role/case straight in).
CALIBRATION_CASES_DIR = _ROOT / "data" / "seed_calibration" / "cases"


def load_calibration_cases(limit: int | None = None) -> list[dict[str, Any]]:
    files = sorted(CALIBRATION_CASES_DIR.glob("cal-*.json"))
    if limit is not None:
        files = files[:limit]
    return [json.loads(f.read_text(encoding="utf-8")) for f in files]


def _need_from_cal(cal: dict[str, Any], jd_by_id: dict[str, str]) -> DevNeed:
    job = cal.get("job", {})
    return DevNeed(
        id=job.get("id", ""),
        title=job.get("title", ""),
        stack=[],
        responsibilities=[],
        seniority_target=job.get("seniority", "medior"),
        role_family=job.get("role_family", "software_engineering"),
        jd_text=jd_by_id.get(job.get("id"), ""),
        notes=f"Real JD from {job.get('company') or 'an undisclosed company'}.",
    )

# Benchmark scenario ids → the registry use case they exercise (capabilities /
# default-model lookups key on the registry name).
REGISTRY_USE_CASE = {
    "match_reasoning": "match_reasoning",
    "automation_screen": "automation",
    "automation_outreach": "automation",
    "automation_rejection": "automation",
    "automation_offer": "automation",
    "interview_prep": "automation",
    "interview_scorecard": "interview_scorecard",
    "weight_proposal": "weight_proposal",
    "jd_ingest": "jd_ingest",
    "devcase_analyze": "devcase_analyze",
    "devcase_role_design": "devcase_role_design",
    "devcase_case_design": "devcase_case_design",
    "devcase_interview_scenario": "devcase_interview_scenario",
    "group_compare": "group_compare",
    "campaign_pack": "campaign_pack",
}

# Interaction mode per bench op — which measured axis matters when picking a
# model. "online" = a person is waiting on the result in the UI (latency is the
# binding constraint); "background" = produced by an automation pass / build
# pipeline where nobody waits (cost per task is the binding constraint).
# Quality is judged the same either way; this only frames the economics columns.
OP_MODES: dict[str, str] = {
    "match_reasoning": "online",
    "jd_ingest": "online",
    "interview_prep": "online",
    "interview_scorecard": "online",
    "group_compare": "online",
    "weight_proposal": "online",
    "automation_screen": "background",
    "automation_outreach": "background",
    "automation_rejection": "background",
    "automation_offer": "background",
    "campaign_pack": "background",
    "devcase_analyze": "background",
    "devcase_role_design": "background",
    "devcase_case_design": "background",
    "devcase_interview_scenario": "background",
}


@dataclass(frozen=True)
class Scenario:
    id: str
    use_case: str
    run: Callable[[Any], tuple[dict[str, Any], str]]
    contract: Callable[[Any], list[str]]
    meta: dict[str, Any] = field(default_factory=dict)


# meta["judgeInput"] — a compact excerpt of the REAL input the production call
# renders into its prompt, stamped by each builder so the LLM judge can check
# the output's claims against evidence instead of scoring style in a vacuum
# (judge.py shows it under its own "Input evidence" heading, truncated there
# too).
#
# COMPLETENESS over brevity (calib-a lesson, 2026-08-11): the first cut carried
# only label/skills/summary — the judge then scored a model 2/10 for "fabricating"
# a Seznam.cz role that is VERBATIM in the candidate's experience_highlights, and
# campaign copy for "inventing" the employer that sits in the job's description
# excerpt. An evidence-grounded judge with starved evidence manufactures
# fabrication findings — so the excerpt must cover every fact CATEGORY the
# production prompt feeds the model (highlights, education, aspirations, the
# description excerpt), even if each is truncated.
_JI_MAX = 4000


def _ji(text: str) -> str:
    return text[:_JI_MAX]


def _candidate_facts(candidate: MatchCandidate, m) -> str:
    """The candidate×match facts most outputs must stay grounded in — every
    category the production prompts feed (skills, highlights, education,
    aspirations, languages), not just the skill list."""
    highlights = "; ".join(h[:220] for h in (candidate.experience_highlights or [])[:4]) or "-"
    return _ji(
        f"Candidate: {candidate.label} — {candidate.seniority} {candidate.archetype}; "
        f"education: {candidate.education_level}; years: {candidate.years_experience}; "
        f"languages: {', '.join(candidate.languages or []) or '-'}; "
        f"skills: {', '.join(candidate.skills[:12])}; summary: {candidate.summary or '-'}\n"
        f"Experience highlights: {highlights}\n"
        f"Aspirations: {', '.join((candidate.aspirations or [])[:3]) or '-'}; "
        f"potential: {candidate.potential_score}\n"
        f"Match: total {m.total}/100; sub-scores: skills {m.skills_score:.2f}, career "
        f"{m.career_score:.2f}, personal {m.personal_score:.2f}; "
        f"matched: {', '.join(m.matched_skills[:8]) or '-'}; "
        f"missing: {', '.join(m.missing_skills[:8]) or '-'}; tier: {m.fit_tier}\n"
        f"Skill provenance: {json.dumps({s: candidate.skill_provenance.get(s, candidate.provenance_default) for s in m.matched_skills[:8]}, ensure_ascii=False)}; "
        f"work links: {', '.join(candidate.work_links[:3]) or 'none'}"
    )


def _job_facts(job) -> str:
    return _ji(
        f"Job: {job.title} ({job.id}), {job.seniority} {job.role_family}; "
        f"company: {job.company or '-'}; location: {job.location or '-'}; "
        f"work mode: {getattr(job, 'work_mode', '') or '-'}; "
        f"languages: {', '.join(job.languages or []) or '-'}; "
        f"skills: {', '.join((job.detected_skills or [])[:12])}; "
        f"salary band: {list(job.salary_band or []) or None}; "
        f"requirements: {'; '.join(f'{r.skill} ({r.kind})' for r in (job.requirements or [])[:6])}\n"
        f"Description excerpt: {(job.description or '')[:600]}"
    )


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
                meta={"jobId": job.id, "candidate": candidate.label, "matchTotal": m.total, "lang": lang,
                      "judgeInput": _candidate_facts(candidate, m) + "\n" + _job_facts(job)},
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
                meta={"jobId": job.id, "candidate": candidate.label, "matchTotal": m.total,
                      "judgeInput": _candidate_facts(candidate, m) + "\n" + _job_facts(job)},
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
                meta={"jobId": job.id, "candidate": candidate.label,
                      "judgeInput": _candidate_facts(candidate, m) + "\n" + _job_facts(job)},
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
                meta={"jobId": job.id, "candidate": candidate.label,
                      "judgeInput": _candidate_facts(candidate, m) + "\n" + _job_facts(job)},
            )
        )
    return out


def automation_offer_scenarios(*, limit: int = 8, lang: str = "en") -> list[Scenario]:
    del lang  # offer-letter language follows the candidate's own languages
    out: list[Scenario] = []
    for i, (candidate, job) in enumerate(_pairs(limit)):
        m = score_job(candidate, job)

        def run(provider: Any, candidate=candidate, job=job, m=m):
            return draft_offer(candidate, job, m, provider=provider)

        out.append(
            Scenario(
                id=f"automation_offer#{i:02d}:{job.id}",
                use_case="automation_offer",
                run=run,
                contract=contracts.automation_offer,
                meta={"jobId": job.id, "candidate": candidate.label, "matchTotal": m.total,
                      "judgeInput": _candidate_facts(candidate, m) + "\n" + _job_facts(job)},
            )
        )
    return out


def interview_prep_scenarios(*, limit: int = 8, lang: str = "en") -> list[Scenario]:
    out: list[Scenario] = []
    for i, (candidate, job) in enumerate(_pairs(limit)):
        m = score_job(candidate, job)

        def run(provider: Any, candidate=candidate, job=job, m=m, lang=lang):
            return interview_prep(candidate, job, m, lang=lang, provider=provider)

        out.append(
            Scenario(
                id=f"interview_prep#{i:02d}:{job.id}",
                use_case="interview_prep",
                run=run,
                contract=contracts.interview_prep,
                meta={"jobId": job.id, "candidate": candidate.label, "matchTotal": m.total,
                      "judgeInput": _candidate_facts(candidate, m) + "\n" + _job_facts(job)},
            )
        )
    return out


def interview_scorecard_scenarios(*, limit: int = 8, lang: str = "en") -> list[Scenario]:
    out: list[Scenario] = []
    for i, (candidate, job) in enumerate(_pairs(limit)):

        def run(provider: Any, candidate=candidate, job=job, lang=lang):
            return interview_scorecard(candidate, job, _SEED_TRANSCRIPT, lang=lang, provider=provider)

        out.append(
            Scenario(
                id=f"interview_scorecard#{i:02d}:{job.id}",
                use_case="interview_scorecard",
                run=run,
                contract=contracts.interview_scorecard,
                meta={"jobId": job.id, "candidate": candidate.label,
                      "judgeInput": _ji("Job: " + job.title + " (" + job.seniority + " " + job.role_family + ")\nTranscript:\n" + _SEED_TRANSCRIPT)},
            )
        )
    return out


def weight_proposal_scenarios(*, limit: int = 8, lang: str = "en") -> list[Scenario]:
    # One proposal per job, over the whole seed candidate group (the production call ranks a group
    # against a role in a single request), so a "scenario" is (all seed candidates × one seed job).
    cand_pairs = [(c.label, c) for c in load_seed_candidates()]
    out: list[Scenario] = []
    for i, job in enumerate(load_seed_jobs(limit)):

        def run(provider: Any, cand_pairs=cand_pairs, job=job, lang=lang):
            return weight_proposal_generate(cand_pairs, job, lang=lang, provider=provider)

        out.append(
            Scenario(
                id=f"weight_proposal#{i:02d}:{job.id}",
                use_case="weight_proposal",
                run=run,
                contract=contracts.weight_proposal,
                meta={"jobId": job.id, "nCandidates": len(cand_pairs),
                      "judgeInput": _ji(_job_facts(job) + "\nPer-candidate rows (archetype, dims, matched-must-have provenance): "
                                        + json.dumps([{"id": r["candidateId"], "arch": r["archetype"],
                                                       "dims": r["dimensionScores"], "mustProv": r["matchedMustHaves"],
                                                       "missing": r["missingMustHaves"][:4], "potential": r["potentialScore"],
                                                       "bounds": r["weightBounds"]}
                                                      for r in proposal_context(cand_pairs, job)["candidates"]], ensure_ascii=False))},
            )
        )
    return out


def jd_ingest_scenarios(*, limit: int = 8, lang: str = "en") -> list[Scenario]:
    del lang  # extraction is language-agnostic (structured fields)
    out: list[Scenario] = []
    for i, jd in enumerate(load_calibration_jobs(limit)):

        def run(provider: Any, text=jd.get("jd_text") or "", jid=jd.get("id")):
            # ingest_raw_ad returns a Job (raises on failure — no deterministic fallback), so wrap
            # it to the bench's (payload_dict, source) shape.
            job = ingest_raw_ad(text, provider=provider, job_id=jid)
            return job.model_dump(by_alias=True), "llm"

        out.append(
            Scenario(
                id=f"jd_ingest#{i:02d}:{jd.get('id')}",
                use_case="jd_ingest",
                run=run,
                contract=contracts.jd_ingest,
                meta={"jobId": jd.get("id"), "title": jd.get("title"), "roleFamily": jd.get("role_family"),
                      "judgeInput": _ji(jd.get("jd_text") or "")},
            )
        )
    return out


def devcase_analyze_scenarios(*, limit: int = 8, lang: str = "en") -> list[Scenario]:
    out: list[Scenario] = []
    for i, jd in enumerate(load_calibration_jobs(limit)):
        need = DevNeed(
            id=jd["id"],
            title=jd["title"],
            stack=[],
            responsibilities=[],
            seniority_target=jd["seniority"],
            role_family=jd["role_family"],
            jd_text=jd["jd_text"],
            notes=f"Real JD from {jd.get('company') or 'an undisclosed company'}.",
        )

        def run(provider: Any, need=need, lang=lang):
            return analyze_need(need, snapshot=None, provider=provider, lang=lang)

        out.append(
            Scenario(
                id=f"devcase_analyze#{i:02d}:{jd['id']}",
                use_case="devcase_analyze",
                run=run,
                contract=contracts.devcase_analyze,
                meta={"jobId": jd["id"], "title": jd["title"], "roleFamily": jd["role_family"],
                      "judgeInput": _ji(jd["jd_text"])},
            )
        )
    return out


def devcase_role_design_scenarios(*, limit: int = 8, lang: str = "en") -> list[Scenario]:
    jd_by_id = {j["id"]: j.get("jd_text", "") for j in load_calibration_jobs(None)}
    out: list[Scenario] = []
    for i, cal in enumerate(load_calibration_cases(limit)):
        need = _need_from_cal(cal, jd_by_id)
        analysis = NeedAnalysis.model_validate(cal["analysis"])

        def run(provider: Any, need=need, analysis=analysis, lang=lang):
            return design_role(need, analysis, provider=provider, lang=lang)

        out.append(
            Scenario(
                id=f"devcase_role_design#{i:02d}:{need.id}",
                use_case="devcase_role_design",
                run=run,
                contract=contracts.devcase_role_design,
                meta={"jobId": need.id, "title": need.title, "roleFamily": need.role_family,
                      "judgeInput": _ji("JD (" + need.title + "):\n" + need.jd_text)},
            )
        )
    return out


def devcase_case_design_scenarios(*, limit: int = 8, lang: str = "en") -> list[Scenario]:
    jd_by_id = {j["id"]: j.get("jd_text", "") for j in load_calibration_jobs(None)}
    out: list[Scenario] = []
    for i, cal in enumerate(load_calibration_cases(limit)):
        need = _need_from_cal(cal, jd_by_id)
        analysis = NeedAnalysis.model_validate(cal["analysis"])
        role = cal["role"]  # design_case takes the role as a plain dict

        def run(provider: Any, need=need, analysis=analysis, role=role, lang=lang):
            return design_case(need, analysis, role, provider=provider, lang=lang)

        out.append(
            Scenario(
                id=f"devcase_case_design#{i:02d}:{need.id}",
                use_case="devcase_case_design",
                run=run,
                contract=contracts.devcase_case_design,
                meta={"jobId": need.id, "title": need.title,
                      "judgeInput": _ji("Role: " + str(role.get("title", need.title)) + "\nJD:\n" + need.jd_text)},
            )
        )
    return out


def devcase_interview_scenario_scenarios(*, limit: int = 8, lang: str = "en") -> list[Scenario]:
    out: list[Scenario] = []
    for i, cal in enumerate(load_calibration_cases(limit)):
        case = CaseScenario.model_validate(cal["case"])
        role = RoleSpec.model_validate(cal["role"])
        job_id = cal.get("job", {}).get("id", f"cal-{i:03d}")
        # Fixture completeness: the calibration cases predate case ids, so the
        # scenario's case_id passthrough surfaced as an empty string the judge
        # (rightly) flagged. Production cases always carry an id.
        if not case.id:
            case = case.model_copy(update={"id": job_id})

        def run(provider: Any, case=case, role=role, lang=lang):
            return scenario_from_case(case, role, provider=provider, lang=lang)

        out.append(
            Scenario(
                id=f"devcase_interview_scenario#{i:02d}:{job_id}",
                use_case="devcase_interview_scenario",
                run=run,
                contract=contracts.devcase_interview_scenario,
                meta={"jobId": job_id, "caseTitle": case.title,
                      "judgeInput": _ji("Case: " + case.title + " (role: " + role.title + ")\nBrief: "
                                        + str(getattr(case, "brief", "") or "") + "\nTasks: "
                                        + "; ".join((case.tasks or [])[:6]) + "\nCover probes: "
                                        + "; ".join(f"{cp.id}@{cp.where}: {cp.reveals}" for cp in (case.cover_probes or [])[:4]))},
            )
        )
    return out


def _group_candidate(candidate: MatchCandidate, m: Any) -> dict[str, Any]:
    """One candidate's comparative facts for group_compare's context (mirrors the
    shape group_compare_cli documents). Subscores are scaled 0-100 to sit on the
    same axis as the 0-100 total; salaryExpectation is unavailable from the seed
    profiles, so it's left null (the prompt treats it as optional)."""
    return {
        "label": candidate.label,
        "archetype": candidate.archetype,
        "seniority": candidate.seniority,
        "total": m.total,
        "skills": round(100 * m.skills_score),
        "career": round(100 * m.career_score),
        "personal": round(100 * m.personal_score),
        "matchedSkills": list(m.matched_skills),
        "missingSkills": list(m.missing_skills),
        "verdict": m.fit_tier,
        "potentialScore": candidate.potential_score,
        "salaryExpectation": None,
    }


# A comparison group is a recruiter's SHORTLIST, not the whole corpus — cap it so the
# prompt stays realistic and cheap (comparing 50 candidates is neither).
_GROUP_SHORTLIST = 6


def group_compare_scenarios(*, limit: int = 8, lang: str = "en") -> list[Scenario]:
    # One comparison per job over the top-scoring seed candidates — the production call
    # ranks a role's shortlist head-to-head in a single request, so a "scenario" is
    # (top-N seed candidates scored × one seed job).
    candidates = load_seed_candidates()
    out: list[Scenario] = []
    for i, job in enumerate(load_seed_jobs(limit)):
        scored = sorted(
            ((c, score_job(c, job)) for c in candidates), key=lambda cm: cm[1].total, reverse=True
        )[:_GROUP_SHORTLIST]
        context = {
            "roleTitle": job.title,
            "roleSalaryBand": list(job.salary_band) or None,
            "candidates": [_group_candidate(c, m) for c, m in scored],
        }

        def run(provider: Any, context=context, lang=lang):
            return group_compare_generate(context, lang=lang, provider=provider)

        out.append(
            Scenario(
                id=f"group_compare#{i:02d}:{job.id}",
                use_case="group_compare",
                run=run,
                contract=contracts.group_compare,
                meta={"jobId": job.id, "roleTitle": job.title, "nCandidates": len(scored),
                      "judgeInput": _ji(json.dumps(context, ensure_ascii=False))},
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
                meta={"jobId": job.id, "lang": lang,
                      "judgeInput": _ji(_job_facts(job) + "\nApply URL: https://example.invalid/apply/" + job.id + "/quick")},
            )
        )
    return out


SCENARIO_BUILDERS: dict[str, Callable[..., list[Scenario]]] = {
    "match_reasoning": match_reasoning_scenarios,
    "automation_screen": automation_screen_scenarios,
    "automation_outreach": automation_outreach_scenarios,
    "automation_rejection": automation_rejection_scenarios,
    "automation_offer": automation_offer_scenarios,
    "interview_prep": interview_prep_scenarios,
    "interview_scorecard": interview_scorecard_scenarios,
    "weight_proposal": weight_proposal_scenarios,
    "jd_ingest": jd_ingest_scenarios,
    "devcase_analyze": devcase_analyze_scenarios,
    "devcase_role_design": devcase_role_design_scenarios,
    "devcase_case_design": devcase_case_design_scenarios,
    "devcase_interview_scenario": devcase_interview_scenario_scenarios,
    "group_compare": group_compare_scenarios,
    "campaign_pack": campaign_pack_scenarios,
}


def scenarios_for(use_case: str, *, limit: int = 8, lang: str = "en") -> list[Scenario]:
    builder = SCENARIO_BUILDERS.get(use_case)
    if builder is None:
        raise ValueError(f"unknown bench use case {use_case!r} (known: {sorted(SCENARIO_BUILDERS)})")
    return builder(limit=limit, lang=lang)
