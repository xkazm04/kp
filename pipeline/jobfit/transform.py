"""The bridge (Phase 5, diagram 09): CandidateProfileV2 -> MatchCandidate.

Translates a student / switcher profile into the same representation the matching
engine speaks for everyone:

  * skills are unioned from self-rated claims AND evidence, each carrying its
    strongest provenance, so skill_match_score discounts a school-project skill
    relative to a production one;
  * a potential / readiness score replaces years-of-experience for early-career
    candidates (demonstrated depth, learning velocity, foundation quality,
    initiative), with human-readable signals for the reasoning layer.
"""

from __future__ import annotations

from .matching import MatchCandidate
from .profile import CandidateProfileV2
from .taxonomy import PROVENANCE_WEIGHTS
from .transferable import map_transferable

_EARLY_CAREER = ("student", "career_switcher")

# Surface tokens hinting a degree is relevant to the target field.
_FAMILY_DEGREE_TERMS = {
    "software_engineering": ("comput", "software", "informat", "programm", "fel", "fit", "kybernet"),
    "data_ai": ("data", "machine learning", "ai", "statist", "math", "analyt"),
    "product_project": ("manage", "business", "econom", "product", "marketing"),
}


def compute_potential(profile: CandidateProfileV2) -> tuple[float, list[str]]:
    """Readiness score in [0,1] + human-readable signals (replaces years-of-experience)."""
    signals: list[str] = []
    ev = profile.evidence
    project_like = [e for e in ev if e.kind in ("project", "thesis")]
    shipped = [e for e in project_like if e.link]

    # 1. demonstrated depth — did they build something, ideally verifiable?
    depth = min(1.0, len(project_like) / 3.0)
    if shipped:
        depth = min(1.0, depth + 0.15 * len(shipped))
        signals.append(f"{len(shipped)} project(s)/thesis with a code or demo link")
    elif project_like:
        signals.append(f"{len(project_like)} project(s) or thesis")

    # 2. learning velocity — breadth of skills is a strong early-career signal.
    distinct = {s.skill.casefold() for s in profile.skill_claims}
    distinct |= {sk.casefold() for e in ev for sk in e.skills}
    n_skills = len(distinct)
    velocity = min(1.0, n_skills / 8.0)
    if n_skills >= 6:
        signals.append(f"self-taught breadth: {n_skills} distinct skills")

    # 3. foundation quality — relevant, completed (or in-progress) degree.
    foundation = {"phd": 1.0, "master": 0.85, "bachelor": 0.7, "university": 0.5}.get(
        profile.education_level, 0.0
    )
    detail = profile.education_detail.casefold()
    if any(term in detail for term in _FAMILY_DEGREE_TERMS.get(profile.role_family, ())):
        foundation = min(1.0, foundation + 0.1)
        signals.append("degree relevant to the target field")

    # 4. initiative / trajectory.
    kinds = {e.kind for e in ev}
    initiative = 0.0
    if "internship" in kinds:
        initiative += 0.4
        signals.append("internship experience")
    if "extracurricular" in kinds:
        initiative += 0.3
        signals.append("extracurricular / community activity")
    if any(e.resolved_provenance() == "open_source" for e in ev):
        initiative += 0.3
        signals.append("open-source contribution")
    if "certification" in kinds:
        initiative += 0.2
    initiative = min(1.0, initiative)

    # 5. career-switcher: prior professional delivery de-risks the switch.
    if profile.archetype == "career_switcher":
        prior = [e for e in ev if e.kind == "job"]
        if prior:
            initiative = min(1.0, initiative + 0.4)
            signals.append(f"proven delivery in {len(prior)} prior professional role(s)")
        if (profile.years_experience or 0) >= 3:
            depth = max(depth, 0.6)
            signals.append(f"{profile.years_experience:g}y professional track record (different field)")

    score = round(0.35 * depth + 0.25 * velocity + 0.25 * foundation + 0.15 * initiative, 3)
    return score, signals


def _norm(skill: str) -> str:
    return skill.strip().casefold()


def build_match_candidate(profile: CandidateProfileV2) -> MatchCandidate:
    """Normalize a profile into a MatchCandidate (skills + per-skill provenance + potential)."""
    prov_by_norm: dict[str, str] = {}
    display_by_norm: dict[str, str] = {}

    def consider(skill: str, provenance: str) -> None:
        key = _norm(skill)
        if not key:
            return
        display_by_norm.setdefault(key, skill.strip())
        current = prov_by_norm.get(key)
        if current is None or PROVENANCE_WEIGHTS.get(provenance, 0.0) > PROVENANCE_WEIGHTS.get(current, 0.0):
            prov_by_norm[key] = provenance

    for claim in profile.skill_claims:
        consider(claim.skill, claim.provenance)
    for evidence in profile.evidence:
        prov = evidence.resolved_provenance()
        for skill in evidence.skills:
            consider(skill, prov)

    # career-switcher: credit transferable meta-skills from the prior domain at
    # PROFESSIONAL provenance (the difference from a true beginner).
    transferable: list[str] = []
    if profile.archetype == "career_switcher":
        for skill, _source in map_transferable(profile.evidence):
            consider(skill, "professional")
            transferable.append(skill)

    skills = [display_by_norm[k] for k in display_by_norm]
    skill_provenance = {display_by_norm[k]: prov_by_norm[k] for k in prov_by_norm}

    is_early = profile.archetype in _EARLY_CAREER
    potential, signals = compute_potential(profile) if is_early else (None, [])

    return MatchCandidate(
        skills=skills,
        skill_provenance=skill_provenance,
        seniority=profile.seniority or ("junior" if is_early else "medior"),
        role_family=profile.role_family,
        education_level=profile.education_level,
        languages=profile.languages,
        years_experience=profile.years_experience or 0.0,
        archetype=profile.archetype,
        provenance_default="self_declared" if is_early else "professional",
        potential_score=potential,
        learning_signals=signals,
        aspirations=profile.aspirations,
        transferable_skills=transferable,
        label=profile.display_name or "Candidate",
    )
