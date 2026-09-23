"""The name-neutrality registry: ONE perturbation set, and every candidate-typed
scorer on the tree either proves invariance over it or says why not.

Why this exists. Name neutrality (the AI-Act pack's G3) used to be only as wide as
the engines someone remembered to perturb: ``match()`` + ``fairness_matrix()`` in
tests/test_fairness.py, ``match()`` + ``analyze_cv()`` in tests/test_name_neutrality.py,
and ``match()`` again in eval/matching_eval.py — three hand-kept name lists, each
wired to a different subset. Twice a planted ``-ová`` penalty stayed green because
it lived in an engine no test perturbed (both recorded in those files' docstrings),
while ~40 public functions take a candidate — recruiter ranking, the Fair Rank
matrix, the keyless screen that gates automated moves, rematch, winnability.

The shape (technique: name-and-proxy-neutrality-perturbation-testing):

* :data:`PERTURBATIONS` — the canonical set, the UNION of the three old lists.
  The three suites read it instead of re-typing names.
* :func:`discover_candidate_scorers` — an AST walk of ``pipeline/jobfit`` that
  returns every public top-level function with a parameter annotated
  ``MatchCandidate | CandidateProfileV2 | CandidateProfile``. The list is DERIVED
  from the tree, never hand-kept, so a new scorer cannot ship unproven.
* :data:`SCORERS` — name -> a runner plus the JSON paths that are ALLOWED to carry
  the name (display carriers). :data:`EXEMPT` — name -> why no runner is owed.
  tests/test_neutrality_registry.py asserts ``SCORERS | EXEMPT == discovered``,
  then runs every scorer x every perturbation for byte-identity with the name
  removed ONLY from the declared carriers, plus a sentinel pass that fails on a
  name found at any undeclared path.

Keyless and deterministic by construction: every LLM-capable callee is invoked
with ``provider=None`` (its deterministic fallback), so this proves the Python half.
What an LLM does with a name is blind mode's job (redact.py), not this file's.
"""

from __future__ import annotations

import ast
import dataclasses
import functools
import json
from collections.abc import Callable, Iterable
from dataclasses import dataclass
from pathlib import Path
from typing import Any

# ---------------------------------------------------------------------------
# The perturbation set
# ---------------------------------------------------------------------------

# The baseline is name-SHAPED (not None): the comparison is name-vs-name, so a
# hypothetical "any label present" branch fires on both sides and only a
# dependence on the name's VALUE can produce a diff.
BASELINE_NAME = "Alex Smith"

# A token no real name, skill or taxonomy term contains: found anywhere outside a
# declared carrier, it IS the name travelling somewhere it was not declared.
SENTINEL = "Zzneutralitynamezz"


@dataclass(frozen=True)
class Perturbation:
    """One perturbed input. ``name`` replaces the display name; ``prose`` (when set)
    is a gendered CV line added as job evidence. ``pair`` groups a masculine and a
    feminine member of the same same-person comparison."""

    axis: str
    name: str = BASELINE_NAME
    prose: str | None = None
    pair: str | None = None
    gender: str | None = None  # "m" | "f" inside a pair


