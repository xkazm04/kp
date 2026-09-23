"""Generate the TypeScript artifacts the frontend shares with the Python pipeline.

The Pydantic models in ``models.py`` are the single source of truth for the
analysis result shape; this module exports their JSON Schema (with camelCase
aliases) and transpiles it into Zod definitions written to
``app/_lib/schemas.generated.ts``.

It also generates ``app/_lib/taxonomy.generated.ts`` — the evidence/skill/
provenance dropdown lists — from the Python taxonomy (``profile.EVIDENCE_KINDS``,
``profile.SKILL_LEVELS`` and ``taxonomy.UI_PROVENANCE``) so those enums have ONE
source of truth instead of a hand-maintained TS copy that silently drifts
(idea-ba28f11b). The devcase timebox bounds ride along for the same reason: the
cap on a candidate's unpaid work was enforced in the Python designer and
re-typed as a different literal in the TS approve route, so the two drifted.

And it generates ``app/_lib/contract-constants.generated.ts`` — the contract
NUMBERS both languages enforce (scorecard-notes budget, screening-volume tiers,
calibration floor and bin count, interview-kit caps, letter cap, probe threshold)
— from ``CONTRACT_CONSTANTS`` below. Each number used to be typed a second time
as a TS literal and held equal only by a regex over the TS source; the TS home
modules now re-export the generated value instead.

Run via ``python -m pipeline.jobfit.codegen`` (also wired into ``npm run build``
and ``npm run typecheck``); ``--check`` (``npm run schemas:check``) exits 1 when a
generated file is out of date. CI does not run ``schemas:check`` — the contract
file's freshness is pinned by ``tests/test_codegen_contract_constants.py``, which
``test:python:gate`` runs.
"""

from __future__ import annotations

import importlib
import json
import sys
from pathlib import Path
from typing import Any, NamedTuple

from .appmaster import AppMasterSpec, PerformanceBackbone, RepoDossier
from .devcase.models import MAX_TIMEBOX_HOURS, MIN_TIMEBOX_HOURS, RoleSpec
from .models import AnalysisResult
from .profile import EVIDENCE_KINDS, SKILL_LEVELS
from .rolebrief import RoleBrief
from .taxonomy import UI_PROVENANCE


ROOT = Path(__file__).resolve().parents[2]
OUTPUT = ROOT / "app" / "_lib" / "schemas.generated.ts"
TAXONOMY_OUTPUT = ROOT / "app" / "_lib" / "taxonomy.generated.ts"
CONTRACT_OUTPUT = ROOT / "app" / "_lib" / "contract-constants.generated.ts"

HEADER = """// AUTO-GENERATED — DO NOT EDIT.
// Source of truth: pipeline/jobfit/models.py
// Regenerate with: python -m pipeline.jobfit.codegen

import { z } from "zod";
"""

