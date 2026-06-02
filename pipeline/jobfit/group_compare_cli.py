"""CLI: comparative ("compare all") summary across a role's candidates.

    python -m pipeline.jobfit.group_compare_cli --input-json <path>

Input JSON (stdin or --input-json) is the assembled comparison context:
  { "roleTitle": str,
    "roleSalaryBand": [min, max] | null,   # role's recommended band (budget fit)
    "candidates": [ { "label", "archetype", "seniority", "total", "skills",
                      "career", "personal", "matchedSkills", "missingSkills",
                      "verdict", "potentialScore",
                      "salaryExpectation": int|null }, ... ] }   # candidate midpoint

Output: { "comparison": { "headline", "keyPoints": [...], "recommendation" },
          "source": "llm"|"deterministic", "promptVersion": str }. Bold spans in
the text are marked with **double asterisks**. Invoked by
app/_lib/group-eval-run.ts; the group evaluation persists the result (so there is
no separate cache and no cross-language cache-key to keep in sync).
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

from .claude_cli import ClaudeCliProvider
from .group_compare import GROUP_COMPARE_PROMPT_VERSION, generate


def main(argv: list[str] | None = None) -> int:
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8")
        sys.stderr.reconfigure(encoding="utf-8")

    parser = argparse.ArgumentParser(description="Comparative summary across a role's candidates.")
    parser.add_argument("--input-json", type=Path, help="Comparison context JSON. Reads stdin if omitted.")
    parser.add_argument("--no-llm", action="store_true", help="Force the deterministic synthesis.")
    args = parser.parse_args(argv)

    try:
        context = json.loads(
            args.input_json.read_text(encoding="utf-8") if args.input_json else (sys.stdin.read() or "{}")
        )
        if not isinstance(context, dict):
            raise ValueError("input must be a JSON object")
        provider = None if args.no_llm else ClaudeCliProvider(timeout=120)
        if provider is not None and not provider.available():
            provider = None
        comparison, source = generate(context, provider=provider)
    except Exception as exc:
        print(json.dumps({"error": str(exc), "status": 500}, ensure_ascii=False), file=sys.stderr)
        return 1

    print(
        json.dumps(
            {"comparison": comparison, "source": source, "promptVersion": GROUP_COMPARE_PROMPT_VERSION},
            ensure_ascii=False,
        )
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
