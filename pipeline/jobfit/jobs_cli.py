"""CLI: structure a job ad / role record into a matchable Job.

    python -m pipeline.jobfit.jobs_cli normalize --record-json <path> [--job-id ID]
    python -m pipeline.jobfit.jobs_cli ingest    --ad-file <path>     [--job-id ID]

`normalize` deterministically turns a structured record (e.g. the JD-builder's
RoleSpec) into a Job — no LLM. `ingest` parses a prose ad via the configured LLM
provider (the Claude CLI by default) then normalizes; with no provider available it
degrades to a deterministic structural parse (title from the first line, the ad as the
description, nothing invented). Output:
    {"job": {<Job, camelCase>}, "source": "deterministic" | "llm"}.
Invoked by /api/jds/save (authored JDs) and /api/jobs/ingest (prose ads).
On failure the shared {"error", "status", "code"} envelope goes to stderr, so a
malformed record answers 400/invalid_input instead of reaching the browser as an
anonymous 500. A missing provider is no longer a fault for `ingest` (it degrades).
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

from ._cli import CliError, configure_stdio, emit_error, invalid_input
from .jobs import ingest_ad_deterministic, ingest_raw_ad, normalize_job


def main(argv: list[str] | None = None) -> int:
    configure_stdio(errors="replace")

    parser = argparse.ArgumentParser(description="Structure a job ad / role record into a Job.")
    parser.add_argument("command", choices=["normalize", "ingest"])
    parser.add_argument("--record-json", type=Path, help="structured record JSON (normalize).")
    parser.add_argument("--ad-file", type=Path, help="prose ad text file (ingest).")
    parser.add_argument("--job-id", default=None)
    args = parser.parse_args(argv)

    try:
        if args.command == "normalize":
            raw = json.loads(args.record_json.read_text(encoding="utf-8")) if args.record_json else json.loads(sys.stdin.read() or "{}")
            job = normalize_job(raw, job_id=args.job_id)
            source = "deterministic"
        else:  # ingest
            text = args.ad_file.read_text(encoding="utf-8") if args.ad_file else sys.stdin.read()
            if not text.strip():
                raise invalid_input("ingest requires non-empty ad text")
            from .llm import resolve_provider

            provider = resolve_provider("jd_ingest", timeout=120)
            if provider.available():
                job = ingest_raw_ad(text, provider=provider, job_id=args.job_id)
                source = "llm"
            else:
                # Keyless degradation is a product property: no provider means a
                # structural draft (every unstated field listed in defaulted_fields),
                # not a 500.
                job = ingest_ad_deterministic(text, job_id=args.job_id)
                source = "deterministic"
    except Exception as exc:  # noqa: BLE001 — clean error envelope on stderr
        # The shared envelope names the failure: a bad record is the caller's
        # input (400/invalid_input), a missing provider is an engine fault (500).
        # Exit 2 mirrors the sibling CLIs for a failure named at the raise site.
        rc = emit_error(exc)
        return 2 if isinstance(exc, CliError) and exc.status == 400 else rc

    print(json.dumps({"job": job.model_dump(by_alias=True), "source": source}, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