# The Czech labor market's known discrimination axes (given names as the gender
# proxy, the -ová surname as an explicit grammatical marker, Horváth/Lakatošová and
# Gejza/Květoslava as strongly Roma-associated in CZ/SK), plus same-person gender
# PAIRS: the shipped Czech marking, its accent-stripped form (what a lossy PDF
# extract produces), a titled form, an English control, and two gendered-prose
# lines (honorific, pronoun and gender-inflected job title in the CV text itself).
PERTURBATIONS: tuple[Perturbation, ...] = (
    # -- single-name axes (formerly test_name_neutrality.NAME_VARIANTS) --
    Perturbation("czech_male", "Jiří Novák"),
    Perturbation("czech_female_ova", "Jana Nováková"),
    Perturbation("vietnamese", "Nguyễn Thị Thu Hà"),
    Perturbation("ukrainian", "Oleksandra Shevchenko"),
    Perturbation("arabic", "Ahmed Al-Farsi"),
    Perturbation("roma_associated", "Gejza Horváth"),
    Perturbation("roma_associated_female", "Květoslava Lakatošová"),
    # -- same-person gender pairs (formerly test_fairness._GENDER_PAIRS and
    #    matching_eval._probe_gender's pairs) --
    Perturbation("pair_cz_m", "Jan Novák", pair="cz", gender="m"),
    Perturbation("pair_cz_f", "Jana Nováková", pair="cz", gender="f"),
    Perturbation("pair_cz_ascii_m", "Jan Novak", pair="cz_ascii", gender="m"),
    Perturbation("pair_cz_ascii_f", "Jana Novakova", pair="cz_ascii", gender="f"),
    Perturbation("pair_cz_titled_m", "Ing. Jan Novák", pair="cz_titled", gender="m"),
    Perturbation("pair_cz_titled_f", "Ing. Jana Nováková", pair="cz_titled", gender="f"),
    Perturbation("pair_en_m", "John Smith", pair="en", gender="m"),
    Perturbation("pair_en_f", "Jane Smith", pair="en", gender="f"),
    # -- gendered CV prose (formerly test_fairness._GENDERED_PROSE) --
    Perturbation(
        "prose_cz_m", prose="pan Jan Novák; on byl vedoucí vývojář týmu", pair="prose_cz", gender="m"
    ),
    Perturbation(
        "prose_cz_f",
        prose="paní Jana Nováková; ona byla vedoucí vývojářka týmu",
        pair="prose_cz",
        gender="f",
    ),
    Perturbation("prose_en_m", prose="Mr Smith led the team; his work shipped", pair="prose_en", gender="m"),
    Perturbation("prose_en_f", prose="Ms Smith led the team; her work shipped", pair="prose_en", gender="f"),
    # -- the transform's fallback label: "no name" must not be an advantage either --
    Perturbation("unnamed_fallback", "Candidate"),
)


def name_axes(perturbations: Iterable[Perturbation] = PERTURBATIONS) -> dict[str, str]:
    """``{axis: name}`` for the single-name axes (no pair, no prose)."""
    return {
        p.axis: p.name
        for p in perturbations
        if p.pair is None and p.prose is None and p.name != "Candidate"
    }


def _pairs(perturbations: Iterable[Perturbation], *, prose: bool) -> tuple[tuple[str, str], ...]:
    members: dict[str, dict[str, str]] = {}
    for p in perturbations:
        if p.pair is None or (p.prose is not None) != prose:
            continue
        members.setdefault(p.pair, {})[p.gender or ""] = (p.prose or "") if prose else p.name
    return tuple((m["m"], m["f"]) for m in members.values() if "m" in m and "f" in m)


def gender_pairs(perturbations: Iterable[Perturbation] = PERTURBATIONS) -> tuple[tuple[str, str], ...]:
    """``(masculine, feminine)`` display-name pairs, in declaration order."""
    return _pairs(perturbations, prose=False)


def gendered_prose(perturbations: Iterable[Perturbation] = PERTURBATIONS) -> tuple[tuple[str, str], ...]:
    """``(masculine, feminine)`` gendered CV-prose pairs, in declaration order."""
    return _pairs(perturbations, prose=True)


def control_for(p: Perturbation) -> Perturbation:
    """What a perturbation is compared against. A name axis against the baseline
    name; a prose line against the MASCULINE line of its own pair (a prose line vs
    no line would add an evidence item — a legitimate input change, not a name)."""
    if p.prose is None:
        return Perturbation("baseline", BASELINE_NAME)
    for q in PERTURBATIONS:
        if q.pair == p.pair and q.gender == "m" and q.prose is not None:
            return Perturbation("baseline", BASELINE_NAME, prose=q.prose)
    return Perturbation("baseline", BASELINE_NAME, prose=p.prose)


# ---------------------------------------------------------------------------
# Discovery: which functions owe a proof (derived from the tree)
# ---------------------------------------------------------------------------

CANDIDATE_TYPES = frozenset({"MatchCandidate", "CandidateProfileV2", "CandidateProfile"})
JOBFIT_ROOT = Path(__file__).resolve().parents[1]
_EXCLUDED_DIRS = ("tests/", "eval/", "llm/bench/")


