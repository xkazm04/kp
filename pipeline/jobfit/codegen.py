"""Generate the TypeScript artifacts the frontend shares with the Python pipeline.

The Pydantic models in ``models.py`` are the single source of truth for the
analysis result shape; this module exports their JSON Schema (with camelCase
aliases) and transpiles it into Zod definitions written to
``app/_lib/schemas.generated.ts``.

It also generates ``app/_lib/taxonomy.generated.ts`` — the evidence/skill/
provenance dropdown lists — from the Python taxonomy (``profile.EVIDENCE_KINDS``,
``profile.SKILL_LEVELS`` and ``taxonomy.UI_PROVENANCE``) so those enums have ONE
source of truth instead of a hand-maintained TS copy that silently drifts
(idea-ba28f11b).

Run via ``python -m pipeline.jobfit.codegen`` (also wired into ``npm run build``);
``--check`` (``npm run schemas:check``) fails CI if either file is out of date.
"""

from __future__ import annotations

import json
import sys
from pathlib import Path
from typing import Any

from .devcase.models import RoleSpec
from .models import AnalysisResult
from .profile import EVIDENCE_KINDS, SKILL_LEVELS
from .rolebrief import RoleBrief
from .taxonomy import UI_PROVENANCE


ROOT = Path(__file__).resolve().parents[2]
OUTPUT = ROOT / "app" / "_lib" / "schemas.generated.ts"
TAXONOMY_OUTPUT = ROOT / "app" / "_lib" / "taxonomy.generated.ts"

HEADER = """// AUTO-GENERATED — DO NOT EDIT.
// Source of truth: pipeline/jobfit/models.py
// Regenerate with: python -m pipeline.jobfit.codegen

import { z } from "zod";
"""

TAXONOMY_HEADER = """// AUTO-GENERATED — DO NOT EDIT.
// Source of truth: pipeline/jobfit/profile.py (EVIDENCE_KINDS, SKILL_LEVELS)
// and pipeline/jobfit/taxonomy.py (UI_PROVENANCE).
// Regenerate with: python -m pipeline.jobfit.codegen
"""


def _resolve_ref(node: dict[str, Any], defs: dict[str, Any]) -> dict[str, Any]:
    if "$ref" in node:
        name = node["$ref"].rsplit("/", 1)[-1]
        return defs[name]
    return node


def _emit(node: dict[str, Any], defs: dict[str, Any], indent: int = 0) -> str:
    """Convert a JSON Schema node into Zod source."""
    node = _resolve_ref(node, defs)

    if "anyOf" in node:
        non_null = [s for s in node["anyOf"] if s.get("type") != "null"]
        # `Optional[X]` collapses to its non-null branch; `.optional()` is added
        # by the caller using the parent's `required` set.
        if len(non_null) == 1:
            return _emit(non_null[0], defs, indent)
        parts = [_emit(s, defs, indent) for s in non_null]
        return f"z.union([{', '.join(parts)}])"

    # `Literal[...]` of string values serializes as an `enum`; emit a matching
    # Zod enum so the union of states is enforced (and inferred) on the client.
    if "enum" in node and all(isinstance(v, str) for v in node["enum"]):
        members = ", ".join(json.dumps(v) for v in node["enum"])
        return f"z.enum([{members}])"

    t = node.get("type")
    if t == "string":
        return "z.string()"
    if t in ("integer", "number"):
        return "z.number()"
    if t == "boolean":
        return "z.boolean()"
    if t == "array":
        items = node.get("items", {"type": "string"})
        return f"z.array({_emit(items, defs, indent)})"
    if t == "object":
        if "properties" in node:
            return _emit_object(node, defs, indent)
        ap = node.get("additionalProperties")
        if isinstance(ap, dict):
            return f"z.record(z.string(), {_emit(ap, defs, indent)})"
        return "z.record(z.string(), z.unknown())"
    return "z.unknown()"


