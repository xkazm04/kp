"""App master — the role contract for the accountable owner of one application.

Phase P1 of ``docs/concepts/app-master.md``: before the intake shape, the repo
scan or the Personas hire handler exist, the *contract* has to. Three schemas
live here and nothing else — no LLM call, no I/O, no side effects:

* :class:`AppMasterSpec` — §2.4 of the concept. Supersedes the flat agent spec
  for this role: the app binding (which repo), the objectives (which KPIs), the
  mandate (how far the holder may go), the cadence (what wakes them), the budget
  (with a reservation policy and a drain-on-cap rule) and the tenure. The
  population-specific blocks (``agent`` / ``human``) are the small tail; the rest
  of the spec is identical for a human and an agent holder, which is what makes
  the hiring decision "human or agent for this app" comparable at all.
* :class:`RepoDossier` — §3 step 2. What a machine read off the codebase before
  the role was composed. Carries ``source`` (``llm`` when Claude Code read the
  repo, ``heuristic`` when the keyless file-walk produced the same shape) plus
  per-field provenance, because a dossier is an *inference about someone else's
  codebase* and must look like one.
* :class:`PerformanceBackbone` + :func:`backbone_score` — §2.3's closing rule:
  the performance score is deterministic and attributable; an LLM narrates it and
  never rescores it. :func:`backbone_score` therefore returns per-rule
  contributions, never a bare number, and refuses to read an *unmeasured* input
  as a good one (an unmetered budget is not zero spend; an unmeasured KPI is not
  a missed target either — it is a coverage gap, and it is reported as one).

:func:`coerce_app_master_spec` follows the house prompt-and-coerce discipline
(see :mod:`pipeline.jobfit.agentfit`): every field is defaulted so a model can
half-fill the shape, and the strictness lives in the coercer — connectors are
intersected with the supplied catalog, the mandate rung is clamped into the
range v1 allows, and unknown forbidden-change classes are dropped. Nothing is
dropped silently: every intervention lands in ``coercionNotes`` on the returned
spec and in the module logger.

Implemented in this phase: the schemas, the coercer, the backbone function and
their codegen export. NOT implemented: the intake shape, the repo scan that
fills a dossier, dispatch, and Personas-side enforcement (P2–P4).
"""

from __future__ import annotations

import logging
import math
from typing import Any, Literal

from pydantic import Field, field_validator

from .models import _Base

APP_MASTER_PROMPT_VERSION = "app-master-v1"

# The rubric the levels in docs/features/app-master/README.md belong to. Stamped
# on every spec at write time: sharpening an anchor changes what every future
# rating means, and an unversioned change silently rewrites the past ones too.
APP_MASTER_RUBRIC_VERSION = "app-master-rubric-v1"

_LOG = logging.getLogger(__name__)

# Who can hold the role. "either" = the fit transform has not decided yet (or the
# role is genuinely open to both) — never a guess dressed as a decision.
POPULATIONS = ("human", "agent", "either")

# The mandate scope ladder (registry: machine-paced-delivery / scoped-delivery-access).
#   0 read           — observe and report, no writes at all
#   1 retry          — re-run existing work (a failed job, a flaky gate), no new change
#   2 open branch/PR — author a change and propose it; a human merges
#   3 deploy/merge   — NEVER granted to an agent holder in v1
#   4 change gates   — NEVER granted to any holder; gates are the instrument the
#                      work is judged by, and a holder who can edit them is
#                      grading their own exam
SCOPE_RUNGS = (0, 1, 2, 3, 4)
MAX_AGENT_SCOPE_RUNG = 2
DEFAULT_SCOPE_RUNG = 2

# Closed vocabulary. Each class names a move that makes a *red* signal *green*
# without making the underlying thing true — the "repair by deletion" family. A
# proposal touching one of these is blocked at dispatch and counted as a
# violation; it is never silently rewritten into an allowed shape.
FORBIDDEN_CHANGE_CLASSES = (
    "test_deletion_or_skip",            # deleting/skipping/xfailing a test to pass
    "suppression_directive",            # eslint-disable, # type: ignore, @ts-expect-error, noqa
    "gate_configuration",               # editing the gate/CI config the work is judged by
    "dependency_bump_to_satisfy_check",  # moving a version to make a check stop complaining
    "credentials_or_permissions",       # secrets, tokens, IAM, auth config
    "delivery_configuration",           # deploy targets, release channels, feature-flag rollout
)