def _annotation_names(node: ast.AST) -> set[str]:
    out: set[str] = set()
    for n in ast.walk(node):
        if isinstance(n, ast.Name):
            out.add(n.id)
        elif isinstance(n, ast.Attribute):
            out.add(n.attr)
        elif isinstance(n, ast.Constant) and isinstance(n.value, str):
            # A string annotation ("MatchCandidate") names the type just the same.
            out.update(t for t in CANDIDATE_TYPES if t in n.value)
    return out


def discover_in_source(module: str, source: str) -> set[str]:
    """``module.func`` for every public top-level def in ``source`` that takes a
    candidate-typed parameter."""
    found: set[str] = set()
    for node in ast.parse(source).body:
        if not isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)) or node.name.startswith("_"):
            continue
        a = node.args
        params = [*a.posonlyargs, *a.args, *a.kwonlyargs, *(x for x in (a.vararg, a.kwarg) if x)]
        if any(p.annotation is not None and _annotation_names(p.annotation) & CANDIDATE_TYPES for p in params):
            found.add(f"{module}.{node.name}")
    return found


def discover_candidate_scorers(root: Path = JOBFIT_ROOT) -> set[str]:
    """Every public candidate-typed function under ``root`` (tests/, eval/,
    llm/bench/, ``*_cli.py`` and ``seed_*.py`` excluded: harnesses, not scorers)."""
    found: set[str] = set()
    for path in sorted(root.rglob("*.py")):
        rel = path.relative_to(root).as_posix()
        if rel.startswith(_EXCLUDED_DIRS) or path.name.endswith("_cli.py") or path.name.startswith("seed_"):
            continue
        module = rel[: -len(".py")].replace("/", ".")
        found |= discover_in_source(module, path.read_text(encoding="utf-8"))
    return found


# ---------------------------------------------------------------------------
# Fixtures: the subject, its peers, the jobs
# ---------------------------------------------------------------------------


def _base_profile(base: str, name: str, prose: str | None = None):
    from ..profile import CandidateProfileV2, Evidence, SkillClaim

    if base == "student":
        profile = CandidateProfileV2(
            display_name=name,
            archetype="student",
            role_family="software_engineering",
            education_level="bachelor",
            education_detail="Computer Science, ČVUT FEL",
            languages=["Czech", "English"],
            aspirations=["Junior frontend developer"],
            skill_claims=[
                SkillClaim(skill="React"),
                SkillClaim(skill="JavaScript"),
                SkillClaim(skill="Git"),
                SkillClaim(skill="TypeScript", provenance="coursework"),
            ],
            evidence=[
                Evidence(kind="thesis", title="Recommender web app", text="Bachelor thesis project",
                         skills=["React", "TypeScript", "REST API"], link="http://example.test/thesis"),
                Evidence(kind="internship", title="FE intern", skills=["JavaScript", "CSS"]),
                Evidence(kind="project", title="Personal portfolio site", skills=["HTML"],
                         link="http://example.test/portfolio"),
            ],
        )
    else:
        profile = CandidateProfileV2(
            display_name=name,
            archetype="bau",
            role_family="software_engineering",
            education_level="master",
            languages=["English", "Czech"],
            years_experience=8,
            seniority="senior",
            skill_claims=[SkillClaim(skill=s, provenance="professional") for s in ["Python", "Django", "PostgreSQL", "AWS"]],
            evidence=[Evidence(kind="job", title="Senior Backend Engineer", text="Owned the payments API",
                               skills=["Python", "Django"])],
        )
    if prose is not None:
        profile.evidence = [*profile.evidence, Evidence(kind="job", title=prose, text=prose)]
    return profile


BASES = ("student", "senior")


@functools.lru_cache(maxsize=1)
def corpus() -> tuple[Any, ...]:
    from ..matching import load_corpus

    return tuple(load_corpus())


@functools.lru_cache(maxsize=1)
def probe_jobs() -> tuple[Any, ...]:
    """A few corpus software roles plus one synthetic senior role with hard
    must-haves, so both the KO-pass and the KO-fail paths run for every base."""
    from ..jobs import normalize_job

    software = [j for j in corpus() if j.role_family == "software_engineering"][:3]
    other = [j for j in corpus() if j.role_family != "software_engineering"][:1]
    synthetic = normalize_job(
        {
            "title": "Senior Python Engineer",
            "seniority": "senior",
            "role_family": "software_engineering",
            "languages": ["English"],
            "description": "Payments platform team.",
            "requirements": [
                {"skill": "Python", "kind": "must_have", "hardness": "hard"},
                {"skill": "React", "kind": "nice_to_have"},
            ],
        },
        job_id="neutrality-senior",
    )
    return (*software, *other, synthetic)