TAXONOMY_HEADER = """// AUTO-GENERATED — DO NOT EDIT.
// Source of truth: pipeline/jobfit/profile.py (EVIDENCE_KINDS, SKILL_LEVELS),
// pipeline/jobfit/taxonomy.py (UI_PROVENANCE) and
// pipeline/jobfit/devcase/models.py (the devcase timebox bounds).
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

    # A SINGLE-value `Literal[...]` serializes as `const`, not `enum` (pydantic
    # 2.x). Without this branch it fell through to `z.string()` and the one thing
    # the literal was stating — e.g. Budget.onCap is only ever "drain" — was lost
    # on the TS side.
    if isinstance(node.get("const"), str):
        return f"z.literal({json.dumps(node['const'])})"

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
# The App master trio (docs/features/app-master/README.md) rides the same door:
# the role contract, the machine-read dossier it is composed from, and the
# deterministic performance record — all three cross the TS/Python seam.
_EXPORTED_MODELS = (
    (AnalysisResult, "analysisResultSchema", "AnalysisResult"),
    (RoleSpec, "roleSpecSchema", "RoleSpec"),
    (RoleBrief, "roleBriefSchema", "RoleBrief"),
    (AppMasterSpec, "appMasterSpecSchema", "AppMasterSpec"),
    (RepoDossier, "repoDossierSchema", "RepoDossier"),
    (PerformanceBackbone, "performanceBackboneSchema", "PerformanceBackbone"),
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
        # Policy numbers, not a taxonomy — but the same drift problem, so they take the
        # same door: the TS side must clamp a reviewer-edited timebox to the number the
        # Python designer enforces, not to a hand-copied one.
        "// The cap on a candidate's unpaid work, in hours, and the floor that keeps a\n"
        '// degenerate 0 from rendering as "~0h". Every writer clamps to these.\n'
        f"export const DEVCASE_MAX_TIMEBOX_HOURS = {MAX_TIMEBOX_HOURS};\n"
        f"export const DEVCASE_MIN_TIMEBOX_HOURS = {MIN_TIMEBOX_HOURS};",
    ]
    return f"{TAXONOMY_HEADER}\n" + "\n\n".join(lists) + "\n"


class ContractConstant(NamedTuple):
    """One number both languages enforce: its TS name, the ``app/_lib`` module that
    re-exports it, and where Python keeps it (a module attribute, or a key of a
    module-level dict such as ``automation.POLICY``)."""

    ts_name: str
    ts_home: str
    py_module: str
    py_attr: str
    py_key: str | None = None

    def source(self) -> str:
        where = f"pipeline/jobfit/{self.py_module.replace('.', '/')}.py {self.py_attr}"
        return f'{where}["{self.py_key}"]' if self.py_key else where


# The hand-mirrored contract numbers. A new cross-language number is one row here
# plus a re-export in its TS home — never a second literal and a new sync regex.
# app/_lib/fit-thresholds.ts's two floors are deliberately NOT here: that file sits
# on the client page graph and stays import-free; test_fit_threshold_sync.py pins it.
CONTRACT_CONSTANTS: tuple[ContractConstant, ...] = (
    ContractConstant("MAX_SCORECARD_NOTES_CHARS", "interview-transcript.ts", "automation", "MAX_SCORECARD_NOTES_CHARS"),
    ContractConstant("SCREEN_VOLUME_SPARSE_MAX", "automation-cache-key.ts", "automation", "POLICY", "screen_volume_sparse_max"),
    ContractConstant("SCREEN_VOLUME_MODERATE_MAX", "automation-cache-key.ts", "automation", "POLICY", "screen_volume_moderate_max"),
    ContractConstant("MIN_CALIBRATION_OUTCOMES", "calibration.ts", "calibration_drift", "MIN_CALIBRATION_OUTCOMES"),
    ContractConstant("CALIBRATION_BIN_COUNT", "calibration.ts", "calibration_drift", "CALIBRATION_BIN_COUNT"),
    ContractConstant("KIT_MAX_COMPETENCIES", "interview-kit-types.ts", "automation", "KIT_MAX_COMPETENCIES"),
    ContractConstant("KIT_MAX_QUESTIONS_PER_COMPETENCY", "interview-kit-types.ts", "automation", "KIT_MAX_QUESTIONS_PER_COMPETENCY"),
    ContractConstant("KIT_MAX_MUST_ASKS", "interview-kit-types.ts", "automation", "KIT_MAX_MUST_ASKS"),
    ContractConstant("KIT_MAX_FAQ", "interview-kit-types.ts", "automation", "KIT_MAX_FAQ"),
    ContractConstant("LETTER_MAX_CHARS", "interview-letter-types.ts", "automation", "LETTER_MAX_CHARS"),
    ContractConstant("MIN_PROBE_DECISION_OPTIONS", "devcase-probe-audit.ts", "devcase.design", "MIN_PROBE_DECISION_OPTIONS"),
)

CONTRACT_HEADER = """// AUTO-GENERATED — DO NOT EDIT.
// Source of truth: pipeline/jobfit/codegen.py CONTRACT_CONSTANTS, which names the
// Python value behind every number (one comment per line below).
// Regenerate with: python -m pipeline.jobfit.codegen
//
// Import-free on purpose: the TS home modules re-export these names, and some of
// them are imported by client components. Import it WITH the `.ts` extension:
// hand-rolled test resolve hooks read `.generated` as an extension already present.
"""


def resolve_contract_constant(row: ContractConstant) -> int:
    """The Python value behind ``row``, read at render time — never a copy."""
    module = importlib.import_module(f".{row.py_module}", __package__)
    if not hasattr(module, row.py_attr):
        raise AttributeError(
            f"CONTRACT_CONSTANTS row {row.ts_name}: {row.source()} does not exist"
        )
    value = getattr(module, row.py_attr)
    if row.py_key is not None:
        if not isinstance(value, dict) or row.py_key not in value:
            raise AssertionError(
                f"CONTRACT_CONSTANTS row {row.ts_name}: {row.source()} does not exist"
            )
        value = value[row.py_key]
    if isinstance(value, bool) or not isinstance(value, int):
        raise AssertionError(
            f"CONTRACT_CONSTANTS row {row.ts_name}: {row.source()} is {value!r}, not an int"
        )
    return value


def render_contract_constants() -> str:
    names = [row.ts_name for row in CONTRACT_CONSTANTS]
    if len(set(names)) != len(names):
        raise AssertionError("CONTRACT_CONSTANTS names a TS constant twice")
    lines = [
        f"// {row.source()}\nexport const {row.ts_name} = {resolve_contract_constant(row)};"
        for row in CONTRACT_CONSTANTS
    ]
    return f"{CONTRACT_HEADER}\n" + "\n".join(lines) + "\n"


# (path, renderer) for every generated TS file — keeps write() and --check in lockstep.
_GENERATED = (
    (OUTPUT, render),
    (TAXONOMY_OUTPUT, render_taxonomy),
    (CONTRACT_OUTPUT, render_contract_constants),
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