ForbiddenClass = Literal[
    "test_deletion_or_skip",
    "suppression_directive",
    "gate_configuration",
    "dependency_bump_to_satisfy_check",
    "credentials_or_permissions",
    "delivery_configuration",
]

TRIGGER_KINDS = ("schedule", "pr", "kpi_tick")
OBJECTIVE_DIRECTIONS = ("gte", "lte")
RESERVATION_POLICIES = ("estimate", "fixed")

# What a dossier field's value traces to. "llm" = Claude Code read the repo;
# "heuristic" = the deterministic file-walk derived it; "unknown" = neither could
# establish it (a disclosed hole, never a filled one).
DOSSIER_PROVENANCE = ("llm", "heuristic", "unknown")


# --------------------------------------------------------------------------- #
# AppMasterSpec (§2.4)
# --------------------------------------------------------------------------- #


class RoleBlock(_Base):
    """Who the role is, independent of who holds it."""

    title: str = "App master"
    population: Literal["human", "agent", "either"] = "either"
    seniority: str = "senior"          # jobs.py seniority vocabulary; "a step past senior"
    rubric_version: str = APP_MASTER_RUBRIC_VERSION


class RepoRef(_Base):
    """Where the app's code is. ``url`` for a remote, ``rootPath`` for a local
    checkout (accepted only behind the ``KP_APP_MASTER_REPO_ROOTS`` allow-list —
    P2 enforces that; the schema only carries the value)."""

    url: str | None = None
    root_path: str | None = None
    main_branch: str = "main"


class AppBinding(_Base):
    """The app the holder is accountable for. The binding a JD has never had."""

    name: str = ""
    repo: RepoRef = Field(default_factory=RepoRef)
    context_map_ref: str | None = None   # e.g. "context-map.json"
    dossier_id: str | None = None        # RepoDossier.dossier_id this spec was composed from


class Objective(_Base):
    """One line of the value ledger: a KPI with a baseline, a target and a window.

    The holder's standing question is "which of these can I move this cycle?".
    ``baseline``/``target`` are nullable on purpose — an objective whose baseline
    nobody measured is a real state, and writing 0 there would invent one."""

    kpi_key: str = ""
    label: str = ""
    baseline: float | None = None
    target: float | None = None
    unit: str = ""
    direction: Literal["gte", "lte"] = "gte"
    window_days: int = 30


class Mandate(_Base):
    """How far the holder may go on their own — data, not prose in a prompt."""

    scope_rung: int = DEFAULT_SCOPE_RUNG
    forbidden_classes: list[ForbiddenClass] = Field(
        default_factory=lambda: list(FORBIDDEN_CHANGE_CLASSES)
    )
    approval_gates: list[str] = Field(default_factory=list)  # gate commands a proposal must pass
    owner: str = ""                                          # the human who reviews and answers

    @field_validator("scope_rung")
    @classmethod
    def _rung_in_range(cls, v: int) -> int:
        # Rungs 3 (deploy/merge) and 4 (change gates) are not grantable in v1 —
        # for either population. The schema refuses them rather than storing a
        # rung the enforcement layer would then have to remember to ignore.
        if v not in (0, 1, 2):
            raise ValueError(
                f"scopeRung {v} is not grantable in v1 (0=read, 1=retry, 2=open branch/PR; "
                "3=deploy/merge and 4=change gates are never granted)"
            )
        return v


class Trigger(_Base):
    """What wakes the holder. Cadence is triggers, not a turn cap: a turn cap
    measures how long something ran, a trigger states when it should start."""

    kind: Literal["schedule", "pr", "kpi_tick"] = "schedule"
    config: dict[str, Any] = Field(default_factory=dict)  # e.g. {"cron": "0 2 * * *"}