def _mc(profile):
    from ..transform import build_match_candidate

    return build_match_candidate(profile)


def _peers() -> list[tuple[str, Any]]:
    from ..profile import CandidateProfileV2, Evidence, SkillClaim

    java = CandidateProfileV2(
        display_name="Tomáš Beneš", archetype="bau", role_family="software_engineering",
        education_level="bachelor", languages=["Czech"], years_experience=4, seniority="medior",
        skill_claims=[SkillClaim(skill=s, provenance="professional") for s in ["Java", "Spring", "SQL"]],
        evidence=[Evidence(kind="job", title="Java Developer", skills=["Java", "Spring"])],
    )
    data = CandidateProfileV2(
        display_name="Lucie Černá", archetype="student", role_family="data_ai",
        education_level="master", languages=["English"], aspirations=["Data scientist"],
        skill_claims=[SkillClaim(skill="Python"), SkillClaim(skill="Pandas", provenance="coursework")],
        evidence=[Evidence(kind="thesis", title="Churn model", skills=["Python", "Pandas"])],
    )
    return [("peer-java", _mc(java)), ("peer-data", _mc(data))]


def _pool(profile) -> list[tuple[str, Any]]:
    return [("subject", _mc(profile)), *_peers()]


def _v1(profile):
    """The v1 CandidateProfile the CV-analysis half reads, built from the subject."""
    from ..models import CandidateProfile

    return CandidateProfile(
        name=profile.display_name,
        raw_text="Engineer with shipped work. " + " ".join(e.text for e in profile.evidence if e.text),
        years_experience=float(profile.years_experience or 0),
        current_seniority=profile.seniority or "junior",
        role_family=profile.role_family,
        skills=[c.skill for c in profile.skill_claims],
        education_level=profile.education_level,
        languages=list(profile.languages),
        traits=["ownership"],
        evidence=["Recent role focus: backend services"],
    )


# ---------------------------------------------------------------------------
# Runners
# ---------------------------------------------------------------------------


@dataclass(frozen=True)
class Scorer:
    """``run(profile) -> JSON-able payload``. ``carriers`` are the dotted paths
    (``*`` = every list item / dict key) allowed to carry the name — the name is
    removed from exactly those. ``scored_key`` must appear in the baseline payload
    (non-vacuity: the runner really reached the scored surface)."""

    run: Callable[[Any], Any]
    scored_key: str
    carriers: tuple[str, ...] = ()


def _per_job(fn: Callable[[Any, Any], Any]) -> Callable[[Any], Any]:
    return lambda profile: [fn(_mc(profile), job) for job in probe_jobs()]


def _m(cand, job):
    from ..matching import score_job

    return score_job(cand, job)


