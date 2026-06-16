"""CLI: structure a job ad / role record into a matchable Job.

    python -m pipeline.jobfit.jobs_cli normalize --record-json <path> [--job-id ID]
    python -m pipeline.jobfit.jobs_cli ingest    --ad-file <path>     [--job-id ID]

`normalize` deterministically turns a structured record (e.g. the JD-builder's
RoleSpec) into a Job — no LLM. `ingest` parses a prose ad via the Claude CLI
(subscription) then normalizes. Output:
    {"job": {<Job, camelCase>}, "source": "deterministic" | "llm"}.
Invoked by /api/jds/save (authored JDs) and /api/jobs/ingest (prose ads).
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

from .jobs import ingest_raw_ad, normalize_job


def main(argv: list[str] | None = None) -> int:
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")
        sys.stderr.reconfigure(encoding="utf-8", errors="replace")

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
                raise ValueError("ingest requires non-empty ad text")
            from .llm import resolve_provider

            provider = resolve_provider("jd_ingest", timeout=120)
            if not provider.available():
                raise RuntimeError("No LLM provider available for ad ingestion (configure one in Models, or install the Claude CLI).")
            job = ingest_raw_ad(text, provider=provider, job_id=args.job_id)
            source = "llm"
    except Exception as exc:  # noqa: BLE001 — clean error envelope on stderr
        print(json.dumps({"error": str(exc), "status": 500}, ensure_ascii=False), file=sys.stderr)
        return 1

    print(json.dumps({"job": job.model_dump(by_alias=True), "source": source}, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
