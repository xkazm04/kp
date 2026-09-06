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
    Call sites that clamp or validate a **model-produced** value into a domain
    in code. Each one is a domain that exists, is known, and is written in a
    place no schema consumer can read.

A high ``repairs`` against a low ``declared`` is the state this module exists
to make visible: the contract's shape is declared twice (Pydantic, then TS)
and its value domains a third time, imperatively, in the one form that cannot
be sent to the producer that keeps violating them.

**Only model-produced domains count, and that is the whole point of the
number.** A clamp on a locally computed value — a weighted score, a cosine, a
sleep duration — is not a domain a response schema could ever constrain, so
counting it inflates a gap no schema can close. The first version of this
module counted every ``max(0, min(...))`` shape and reported 17; six of those
were local arithmetic and one mechanism was counted twice (a validator's
decorator and its own return statement), so the real figure was 10. A count
that cannot say what it counted is not evidence, which is exactly the failure
this module was written to expose in the schema, and it is worth not
reproducing here.

Every hit is therefore classified against :data:`CLASSIFIED` with a stated
reason, and an **unclassified hit fails the test**. That keeps both halves
honest: the numerator cannot quietly grow by absorbing local arithmetic, and
the exclusion list cannot quietly grow either.

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

# Every repair site the patterns can match, classified. `model` means the clamped
# value arrived in a model response, so declaring its domain and sending the
# schema could remove the repair; `local` means it is computed in this process
# and no schema could ever constrain it.
#
# Keyed by ``(relative path, a literal substring of the matched line)`` and
# deliberately NOT by line number: this is a shared checkout, and a sibling
# session adding one import to a module would shift every line below it, so a
# line-keyed table turns an unrelated commit into a red gate on a file the author
# never opened. The marker has to be distinctive within its file, not globally.
#
# `dup_of` marks a hit that is the SAME mechanism as another entry — a Pydantic
# validator matches twice, once on its decorator and once on the clamp in its
# body — so it is classified but not counted.
CLASSIFIED: dict[tuple[str, str], tuple[str, str]] = {
    ("jobfit/appmaster.py", '@field_validator("scope_rung")'):
        ("model", "scope_rung on the agent mandate the model returns"),
    ("jobfit/appmaster.py", "clamped = min(1.0, max(0.0, rate))"):
        ("local", "gate pass rate computed from recorded gate outcomes"),
    ("jobfit/automation.py", 'int(payload.get("confidence"))'):
        ("model", "confidence read from the model payload"),
    ("jobfit/devcase/analyze.py", "conf = max(0.0, min(1.0, conf))"):
        ("model", "confidence read from the model payload"),
    ("jobfit/devcase/evaluate.py", "min(1.0, x)) * 100"):
        ("local", "_pct formats locally computed weighted sums"),
    ("jobfit/devcase/evaluate.py", "int(round(float(value)))"):
        ("model", "_score_int coerces scores.get/raw.get/payload.get"),
    ("jobfit/devcase/evaluate.py", 'float(a["confidence"])'):
        ("model", "confidence off each model-produced artifact"),
    ("jobfit/devcase/models.py", '@field_validator("timebox_hours", mode="after")'):
        ("model", "timebox_hours on a model-parsed model"),
    ("jobfit/devcase/models.py", '@model_validator(mode="after")'):
        ("model", "model_validator over model-parsed fields"),
    ("jobfit/devcase/reflect.py", "return max(0.0, min(1.0, v))"):
        ("model", "the comment names an LLM emitting NaN in its JSON"),
    ("jobfit/embedding_bridge.py", "_cosine(va, vb)"):
        ("local", "cosine computed here from two local vectors"),
    ("jobfit/llm/fault.py", "time.sleep(max(0.0, min(self.hang_s"):
        ("local", "a time.sleep duration, not a payload value"),
    ("jobfit/matching.py", '@field_validator("potential_score")'):
        ("model", "potential_score validator on the model's score"),
    ("jobfit/matching.py", "return max(0.0, min(1.0, v))"):
        ("dup_of", "the return statement of the potential_score validator"),
    ("jobfit/matching.py", "career = max(0.0, min(1.0, career))"):
        ("local", "career score computed from local sub-scores"),
    ("jobfit/matching.py", 'weights["skills"] * skills'):
        ("local", "weighted sum of locally computed sub-scores"),
    ("jobfit/rolebrief.py", "return min(1.0, max(0.0, float(value)))"):
        ("model", "_clamp01 over entry.get(weight)/entry.get(confidence)"),
}