def _scorers() -> dict[str, Scorer]:
    from .. import automation, interview, insights, jobseeker, live_case, match_reasoning, matching
    from .. import profile as profile_mod
    from .. import recruiter, soft_signals, transform, weight_proposal, winnability
    from ..devcase.models import CaseEvaluation, CaseScenario, RoleSpec, TransferAssessment
    from ..models import JobFitResult, SalaryEstimate, ScoreBreakdown

    role = RoleSpec(title="Backend", role_family="software_engineering", seniority="junior",
                    must_haves=["Python", "SQL"])
    case = CaseScenario(title="Mini API")
    transfer = TransferAssessment(transfer_score=82, transfers=["Python", "SQL"], confidence=0.8)
    scorecard = {
        "confidence": {"level": "narrow"},
        "ratings": [
            {"competency": c, "rating": 5, "evidence": "Walked through the trade-offs with a worked example."}
            for c in live_case.CASE_CONSTRUCTS
        ],
        "summary": "Clear reasoning throughout.",
    }
    score = ScoreBreakdown(total=70, experience=18, skills=22, role_seniority=15, education=8, traits=7)
    salary = SalaryEstimate(currency="CZK", period="month", minimum=60000, maximum=90000, midpoint=75000,
                            confidence="medium", rationale=["Market band for the role"])
    fit = JobFitResult(score=70, summary="Solid fit", matching_skills=["Python"], missing_skills=["Kubernetes"],
                       seniority_alignment="aligned", role_alignment="aligned", salary_assessment="in band",
                       recommendations=["Show a deployed service"])
    jobs = list(corpus())
    notes = "Candidate explained the payment retry design and owned the incident review."

    return {
        # -- matching: the deterministic engine --
        "matching.match": Scorer(
            lambda p: matching.match(_mc(p), jobs, limit=25), "total", ("candidate.label",)
        ),
        "matching.score_job": Scorer(_per_job(lambda c, j: matching.score_job(c, j)), "total"),
        "matching.ko_filter": Scorer(_per_job(lambda c, j: list(matching.ko_filter(c, j))), "key"),
        "matching.eligibility_flags": Scorer(
            _per_job(lambda c, j: {"flags": matching.eligibility_flags(c, j)}), "flags"
        ),
        "matching.score_skills": Scorer(_per_job(lambda c, j: {"v": matching.score_skills(c, j)}), "v"),
        "matching.score_career": Scorer(_per_job(lambda c, j: {"v": matching.score_career(c, j)}), "v"),
        "matching.score_personal": Scorer(_per_job(lambda c, j: {"v": matching.score_personal(c, j)}), "v"),
        "matching.score_motivation": Scorer(_per_job(lambda c, j: {"v": matching.score_motivation(c, j)}), "v"),
        "matching.propose_weights": Scorer(_per_job(lambda c, j: {"v": matching.propose_weights(c, j)}), "v"),
        "matching.embedding_texts_for": Scorer(
            _per_job(lambda c, j: {"v": list(matching.embedding_texts_for(c, j))}), "v"
        ),
        "matching.fairness_matrix": Scorer(
            lambda p: [
                matching.fairness_matrix(
                    [(c, matching.propose_weights(c, job)[0]) for _cid, c in _pool(p)], job
                )
                for job in probe_jobs()
            ],
            "matrix",
            ("*.labels", "*.ranking"),
        ),
        "matching.candidate_assumptions": Scorer(
            lambda p: {"v": matching.candidate_assumptions(_mc(p))}, "v"
        ),
        "matching.candidate_assumption_codes": Scorer(
            lambda p: {"v": matching.candidate_assumption_codes(_mc(p))}, "v"
        ),
        # -- recruiter: one job -> the ranked pool --
        "recruiter.rank_candidates_for_job": Scorer(
            lambda p: [recruiter.rank_candidates_for_job(_pool(p), job) for job in probe_jobs()],
            "result",
            ("*.*.label",),
        ),
        "recruiter.rank_candidates_by_track": Scorer(
            lambda p: [recruiter.rank_candidates_by_track(_pool(p), job) for job in probe_jobs()],
            "result",
            ("*.*.*.label",),
        ),
        "recruiter.fairness_check": Scorer(
            lambda p: [recruiter.fairness_check(_pool(p), job, provider=None) for job in probe_jobs()],
            "matrix",
            ("*.labels", "*.ranking"),
        ),
        # -- automation: the keyless half of every task (provider=None) --
        "automation.screen_candidate": Scorer(
            _per_job(lambda c, j: automation.screen_candidate(c, j, _m(c, j), provider=None)),
            "recommendation",
        ),
        "automation.rematch_candidate": Scorer(
            lambda p: automation.rematch_candidate(_mc(p), None, jobs, provider=None), "jobId"
        ),
        "automation.interview_prep": Scorer(
            _per_job(lambda c, j: automation.interview_prep(c, j, _m(c, j), provider=None)), "questions"
        ),
        "automation.interview_scorecard": Scorer(
            _per_job(lambda c, j: automation.interview_scorecard(c, j, notes, provider=None)), "ratings"
        ),
        "match_reasoning.reasoning_context": Scorer(
            _per_job(lambda c, j: match_reasoning.reasoning_context(c, j, _m(c, j))),
            "match",
            ("*.candidate.experienceHighlights",),
        ),
        "match_reasoning.generate": Scorer(
            _per_job(lambda c, j: match_reasoning.generate(c, j, _m(c, j), provider=None)), "verdict"
        ),
        # -- weight proposals (the Fair Rank inputs) --
        "weight_proposal.deterministic_proposals": Scorer(
            lambda p: [weight_proposal.deterministic_proposals(_pool(p), job) for job in probe_jobs()],
            "weights",
        ),
        "weight_proposal.proposal_context": Scorer(
            lambda p: [weight_proposal.proposal_context(_pool(p), job) for job in probe_jobs()],
            "baselineWeights",
            ("*.candidates.*.label",),
        ),
        "weight_proposal.generate": Scorer(
            lambda p: [weight_proposal.generate(_pool(p), job, provider=None) for job in probe_jobs()],
            "weights",
        ),
        "winnability.assess_winnability": Scorer(
            lambda p: [winnability.assess_winnability([c for _cid, c in _pool(p)], job) for job in probe_jobs()],
            "eligible",
        ),
        # -- profile / transform: the inputs every scorer above is fed --
        "transform.build_match_candidate": Scorer(
            lambda p: _mc(p), "skills", ("label", "experienceHighlights")
        ),
        "transform.apply_preferences": Scorer(
            lambda p: transform.apply_preferences(
                _mc(p), {"salaryFloor": 60000, "locations": ["Praha"], "workModes": ["hybrid"]}
            ),
            "preferredLocations",
            ("label", "experienceHighlights"),
        ),
        "transform.compute_potential": Scorer(lambda p: {"v": transform.compute_potential(p)}, "v"),
        "profile.completeness": Scorer(lambda p: {"v": profile_mod.completeness(p)}, "v"),
        "profile.completeness_gaps": Scorer(lambda p: {"v": profile_mod.completeness_gaps(p)}, "v"),
        "profile.normalize_profile": Scorer(
            lambda p: {"result": profile_mod.normalize_profile(p), "profile": p},
            "completeness",
            ("profile.displayName", "profile.evidence.*.title", "profile.evidence.*.text"),
        ),
        "soft_signals.build_soft_signal_panel": Scorer(
            lambda p: soft_signals.build_soft_signal_panel(p), "antipatterns", ("displayName",)
        ),
        "jobseeker.deterministic_suggestions": Scorer(
            lambda p: {
                "v": jobseeker.deterministic_suggestions(
                    "I was responsible for various tasks. I worked on many projects with a team.", p, "en"
                )
            },
            "v",
        ),
        "live_case.apply_live_case": Scorer(
            lambda p: live_case.apply_live_case(
                p, role, case, CaseEvaluation(summary="Handled it well."), transfer
            ),
            "evidence",
            ("0.displayName", "0.evidence.*.title", "0.evidence.*.text"),
        ),
        "live_case.apply_interview_case": Scorer(
            lambda p: live_case.apply_interview_case(p, role, case, scorecard),
            "evidence",
            ("0.displayName", "0.evidence.*.title", "0.evidence.*.text"),
        ),
        # -- the v1 CV-analysis half --
        "insights.build_evidence_trace": Scorer(
            lambda p: insights.build_evidence_trace(_v1(p), score, salary), "skills"
        ),
        "interview.build_interview_kit": Scorer(
            lambda p: interview.build_interview_kit(_v1(p), fit),
            "questions",
            # The kit is coaching prose that addresses the candidate by name (the
            # summary line and the "would thrive" question); the question SELECTION
            # is what must not move, and it is compared.
            ("summary", "questions.*.question"),
        ),
    }


