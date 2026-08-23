"""RoleBrief — the canonical structured statement of a hiring need.

Phase 0 of the role-intake concept (docs/concepts/role-intake-dialog.md): before
any intake dialog exists, the schema has to. A RoleBrief is what the dialog will
fill, what the JD is rendered FROM, and what scoring/interviews/devcases read as
the reference for the whole hire.

Design principles (why this is not just a bigger RoleSpec):

* **Minimal required spine, open everything else.** Needs vary too much for a
  fixed form — "add a power unit to an existing squad" states five fields; a
  senior role with a complex story needs room the schema cannot predict. The
  spine (title/seniority/family) is the only structure every brief shares;
  everything situational lives in ``facets``, an open-vocabulary list with
  SUGGESTED (never enforced) keys.
* **Must vs valuable is graded, not binary.** Requirements reuse the existing
  matching vocabulary (``kind``: must_have | nice_to_have, ``hardness``:
  prerequisite | learnable — pinned to :class:`~pipeline.jobfit.jobs.JobRequirement`)
  plus a 0..1 ``weight`` inside each kind, so "must know Czech" and "must have
  seen Kafka once" stop being the same claim.
* **Every value knows where it came from.** ``provenance`` (stated | inferred |
  default) + ``confidence`` per requirement/facet make the brief trustworthy as
  a hiring-long reference and keep the keyless path honest: a template default
  can never masquerade as something the requestor said. ``source_turn`` links a
  facet back to the intake-dialog turn that produced it (None until the dialog
  ships).

The models are LLM-coercion-friendly (every field defaulted); the strictness
lives in :func:`coerce_role_brief`, following the house prompt-and-coerce
discipline (see devcase/design.py)."""

from __future__ import annotations

from typing import Any

from pydantic import Field

from .jobs import JobRequirement
from .models import _Base

# Where a value came from. "stated" = the requestor said it (or typed it into a
# form field); "inferred" = a model derived it from what was said/pasted;
# "default" = a template/taxonomy default filled the hole. Deliberately distinct
# from taxonomy.UI_PROVENANCE (candidate-evidence provenance) — different axis.
BRIEF_PROVENANCE = ("stated", "inferred", "default")

# How much a facet matters to the hire. "core" = losing it changes who you hire;
# "valuable" = shapes ranking/interviews but isn't a gate; "context" = background
# that helps a reader (or an interviewer brief) understand the role.
FACET_IMPORTANCE = ("core", "valuable", "context")

# SUGGESTED facet keys — a vocabulary for UIs and the future intake dialog to
# offer, NEVER a validator: any key is legal. Keep kebab-free snake_case so keys
# survive the camelCase wire alias untouched.
SUGGESTED_FACET_KEYS = (
    "team_context",       # who they join, team size/shape, who they work with
    "why_now",            # why the role exists / what triggered the hire
    "urgency",            # timeline pressure, cost of the seat staying empty
    "headcount",          # how many hires this brief covers
    "budget_band",        # compensation expectation (feeds the CZK layer)
    "success_90d",        # what "great after 90 days" looks like (also success_criteria)
    "growth_path",        # where the role can grow
    "work_environment",   # tooling, process, codebase/materials reality
    "location_constraints",
    "interview_loop",     # intended loop shape / who decides
    "dealbreaker_context",  # the story behind a hard requirement
    "grade_label",        # the requestor's own grade vocabulary ("Band 5", "AfC 6")
                          # when it maps to no seniority enum token — verbatim, stated
    "codebase_dossier",   # what a machine read off the app's own repo before the role
                          # was composed (stack, declared gates, hot spots, candidate
                          # objectives) — App master intake, always `inferred`
                          # (docs/features/app-master/README.md)
)

_KINDS = ("must_have", "nice_to_have")
_HARDNESS = ("prerequisite", "learnable")


class BriefRequirement(_Base):
    """One graded requirement. ``kind``/``hardness`` are pinned to the
    JobRequirement vocabulary so a brief projects losslessly onto the matching
    engine; ``weight`` ranks WITHIN a kind (0..1, higher = more decisive)."""

    skill: str = ""
    kind: str = "must_have"          # must_have | nice_to_have (JobRequirement.kind)
    hardness: str = "prerequisite"   # prerequisite | learnable (JobRequirement.hardness)
    weight: float = 0.5              # 0..1 relative importance within its kind
    rationale: str = ""              # why THIS role needs it, in the requestor's terms
    provenance: str = "inferred"     # BRIEF_PROVENANCE
    confidence: float = 0.5          # 0..1 trust in the value
    source_turn: int | None = None   # transcript turn index the value traces to (defensibility)


