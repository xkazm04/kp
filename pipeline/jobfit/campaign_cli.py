"""CLI for the sourcing campaign pack (Erika gap E1). Mirrors automation_cli.py.

    python -m pipeline.jobfit.campaign_cli --job-json J [--lang cs] [--apply-url U] [--no-llm]

Input: --job-json holds ONE job record (the TS JobRecord payload — camelCase keys
validate straight into the pydantic Job via its alias generator). Deliberately
NOT normalize_job(): that would overwrite the record's real salary band with the
role-band table and stamp DEFAULT_POLICY phantoms ("Praha"/"medior") that the
campaign's honesty rule must never advertise. Missing company/location are
blank-filled instead — campaign._job_facts treats blanks as absent facts.

Output: {"result": <pack>, "source": "llm"|"deterministic"} on stdout. On failure
the standard {"error","status","code"} envelope goes to stderr with an honest
status (400 invalid input / 500 engine fault) and a matching exit code.
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

from . import campaign
from .llm import resolve_provider
from .jobs import Job

ERR_INVALID_INPUT = "invalid_input"
ERR_ENGINE = "engine_error"


def main(argv: list[str] | None = None) -> int:
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8")
        sys.stderr.reconfigure(encoding="utf-8")

    parser = argparse.ArgumentParser(description="Sourcing campaign pack (Claude CLI with deterministic fallback).")
    parser.add_argument("--job-json", type=Path, required=True)
    parser.add_argument("--lang", type=str, default="en")
    parser.add_argument("--apply-url", type=str, default="")
    parser.add_argument("--no-llm", action="store_true")
    args = parser.parse_args(argv)

    try:
        raw = json.loads(args.job_json.read_text(encoding="utf-8"))
        if not isinstance(raw, dict):
            raise ValueError("--job-json must hold one job object")
        # The Job model requires company/location; a TS JobRecord may omit both.
        # Blank-fill (absent fact) rather than default-fill (phantom fact).
        raw.setdefault("company", "")
        raw.setdefault("location", "")
        job = Job.model_validate(raw)

        provider = None if args.no_llm else resolve_provider("campaign_pack", timeout=120)
        if provider is not None and not provider.available():
            provider = None

        result, source = campaign.draft_campaign_pack(
            job, lang=args.lang, apply_url=args.apply_url, provider=provider
        )
        print(json.dumps({"result": result, "source": source}, ensure_ascii=False))
        return 0
    except ValueError as exc:
        # Bad arguments, malformed JSON, or pydantic validation — user-correctable → 400.
        print(json.dumps({"error": str(exc), "status": 400, "code": ERR_INVALID_INPUT}, ensure_ascii=False), file=sys.stderr)
        return 2
    except Exception as exc:
        print(json.dumps({"error": str(exc), "status": 500, "code": ERR_ENGINE}, ensure_ascii=False), file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
