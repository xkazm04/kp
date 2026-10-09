"""CLI: Cohort Studio's comparative pass over one cohort (Analyze v2).

    python -m pipeline.jobfit.cohort_compare_cli --input-json <path> [--lang cs] [--no-llm]

Input JSON (``--input-json``, or stdin when omitted) is the pass's context, built by
app/_lib/analyze-cohort-run.ts ``buildCompareInput`` — one presentation order of it:
  { "lang": str, "blind": bool, "jdTitle": str,
    "members": [ {"memberId", "label", "fitRank", "cells": {dim: {rating, tier, label}},
                  "facts": {...compact per-dimension facts — never the CV text} } ],
    "claims": {...CohortClaims, decided by code},
    "narrativeTop": [memberId], "leavesOut": int }

Output: { "cells": [{memberId, dimension, comment}], "notes": {dimension: str},
          "narrative": {covers, leavesOut, text} | null, "engine": "model"|"keyless",
          "promptVersion": str }

The model use case is ``group_compare`` (see cohort_compare.py); a keyless or failed
provider serves the deterministic floor and records it in the usage ledger.
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

from ._cli import configure_stdio, emit_error, invalid_input
from .cohort_compare import COHORT_COMPARE_PROMPT_VERSION, generate
from .i18n import normalize_lang
from .llm import emit_deterministic, provider_availability, resolve_provider


def main(argv: list[str] | None = None) -> int:
    configure_stdio()
    parser = argparse.ArgumentParser(description="Cohort Studio comparative pass.")
    parser.add_argument("--input-json", type=Path, help="Cohort context JSON. Reads stdin if omitted.")
    parser.add_argument("--no-llm", action="store_true", help="Force the deterministic floor.")
    parser.add_argument("--lang", default=None, help="Report language (en, cs, de, fr); defaults to the input's lang.")
    args = parser.parse_args(argv)

    try:
        context = json.loads(
            args.input_json.read_text(encoding="utf-8") if args.input_json else (sys.stdin.read() or "{}")
        )
        if not isinstance(context, dict):
            raise invalid_input("input must be a JSON object")
        lang = normalize_lang(args.lang if args.lang else context.get("lang"))
        provider = None if args.no_llm else resolve_provider("group_compare", timeout=120)
        descent = "disabled" if args.no_llm else None
        if provider is not None:
            ok, descent = provider_availability(provider)
            if not ok:
                provider = None

        def note_descent(reason: str) -> None:
            nonlocal descent
            descent = reason

        result = generate(context, lang=lang, provider=provider, on_fallback=note_descent)
        if result["engine"] == "keyless":
            emit_deterministic("group_compare", reason=descent)
    except Exception as exc:  # noqa: BLE001 — the bridge's standard {error, status, code} envelope
        return emit_error(exc)

    print(json.dumps({**result, "promptVersion": COHORT_COMPARE_PROMPT_VERSION}, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