@functools.lru_cache(maxsize=1)
def _registry() -> dict[str, Scorer]:
    return _scorers()


def __getattr__(attr: str) -> Any:
    # SCORERS is built on first access (PEP 562): the runners import the whole
    # engine, and matching_eval imports this module for PERTURBATIONS alone.
    if attr == "SCORERS":
        return _registry()
    raise AttributeError(attr)

# Name -> why no runner is owed. A reason names either the registered scorer that
# covers the function transitively ("covered by <module.func>" — checked) or why
# its output cannot carry a score.
EXEMPT: dict[str, str] = {
    "automation.draft_outreach": (
        "addresses the candidate by name by design; outreach prose that gates nothing — "
        "the decision it follows is covered by automation.screen_candidate"
    ),
    "automation.draft_rejection": (
        "addresses the candidate by name by design; a letter written AFTER the decision, "
        "gating nothing — the decision is covered by automation.screen_candidate"
    ),
    "automation.draft_offer": (
        "addresses the candidate by name by design; an offer letter written after the hire "
        "decision, gating nothing"
    ),
}


# ---------------------------------------------------------------------------
# Canonical payloads, carriers, checks
# ---------------------------------------------------------------------------

REDACTED = "«name»"


def _default(obj: Any) -> Any:
    if hasattr(obj, "model_dump"):
        return obj.model_dump(mode="json", by_alias=True)
    if dataclasses.is_dataclass(obj) and not isinstance(obj, type):
        return dataclasses.asdict(obj)
    if isinstance(obj, (set, frozenset)):
        return sorted(obj, key=str)
    return str(obj)