class Cadence(_Base):
    triggers: list[Trigger] = Field(default_factory=list)


class Budget(_Base):
    """Monthly ceiling with a reservation policy. ``onCap`` is a closed literal
    because there is exactly one honest behaviour at the cap: drain (finish the
    in-flight unit, then stop and say so). A cap-hit pauses; it never
    "completes"."""

    monthly_usd: float = Field(default=0.0, ge=0)
    reservation_policy: Literal["estimate", "fixed"] = "estimate"
    on_cap: Literal["drain"] = "drain"


class Tenure(_Base):
    """Probation → active → retirement, written at hire (creation-names-reaper)."""

    probation_days: int = 30
    review_cadence_days: int = 30
    retire_criteria: list[str] = Field(default_factory=list)


class AgentBlock(_Base):
    """Agent population only. Mirrors the existing ``agentfit`` spec fields so an
    ``AppMasterSpec`` projects losslessly onto the shipped bridge payload
    (``app/_lib/agent-hire/bridge-client.ts``)."""

    name: str = ""
    mission: str = ""
    system_prompt_draft: str = ""
    connectors: list[str] = Field(default_factory=list)
    max_turns: int | None = None


class HumanBlock(_Base):
    """Human population only — the handles into the JD/comp side of kp."""

    jd_slug: str = ""
    comp_band_ref: str = ""


class AppMasterSpec(_Base):
    """§2.4. The dispatch payload gains this beside ``spec`` (additive — the old
    flat agent shape keeps working)."""

    schema_version: int = 1
    role: RoleBlock = Field(default_factory=RoleBlock)
    app: AppBinding = Field(default_factory=AppBinding)
    objectives: list[Objective] = Field(default_factory=list)
    mandate: Mandate = Field(default_factory=Mandate)
    cadence: Cadence = Field(default_factory=Cadence)
    budget: Budget = Field(default_factory=Budget)
    tenure: Tenure = Field(default_factory=Tenure)
    agent: AgentBlock | None = None
    human: HumanBlock | None = None
    # Every intervention :func:`coerce_app_master_spec` made, in the order made.
    # A dropped connector or a clamped rung is a fact about the composition and
    # is carried with the spec, not swallowed by the coercer.
    coercion_notes: list[str] = Field(default_factory=list)
    prompt_version: str = APP_MASTER_PROMPT_VERSION


# --------------------------------------------------------------------------- #
# RepoDossier (§3 step 2)
# --------------------------------------------------------------------------- #


class RepoSize(_Base):
    files: int = 0
    source_files: int = 0
    contexts: int = 0


class DossierContext(_Base):
    """One feature area as the repo itself declares it (kp: ``context-map.json``)."""

    name: str = ""
    category: str = ""
    file_count: int = 0


class DossierFinding(_Base):
    """A hot spot or a risk area: what was looked at, and why it stood out."""

    ref: str = ""      # path / context name / command
    note: str = ""     # one line of why


class RepoDossier(_Base):
    """What a machine read off the codebase before the role was composed.

    ``source`` is the whole-dossier path (``llm`` = Claude Code read the repo in
    place; ``heuristic`` = the keyless deterministic walk over manifests and the
    context map). ``fieldProvenance`` refines it per field, because a mostly-LLM
    dossier can still have heuristic ``size`` and an unknown ``maintainerLoad`` —
    and a hole must read as a hole (absence-of-evidence-is-not-evidence)."""

    dossier_id: str = ""
    repo: RepoRef = Field(default_factory=RepoRef)
    source: Literal["llm", "heuristic"] = "heuristic"
    generated_at: str = ""             # ISO-8601, set by the producer (P2)
    stack: list[str] = Field(default_factory=list)
    size: RepoSize = Field(default_factory=RepoSize)
    declared_gates: list[str] = Field(default_factory=list)     # the repo's OWN gate commands
    contexts: list[DossierContext] = Field(default_factory=list)
    hot_spots: list[DossierFinding] = Field(default_factory=list)
    risk_areas: list[DossierFinding] = Field(default_factory=list)
    existing_kpis: list[str] = Field(default_factory=list)
    maintainer_load_estimate: str = ""  # prose ("~1.5 devs, bursty"), never a fabricated number
    candidate_objectives: list[Objective] = Field(default_factory=list)
    # field name -> DOSSIER_PROVENANCE. A field absent from the map reads
    # "unknown", which is the honest default for anything nobody stamped.
    field_provenance: dict[str, str] = Field(default_factory=dict)
    prompt_version: str = APP_MASTER_PROMPT_VERSION