# Model-produced repairs the patterns CANNOT match, listed by hand.
#
# This list is why the headline figure is a **floor** and not a count. The
# patterns recognise three clamp spellings and two validator decorators; a
# domain repaired by an if/elif ladder, or by a helper that divides before it
# clamps, is a real repair the scan cannot see. The classification machinery
# above only stops the numerator from absorbing local arithmetic — nothing there
# guards against an undetected model-produced repair, so the guard is this list
# plus a test that each marker still exists.
#
# Adding a pattern is better than adding an entry here. An entry is an admission
# that the scan is blind to a shape.
KNOWN_UNMATCHED: dict[tuple[str, str], str] = {
    ("jobfit/appmaster.py", "elif rung > MAX_AGENT_SCOPE_RUNG:"):
        "scopeRung clamped by an if/elif ladder on the raw parsed mandate - a "
        "second repair of the same domain as the :165 validator, on the dict "
        "rather than the model, and the only one that records the clamp in notes",
    ("jobfit/calibration_drift.py", "def _clamp_prob(score: float) -> float:"):
        "a model-produced fit total read as a probability; divides by 100 before "
        "clamping, so no clamp pattern in this module matches the line",
}


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


def classify(rel: str, text: str) -> tuple[str, str]:
    """Return ``(kind, reason)`` for one hit, matched by marker within its file.

    Matched on a substring of the hit's own line rather than on a line number, so
    an unrelated edit above it does not turn this into a red gate.
    """
    for (path, marker), verdict in CLASSIFIED.items():
        if rel == path and marker in text:
            return verdict
    return ("unclassified", "")


def find_known_unmatched(root: Path) -> tuple[list[tuple[str, str, str]], list[tuple[str, str]]]:
    """Locate the hand-listed model-produced repairs the patterns cannot match.

    Returns ``(found, missing)``. A missing marker means the code moved or was
    deleted and the list has drifted into fiction — which is the failure mode of
    every hand-maintained list, so a test asserts ``missing`` is empty.
    """
    found: list[tuple[str, str, str]] = []
    missing: list[tuple[str, str]] = []
    for (rel, marker), reason in KNOWN_UNMATCHED.items():
        path = root.parent / rel
        try:
            body = path.read_text(encoding="utf-8")
        except (OSError, UnicodeDecodeError):
            missing.append((rel, marker))
            continue
        if marker in body:
            found.append((rel, marker, reason))
        else:
            missing.append((rel, marker))
    return found, missing


def scan_repairs(root: Path) -> list[tuple[str, int, str, str]]:
    """Find domain-repair shapes under *root*, excluding tests and this module.

    Returns every match, of every kind. Callers that want the figure the plan is
    sized against must filter to ``kind == "model"`` via :func:`classify`;
    :func:`partition` does that.
    """
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


def partition(sites: Iterable[tuple[str, int, str, str]]) -> dict[str, list[Any]]:
    """Split raw hits into the kinds, keyed by kind.

    ``unclassified`` is a fault, not a bucket: a new repair shape must be
    classified before the figure it changes can be trusted.
    """
    out: dict[str, list[Any]] = {"model": [], "local": [], "dup_of": [], "unclassified": []}
    for rel, line, kind_of_match, text in sites:
        kind, reason = classify(rel, text)
        out[kind].append((rel, line, kind_of_match, text, reason))
    return out


def _load_schema() -> dict[str, Any]:
    """Load the exported analysis schema from the codegen module."""
    from .models import AnalysisResult

    return AnalysisResult.model_json_schema(by_alias=True, mode="serialization")


