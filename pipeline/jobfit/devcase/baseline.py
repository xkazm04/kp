"""LLM-era controls #6 — the naive one-shot baseline.

At approval (freeze time, beside the seed/scenario) the case is solved ONCE by a
bare model told to do exactly what a delegating candidate would do: paste the
brief, generate everything in one pass, no reading, no questions, no verification.
The result is frozen per case (dev_cases.baseline_json) as the comparison target
every submission is diffed against (artifact_checks.baseline_similarity).

The baseline answers "what does zero human judgment look like on THIS case?".
Similarity to it is NEVER a penalty — it aims the authorship interview at whatever
the human did (or didn't) add beyond the bare model.

No deterministic fallback that fabricates a solution: a template baseline would
poison every downstream comparison. Degraded mode = {"solutions": []} (check
simply reports unavailable).
"""
from __future__ import annotations

import json
import logging
from typing import Any

from .models import CaseScenario, RoleSpec
from .seed_materializer import MAX_FILE_CHARS, MAX_SEED_FILES, _safe_path

_LOG = logging.getLogger(__name__)

BASELINE_PROMPT_VERSION = "baseline-solve-v1"

_SYSTEM = (
    "You simulate a candidate who fully delegates a work-sample exercise to an AI in ONE shot: read the brief "
    "and starting files once, then produce the complete finished submission immediately. Do NOT simulate "
    "careful judgment: no clarifying questions, no flagging of oddities, take every starting file at face "
    "value, fill the decision log with plausible but generic entries. Produce competent-looking average work — "
    "what a capable model emits unattended. Output strict JSON only."
)

_KEYS = ("files", "note")


def solve_baseline(case: CaseScenario, role: RoleSpec, seed: dict | None, *, provider: Any | None = None) -> tuple[dict, str]:
    """One one-shot solution over the case + materialized seed. Returns
    ({solutions: [{files, note}], promptVersion}, source)."""
    from .provenance import generate_with_fallback

    ctx = {
        "role": {"title": role.title, "seniority": role.seniority},
        "case": {"title": case.title, "brief": case.brief, "tasks": case.tasks, "timeboxHours": case.timebox_hours},
        "startingFiles": [
            {"path": f.get("path"), "contents": str(f.get("contents") or "")[:MAX_FILE_CHARS]}
            for f in ((seed or {}).get("files") or [])
            if isinstance(f, dict)
        ][:MAX_SEED_FILES],
    }
    prompt = (
        "Produce the finished one-shot submission for this exercise: the complete edited file tree (return every "
        "starting file, edited where the tasks demand, plus any new files).\n"
        f"{json.dumps(ctx, ensure_ascii=False, indent=2)}\n\n"
        f'Return JSON: {{ "files": [ {{ "path": str, "contents": str }} ] (at most {MAX_SEED_FILES + 4} files, each at most '
        f'{MAX_FILE_CHARS} chars), "note": str (one line) }}. JSON only.'
    )

    def deterministic() -> dict:
        return {"files": [], "note": "baseline unavailable (no LLM) — comparisons will report unavailable"}

    def coerce(payload: Any) -> dict:
        det = deterministic()
        if not isinstance(payload, dict):
            return det
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
            if len(files) >= MAX_SEED_FILES + 4:
                break
        return {"files": files, "note": str(payload.get("note") or "").strip() or "one-shot baseline"} if files else det

    result, source = generate_with_fallback(provider, prompt, _SYSTEM, deterministic, coerce, _LOG, expected_keys=_KEYS)
    solutions = [result] if result.get("files") else []
    out: dict[str, Any] = {"solutions": solutions, "promptVersion": BASELINE_PROMPT_VERSION}
    # Lift the runner's fallback reason (if any) onto the envelope artifact so the
    # caller's audit trail can tell "LLM down" from "clean empty".
    if "fallbackReason" in result:
        out["fallbackReason"] = result.pop("fallbackReason")
    return out, source
