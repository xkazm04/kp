"""P0-4 live check (bypasses the metered /api/analyze): first-class capture of
credentials/publications/links + the credential gate. Run from repo root:
  PYTHONPATH=. python uat/runs/2026-06-20-hr20-onboarding/_l2/verify_p04.py
"""
import json
from pathlib import Path

from pipeline.jobfit.gemini import load_local_env

load_local_env()  # picks up GEMINI_API_KEY from .env.local
from pipeline.jobfit.pipeline import analyze_cv

RN_JD = (
    "Registered Nurse - ICU at a Level I trauma center, Boston MA, USA. REQUIRES an "
    "ACTIVE RN license and CCRN certification; BLS/ACLS; 3+ years adult ICU experience."
)


def show(label: str, cv: str, jd: str) -> None:
    res = analyze_cv(Path(cv), job_description_text=jd, lang="en")
    d = res.model_dump()
    prof = d.get("profile") or d.get("candidate") or {}
    jf = d.get("job_fit") or {}
    print(f"\n===== {label} =====")
    print("role_family:", prof.get("role_family"))
    print("credentials:", json.dumps(prof.get("credentials"), ensure_ascii=False))
    print("publications:", json.dumps(prof.get("publications"), ensure_ascii=False))
    print("links:", json.dumps(prof.get("links"), ensure_ascii=False))
    print("gaps:", json.dumps(d.get("gaps"), ensure_ascii=False))
    print("recruiter_risk_flags:", json.dumps((jf or {}).get("recruiter_risk_flags"), ensure_ascii=False))


# 1) capture: a nurse who HOLDS the credentials -> they become structured data
show("RN CV -> RN JD (CAPTURE)", "uat/runs/2026-06-20-hr20-onboarding/_l2/sarah-rn-cv.txt", RN_JD)
# 2) gate: a candidate who LACKS the required RN license -> blocking credential flag
show("SWE CV -> RN JD (CREDENTIAL GATE)", "uat/runs/2026-06-20-hr20-onboarding/_l2/alex-swe-cv.txt", RN_JD)
