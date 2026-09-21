"""CLI: propose extraction rules for a job-board listing page (model-as-author).

The rule engine (app/_lib/jobseeker/rules/engine.ts) runs rules deterministically on
every scan; THIS is the one place a model is asked anything about a board — once per
page shape, from the REAL markup the route fetched and reduced. Nothing here touches
the network or the store: the route validates and dry-runs whatever comes back and
persists nothing (ADR 0009 §2).

stdin or ``--input-json <path>``::

    {"html": "<reduced listing HTML>", "url": "<listing page URL>", "lang": "en"}

stdout::

    {"rules": [<ExtractionRule>...], "source": "llm" | "deterministic",
     "fallbackReason": str | null, "promptVersion": str, "reasoning": [str, ...]}

Keyless twin: a heuristic rule set from the listing's own anchors — the most common
path prefix among linked titles becomes the url/title/externalKey rules, with
``source: "deterministic"`` so the owner knows a template proposed it. Exit 2 +
``invalid_input`` when the request is malformed.
"""

from __future__ import annotations

import argparse
import json
import re
import sys
from collections import Counter
from pathlib import Path
from typing import Any

from ._cli import configure_stdio, emit_error, invalid_input
from .llm import LLMError, resolve_provider

USE_CASE = "extraction_rules"
PROMPT_VERSION = "extraction-rules-v1"
LANGS = ("en", "cs", "de", "fr")
MAX_HTML_CHARS = 40_000

RULE_FIELDS = ("title", "company", "location", "url", "postedAt", "salaryText", "externalKey")
LOCATOR_KINDS = ("css", "regex", "jsonld", "pointer")
POST_OPS = ("trim", "text", "absUrl", "number", "date")

_SYSTEM = (
    "You author extraction rules for a job-board LISTING page. You are given the page's real, "
    "reduced HTML. Rules are run by a deterministic engine on every scan; you propose them once. "
    "Prefer css locators on stable class names or data-* attributes; use regex only when no "
    "selector can reach the value; never invent selectors that are not in the HTML."
)

_PROMPT = """Page URL: {url}
Reader language: {lang}

Rule schema (JSON): {{"field": one of {fields}, "locator": {{"kind": one of {kinds}, "expr": string, "attr"?: attribute name for css}},
"cardinality": "one" | "many", "pick": "first" | "last" | "fail", "post": array of {ops}, "required": boolean}}

Rules of the DSL:
- Every listing card yields one item; a rule with cardinality "many" produces one value per card, in page order. Make ALL card-level rules "many".
- A "url" rule is REQUIRED (required: true) and should end with post ["absUrl"]. An "externalKey" rule, when a stable id attribute exists, is required too.
- "title" should be required. company/location/postedAt/salaryText are optional (required: false) and may be omitted when the page does not show them.
- css `expr` is a selector; `attr` reads an attribute instead of the text. Use post ["text","trim"] for text values.
- Do not emit two rules for the same field.

Return ONLY JSON: {{"rules": [...], "reasoning": ["one short sentence per rule explaining the anchor you chose"]}}

HTML:
{html}
"""


def _fail(msg: str) -> None:
    emit_error(invalid_input(msg))
    sys.exit(2)


def _read_input(path: str | None) -> dict[str, Any]:
    raw = Path(path).read_text(encoding="utf-8") if path else sys.stdin.read()
    try:
        data = json.loads(raw or "{}")
    except json.JSONDecodeError as exc:
        _fail(f"input is not JSON: {exc}")
    if not isinstance(data, dict):
        _fail("input must be a JSON object")
    return data


# --- the deterministic twin -------------------------------------------------------------------

_ANCHOR_RE = re.compile(r"<a\b([^>]*)\bhref\s*=\s*[\"']([^\"']+)[\"']([^>]*)>([\s\S]*?)</a\s*>", re.IGNORECASE)
_ID_ATTR_RE = re.compile(r"\b(data-[a-z0-9-]*id[a-z0-9-]*)\s*=\s*[\"']([^\"']+)[\"']", re.IGNORECASE)
_MIN_ANCHORS = 3


def _path_prefix(href: str) -> str | None:
    """`/rpd/2001001/?x=1` → `/rpd/`; `/jobs/123-title` → `/jobs/`; a bare `/` or `#` → None."""
    path = href.split("?", 1)[0].split("#", 1)[0]
    path = re.sub(r"^https?://[^/]+", "", path)
    m = re.match(r"^(/[^/]+/)", path)
    if not m:
        return None
    prefix = m.group(1)
    if re.fullmatch(r"/(prace|jobs?|nabidk[ay]|rpd|offers?|positions?|stellen|emplois?|volna-mista|pozice|inzerat[y]?|job|vacanc(y|ies))/", prefix, re.IGNORECASE):
        return prefix
    # Any prefix followed by something id-like still counts (a numeric or slug segment).
    return prefix if re.match(r"^/[^/]+/[\w%-]+", path) else None