class BriefFacet(_Base):
    """A dynamic, open-vocabulary slot for everything the spine can't predict."""

    key: str = ""                    # SUGGESTED_FACET_KEYS or anything else
    label: str = ""                  # human heading (localized by the producer)
    value: str = ""                  # prose value
    importance: str = "valuable"     # FACET_IMPORTANCE
    provenance: str = "inferred"     # BRIEF_PROVENANCE
    confidence: float = 0.5          # 0..1 trust in the value
    source_turn: int | None = None   # intake-dialog turn index that produced it


class RoleBrief(_Base):
    """The structured hiring need. Superset of the legacy RoleSpec — see
    :func:`role_brief_from_spec` for the lift."""

    schema_version: int = 1
    title: str = ""
    seniority: str = "medior"        # junior | medior | senior | lead
    role_family: str = "software_engineering"
    languages: list[str] = Field(default_factory=list)
    summary: str = ""                # one-paragraph narrative of the need
    responsibilities: list[str] = Field(default_factory=list)
    success_criteria: list[str] = Field(default_factory=list)  # "great after 90 days"
    requirements: list[BriefRequirement] = Field(default_factory=list)
    facets: list[BriefFacet] = Field(default_factory=list)
    # Provenance for the SPINE scalars (keys: "title" | "seniority" |
    # "role_family"; values: BRIEF_PROVENANCE). Requirements/facets carry
    # per-entry provenance; without this map the schema defaults ("medior",
    # "software_engineering") were indistinguishable from captured values and
    # rendered as if the requestor said them (UAT 2026-08-07-intake,
    # L1-CONV-3 — convergent across all three Characters). A missing key
    # reads as "default".
    spine_provenance: dict[str, str] = Field(default_factory=dict)
    prompt_version: str = ""


# -- coercion (the strict half of prompt-and-coerce) -------------------------


def _text(value: Any) -> str:
    return str(value).strip() if isinstance(value, (str, int, float)) and not isinstance(value, bool) else ""


def _text_list(value: Any) -> list[str]:
    if not isinstance(value, list):
        return []
    return [t for t in (_text(v) for v in value) if t]


def _clamp01(value: Any, default: float) -> float:
    try:
        return min(1.0, max(0.0, float(value)))
    except (TypeError, ValueError):
        return default


def _vocab(value: Any, allowed: tuple[str, ...], default: str) -> str:
    token = _text(value).lower().replace("-", "_").replace(" ", "_")
    return token if token in allowed else default


