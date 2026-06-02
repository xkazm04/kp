"""Seed COMPLETE, realistic CV analyses for the synthetic candidate population.

The Profile candidate matrix (and Match's "saved analysis" source) read the
``analyses`` table — but nothing seeds it, so on a fresh boot there are zero
analyzed candidates. This mirrors the Analyze-tab output WITHOUT an LLM: each
seeded candidate is scored against a drafted job description + organization
description (one per role family), a Gemini-shaped payload is synthesized from the
candidate + the match, and that payload is run through the SAME post-Gemini
assembly the live pipeline uses (``_profile_from_payload``, ``build_interview_kit``,
``build_evidence_trace``, ``build_company_context``, ``evaluate_keyword_coverage``,
``compare_extraction_quality``, ``_build_deterministic_evidence``, ``_sanity_checks``).

So every section a real analysis fills — Interview kit, Evidence trace, Keyword
coverage, Company context, Extraction quality, Deterministic evidence, full Job-fit
and Market-evidence — is populated with the real functions, and the payload is a
schema-valid ``AnalysisResult`` that renders on /history/<slug> like a real run.

    python -m pipeline.jobfit.seed_analyses           # writes data/seed_analyses/analyses.json
    python -m pipeline.jobfit.seed_analyses --limit 5 # quick check
"""

from __future__ import annotations

import argparse
import json
import re
import sys
from pathlib import Path
from typing import Any

from .align_candidates_csas import TRACKS as _CSAS_TRACKS
from .archetype import label_for
from .ats import evaluate_keyword_coverage
from .extractors import clean_text
from .insights import apply_company_salary_context, build_company_context, build_evidence_trace
from .interview import build_interview_kit
from .jobs import normalize_job
from .matching import score_job
from .models import AnalysisMetadata, AnalysisResult, ExtractionComparison
from .pipeline import (
    _build_deterministic_evidence,
    _explanation_fallback,
    _job_fit_from_payload,
    _market_evidence_from_payload,
    _profile_from_payload,
    _salary_from_payload,
    _sanity_checks,
    _score_from_payload,
    _string_list,
    compare_extraction_quality,
)
from .profile import CandidateProfileV2
from .taxonomy import role_band
from .transform import build_match_candidate

ROOT = Path(__file__).resolve().parents[2]
CANDIDATES_PATH = ROOT / "data" / "seed_candidates" / "candidates.json"
OUT_PATH = ROOT / "data" / "seed_analyses" / "analyses.json"

ORG_DESCRIPTION = (
    "Česká spořitelna (a.s.) is the largest retail bank in the Czech Republic and part of "
    "Erste Group, a multinational banking corporation. Headquartered in Praha (Praha-Michle), it "
    "serves millions of clients through George, its award-winning digital banking platform, and "
    "runs large in-house engineering, data, and product teams across agile tribes. As a regulated "
    "bank it pairs enterprise scale and stability with deliberate investment in mentoring and "
    "early-career hiring — graduates and career-changers are paired with a mentor for their first months."
)

_GRAD_FRIENDLY = " Graduates and career-changers are welcome; structured mentoring and training are provided."

