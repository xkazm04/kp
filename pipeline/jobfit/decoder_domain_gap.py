"""Report where a model-produced value domain is repaired instead of declared.

The analysis models are exported to TypeScript by ``codegen.py`` and the same
JSON Schema could be handed to the model as a response schema — but a domain
that lives in an imperative clamp reaches neither boundary. This module counts
the gap so it is a number in a report rather than a thing somebody notices.

Three figures, and the interesting one is the third:

``declared``
    Fields in the exported schema that carry a bounded domain — ``minimum`` /
    ``maximum`` bounds, an ``enum``, or a ``const``. These are the domains a
    response schema could enforce and the TS side could narrow.
``fields``
    Total exported fields, as the denominator. ``declared / fields`` is the
    share of the contract whose value domain is machine-readable at all.
``repairs``
    Call sites that clamp or validate a value into a domain in code. Each one
    is a domain that exists, is known, and is written in a place no schema
    consumer can read.

A high ``repairs`` against a low ``declared`` is the state this module exists
to make visible: the contract's shape is declared twice (Pydantic, then TS)
and its value domains a third time, imperatively, in the one form that cannot
be sent to the producer that keeps violating them.

Usage::

    py -m pipeline.jobfit.decoder_domain_gap
    py -m pipeline.jobfit.decoder_domain_gap --json
    py -m pipeline.jobfit.decoder_domain_gap --list
"""

from __future__ import annotations

import argparse
import json
import re
import sys
from pathlib import Path
from typing import Any, Iterable

PIPELINE_ROOT = Path(__file__).resolve().parent

# A domain repair: a clamp expression, or a Pydantic validator that coerces a
# value into range. Deliberately conservative — these are the shapes actually
# present in this pipeline, and a pattern that over-matches would make the
# figure unreadable.
REPAIR_PATTERNS: tuple[tuple[str, str], ...] = (
    ("clamp", r"max\(\s*0(?:\.0)?\s*,\s*min\("),
    ("clamp", r"min\(\s*1\.0\s*,\s*max\("),
    ("clamp", r"min\(\s*100\s*,\s*max\("),
    ("validator", r"@field_validator\("),
    ("validator", r"@model_validator\("),
)

BOUND_KEYS = ("minimum", "maximum", "exclusiveMinimum", "exclusiveMaximum")


def _domain_kinds(schema: dict[str, Any], defs: dict[str, Any]) -> list[str]:
    """Return the bounded-domain markers on one field's schema.

    Looks through ``anyOf`` and ``$ref`` because an optional field is spelled
    as a union with null, and an enum is usually a referenced definition —
    both hide the domain from a naive top-level key check.
    """
    kinds: list[str] = []

    def visit(node: dict[str, Any], depth: int = 0) -> None:
        if not isinstance(node, dict) or depth > 3:
            return
        for key in BOUND_KEYS:
            if key in node:
                kinds.append(key)
        if "enum" in node:
            kinds.append("enum")
        if "const" in node:
            kinds.append("const")
        ref = node.get("$ref")
        if isinstance(ref, str):
            visit(defs.get(ref.rsplit("/", 1)[-1]) or {}, depth + 1)
        for sub in node.get("anyOf") or []:
            visit(sub, depth + 1)

    visit(schema)
    return sorted(set(kinds))


def scan_schema(schema: dict[str, Any]) -> tuple[int, list[tuple[str, str, list[str]]]]:
    """Count exported fields and collect the ones with a declared domain."""
    defs = schema.get("$defs") or {}
    total = 0
    declared: list[tuple[str, str, list[str]]] = []

    def walk(owner: str, properties: dict[str, Any] | None) -> None:
        nonlocal total
        for field, field_schema in (properties or {}).items():
            total += 1
            kinds = _domain_kinds(field_schema, defs)
            if kinds:
                declared.append((owner, field, kinds))

    for name, definition in defs.items():
        walk(name, definition.get("properties"))
    walk(schema.get("title") or "root", schema.get("properties"))
    return total, declared


def scan_repairs(root: Path) -> list[tuple[str, int, str, str]]:
    """Find domain-repair sites under *root*, excluding tests and this module."""
    found: list[tuple[str, int, str, str]] = []
    compiled = [(kind, re.compile(pattern)) for kind, pattern in REPAIR_PATTERNS]
    for path in sorted(root.rglob("*.py")):
        name = path.name
        if name.endswith("_test.py") or name.startswith("test_"):
            continue
        if path == Path(__file__).resolve():
            continue
        try:
            lines = path.read_text(encoding="utf-8").splitlines()
        except (OSError, UnicodeDecodeError):
            continue
        for number, line in enumerate(lines, start=1):
            for kind, pattern in compiled:
                if pattern.search(line):
                    rel = path.relative_to(root.parent).as_posix()
                    found.append((rel, number, kind, line.strip()[:110]))
                    break
    return found


def _load_schema() -> dict[str, Any]:
    """Load the exported analysis schema from the codegen module."""
    from .models import AnalysisResult

    return AnalysisResult.model_json_schema(by_alias=True, mode="serialization")


def _render(report: dict[str, Any], show_list: bool) -> Iterable[str]:
    fields = report["fields"]
    declared = report["declared"]
    repairs = report["repairs"]
    share = (declared / fields * 100) if fields else 0.0
    yield "decoder domain gap"
    yield f"  exported fields            {fields}"
    yield f"  with a declared domain     {declared} ({share:.1f}%)"
    yield f"  repaired in code           {repairs}"
    yield ""
    if declared < repairs:
        yield (
            f"  {repairs} domain(s) are enforced imperatively and {declared} "
            "declared: the producer is never told the bound it keeps missing."
        )
    else:
        yield "  Declared domains meet or exceed the imperative repairs."
    if show_list:
        yield ""
        yield "  declared:"
        for owner, field, kinds in report["declared_fields"]:
            yield f"    {owner}.{field}  {','.join(kinds)}"
        yield "  repairs:"
        for rel, number, kind, text in report["repair_sites"]:
            yield f"    {rel}:{number}  [{kind}] {text}"


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--json", action="store_true", help="emit the report as JSON")
    parser.add_argument("--list", action="store_true", help="list every field and site")
    args = parser.parse_args(argv)

    total, declared = scan_schema(_load_schema())
    repairs = scan_repairs(PIPELINE_ROOT)
    report = {
        "fields": total,
        "declared": len(declared),
        "repairs": len(repairs),
        "declared_fields": declared,
        "repair_sites": repairs,
    }
    if args.json:
        print(json.dumps(report, indent=2))
    else:
        print("\n".join(_render(report, args.list)))
    return 0


if __name__ == "__main__":  # pragma: no cover - CLI entry
    sys.exit(main())