# --------------------------------------------------------------------------- #
# PerformanceBackbone (§2.3 closing rule)
# --------------------------------------------------------------------------- #


class KpiDelta(_Base):
    """Movement on one objective inside its window. ``measured`` false = nobody
    read the meter; that is a coverage gap, NOT a missed target and NOT a hit."""

    kpi_key: str = ""
    baseline: float | None = None
    current: float | None = None
    target: float | None = None
    direction: Literal["gte", "lte"] = "gte"
    window_days: int = 30
    measured: bool = False


class PerformanceBackbone(_Base):
    """The deterministic performance record for one review window.

    Every field is a count, a rate or a flag that some system already emits — no
    field here is a judgment. The narration layer reads this; it never writes it."""

    window_days: int = 30
    proposals_opened: int = 0
    proposals_merged: int = 0
    proposals_reverted: int = 0
    # None = the gate outcome was not recorded for the window. Distinct from 0.0
    # (every proposal failed its gates), and scored differently.
    gate_pass_rate: float | None = None
    forbidden_class_violations: int = 0
    kpi_deltas: list[KpiDelta] = Field(default_factory=list)
    budget_reserved_usd: float = 0.0
    budget_settled_usd: float = 0.0
    # True = spend was not metered for this window. "Unmeasured is not free": a
    # missing meter must never score as perfect budget adherence.
    budget_unmeasured: bool = False
    # False = the activity ledger and the proposal record disagree (A3's failure).
    ledger_consistent: bool = True


# Rule weights. Deliberately flat integers that sum to 100 so a contribution is
# readable without a calculator, and so re-weighting is a visible diff.
_BACKBONE_RULES: tuple[tuple[str, str, int], ...] = (
    ("delivery", "Proposals merged out of proposals opened", 25),
    ("durability", "Merged proposals that stayed merged", 15),
    ("gates", "Gate pass rate on proposals", 20),
    ("objectives", "Objectives moved toward target in window", 25),
    ("budget", "Spend settled within the reservation", 10),
    ("ledger", "Activity ledger consistent with the proposal record", 5),
)


def _rule_weight(key: str) -> int:
    for k, _label, w in _BACKBONE_RULES:
        if k == key:
            return w
    raise KeyError(key)  # pragma: no cover - the table is closed


def _finite(value: Any) -> float | None:
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        return None
    return float(value) if math.isfinite(value) else None


def _kpi_moved(delta: KpiDelta) -> bool | None:
    """Did this objective move toward its target? ``None`` = cannot tell."""
    if not delta.measured:
        return None
    baseline = _finite(delta.baseline)
    current = _finite(delta.current)
    target = _finite(delta.target)
    if current is None or target is None:
        return None
    if delta.direction == "gte":
        if current >= target:
            return True
        return False if baseline is None else current > baseline
    if current <= target:
        return True
    return False if baseline is None else current < baseline