def _render(report: dict[str, Any], show_list: bool) -> Iterable[str]:
    fields = report["fields"]
    declared = report["declared"]
    matched = report["repairs_matched"]
    listed = report["repairs_listed"]
    floor = matched + listed
    local = report["local"]
    share = (declared / fields * 100) if fields else 0.0
    yield "decoder domain gap"
    # Withheld, not annotated: a figure printed beside a warning still gets
    # quoted without the warning, and the whole point of this module is that a
    # count nobody can qualify is not evidence.
    if report["unclassified"]:
        yield "  FIGURES WITHHELD - unclassified repair shapes found."
        yield "  Until each is classified, no repair count from this run is trustworthy:"
        for rel, number, _kind, text, _reason in report["unclassified_sites"]:
            yield f"    {rel}:{number}  {text}"
        yield "  Classify each in CLASSIFIED (model / local / dup_of) with a reason."
        yield f"  (the schema side is unaffected and stands: {declared} of {fields} fields declare a domain)"
        return
    yield f"  exported fields                    {fields}"
    yield f"  with a declared domain             {declared} ({share:.1f}%)"
    yield f"  model-produced repairs (AT LEAST)  {floor}   [{matched} matched + {listed} hand-listed]"
    yield f"  local arithmetic (not countable)   {local}"
    yield ""
    if report["missing_markers"]:
        yield "  KNOWN_UNMATCHED has drifted - these markers no longer exist:"
        for rel, marker in report["missing_markers"]:
            yield f"    {rel}: {marker}"
        return
    yield (
        f"  The model-produced figure is a FLOOR, not a count. The patterns match "
        f"three clamp spellings and two validator decorators; {listed} further "
        "repair(s) are listed by hand because no pattern reaches them (an if/elif "
        "ladder, a helper that divides before it clamps). Anything sized against "
        "this number is sized against at least this many sites, never exactly this "
        "many - and step 4 of the work item must walk the hand-listed ones too, or "
        "it will report the gap closed with them still in place."
    )
    yield ""
    if declared < floor:
        yield (
            f"  At least {floor} model-produced domain(s) are enforced imperatively "
            f"and {declared} declared: the producer is never told the bound it keeps "
            "missing. The local figure is excluded on purpose - no response schema "
            "could constrain a value this process computed itself."
        )
    else:
        yield "  Declared domains meet or exceed the imperative repairs."
    if show_list:
        yield ""
        yield "  declared:"
        for owner, field, kinds in report["declared_fields"]:
            yield f"    {owner}.{field}  {','.join(kinds)}"
        for kind in ("model", "local", "dup_of"):
            yield f"  {kind} (pattern-matched):"
            for rel, number, match_kind, text, reason in report["by_kind"][kind]:
                yield f"    {rel}:{number}  [{match_kind}] {text}"
                yield f"        why: {reason}"
        yield "  model (hand-listed, no pattern reaches them):"
        for rel, marker, reason in report["listed_sites"]:
            yield f"    {rel}  {marker}"
            yield f"        why: {reason}"


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--json", action="store_true", help="emit the report as JSON")
    parser.add_argument("--list", action="store_true", help="list every field and site")
    args = parser.parse_args(argv)

    total, declared = scan_schema(_load_schema())
    by_kind = partition(scan_repairs(PIPELINE_ROOT))
    listed, missing = find_known_unmatched(PIPELINE_ROOT)
    report = {
        "fields": total,
        "declared": len(declared),
        "repairs_matched": len(by_kind["model"]),
        "repairs_listed": len(listed),
        "repairs_floor": len(by_kind["model"]) + len(listed),
        "local": len(by_kind["local"]),
        "unclassified": len(by_kind["unclassified"]),
        "declared_fields": declared,
        "by_kind": by_kind,
        "unclassified_sites": by_kind["unclassified"],
        "listed_sites": listed,
        "missing_markers": missing,
    }
    if args.json:
        print(json.dumps(report, indent=2))
    else:
        print("\n".join(_render(report, args.list)))
    return 0


if __name__ == "__main__":  # pragma: no cover - CLI entry
    sys.exit(main())