JD_DRAFTS: dict[str, dict[str, Any]] = {
    "software_engineering": {
        "title": "Software Engineer",
        "company": "Česká spořitelna",
        "location": "Praha",
        "work_mode": "hybrid",
        "seniority": "medior",
        "role_family": "software_engineering",
        "languages": ["Czech", "English"],
        "description": (
            "Build and ship features for George, the bank's digital banking platform: a TypeScript/React "
            "frontend and Node.js/JVM service layers backed by PostgreSQL. You'll own features end to end, "
            "review peers' code, and care about tests and reliability in a regulated environment."
            + _GRAD_FRIENDLY + " " + ORG_DESCRIPTION
        ),
        "requirements": [
            {"skill": "TypeScript", "kind": "must_have", "hardness": "prerequisite"},
            {"skill": "JavaScript", "kind": "must_have", "hardness": "prerequisite"},
            {"skill": "React", "kind": "must_have", "hardness": "prerequisite"},
            {"skill": "Node.js", "kind": "must_have", "hardness": "learnable"},
            {"skill": "Python", "kind": "nice_to_have", "hardness": "learnable"},
            {"skill": "Java", "kind": "nice_to_have", "hardness": "learnable"},
            {"skill": "SQL", "kind": "must_have", "hardness": "learnable"},
            {"skill": "PostgreSQL", "kind": "nice_to_have", "hardness": "learnable"},
            {"skill": "Docker", "kind": "nice_to_have", "hardness": "learnable"},
            {"skill": "Git", "kind": "nice_to_have", "hardness": "learnable"},
            {"skill": "REST APIs", "kind": "nice_to_have", "hardness": "learnable"},
        ],
    },
    "data_ai": {
        "title": "Data Scientist",
        "company": "Česká spořitelna",
        "location": "Praha",
        "work_mode": "hybrid",
        "seniority": "medior",
        "role_family": "data_ai",
        "languages": ["Czech", "English"],
        "description": (
            "Turn retail-banking and behavioural data into models and insight: build pipelines in Python, "
            "prototype ML models for risk, fraud, and personalization, and communicate findings to product "
            "tribes." + _GRAD_FRIENDLY + " " + ORG_DESCRIPTION
        ),
        "requirements": [
            {"skill": "Python", "kind": "must_have", "hardness": "prerequisite"},
            {"skill": "SQL", "kind": "must_have", "hardness": "prerequisite"},
            {"skill": "machine learning", "kind": "must_have", "hardness": "learnable"},
            {"skill": "pandas", "kind": "nice_to_have", "hardness": "learnable"},
            {"skill": "NumPy", "kind": "nice_to_have", "hardness": "learnable"},
            {"skill": "statistics", "kind": "nice_to_have", "hardness": "learnable"},
            {"skill": "deep learning", "kind": "nice_to_have", "hardness": "learnable"},
            {"skill": "data visualization", "kind": "nice_to_have", "hardness": "learnable"},
            {"skill": "scikit-learn", "kind": "nice_to_have", "hardness": "learnable"},
            {"skill": "data analysis", "kind": "nice_to_have", "hardness": "learnable"},
        ],
    },
    "product_project": {
        "title": "Product Manager",
        "company": "Česká spořitelna",
        "location": "Praha",
        "work_mode": "hybrid",
        "seniority": "medior",
        "role_family": "product_project",
        "languages": ["Czech", "English"],
        "description": (
            "Own a product area within a digital-banking tribe: shape the roadmap, align stakeholders across "
            "business and risk, and turn user research into shipped outcomes with your squad."
            + _GRAD_FRIENDLY + " " + ORG_DESCRIPTION
        ),
        "requirements": [
            {"skill": "product management", "kind": "must_have", "hardness": "prerequisite"},
            {"skill": "stakeholder management", "kind": "must_have", "hardness": "learnable"},
            {"skill": "agile", "kind": "must_have", "hardness": "learnable"},
            {"skill": "scrum", "kind": "nice_to_have", "hardness": "learnable"},
            {"skill": "roadmapping", "kind": "nice_to_have", "hardness": "learnable"},
            {"skill": "analytics", "kind": "nice_to_have", "hardness": "learnable"},
            {"skill": "user research", "kind": "nice_to_have", "hardness": "learnable"},
            {"skill": "project management", "kind": "nice_to_have", "hardness": "learnable"},
            {"skill": "Jira", "kind": "nice_to_have", "hardness": "learnable"},
        ],
    },
}

_DEFAULT_FAMILY = "software_engineering"
_EDU_PTS = {"phd": 12, "master": 10, "bachelor": 8, "university": 6, "unknown": 3}
_SEN_PTS = {"junior": 11, "medior": 16, "senior": 20, "lead": 23}

