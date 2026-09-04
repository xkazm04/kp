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
          "source": "llm"|"deterministic", "narrativeLang": str,
          "promptVersion": str }. Bold spans in
the text are marked with **double asterisks**. Invoked by
app/_lib/group-eval-run.ts; the group evaluation persists the result (so there is
no separate cache and no cross-language cache-key to keep in sync).
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

from ._cli import configure_stdio, emit_error, invalid_input
from .i18n import normalize_lang
from .llm import emit_deterministic, provider_availability, resolve_provider
from .group_compare import GROUP_COMPARE_PROMPT_VERSION, generate
from .match_reasoning import narrative_lang_for


def main(argv: list[str] | None = None) -> int:
    # The shared scaffold, not a local re-implementation: the old inline reconfigure
    # guarded only sys.stdout and then called sys.stderr.reconfigure unconditionally, so
    # a harness that replaced one stream and not the other died before the CLI ran a
    # line (the exact bug configure_stdio was extracted to fix).
    configure_stdio()

    parser = argparse.ArgumentParser(description="Comparative summary across a role's candidates.")
    parser.add_argument("--input-json", type=Path, help="Comparison context JSON. Reads stdin if omitted.")
    parser.add_argument("--no-llm", action="store_true", help="Force the deterministic synthesis.")
    parser.add_argument(
        "--lang",
        default="en",
        help="Output locale for the narrative — any locale in i18n.LANG_NAMES (en, cs, de, fr). "
        "The deterministic synthesis is English-only whatever is requested.",
    )
    args = parser.parse_args(argv)
    # One guard so a fat-fingered --lang can never reach a prompt as an unknown
    # language — the same normalisation reasoning_cli applies. Without it "--lang cs-CZ"
    # (or "CS") was handed straight to language_directive.
    lang = normalize_lang(args.lang)

    try:
        context = json.loads(
            args.input_json.read_text(encoding="utf-8") if args.input_json else (sys.stdin.read() or "{}")
        )
        if not isinstance(context, dict):
            # 400/invalid_input, not the anonymous 500 a bare ValueError became: the
            # caller sent the wrong shape, and "fix the payload" is nothing like
            # "the engine crashed".
            raise invalid_input("input must be a JSON object")
        provider = None if args.no_llm else resolve_provider("group_compare", timeout=120)
        descent = "disabled" if args.no_llm else None
        if provider is not None:
            ok, descent = provider_availability(provider)
            if not ok:
                provider = None

        # A provider that PASSED the availability gate can still fail mid-flight
        # (timeout, unparseable JSON, a 429). `descent` then stayed None and the ledger
        # recorded a deterministic serve with no reason at all.
        def note_descent(reason: str) -> None:
            nonlocal descent
            descent = reason

        comparison, source = generate(
            context, lang=lang, provider=provider, on_fallback=note_descent
        )
        if source == "deterministic":
            # Keyless/failed fallback served — record it in the usage ledger so
            # template traffic stops being invisible (no-op without KP_LLM_USAGE_LOG),
            # with the descent reason naming WHY the floor served (R6).
            emit_deterministic("group_compare", reason=descent)
    except Exception as exc:
        # The bridge's standard envelope — {error, status, code}. The bare
        # {"error", "status": 500} this printed carried no code at all, so
        # python-runner.ts had to guess one back out of the status and a malformed
        # payload reached the recruiter as "the engine failed".
        return emit_error(exc)

    print(
        json.dumps(
            {
                "comparison": comparison,
                "source": source,
                # The language the narrative is actually IN, stated by the side that
                # produced it: the deterministic synthesis is English-only, so a
                # --lang cs run that fell back answers "en" and the modal's honest
                # "shown in English" note can fire. The per-match path has said this
                # since MAT1; the comparison stored English prose in a shared payload
                # with no stamp at all.
                "narrativeLang": narrative_lang_for(source, lang),
                "promptVersion": GROUP_COMPARE_PROMPT_VERSION,
            },
            ensure_ascii=False,
        )
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
