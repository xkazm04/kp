"""Generate the TypeScript Zod schema from the Pydantic AnalysisResult model.

The Pydantic models in ``models.py`` are the single source of truth for the
analysis result shape. This module exports their JSON Schema (with camelCase
aliases) and transpiles it into Zod definitions written to
``app/_lib/schemas.generated.ts``. Run via ``python -m pipeline.jobfit.codegen``
(also wired into the ``npm run build`` step).
"""

from __future__ import annotations

import json
import sys
from pathlib import Path
from typing import Any

from .models import AnalysisResult


ROOT = Path(__file__).resolve().parents[2]
OUTPUT = ROOT / "app" / "_lib" / "schemas.generated.ts"

HEADER = """// AUTO-GENERATED — DO NOT EDIT.
// Source of truth: pipeline/jobfit/models.py
// Regenerate with: python -m pipeline.jobfit.codegen

import { z } from "zod";
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
        # `model_dump(exclude_none=True)` only drops fields whose type allows
        # None — list/dict/string defaults always serialize. Mirror that here:
        # `.optional()` reflects "may be missing on the wire", not "has a
        # Python default".
        if _is_nullable(sub, defs):
            zod += ".optional()"
        lines.append(f"{pad}{name}: {zod}")
    body = ",\n".join(lines)
    return f"z.object({{\n{body}\n{close_pad}}})"


def _is_nullable(sub: dict[str, Any], defs: dict[str, Any]) -> bool:
    sub = _resolve_ref(sub, defs)
    if "anyOf" in sub:
        return any(_is_nullable(s, defs) for s in sub["anyOf"])
    return sub.get("type") == "null"


def render() -> str:
    schema = AnalysisResult.model_json_schema(by_alias=True, mode="serialization")
    defs = schema.pop("$defs", {})
    body = _emit(schema, defs, indent=0)
    return (
        f"{HEADER}\n"
        f"export const analysisResultSchema = {body};\n\n"
        f"export type AnalysisResult = z.infer<typeof analysisResultSchema>;\n"
    )


def write() -> Path:
    OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    OUTPUT.write_text(render(), encoding="utf-8")
    return OUTPUT


def main(argv: list[str] | None = None) -> int:
    args = list(argv or sys.argv[1:])
    if "--check" in args:
        existing = OUTPUT.read_text(encoding="utf-8") if OUTPUT.exists() else ""
        if existing != render():
            sys.stderr.write(
                "schemas.generated.ts is out of date. Run `python -m pipeline.jobfit.codegen`.\n"
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
    path = write()
    sys.stdout.write(f"wrote {path.relative_to(ROOT)}\n")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