# Per-track ČS role JDs: a candidate aligned to a ČS track (align_candidates_csas)
# is analyzed against the role they actually target, so the fit is realistic
# (good but imperfect) instead of an iOS engineer scored against a generic
# TS/React role. Falls back to the broad family JD when a candidate has no track.
_TRACK_BY_TARGET: dict[str, tuple[str, dict[str, Any]]] = {
    t["target"]: (fam, t) for fam, ts in _CSAS_TRACKS.items() for t in ts
}
_FAMILY_CTX = {
    "software_engineering": "George digital banking and core banking services on the Erste platform",
    "data_ai": "risk, fraud, personalization and reporting models for retail banking",
    "product_project": "a digital-banking product tribe",
}

# Cross-cutting "ideal" must-haves a ČS role wants beyond the narrow track stack.
# A candidate whose track already carries one has no gap there; others surface a
# realistic missing-skill, so the Job-fit tab shows genuine, varied gaps.
_FAMILY_STRETCH = {
    "software_engineering": ["Kubernetes", "CI/CD"],
    "data_ai": ["MLOps", "cloud"],
    "product_project": ["SQL", "data analysis"],
}


def _jd_for_track(target: str, family: str, track: dict[str, Any]) -> dict[str, Any]:
    skills = track["skills"]
    reqs = [
        {"skill": s, "kind": "must_have" if i < 3 else "nice_to_have", "hardness": "prerequisite" if i < 2 else "learnable"}
        for i, s in enumerate(skills)
    ]
    track_lower = {s.casefold() for s in skills}
    for extra in _FAMILY_STRETCH.get(family, []):
        if extra.casefold() not in track_lower:
            reqs.append({"skill": extra, "kind": "must_have", "hardness": "learnable"})
    desc = (
        f"{target} at Česká spořitelna, working on {_FAMILY_CTX.get(family, 'banking technology')} with "
        f"{', '.join(skills[:4])} and a modern toolchain." + _GRAD_FRIENDLY + " " + ORG_DESCRIPTION
    )
    return {
        "title": target,
        "company": "Česká spořitelna",
        "location": "Praha",
        "work_mode": "hybrid",
        "seniority": "medior",
        "role_family": family,
        "languages": ["Czech", "English"],
        "description": desc,
        "requirements": reqs,
    }


def _grad_year(profile: CandidateProfileV2) -> str | None:
    m = re.search(r"(20\d{2})", profile.education_detail or "")
    return m.group(1) if m else None


def _raw_text(profile: CandidateProfileV2) -> str:
    """A CV-like text the deterministic extractors/taxonomy can read (skills,
    role family, evidence) — stands in for the extracted PDF text."""
    lines = [
        profile.display_name or "Candidate",
        f"{label_for(profile.archetype)} · {profile.role_family}",
    ]
    if profile.seniority:
        lines.append(f"Current level: {profile.seniority}")
    if profile.years_experience:
        lines.append(f"Experience: {profile.years_experience:g} years")
    if profile.education_detail:
        lines.append(f"Education: {profile.education_level} — {profile.education_detail}")
    else:
        lines.append(f"Education: {profile.education_level}")
    if profile.languages:
        lines.append(f"Languages: {', '.join(profile.languages)}")
    skills = sorted({c.skill for c in profile.skill_claims} | {s for e in profile.evidence for s in e.skills})
    if skills:
        lines.append(f"Skills: {', '.join(skills)}")
    for e in profile.evidence:
        if e.title or e.text:
            lines.append(f"- {e.kind}: {e.title}{(' — ' + e.text) if e.text else ''}".rstrip())
    if profile.aspirations:
        lines.append("Aspirations: " + ", ".join(profile.aspirations))
    return "\n".join(lines)