def deterministic_rules(html: str) -> tuple[list[dict[str, Any]], list[str]]:
    """Anchors grouped by their path prefix; the largest group (>= 3 with visible text)
    becomes the url + title rules, and a data-*-id attribute on those anchors becomes
    the externalKey rule. Company/location are not guessed — a wrong optional rule is
    worse than a missing one the owner adds from the preview."""
    groups: Counter[str] = Counter()
    id_attrs: dict[str, Counter[str]] = {}
    for m in _ANCHOR_RE.finditer(html):
        href = m.group(2)
        text = re.sub(r"<[^>]+>", " ", m.group(4))
        text = re.sub(r"\s+", " ", text).strip()
        if len(text) < 4:
            continue
        prefix = _path_prefix(href)
        if not prefix:
            continue
        groups[prefix] += 1
        attrs = f"{m.group(1)} {m.group(3)}"
        for attr in _ID_ATTR_RE.finditer(attrs):
            id_attrs.setdefault(prefix, Counter())[attr.group(1).lower()] += 1
    if not groups:
        return [], ["no repeated anchor group found on the page"]
    prefix, count = groups.most_common(1)[0]
    if count < _MIN_ANCHORS:
        return [], [f"largest anchor group ({prefix}) has only {count} links"]
    selector = f'a[href*="{prefix}"]'
    rules: list[dict[str, Any]] = [
        {"field": "url", "locator": {"kind": "css", "expr": selector, "attr": "href"}, "cardinality": "many", "pick": "first", "post": ["trim", "absUrl"], "required": True},
        {"field": "title", "locator": {"kind": "css", "expr": selector}, "cardinality": "many", "pick": "first", "post": ["text", "trim"], "required": True},
    ]
    reasoning = [
        f"{count} links share the path prefix {prefix}; they are the offer links.",
        "The same anchors carry the offer title as their text.",
    ]
    attr_counts = id_attrs.get(prefix)
    if attr_counts:
        attr, n = attr_counts.most_common(1)[0]
        if n >= _MIN_ANCHORS:
            rules.insert(0, {"field": "externalKey", "locator": {"kind": "css", "expr": selector, "attr": attr}, "cardinality": "many", "pick": "first", "post": ["trim"], "required": True})
            reasoning.insert(0, f"{n} of those anchors carry a stable {attr} attribute — the posting's own id.")
    return rules, reasoning


# --- the LLM path -----------------------------------------------------------------------------


def _coerce_rules(payload: Any) -> list[dict[str, Any]]:
    """Keep only rules the DSL can hold (the route re-validates with validateRules)."""
    rules = payload.get("rules") if isinstance(payload, dict) else None
    if not isinstance(rules, list):
        return []
    out: list[dict[str, Any]] = []
    seen: set[str] = set()
    for r in rules:
        if not isinstance(r, dict):
            continue
        field = r.get("field")
        loc = r.get("locator") if isinstance(r.get("locator"), dict) else None
        if field not in RULE_FIELDS or field in seen or not loc or loc.get("kind") not in LOCATOR_KINDS or not isinstance(loc.get("expr"), str):
            continue
        seen.add(field)
        locator: dict[str, Any] = {"kind": loc["kind"], "expr": loc["expr"][:500]}
        if isinstance(loc.get("attr"), str) and loc["kind"] == "css":
            locator["attr"] = loc["attr"]
        post = [op for op in (r.get("post") or []) if op in POST_OPS]
        out.append({
            "field": field,
            "locator": locator,
            "cardinality": "one" if r.get("cardinality") == "one" else "many",
            "pick": r.get("pick") if r.get("pick") in ("first", "last", "fail") else "first",
            "post": post,
            "required": bool(r.get("required")) or field in ("url", "externalKey"),
        })
    return out


def propose(req: dict[str, Any]) -> dict[str, Any]:
    html = str(req.get("html") or "")[:MAX_HTML_CHARS]
    url = str(req.get("url") or "")
    lang = req.get("lang") if req.get("lang") in LANGS else "en"
    fallback_reason: str | None = None
    try:
        provider = resolve_provider("extraction_rules", timeout=90)  # literal: the BYOM coverage scan reads call sites by text
        if provider is not None and provider.available():
            payload = provider.complete_json(
                _PROMPT.format(url=url, lang=lang, fields=list(RULE_FIELDS), kinds=list(LOCATOR_KINDS), ops=list(POST_OPS), html=html),
                system=_SYSTEM,
                expected_keys=("rules",),
            )
            rules = _coerce_rules(payload)
            if rules and any(r["field"] == "url" for r in rules):
                reasoning = payload.get("reasoning") if isinstance(payload, dict) and isinstance(payload.get("reasoning"), list) else []
                return {"rules": rules, "source": "llm", "fallbackReason": None, "promptVersion": PROMPT_VERSION, "reasoning": [str(x) for x in reasoning][:20]}
            fallback_reason = "llm_no_usable_rules"
        else:
            fallback_reason = "no_provider"
    except LLMError as exc:
        fallback_reason = f"llm_error:{exc.subtype or 'unknown'}"
    except Exception as exc:  # noqa: BLE001 — the deterministic twin is the floor, never a crash
        fallback_reason = f"llm_error:{type(exc).__name__}"
    rules, reasoning = deterministic_rules(html)
    return {"rules": rules, "source": "deterministic", "fallbackReason": fallback_reason, "promptVersion": PROMPT_VERSION, "reasoning": reasoning}


def main(argv: list[str] | None = None) -> int:
    configure_stdio()
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--input-json", default=None)
    args = parser.parse_args(argv)
    req = _read_input(args.input_json)
    if not isinstance(req.get("html"), str) or not req["html"].strip():
        _fail("html must be a non-empty string")
    if not isinstance(req.get("url"), str) or not re.match(r"^https?://", req["url"]):
        _fail("url must be an http(s) URL")
    sys.stdout.write(json.dumps(propose(req), ensure_ascii=False))
    sys.stdout.write("\n")
    return 0


if __name__ == "__main__":
    sys.exit(main())