def backbone_score(b: PerformanceBackbone) -> dict[str, Any]:
    """Score a backbone deterministically and attributably.

    Pure: the same backbone always yields the same dict, and every number in it
    is traceable to one named rule. Returns::

        {
          "rules": [ {rule, label, weight, measured, value, contribution, reason} ],
          "gates": [ {gate, passed, value, reason} ],
          "scoredWeight": int,   # weight of the rules that could be scored
          "totalWeight": int,    # weight of every rule
          "coverage": float,     # scoredWeight / totalWeight — how much was measurable
          "score": float | None, # 0..1 over the SCORED weight only; None if nothing scored
          "unmeasured": [rule keys],
          "verdict": "pass" | "fail" | "incomplete",
          "rubricVersion": ...
        }

    Two disciplines are load-bearing:

    * **Unmeasured is not zero.** A rule with no reading is reported with
      ``measured: false`` and ``contribution: null``, is excluded from both the
      numerator and the denominator, and is listed in ``unmeasured``. An
      unmetered budget therefore cannot score as perfect adherence, and an
      unmeasured KPI is neither a hit nor a miss.
    * **A gate is not a weight.** A forbidden-class violation is a stated gate on
      the decision, not an invisible multiplier inside an average: it fails the
      verdict outright and stays visible in ``gates``.
    """
    rules: list[dict[str, Any]] = []

    def add(key: str, *, measured: bool, value: Any, fraction: float | None, reason: str) -> None:
        label = next(lbl for k, lbl, _w in _BACKBONE_RULES if k == key)
        weight = _rule_weight(key)
        rules.append(
            {
                "rule": key,
                "label": label,
                "weight": weight,
                "measured": measured,
                "value": value,
                "contribution": None if fraction is None else round(fraction * weight, 3),
                "reason": reason,
            }
        )

    # 1. delivery — merged / opened.
    opened = max(0, b.proposals_opened)
    merged = max(0, b.proposals_merged)
    if opened == 0:
        add("delivery", measured=False, value=None, fraction=None,
            reason="no proposals were opened in the window — nothing to rate")
    else:
        ratio = min(1.0, merged / opened)
        add("delivery", measured=True, value=round(ratio, 3), fraction=ratio,
            reason=f"{merged} of {opened} proposals merged")

    # 2. durability — merged proposals that were not reverted.
    reverted = max(0, b.proposals_reverted)
    if merged == 0:
        add("durability", measured=False, value=None, fraction=None,
            reason="no proposals merged in the window — nothing could revert")
    else:
        kept = max(0, merged - reverted) / merged
        add("durability", measured=True, value=round(kept, 3), fraction=min(1.0, kept),
            reason=f"{reverted} of {merged} merged proposals reverted")

    # 3. gates — pass rate on the repo's own declared gates.
    rate = _finite(b.gate_pass_rate)
    if rate is None:
        add("gates", measured=False, value=None, fraction=None,
            reason="gate outcomes were not recorded for the window")
    else:
        clamped = min(1.0, max(0.0, rate))
        add("gates", measured=True, value=round(clamped, 3), fraction=clamped,
            reason=f"gate pass rate {clamped:.0%} on proposals")

    # 4. objectives — the value ledger. Unmeasured objectives leave the
    #    denominator (coverage gap), they do not score as misses.
    verdicts = [_kpi_moved(d) for d in b.kpi_deltas]
    readable = [v for v in verdicts if v is not None]
    unread = len(verdicts) - len(readable)
    if not readable:
        add("objectives", measured=False, value=None, fraction=None,
            reason=(
                "no objective had a reading in the window"
                if verdicts
                else "no objectives were recorded for the window"
            ))
    else:
        moved = sum(1 for v in readable if v)
        fraction = moved / len(readable)
        add("objectives", measured=True, value=round(fraction, 3), fraction=fraction,
            reason=(
                f"{moved} of {len(readable)} measured objectives moved toward target"
                + (f"; {unread} unmeasured and excluded" if unread else "")
            ))

    # 5. budget — settled against what was reserved. An unmetered window is not a
    #    cheap one: it is withheld from the score and disclosed.
    reserved = max(0.0, _finite(b.budget_reserved_usd) or 0.0)
    settled = max(0.0, _finite(b.budget_settled_usd) or 0.0)
    if b.budget_unmeasured:
        add("budget", measured=False, value=None, fraction=None,
            reason="spend was not metered for this window — unmeasured is not zero spend")
    elif reserved <= 0:
        if settled > 0:
            add("budget", measured=True, value=round(settled, 2), fraction=0.0,
                reason=f"${settled:.2f} settled against no reservation")
        else:
            add("budget", measured=False, value=None, fraction=None,
                reason="nothing was reserved and nothing was spent — nothing to rate")
    else:
        overrun = max(0.0, settled - reserved) / reserved
        fraction = max(0.0, 1.0 - overrun)
        add("budget", measured=True, value=round(settled / reserved, 3), fraction=fraction,
            reason=f"${settled:.2f} settled against ${reserved:.2f} reserved")

    # 6. ledger — the self-report matches the record (A3).
    add("ledger", measured=True, value=b.ledger_consistent,
        fraction=1.0 if b.ledger_consistent else 0.0,
        reason=(
            "activity ledger matches the proposal record"
            if b.ledger_consistent
            else "activity ledger disagrees with the proposal record"
        ))

    violations = max(0, b.forbidden_class_violations)
    gates = [
        {
            "gate": "forbidden_classes",
            "passed": violations == 0,
            "value": violations,
            "reason": (
                "no proposal touched a forbidden-change class"
                if violations == 0
                else f"{violations} proposal(s) touched a forbidden-change class"
            ),
        },
        {
            "gate": "mandate_rung",
            "passed": True,
            "value": MAX_AGENT_SCOPE_RUNG,
            "reason": "rungs 3 (deploy/merge) and 4 (change gates) are never granted in v1",
        },
    ]

    scored_weight = sum(r["weight"] for r in rules if r["measured"])
    total_weight = sum(r["weight"] for r in rules)
    earned = sum(r["contribution"] or 0.0 for r in rules if r["measured"])
    score = round(earned / scored_weight, 4) if scored_weight else None
    unmeasured = [r["rule"] for r in rules if not r["measured"]]

    if any(not g["passed"] for g in gates):
        verdict = "fail"
    elif score is None or unmeasured:
        verdict = "incomplete"
    else:
        verdict = "pass"

    return {
        "rules": rules,
        "gates": gates,
        "scoredWeight": scored_weight,
        "totalWeight": total_weight,
        "coverage": round(scored_weight / total_weight, 4) if total_weight else 0.0,
        "score": score,
        "unmeasured": unmeasured,
        "verdict": verdict,
        "rubricVersion": APP_MASTER_RUBRIC_VERSION,
    }


