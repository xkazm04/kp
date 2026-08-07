"""CLI for the agent-fit transform (agent-candidate bridge WP1). Mirrors campaign_cli.py.

    python -m pipeline.jobfit.agentfit_cli --job-json J --catalog-json C [--lang cs] [--no-llm]

Input: --job-json holds ONE job record (the TS JobRecord payload — camelCase keys
validate straight into the pydantic Job via its alias generator); --catalog-json a
JSON array of ``{name, description}`` connectors. Deliberately NOT normalize_job():
that would overwrite the record's real salary band (the budget-rule input) with
the role-band table and stamp DEFAULT_POLICY phantoms. Missing company/location
are blank-filled instead.

Output: the uniform provenance envelope on stdout —
{"result": {fit, spec, budget, metrics, promptVersion}, "source": "llm"|"deterministic",
 "perStepSources": {"agentFit": ...}[, "fallbackReason": {"agentFit": "<Type>: <msg>"}]}
— matching the devcase_cli contract so the TS runner's provenance handling
(source + fallbackReason, devcase-run.ts) applies unchanged. On failure the
standard {"error","status","code"} envelope goes to stderr with an honest status
(400 invalid input / 500 engine fault) and a matching exit code.
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

from . import agentfit
from .devcase.provenance import collect_fallback_reasons
from .jobs import Job
from .llm import emit_deterministic, resolve_provider

ERR_INVALID_INPUT = "invalid_input"
ERR_ENGINE = "engine_error"


def main(argv: list[str] | None = None) -> int:
    for stream in (sys.stdout, sys.stderr):
        if hasattr(stream, "reconfigure"):
            stream.reconfigure(encoding="utf-8")

    parser = argparse.ArgumentParser(description="Job → AgentFitSpec transform (LLM with deterministic fallback).")
    parser.add_argument("--job-json", type=Path, required=True)
    parser.add_argument("--catalog-json", type=Path, required=True)
    parser.add_argument("--lang", type=str, default="en")
    parser.add_argument("--no-llm", action="store_true")
    args = parser.parse_args(argv)

    try:
        raw = json.loads(args.job_json.read_text(encoding="utf-8"))
        if not isinstance(raw, dict):
            raise ValueError("--job-json must hold one job object")
        raw.setdefault("company", "")
        raw.setdefault("location", "")
        job = Job.model_validate(raw)

        catalog = json.loads(args.catalog_json.read_text(encoding="utf-8"))
        if not isinstance(catalog, list):
            raise ValueError("--catalog-json must hold a JSON array of {name, description} connectors")

        provider = None if args.no_llm else resolve_provider("agent_fit", timeout=120)
        if provider is not None and not provider.available():
            provider = None

        result, source = agentfit.analyze_agent_fit(job, catalog, provider=provider, lang=args.lang)
        if source == "deterministic":
            # Keyless/failed fallback served — record it in the usage ledger so
            # template traffic stays visible (no-op without KP_LLM_USAGE_LOG).
            emit_deterministic("agent_fit")
        envelope: dict[str, object] = {
            "result": result,
            "source": source,
            "perStepSources": {"agentFit": source},
        }
        # Lift the fallback cause (stashed on the artifact by generate_with_fallback)
        # into the envelope, mirroring devcase_cli.
        reasons = collect_fallback_reasons([("agentFit", result)], pop=True)
        if reasons:
            envelope["fallbackReason"] = reasons
        print(json.dumps(envelope, ensure_ascii=False))
        return 0
    except ValueError as exc:
        print(json.dumps({"error": str(exc), "status": 400, "code": ERR_INVALID_INPUT}, ensure_ascii=False), file=sys.stderr)
        return 2
    except Exception as exc:
        print(json.dumps({"error": str(exc), "status": 500, "code": ERR_ENGINE}, ensure_ascii=False), file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