def _emit_object(node: dict[str, Any], defs: dict[str, Any], indent: int) -> str:
    pad = "  " * (indent + 1)
    close_pad = "  " * indent
    lines: list[str] = []
    for name, sub in node["properties"].items():
        zod = _emit(sub, defs, indent + 1)
        # A field whose Python type allows `None` can reach the wire two ways:
        # absent (the serializer passed `exclude_none=True`) or present as JSON
        # `null` (it did not). Emit `.nullish()` — accepts both `undefined` and
        # `null` — so the cross-language contract does NOT silently depend on
        # every serializer remembering `exclude_none=True`. List/dict/string
        # defaults are not nullable and always serialize, so they stay required.
        # The round-trip is pinned by app/_lib/schemas-null-contract.test.ts.
        if _is_nullable(sub, defs):
            zod += ".nullish()"
        lines.append(f"{pad}{name}: {zod}")
    body = ",\n".join(lines)
    return f"z.object({{\n{body}\n{close_pad}}})"


def _is_nullable(sub: dict[str, Any], defs: dict[str, Any]) -> bool:
    sub = _resolve_ref(sub, defs)
    if "anyOf" in sub:
        return any(_is_nullable(s, defs) for s in sub["anyOf"])
    return sub.get("type") == "null"


# Every Pydantic model exported to the TS side: (model, exported schema const,
# exported inferred type). RoleSpec/RoleBrief single-source the role shapes the
# JD builder and role-intake flows share with Python (idea-dcf2460d).
_EXPORTED_MODELS = (
    (AnalysisResult, "analysisResultSchema", "AnalysisResult"),
    (RoleSpec, "roleSpecSchema", "RoleSpec"),
    (RoleBrief, "roleBriefSchema", "RoleBrief"),
)


def render() -> str:
    parts = [HEADER]
    for model, const_name, type_name in _EXPORTED_MODELS:
        schema = model.model_json_schema(by_alias=True, mode="serialization")
        defs = schema.pop("$defs", {})
        body = _emit(schema, defs, indent=0)
        parts.append(
            f"\nexport const {const_name} = {body};\n\n"
            f"export type {type_name} = z.infer<typeof {const_name}>;\n"
        )
    return "".join(parts)


def _emit_string_list(name: str, values: tuple[str, ...]) -> str:
    """A ``export const NAME = ["a", "b"];`` whose inferred type is ``string[]``,
    matching the hand-written lists this replaces (consumers ``.map`` over them)."""
    items = "".join(f"  {json.dumps(v)},\n" for v in values)
    return f"export const {name} = [\n{items}];"


def render_taxonomy() -> str:
    lists = [
        _emit_string_list("EVIDENCE_KINDS", tuple(EVIDENCE_KINDS)),
        _emit_string_list("SKILL_LEVELS", tuple(SKILL_LEVELS)),
        _emit_string_list("PROVENANCE", tuple(UI_PROVENANCE)),
    ]
    return f"{TAXONOMY_HEADER}\n" + "\n\n".join(lists) + "\n"


# (path, renderer) for every generated TS file — keeps write() and --check in lockstep.
_GENERATED = (
    (OUTPUT, render),
    (TAXONOMY_OUTPUT, render_taxonomy),
)


def write() -> list[Path]:
    written: list[Path] = []
    for path, renderer in _GENERATED:
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(renderer(), encoding="utf-8")
        written.append(path)
    return written


def main(argv: list[str] | None = None) -> int:
    args = list(argv or sys.argv[1:])
    if "--check" in args:
        def _is_stale(path: Path, renderer) -> bool:
            try:
                current = path.read_text(encoding="utf-8") if path.exists() else ""
            except (OSError, UnicodeDecodeError):
                # A corrupt / non-UTF-8 / locked generated file is "out of date" (run
                # codegen), NOT a crash — keep --check's contract of exit 0 or the
                # actionable stale message, never a raw UnicodeDecodeError traceback.
                return True
            return current != renderer()

        stale = [path for path, renderer in _GENERATED if _is_stale(path, renderer)]
        if stale:
            names = ", ".join(p.relative_to(ROOT).as_posix() for p in stale)
            sys.stderr.write(
                f"{names} out of date. Run `python -m pipeline.jobfit.codegen`.\n"
            )
            return 1
        return 0
    if "--print-json-schema" in args:
        json.dump(
            AnalysisResult.model_json_schema(by_alias=True, mode="serialization"),
            sys.stdout,
            indent=2,
        )
        return 0
    for path in write():
        sys.stdout.write(f"wrote {path.relative_to(ROOT)}\n")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