# --------------------------------------------------------------------------- #
# Coercion (house prompt-and-coerce discipline — see agentfit.coerce)
# --------------------------------------------------------------------------- #


def _dict(raw: Any, key: str) -> dict[str, Any]:
    value = raw.get(key) if isinstance(raw, dict) else None
    return value if isinstance(value, dict) else {}


def _str(value: Any, *, limit: int = 400) -> str:
    return "" if value is None else str(value).strip()[:limit]


def _int(value: Any) -> int | None:
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        return None
    return int(value) if math.isfinite(float(value)) else None


def coerce_app_master_spec(raw: dict, catalog: list[str]) -> AppMasterSpec:
    """Turn a model's (or an operator's) half-filled object into a valid spec.

    Defensive by construction — the same posture as
    :func:`pipeline.jobfit.agentfit.analyze_agent_fit`'s ``coerce``:

    * ``connectors`` are intersected with ``catalog`` (case-insensitively, and
      re-spelled to the catalog's own casing). A connector the catalog does not
      contain cannot reach a dispatch payload.
    * ``mandate.scopeRung`` is clamped into 0..2 — a model that "granted" rung 3
      or 4 gets rung 2 and a note, never the rung it asked for.
    * unknown ``forbiddenClasses`` are dropped (the vocabulary is closed); an
      empty result falls back to the full list, because "no forbidden classes"
      is never what a failed parse means.
    * ``population`` outside the vocabulary becomes ``either`` — the disclosed
      unknown, not a guessed classification.

    Every intervention is appended to ``coercionNotes`` and logged.
    """
    notes: list[str] = []
    if not isinstance(raw, dict):
        notes.append("input was not an object — composed the default spec")
        raw = {}

    catalog_names = {
        str(name).strip().casefold(): str(name).strip()
        for name in (catalog or [])
        if str(name or "").strip()
    }

    # role
    role_in = _dict(raw, "role")
    population = _str(role_in.get("population")).lower()
    if population not in POPULATIONS:
        if population:
            notes.append(f"population {population!r} is outside the vocabulary — recorded as 'either'")
        population = "either"
    role = RoleBlock(
        title=_str(role_in.get("title")) or "App master",
        population=population,  # type: ignore[arg-type]
        seniority=_str(role_in.get("seniority")) or "senior",
        rubric_version=_str(role_in.get("rubricVersion") or role_in.get("rubric_version"))
        or APP_MASTER_RUBRIC_VERSION,
    )

    # app
    app_in = _dict(raw, "app")
    repo_in = _dict(app_in, "repo")
    repo = RepoRef(
        url=_str(repo_in.get("url"), limit=500) or None,
        root_path=_str(repo_in.get("rootPath") or repo_in.get("root_path"), limit=500) or None,
        main_branch=_str(repo_in.get("mainBranch") or repo_in.get("main_branch"), limit=200) or "main",
    )
    if repo.url is None and repo.root_path is None:
        notes.append("no repo url or rootPath was supplied — the app binding is incomplete")
    app = AppBinding(
        name=_str(app_in.get("name")),
        repo=repo,
        context_map_ref=_str(app_in.get("contextMapRef") or app_in.get("context_map_ref")) or None,
        dossier_id=_str(app_in.get("dossierId") or app_in.get("dossier_id")) or None,
    )

    # objectives
    objectives: list[Objective] = []
    for entry in raw.get("objectives") or []:
        if not isinstance(entry, dict):
            continue
        key = _str(entry.get("kpiKey") or entry.get("kpi_key"), limit=120)
        if not key:
            continue
        direction = _str(entry.get("direction")).lower()
        if direction not in OBJECTIVE_DIRECTIONS:
            direction = "gte"
        window = _int(entry.get("windowDays") or entry.get("window_days"))
        objectives.append(
            Objective(
                kpi_key=key,
                label=_str(entry.get("label")),
                baseline=_finite(entry.get("baseline")),
                target=_finite(entry.get("target")),
                unit=_str(entry.get("unit"), limit=40),
                direction=direction,  # type: ignore[arg-type]
                window_days=window if window and window > 0 else 30,
            )
        )
    if not objectives:
        notes.append("no objectives survived coercion — the value ledger is empty")

    # mandate
    mandate_in = _dict(raw, "mandate")
    rung = _int(mandate_in.get("scopeRung") if "scopeRung" in mandate_in else mandate_in.get("scope_rung"))
    if rung is None:
        rung = DEFAULT_SCOPE_RUNG
    elif rung > MAX_AGENT_SCOPE_RUNG:
        notes.append(
            f"scopeRung {rung} is not grantable in v1 (deploy/merge and gate changes are never "
            f"granted) — clamped to {MAX_AGENT_SCOPE_RUNG}"
        )
        rung = MAX_AGENT_SCOPE_RUNG
    elif rung < 0:
        notes.append(f"scopeRung {rung} is below the ladder — clamped to 0")
        rung = 0
    classes: list[str] = []
    dropped: list[str] = []
    for entry in mandate_in.get("forbiddenClasses") or mandate_in.get("forbidden_classes") or []:
        name = _str(entry, limit=80).lower()
        if not name:
            continue
        if name in FORBIDDEN_CHANGE_CLASSES:
            if name not in classes:
                classes.append(name)
        elif name not in dropped:
            dropped.append(name)
    if dropped:
        notes.append(
            "dropped forbidden-change class(es) outside the closed vocabulary: " + ", ".join(sorted(dropped))
        )
    if not classes:
        classes = list(FORBIDDEN_CHANGE_CLASSES)
        notes.append("no recognised forbidden-change classes were supplied — applied the full list")
    raw_gates = mandate_in.get("approvalGates") or mandate_in.get("approval_gates") or []
    mandate = Mandate(
        scope_rung=rung,
        forbidden_classes=classes,  # type: ignore[arg-type]
        approval_gates=[g for g in (_str(x, limit=200) for x in raw_gates) if g],
        owner=_str(mandate_in.get("owner"), limit=200),
    )
    if not mandate.owner:
        notes.append("no mandate owner was named — escalations have nowhere to go")

    # cadence
    triggers: list[Trigger] = []
    for entry in _dict(raw, "cadence").get("triggers") or []:
        if not isinstance(entry, dict):
            continue
        kind = _str(entry.get("kind")).lower()
        if kind not in TRIGGER_KINDS:
            notes.append(f"dropped trigger of unknown kind {kind or '(empty)'!r}")
            continue
        config = entry.get("config")
        triggers.append(Trigger(kind=kind, config=config if isinstance(config, dict) else {}))  # type: ignore[arg-type]
    cadence = Cadence(triggers=triggers)

    # budget
    budget_in = _dict(raw, "budget")
    monthly = _finite(budget_in.get("monthlyUsd") if "monthlyUsd" in budget_in else budget_in.get("monthly_usd"))
    if monthly is None or monthly < 0:
        if monthly is not None:
            notes.append(f"negative monthlyUsd {monthly} — reset to 0")
        monthly = 0.0
    policy = _str(budget_in.get("reservationPolicy") or budget_in.get("reservation_policy")).lower()
    if policy not in RESERVATION_POLICIES:
        policy = "estimate"
    budget = Budget(
        monthly_usd=round(monthly, 2),
        reservation_policy=policy,  # type: ignore[arg-type]
        on_cap="drain",
    )

    # tenure
    tenure_in = _dict(raw, "tenure")
    probation = _int(tenure_in.get("probationDays") or tenure_in.get("probation_days"))
    review = _int(tenure_in.get("reviewCadenceDays") or tenure_in.get("review_cadence_days"))
    tenure = Tenure(
        probation_days=probation if probation and probation > 0 else 30,
        review_cadence_days=review if review and review > 0 else 30,
        retire_criteria=[
            c for c in (_str(x, limit=300) for x in tenure_in.get("retireCriteria") or tenure_in.get("retire_criteria") or [])
            if c
        ],
    )

    # population tails
    agent_block: AgentBlock | None = None
    if isinstance(raw.get("agent"), dict):
        agent_in = raw["agent"]
        wanted = [_str(c, limit=120) for c in agent_in.get("connectors") or []]
        connectors: list[str] = []
        for name in wanted:
            resolved = catalog_names.get(name.casefold())
            if resolved and resolved not in connectors:
                connectors.append(resolved)
        rejected = sorted({c for c in wanted if c and c.casefold() not in catalog_names})
        if rejected:
            notes.append("dropped connector(s) not in the catalog: " + ", ".join(rejected))
        max_turns = _int(agent_in.get("maxTurns") or agent_in.get("max_turns"))
        if max_turns is not None and not (0 < max_turns <= 1000):
            max_turns = None
        agent_block = AgentBlock(
            name=_str(agent_in.get("name"), limit=120),
            mission=_str(agent_in.get("mission"), limit=1000),
            system_prompt_draft=_str(
                agent_in.get("systemPromptDraft") or agent_in.get("system_prompt_draft"), limit=4000
            ),
            connectors=connectors,
            max_turns=max_turns,
        )

    human_block: HumanBlock | None = None
    if isinstance(raw.get("human"), dict):
        human_in = raw["human"]
        human_block = HumanBlock(
            jd_slug=_str(human_in.get("jdSlug") or human_in.get("jd_slug"), limit=200),
            comp_band_ref=_str(human_in.get("compBandRef") or human_in.get("comp_band_ref"), limit=200),
        )

    if role.population == "agent" and agent_block is None:
        notes.append("population is 'agent' but no agent block was supplied")
    if role.population == "human" and human_block is None:
        notes.append("population is 'human' but no human block was supplied")

    for note in notes:
        _LOG.warning("coerce_app_master_spec: %s", note)

    return AppMasterSpec(
        role=role,
        app=app,
        objectives=objectives,
        mandate=mandate,
        cadence=cadence,
        budget=budget,
        tenure=tenure,
        agent=agent_block,
        human=human_block,
        coercion_notes=notes,
    )