def coerce_role_brief(payload: Any) -> RoleBrief:
    """Field-by-field floor for untrusted (LLM or client) RoleBrief payloads:
    off-vocabulary enums fall to defaults, floats clamp to 0..1, falsy entries
    drop. Accepts camelCase or snake_case keys. Never raises."""

    raw = payload if isinstance(payload, dict) else {}

    def pick(*keys: str) -> Any:
        for key in keys:
            if key in raw:
                return raw[key]
        return None

    def req(entry: Any) -> BriefRequirement | None:
        if not isinstance(entry, dict):
            return None
        skill = _text(entry.get("skill"))
        if not skill:
            return None
        source_turn = entry.get("source_turn", entry.get("sourceTurn"))
        return BriefRequirement(
            skill=skill,
            kind=_vocab(entry.get("kind"), _KINDS, "must_have"),
            hardness=_vocab(entry.get("hardness"), _HARDNESS, "prerequisite"),
            weight=_clamp01(entry.get("weight"), 0.5),
            rationale=_text(entry.get("rationale")),
            provenance=_vocab(entry.get("provenance"), BRIEF_PROVENANCE, "inferred"),
            confidence=_clamp01(entry.get("confidence"), 0.5),
            source_turn=source_turn if isinstance(source_turn, int) and not isinstance(source_turn, bool) else None,
        )

    def facet(entry: Any) -> BriefFacet | None:
        if not isinstance(entry, dict):
            return None
        value = _text(entry.get("value"))
        if not value:
            return None
        source_turn = entry.get("source_turn", entry.get("sourceTurn"))
        return BriefFacet(
            key=_text(entry.get("key")),
            label=_text(entry.get("label")),
            value=value,
            importance=_vocab(entry.get("importance"), FACET_IMPORTANCE, "valuable"),
            provenance=_vocab(entry.get("provenance"), BRIEF_PROVENANCE, "inferred"),
            confidence=_clamp01(entry.get("confidence"), 0.5),
            source_turn=source_turn if isinstance(source_turn, int) and not isinstance(source_turn, bool) else None,
        )

    requirements = pick("requirements")
    facets = pick("facets")
    spine_raw = pick("spine_provenance", "spineProvenance")
    spine = {
        key: _vocab(value, BRIEF_PROVENANCE, "default")
        for key, value in (spine_raw.items() if isinstance(spine_raw, dict) else [])
        if key in ("title", "seniority", "role_family")
    }
    return RoleBrief(
        title=_text(pick("title")),
        seniority=_vocab(pick("seniority"), ("junior", "medior", "senior", "lead"), "medior"),
        role_family=_text(pick("role_family", "roleFamily")) or "software_engineering",
        languages=_text_list(pick("languages")),
        summary=_text(pick("summary")),
        responsibilities=_text_list(pick("responsibilities")),
        success_criteria=_text_list(pick("success_criteria", "successCriteria")),
        requirements=[r for r in (req(e) for e in (requirements if isinstance(requirements, list) else [])) if r],
        facets=[f for f in (facet(e) for e in (facets if isinstance(facets, list) else [])) if f],
        spine_provenance=spine,
        prompt_version=_text(pick("prompt_version", "promptVersion")),
    )


# -- bridges -----------------------------------------------------------------


def role_brief_from_spec(spec: Any, *, provenance: str = "inferred", confidence: float = 0.6) -> RoleBrief:
    """Lift a legacy RoleSpec payload (flat mustHaves/niceToHaves lists — the JD
    builder's design-chain output) into a graded RoleBrief. The grading is a
    DEFAULT, not a judgement: musts arrive as prerequisite/weight 0.8, nices as
    learnable/weight 0.4, and every requirement carries the caller's provenance
    so a reader can tell the lift from a requestor's stated grading."""

    raw = spec if isinstance(spec, dict) else {}
    prov = _vocab(provenance, BRIEF_PROVENANCE, "inferred")
    conf = _clamp01(confidence, 0.6)

    def lifted(skills: Any, kind: str, hardness: str, weight: float) -> list[BriefRequirement]:
        return [
            BriefRequirement(skill=s, kind=kind, hardness=hardness, weight=weight, provenance=prov, confidence=conf)
            for s in _text_list(skills)
        ]

    spine: dict[str, str] = {}
    if _text(raw.get("title")):
        spine["title"] = prov
    if _vocab(raw.get("seniority"), ("junior", "medior", "senior", "lead"), "") in ("junior", "medior", "senior", "lead"):
        spine["seniority"] = prov
    if _text(raw.get("role_family", raw.get("roleFamily"))):
        spine["role_family"] = prov
    return RoleBrief(
        title=_text(raw.get("title")),
        seniority=_vocab(raw.get("seniority"), ("junior", "medior", "senior", "lead"), "medior"),
        role_family=_text(raw.get("role_family", raw.get("roleFamily"))) or "software_engineering",
        spine_provenance=spine,
        languages=_text_list(raw.get("languages")),
        responsibilities=_text_list(raw.get("responsibilities")),
        requirements=(
            lifted(raw.get("must_haves", raw.get("mustHaves")), "must_have", "prerequisite", 0.8)
            + lifted(raw.get("nice_to_haves", raw.get("niceToHaves")), "nice_to_have", "learnable", 0.4)
        ),
        prompt_version=_text(raw.get("prompt_version", raw.get("promptVersion"))),
    )


def brief_job_requirements(brief: RoleBrief) -> list[JobRequirement]:
    """Project the brief's graded requirements onto the matching engine's
    JobRequirement (weight/rationale/provenance don't survive — the matcher
    reads skill/kind/hardness; the brief remains the richer source)."""

    return [
        JobRequirement(skill=r.skill, kind=r.kind, hardness=r.hardness)
        for r in brief.requirements
        if r.skill
    ]
