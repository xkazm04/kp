"""repoSeed prose -> a MATERIALIZED seed: real starter files for the take-home.

The honest LLM-test verdict on the dev case (docs/DEV_D3_HARDENING_FINDINGS.md,
STUDENT_SCORING_CONCEPT.md): with ``repoSeed`` as PROSE the take-home is
essay-grading a model can ace — there is nothing concrete the tasks, the cover
probes, or the evaluation can point INTO. Materializing the seed turns the case
into work on concrete starting materials: a small file tree (code for software
roles; documents/data/spreadsheet-shaped CSVs for other domains) whose contents
deliberately carry the case's traps, so the submission is a reviewable DIFF
against shared ground truth rather than free prose.

LLM path (Claude CLI) + deterministic template fallback, mirroring
interview_scenario.py. One seed per CASE: generated after approval, identical for
every candidate — comparability is structural here too.
"""

from __future__ import annotations

import json
import re
from typing import Any

from .models import CaseScenario, RoleSpec

SEED_PROMPT_VERSION = "seed-materializer-v1"

# Bounds keep the seed a STARTING point, not a project: small enough to read in
# minutes, big enough that the tasks have something real to act on.
MAX_SEED_FILES = 12
MAX_FILE_CHARS = 6_000
# The forced decisions log (case-design v4): the submission is a record of
# decisions, and the template ships IN the seed so keeping it isn't optional-feeling.
DECISIONS_FILE = "DECISIONS.md"

_SYSTEM = (
    "You materialize the starting materials for a work-sample exercise into a small, concrete file "
    "tree the candidate begins from. Software roles get runnable-looking code with a deliberate seam "
    "matching the case's probes; non-software roles get documents/data in their own formats (markdown, "
    "CSV). Never include solutions or reveal that any trap is deliberate. Output strict JSON only."
)


def _safe_path(path: str) -> str | None:
    """A seed path must stay a plain repo-relative file: forward slashes, no
    traversal, no absolute paths, no drive letters — these files get written to
    disk by the TS side, so the sanitizing happens HERE at the producing seam."""
    p = (path or "").strip().replace("\\", "/")
    if not p or p.startswith("/") or re.match(r"^[A-Za-z]:", p):
        return None
    parts = [seg for seg in p.split("/") if seg not in ("", ".")]
    if not parts or any(seg == ".." for seg in parts):
        return None
    return "/".join(parts)


def _decisions_template(case: CaseScenario) -> str:
    tasks = case.tasks or ["the work"]
    lines = [
        "# DECISIONS",
        "",
        "Record every significant decision while you work — this log is part of the submission",
        "and the follow-up conversation builds on it. Using AI tools is expected and never",
        "penalised; what matters is that the decisions are YOURS.",
        "",
        "For each entry: what you decided, the alternative you rejected, and why.",
        "",
    ]
    for i, task in enumerate(tasks[:6], start=1):
        lines += [f"## Task {i}: {task.strip()}", "", "- Decision:", "- Rejected alternative:", "- Why:", ""]
    return "\n".join(lines)


def deterministic_seed(case: CaseScenario, role: RoleSpec) -> dict:
    """Template seed — never fails, and honest about what it is: the prose
    materials become README context plus the forced decisions log. No fake code
    is fabricated deterministically (a wrong-language stub would be worse than
    none); the LLM path is what makes the seed concrete."""
    title = case.title or role.title or "Work sample"
    readme = "\n".join(
        [
            f"# {title}",
            "",
            (case.brief or "").strip() or "See the assignment brief.",
            "",
            "## Starting materials",
            "",
            (case.repo_seed or "").strip() or "Described in the brief.",
            "",
            "## Tasks",
            "",
            *[f"{i}. {t.strip()}" for i, t in enumerate(case.tasks or [], start=1)],
            "",
            f"Timebox: ~{case.timebox_hours:g}h. Keep `{DECISIONS_FILE}` up to date as you go.",
        ]
    )
    return {
        "caseId": case.id,
        "promptVersion": SEED_PROMPT_VERSION,
        "files": [
            {"path": "README.md", "contents": readme},
            {"path": DECISIONS_FILE, "contents": _decisions_template(case)},
        ],
        "note": "deterministic skeleton — starting materials remain prose; the LLM path materializes concrete files",
    }