def _synth_score(profile: CandidateProfileV2, mc: Any, matched: list[str], seniority: str, early: bool) -> dict[str, int]:
    years = float(profile.years_experience or 0.0)
    skills_pts = min(30, 6 + len(mc.skills) * 2 + len(matched) * 2)
    if early:
        pot = mc.potential_score if mc.potential_score is not None else 0.5
        experience_pts = min(25, round(pot * 25))
    else:
        experience_pts = min(25, round(years * 3.5))
    role_seniority_pts = _SEN_PTS.get(seniority, 14)
    education_pts = _EDU_PTS.get(profile.education_level, 3)
    traits_pts = min(10, 3 + len(profile.aspirations) * 2)
    total = min(100, skills_pts + experience_pts + role_seniority_pts + education_pts + traits_pts)
    return {
        "total": total,
        "experience": experience_pts,
        "skills": skills_pts,
        "role_seniority": role_seniority_pts,
        "education": education_pts,
        "traits": traits_pts,
    }


def _synth_payload(profile, mc, res, job, family, seniority, early) -> dict[str, Any]:
    """A Gemini-shaped analysis payload (matching gemini.ANALYSIS_RESPONSE_SCHEMA)
    synthesized from the candidate + the deterministic match — the input the real
    post-Gemini assembly consumes."""
    matched = list(res.matched_skills)
    missing = list(res.missing_skills)
    skills = list(mc.skills)
    # Anchor the salary to the CANDIDATE's seniority band (not the JD's), so a
    # junior and a senior don't land on the same number; the bank/enterprise
    # company-context factor is layered on later by apply_company_salary_context.
    band = list(role_band(family, seniority)) or [45000, 85000]
    lo, hi = band[0], band[-1]
    years = float(profile.years_experience or 0.0)
    name = profile.display_name or "Candidate"
    fit = res.fit_tier

    if profile.archetype == "student":
        sig = {"is_enrolled": True, "education_is_dominant": True, "expected_graduation": _grad_year(profile)}
    elif profile.archetype == "career_switcher":
        sig = {"wants_domain_change": True, "has_substantial_experience": True}
    else:
        sig = {"has_substantial_experience": years >= 3}

    return {
        "profile": {
            "name": name,
            "raw_text": _raw_text(profile),
            "years_experience": years,
            "current_seniority": seniority,
            "role_family": profile.role_family,
            "skills": skills,
            "education_level": profile.education_level,
            "education_detail": profile.education_detail,
            "languages": list(profile.languages),
            "traits": list(profile.aspirations[:4]),
            "evidence": [e.title for e in profile.evidence if e.title][:6],
            "skill_claims": [{"skill": c.skill, "level": c.level, "provenance": c.provenance} for c in profile.skill_claims],
            "experiences": [
                {"kind": e.kind, "title": e.title, "text": e.text, "skills": e.skills, "link": e.link}
                for e in profile.evidence
            ],
            "parsing_notes": [],
            **sig,
        },
        "score": _synth_score(profile, mc, matched, seniority, early),
        "salary": {
            "currency": "CZK",
            "period": "month",
            "minimum": lo,
            "maximum": hi,
            "midpoint": (lo + hi) // 2,
            "confidence": "medium",
            "rationale": [
                f"Anchored to the {family} / {seniority} Prague market band.",
                "Adjust within ±20% for proven depth or a rare specialism.",
            ],
        },
        "job_fit": {
            "score": int(res.total),
            "summary": f"{name} is a {fit} fit ({res.total}/100) for {job.title} at {job.company}.",
            "matching_skills": matched,
            "missing_skills": missing,
            "seniority_alignment": (
                "Open to early-career; evaluated on potential rather than years."
                if early
                else f"{seniority.title()} aligns with the role's {job.seniority} target."
            ),
            "role_alignment": (
                f"Same role family ({family})."
                if profile.role_family == family
                else f"Adjacent family: {profile.role_family} → {family}."
            ),
            "salary_assessment": f"Within the {lo:,}–{hi:,} CZK/month band for the role.",
            "recommendations": [
                (f"Probe depth on {missing[0]} in interview." if missing else "Confirm hands-on depth on the matched stack."),
                ("Validate self-declared / early-career skills with a short exercise." if early else "Confirm recent production use of the core stack."),
            ],
            "interview_talking_points": [f"Walk through a project that used {s}." for s in matched[:3]]
            or ["Discuss a representative recent project end to end."],
            "cv_rewrite_suggestions": (
                [f"Make {missing[0]} experience explicit if it exists."] if missing else ["Lead with the strongest matched skill."]
            ),
            "must_prove_evidence": missing[:3],
            "negotiation_angle": (
                "A strong matched stack supports the upper band." if res.total >= 60 else "Position mid-band with clear growth headroom."
            ),
            "recruiter_risk_flags": (["Some skills are self-declared — validate in interview."] if early else []),
        },
        "market_evidence": {
            "summary": (
                f"Prague {family} roles at {seniority} level pay roughly {lo:,}–{hi:,} CZK/month; "
                f"demand for {(matched or skills or ['core'])[0]} skills remains steady."
            ),
            "suggested_minimum_czk": lo,
            "suggested_maximum_czk": hi,
            "confidence": "medium",
            "notes": [
                "Seeded market estimate (no live grounding).",
                f"{job.company} is a large regulated bank (Erste Group) — comp leans on a stable base plus an annual bonus.",
            ],
        },
        "strengths": [f"Demonstrates {s}." for s in matched[:5]] or [f"Relevant {family} foundation to build on."],
        "gaps": [f"Limited evidence of {s}." for s in missing[:5]],
        "recommendations": [
            "Use the matched skills as interview anchors and probe the gaps.",
            ("Pair with a mentor for the first months." if early else "Confirm scope and recent delivery during screening."),
        ],
        "explanation": (
            f"{name}, routed as {label_for(profile.archetype)}, was assessed for {job.title} at {job.company}: "
            f"{fit} fit at {res.total}/100, estimated {lo:,}–{hi:,} CZK/month. "
            f"Matched: {', '.join(matched[:5]) or '—'}. Gaps: {', '.join(missing[:4]) or 'none critical'}."
        ),
    }


