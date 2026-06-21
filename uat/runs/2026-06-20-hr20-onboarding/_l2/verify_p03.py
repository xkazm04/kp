"""P0-3 live check: industry/market-aware reasoning persona + real CV facts fed in.

Builds a nurse profile + a Boston ICU-nurse job, then runs the real reasoning
provider and prints the persona, the CV highlights/links that now reach the prompt,
and the produced rationale. Run from repo root: python uat/runs/.../_l2/verify_p03.py
"""
import json

from pipeline.jobfit.profile import CandidateProfileV2, Evidence, SkillClaim
from pipeline.jobfit.jobs import normalize_job
from pipeline.jobfit.transform import build_match_candidate
from pipeline.jobfit.matching import score_job
from pipeline.jobfit.match_reasoning import _system_for, generate
from pipeline.jobfit.llm import resolve_provider

profile = CandidateProfileV2(
    archetype="bau",
    display_name="Sarah Mitchell",
    role_family="healthcare_clinical",
    years_experience=8,
    seniority="senior",
    education_level="bachelor",
    languages=["English"],
    location="Boston, MA",
    skill_claims=[
        SkillClaim(skill="Ventilator management", level="strong", provenance="professional"),
        SkillClaim(skill="CRRT", level="strong", provenance="professional"),
        SkillClaim(skill="Sepsis protocols", level="strong", provenance="professional"),
    ],
    evidence=[
        Evidence(kind="job", title="Staff Nurse III, Medical ICU — Massachusetts General Hospital",
                 text="1:1 care for ventilated, CRRT and post-arrest patients; charge-nurse rotation; cut CLABSI 30%",
                 skills=["Ventilator management", "CRRT"], provenance="professional", recency="2024-01"),
        Evidence(kind="certification", title="CCRN (Critical Care Registered Nurse)",
                 text="AACN board certification", skills=["Critical care"], provenance="certification", recency="2023-01"),
    ],
)
job = normalize_job({
    "title": "ICU Registered Nurse",
    "seniority": "senior",
    "role_family": "healthcare_clinical",
    "location": "Boston, MA",
    "description": "ICU RN at a Level I trauma center.",
    "requirements": [
        {"skill": "Ventilator management", "kind": "must_have", "hardness": "prerequisite"},
        {"skill": "CCRN", "kind": "must_have", "hardness": "prerequisite"},
        {"skill": "Sepsis protocols", "kind": "nice_to_have", "hardness": "preferred"},
    ],
})
cand = build_match_candidate(profile)
m = score_job(cand, job)

print("=== PERSONA (was: 'precise technical recruiter for the Czech tech market') ===")
print(_system_for(job))
print("\n=== REAL CV CONTENT NOW FED TO REASONING ===")
print("experienceHighlights:", json.dumps(cand.experience_highlights, ensure_ascii=False))
print("workLinks:", cand.work_links)

prov = resolve_provider("match_reasoning", timeout=120)
if prov is not None and not prov.available():
    prov = None
print("\nprovider:", type(prov).__name__ if prov else None)
reasoning, source = generate(cand, job, m, lang="en", provider=prov)
print("source:", source)
print(json.dumps(reasoning, ensure_ascii=False, indent=2))