def to_jsonable(value: Any) -> Any:
    return json.loads(json.dumps(value, default=_default, ensure_ascii=False))


def _replace(node: Any, needles: tuple[str, ...]) -> Any:
    if isinstance(node, str):
        for needle in needles:
            if needle:
                node = node.replace(needle, REDACTED)
        return node
    if isinstance(node, list):
        return [_replace(x, needles) for x in node]
    if isinstance(node, dict):
        return {_replace(k, needles): _replace(v, needles) for k, v in node.items()}
    return node


def _at(node: Any, parts: list[str], fn: Callable[[Any], Any]) -> tuple[Any, int]:
    """Apply ``fn`` to every node at ``parts`` (``*`` = any item/key); return hits."""
    if not parts:
        return fn(node), 1
    head, rest = parts[0], parts[1:]
    hits = 0
    if isinstance(node, dict):
        keys = list(node) if head == "*" else [head] if head in node else []
        for k in keys:
            node[k], h = _at(node[k], rest, fn)
            hits += h
    elif isinstance(node, list):
        if head == "*":
            idx: Iterable[int] = range(len(node))
        elif head.isdigit() and int(head) < len(node):
            idx = [int(head)]
        else:
            idx = []
        for i in idx:
            node[i], h = _at(node[i], rest, fn)
            hits += h
    return node, hits


def redact(payload: Any, carriers: Iterable[str], needles: tuple[str, ...]) -> tuple[Any, dict[str, int]]:
    """Remove ``needles`` from the declared carrier paths ONLY. Returns the payload
    and, per carrier, how many nodes it matched (0 = a dead declaration)."""
    hits: dict[str, int] = {}
    for carrier in carriers:
        payload, hits[carrier] = _at(payload, carrier.split("."), lambda n: _replace(n, needles))
    return payload, hits


def find_paths(node: Any, needle: str, path: str = "$") -> list[str]:
    """Every JSON path whose string value (or dict key) contains ``needle``."""
    needle = needle.casefold()
    found: list[str] = []
    if isinstance(node, str):
        if needle in node.casefold():
            found.append(path)
    elif isinstance(node, list):
        for i, x in enumerate(node):
            found += find_paths(x, needle, f"{path}[{i}]")
    elif isinstance(node, dict):
        for k, v in node.items():
            if needle in str(k).casefold():
                found.append(f"{path}.{k} (key)")
            found += find_paths(v, needle, f"{path}.{k}")
    return found


def first_diff(a: Any, b: Any, path: str = "$") -> str | None:
    if type(a) is not type(b):
        return f"{path}: {a!r:.60} != {b!r:.60}"
    if isinstance(a, dict):
        for k in sorted(set(a) | set(b), key=str):
            if k not in a or k not in b:
                return f"{path}.{k}: present on one side only"
            d = first_diff(a[k], b[k], f"{path}.{k}")
            if d:
                return d
        return None
    if isinstance(a, list):
        if len(a) != len(b):
            return f"{path}: length {len(a)} != {len(b)}"
        for i, (x, y) in enumerate(zip(a, b)):
            d = first_diff(x, y, f"{path}[{i}]")
            if d:
                return d
        return None
    return None if a == b else f"{path}: {a!r:.60} != {b!r:.60}"


def raw_payload(scorer: Scorer, name: str, prose: str | None = None) -> dict[str, Any]:
    """``{base: runner output}`` as plain JSON, nothing removed."""
    return {base: to_jsonable(scorer.run(_base_profile(base, name, prose))) for base in BASES}