def build_analysis(record: dict[str, Any]) -> dict[str, Any]:
    """One seeded candidate -> a COMPLETE, schema-valid AnalysisResult payload,
    assembled with the live pipeline's deterministic insight functions."""
    profile = CandidateProfileV2.model_validate(record)
    target = str(record.get("targetRole") or "")
    if target in _TRACK_BY_TARGET:
        family, track = _TRACK_BY_TARGET[target]
        jd = _jd_for_track(target, family, track)
    else:
        family = profile.role_family if profile.role_family in JD_DRAFTS else _DEFAULT_FAMILY
        jd = JD_DRAFTS[family]
    job = normalize_job(jd)
    mc = build_match_candidate(profile)
    res = score_job(mc, job)
    early = profile.archetype in ("student", "career_switcher")
    seniority = profile.seniority or ("junior" if early else "medior")

    gp = _synth_payload(profile, mc, res, job, family, seniority, early)
    raw_text = gp["profile"]["raw_text"]
    company_text = ORG_DESCRIPTION
    jd_text = job.description

    # ---- the SAME assembly the live pipeline runs after the Gemini call --------
    evidence = _build_deterministic_evidence(raw_text, company_text)
    candidate = _profile_from_payload(gp["profile"], raw_text)
    score = _score_from_payload(gp["score"])
    company_context = build_company_context(company_text)
    salary = _salary_from_payload(gp["salary"])
    apply_company_salary_context(salary, company_context)
    job_fit = _job_fit_from_payload(gp["job_fit"])
    market_evidence = _market_evidence_from_payload(gp["market_evidence"], [])
    strengths = _string_list(gp["strengths"])
    gaps = _string_list(gp["gaps"])
    recommendations = _string_list(gp["recommendations"])
    explanation = str(gp["explanation"]).strip() or _explanation_fallback(candidate, score, salary, strengths, gaps, recommendations)
    extraction_quality = compare_extraction_quality(raw_text, raw_text, len(candidate.skills))
    extraction_comparison = ExtractionComparison(pypdf_text=clean_text(raw_text), gemini_text=raw_text)
    evidence_trace = build_evidence_trace(candidate, score, salary)
    interview_kit = build_interview_kit(candidate, job_fit)
    keyword_coverage = evaluate_keyword_coverage(
        raw_text, jd_text, [r.skill for r in job.requirements], job_fit.matching_skills, job_fit.missing_skills
    )
    sanity_checks = _sanity_checks(raw_text, score, salary)
    metadata = AnalysisMetadata(
        analysis_engine="seed-deterministic",
        text_extractor="seed",
        model=None,
        parsing_notes=[
            "Seeded analysis (no LLM): scored against a drafted JD + organization description; "
            "insight sections reuse the live pipeline's deterministic builders."
        ],
        grounding_sources=[],
        deterministic_evidence=evidence,
    )
    # The candidate already IS a routed v2 profile — use it directly so the matrix
    # groups by the seeded archetype (no re-detection drift).
    v2_profile = profile.model_dump(by_alias=True, exclude_none=True)

    result = AnalysisResult(
        candidate=candidate,
        score=score,
        salary=salary,
        strengths=strengths,
        gaps=gaps,
        recommendations=recommendations,
        explanation=explanation,
        sanity_checks=sanity_checks,
        job_fit=job_fit,
        company_context=company_context,
        evidence_trace=evidence_trace,
        interview_kit=interview_kit,
        keyword_coverage=keyword_coverage,
        extraction_quality=extraction_quality,
        extraction_comparison=extraction_comparison,
        market_evidence=market_evidence,
        metadata=metadata,
        v2_profile=v2_profile,
    )

    return {
        "id": str(record.get("id") or profile.display_name or "cand"),
        "candidate_label": profile.display_name or "Candidate",
        "role_family": family,
        "seniority": seniority,
        "score": score.total,
        "archetype": profile.archetype,
        "payload": result.model_dump(by_alias=True, exclude_none=True),
    }