def build_prompt(case: CaseScenario, role: RoleSpec) -> str:
    ctx = {
        "role": {"title": role.title, "seniority": role.seniority, "roleFamily": role.role_family,
                 "mustHaves": role.must_haves},
        "case": {
            "title": case.title,
            "brief": case.brief,
            "repoSeed": case.repo_seed,
            "tasks": case.tasks,
            # Internal: the traps the seed's CONTENTS should quietly carry.
            "coverProbes": [
                {"id": cp.id, "kind": cp.kind, "where": cp.where, "reveals": cp.reveals}
                for cp in case.cover_probes
            ],
        },
    }
    return (
        "Materialize the starting materials ('repoSeed') of this work-sample case into a concrete file "
        "tree the candidate will receive. Use ONLY these facts:\n"
        f"{json.dumps(ctx, ensure_ascii=False, indent=2)}\n\n"
        "Rules:\n"
        f"- At most {MAX_SEED_FILES} files, each at most {MAX_FILE_CHARS} characters. Small but REAL: for a "
        "software role, compilable-looking source files in the case's stated stack with a working seam where "
        "each task applies; for a non-software role, documents/data in the role's own formats (markdown briefs, "
        "CSV extracts, plan outlines).\n"
        "- Where a coverProbe names a location ('where'), the corresponding file content should quietly EXHIBIT "
        "that trap (the ambiguity, the legacy wart, the unverified assumption) — never label or hint at it.\n"
        f"- Always include README.md (brief + tasks + timebox) and {DECISIONS_FILE} (a decision-log template "
        "with one section per task: decision / rejected alternative / why).\n"
        "- Repo-relative forward-slash paths only. No solutions anywhere.\n"
        'Return JSON: { "files": [ { "path": str, "contents": str } ], "note": str (one line on what the seed '
        "contains) }. JSON only."
    )


def _coerce(payload: Any, case: CaseScenario, role: RoleSpec) -> dict:
    """Validate/clamp the LLM tree onto the contract; fall back per-file rather
    than wholesale. The decisions log is guaranteed present either way."""
    out = deterministic_seed(case, role)
    if not isinstance(payload, dict):
        return out
    files: list[dict[str, str]] = []
    seen: set[str] = set()
    for f in payload.get("files") or []:
        if not isinstance(f, dict):
            continue
        path = _safe_path(str(f.get("path") or ""))
        contents = str(f.get("contents") or "")
        if not path or not contents.strip() or path.casefold() in seen:
            continue
        seen.add(path.casefold())
        files.append({"path": path, "contents": contents[:MAX_FILE_CHARS]})
        if len(files) >= MAX_SEED_FILES:
            break
    if not files:
        return out
    if not any(f["path"].casefold() == DECISIONS_FILE.casefold() for f in files):
        if len(files) >= MAX_SEED_FILES:
            files = files[: MAX_SEED_FILES - 1]
        files.append({"path": DECISIONS_FILE, "contents": _decisions_template(case)})
    note = str(payload.get("note") or "").strip()
    return {
        "caseId": case.id,
        "promptVersion": SEED_PROMPT_VERSION,
        "files": files,
        "note": note or "materialized starting files",
    }


def materialize_seed(
    case: CaseScenario, role: RoleSpec, *, lang: str = "en", provider: Any | None = None
) -> tuple[dict, str]:
    """Return (seed dict, source 'llm'|'deterministic'). Mirrors scenario_from_case.

    ``lang`` (DEVP5) is the candidate-facing language of the prose the seed
    carries (the README + DECISIONS scaffolding the candidate reads); file
    contents / code stay verbatim. The deterministic fallback is English-only."""
    if provider is None:
        return deterministic_seed(case, role), "deterministic"
    try:
        from ..i18n import language_directive

        prompt = f"{build_prompt(case, role)}\n\n{language_directive(lang)}"
        payload = provider.complete_json(prompt, system=_SYSTEM)
        return _coerce(payload, case, role), "llm"
    except Exception:
        return deterministic_seed(case, role), "deterministic"