def canonical(scorer: Scorer, p: Perturbation) -> tuple[bytes, dict[str, Any]]:
    """Canonical bytes of the payload with the name/prose removed from the declared
    carriers only (each carrier is applied under every base)."""
    raw = raw_payload(scorer, p.name, p.prose)
    needles = tuple(x for x in (p.prose, p.name) if x)
    carriers = [f"{base}.{c}" for base in BASES for c in scorer.carriers]
    red, _hits = redact(raw, carriers, needles)
    return json.dumps(red, ensure_ascii=False, sort_keys=True).encode("utf-8"), red


def neutrality_problems(
    name: str, scorer: Scorer, perturbations: Iterable[Perturbation] = PERTURBATIONS
) -> list[str]:
    """One line per perturbation whose canonical payload differs from its control."""
    problems: list[str] = []
    controls: dict[tuple[str, str | None], tuple[bytes, Any]] = {}
    for p in perturbations:
        c = control_for(p)
        key = (c.name, c.prose)
        if key not in controls:
            controls[key] = canonical(scorer, c)
        base_bytes, base_obj = controls[key]
        got_bytes, got_obj = canonical(scorer, p)
        if got_bytes != base_bytes:
            where = first_diff(base_obj, got_obj) or "bytes differ"
            problems.append(f"{name} x {p.axis} ({p.name!r}): the name moved the payload at {where}")
    return problems


def liveness_problems(name: str, scorer: Scorer) -> list[str]:
    """Non-vacuity: a non-empty payload per base that carries the scored key, and
    every declared carrier still matches something (no dead declaration)."""
    problems: list[str] = []
    raw = raw_payload(scorer, BASELINE_NAME)
    for base in BASES:
        if raw[base] in (None, [], {}, ""):
            problems.append(f"{name}: empty baseline payload for base {base!r}")
    if not _has_key(raw, scorer.scored_key):
        problems.append(f"{name}: baseline payload never carries the scored key {scorer.scored_key!r}")
    for carrier in scorer.carriers:
        _p, hits = redact(raw, [f"*.{carrier}"], (BASELINE_NAME,))
        if not hits[f"*.{carrier}"]:
            problems.append(f"{name}: declared carrier {carrier!r} matches nothing in the payload")
    return problems


def _has_key(node: Any, key: str) -> bool:
    if isinstance(node, dict):
        return key in node or any(_has_key(v, key) for v in node.values())
    if isinstance(node, list):
        return any(_has_key(v, key) for v in node)
    return False


def leak_problems(name: str, scorer: Scorer) -> list[str]:
    """Second-carrier check: the sentinel name found at any undeclared path."""
    sentinel_name = f"{SENTINEL} Uniqueson"
    _bytes, red = canonical(scorer, Perturbation("sentinel", sentinel_name))
    return [f"{name}: the name reached undeclared path {path}" for path in find_paths(red, SENTINEL)]


def completeness_problems(
    discovered: set[str], scorers: Iterable[str], exempt: dict[str, str]
) -> list[str]:
    """``SCORERS | EXEMPT == discovered``, disjoint; exemption reasons are real."""
    registered = set(scorers)
    problems: list[str] = []
    for fn in sorted(discovered - registered - set(exempt)):
        problems.append(f"{fn}: candidate-typed and unproven — register a runner in SCORERS or an EXEMPT reason")
    for fn in sorted((registered | set(exempt)) - discovered):
        problems.append(f"{fn}: registered but no longer a candidate-typed public function on the tree")
    for fn in sorted(registered & set(exempt)):
        problems.append(f"{fn}: both registered and exempt")
    for fn, reason in sorted(exempt.items()):
        if len((reason or "").strip()) < 20:
            problems.append(f"{fn}: exemption reason under 20 chars — say why no proof is owed")
        for cited in _cited(reason):
            if cited not in registered:
                problems.append(f"{fn}: exemption cites {cited!r} as coverage, which is not a registered scorer")
    return problems


def _cited(reason: str) -> list[str]:
    out: list[str] = []
    marker = "covered by "
    for chunk in reason.split(marker)[1:]:
        token = chunk.split()[0].strip(".,;:()`'\"") if chunk.split() else ""
        if "." in token:
            out.append(token)
    return out