def main(argv: list[str] | None = None) -> int:
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8")
        sys.stderr.reconfigure(encoding="utf-8")

    parser = argparse.ArgumentParser(description="Seed complete deterministic CV analyses for the candidate population.")
    parser.add_argument("--candidates", type=Path, default=CANDIDATES_PATH)
    parser.add_argument("--out", type=Path, default=OUT_PATH)
    parser.add_argument("--limit", type=int, default=None)
    args = parser.parse_args(argv)

    if not args.candidates.exists():
        print(f"No candidate seed at {args.candidates}", file=sys.stderr)
        return 1
    records = json.loads(args.candidates.read_text(encoding="utf-8"))
    if args.limit:
        records = records[: args.limit]

    analyses: list[dict[str, Any]] = []
    failures = 0
    for rec in records:
        if not isinstance(rec, dict):
            continue
        try:
            analyses.append(build_analysis(rec))
        except Exception as exc:
            failures += 1
            print(f"  skip {rec.get('id')}: {type(exc).__name__}: {exc}", file=sys.stderr)

    args.out.parent.mkdir(parents=True, exist_ok=True)
    args.out.write_text(json.dumps(analyses, ensure_ascii=False, indent=2), encoding="utf-8")
    try:
        shown = args.out.relative_to(ROOT)
    except ValueError:
        shown = args.out
    print(f"Wrote {len(analyses)} analyses to {shown} (failures: {failures}).", file=sys.stderr)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
