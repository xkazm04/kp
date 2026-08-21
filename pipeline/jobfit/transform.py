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

from . import registry
from .matching import MatchCandidate
from .profile import CandidateProfileV2
from .taxonomy import FAMILY_DEGREE_TERMS, provenance_rank
from .transferable import DISTANCE_ADJACENT, DISTANCE_FAR, domain_distance, map_transferable

# Sourced from the shared registry (archetypes.json) so "which archetypes get the
# potential/readiness path instead of years-of-experience" has one definition.
_EARLY_CAREER = registry.early_career_archetypes()

# Surface tokens hinting a degree is relevant to the target field now live in
# data/taxonomy.json (taxonomy.FAMILY_DEGREE_TERMS), covering all 16 role families
# instead of only the original 3 tech ones — see _doc_family_heuristics there.


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
    if any(term in detail for term in FAMILY_DEGREE_TERMS.get(profile.role_family, ())):
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
        # Domain distance grades the bridge: an ADJACENT prior field (finance
        # analyst → data work) is target-domain foundation a binary "switching"
        # flag can't see; a FAR field changes no number — the meta-skill credit
        # already prices it — but the signal keeps the narrative honest.
        distance, _reason = domain_distance(ev, profile.role_family)
        if distance == DISTANCE_ADJACENT and prior:
            foundation = max(foundation, 0.5)
            signals.append("prior field adjacent to the target — shorter bridge")
        elif distance == DISTANCE_FAR and prior:
            signals.append("distant prior field — the bridge runs through meta-skills")

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
        # Consolidate on the ORDINAL rank, not the scoring weight: several rungs
        # share a weight (observed/professional both cap at 1.0), so a `>` on
        # weights made arrival order the tiebreak — and evidence is iterated after
        # claims, so a résumé line silently shadowed a directly observed skill and
        # cost the candidate the narrowed confidence band and the stronger badge.
        if current is None or provenance_rank(provenance) > provenance_rank(current):
            prov_by_norm[key] = provenance

    for claim in profile.skill_claims:
        consider(claim.skill, claim.provenance)
    for evidence in profile.evidence:
        prov = evidence.resolved_provenance()
        for skill in evidence.skills:
            consider(skill, prov)

    is_early = profile.archetype in _EARLY_CAREER

    # Credit transferable meta-skills from prior job/internship evidence at
    # PROFESSIONAL provenance (the difference from a true beginner). Deliberately
    # gated on the SCORING MODEL, not the career_switcher id: a switcher misread
    # as a student — or a student whose brigáda was in another field — still earns
    # the meta-skill credit their real prior role implies. map_transferable itself
    # yields nothing without job/internship evidence, so a true beginner gains
    # nothing. BAU stays out: their job evidence already carries professional
    # provenance for the actual skills.
    transferable: list[str] = []
    if is_early:
        for skill, _source in map_transferable(profile.evidence):
            consider(skill, "professional")
            transferable.append(skill)

    # Grade the switch bridge for the reasoning layer (adjacent | moderate | far).
    distance = domain_distance(profile.evidence, profile.role_family)[0] if profile.archetype == "career_switcher" else None

    skills = [display_by_norm[k] for k in display_by_norm]
    skill_provenance = {display_by_norm[k]: prov_by_norm[k] for k in prov_by_norm}

    potential, signals = compute_potential(profile) if is_early else (None, [])

    # Compact, recent-first CV highlights + de-duped work links, so Layer C reasoning
    # can ground its rationale in concrete candidate facts (and a portfolio/repo for
    # creative/eng roles) rather than the structured tags alone.
    highlights: list[str] = []
    for ev in sorted(profile.evidence, key=lambda e: (e.recency or ""), reverse=True):
        title = (ev.title or "").strip()
        text = (ev.text or "").strip()
        if not title and not text:
            continue
        line = f"{title} — {text}" if title and text else (title or text)
        highlights.append(line[:200])
        if len(highlights) >= 6:
            break
    seen_links: set[str] = set()
    work_links: list[str] = []
    for ev in profile.evidence:
        link = (ev.link or "").strip()
        if link and link not in seen_links:
            seen_links.add(link)
            work_links.append(link)

    return MatchCandidate(
        skills=skills,
        skill_provenance=skill_provenance,
        seniority=profile.seniority or ("junior" if is_early else "medior"),
        role_family=profile.role_family,
        education_level=profile.education_level,
        languages=profile.languages,
        years_experience=profile.years_experience or 0.0,
        archetype=profile.archetype,
        # Was `"self_declared" if is_early else "professional"` — the discount for an
        # uncorroborated claim fell ONLY on juniors, while an experienced candidate's
        # bare skill list was credited at full professional weight. That is backwards:
        # the same unevidenced claim was penalised for the person least able to
        # evidence it and waived for the person the market already advantages
        # (UAT 2026-07-20 cs-jana-02 / LUC-GEF-L1-05). One honest default for
        # everyone; recorded provenance still overrides it per skill.
        provenance_default="self_declared",
        potential_score=potential,
        learning_signals=signals,
        aspirations=profile.aspirations,
        transferable_skills=transferable,
        domain_distance=distance,
        label=profile.display_name or "Candidate",
        experience_highlights=highlights,
        work_links=work_links[:6],
    )
