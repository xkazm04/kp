"""CLI for the App-master repo scan (P2). Mirrors agentfit_cli.py.

    python -m pipeline.jobfit.repo_scan_cli --root PATH [--lang cs] [--no-llm]
                                            [--repo-url URL] [--dossier-id ID]
                                            [--main-branch main] [--churn-depth 200]

Input: ``--root`` is a filesystem path to the repository to read. The caller
(``app/_lib/repo-scan.ts``) is what decides whether that path may be scanned at
all — the ``KP_APP_MASTER_REPO_ROOTS`` allow-list is enforced there, at the
trust boundary, before this process is ever spawned. This CLI only refuses a path
that does not exist or is not a directory.

Output: the uniform provenance envelope on stdout —
{"result": <RepoDossier>, "source": "llm"|"heuristic",
 "perStepSources": {"repoScan": ...}[, "fallbackReason": {"repoScan": "<Type>: <msg>"}]}
— the same contract agentfit_cli / devcase_cli emit, so the TS runner's
provenance handling applies unchanged. NOTE the source vocabulary: a dossier's
non-LLM path is ``heuristic`` (RepoDossier.source's own literal), not
``deterministic``.

On failure the standard {"error","status","code"} envelope goes to stderr with an
honest status (400 invalid input / 500 engine fault) and a matching exit code.
"""

from __future__ import annotations

import argparse
import json
import sys
from datetime import datetime, timezone
from pathlib import Path

from . import repo_scan
from .devcase.provenance import collect_fallback_reasons
from .llm import emit_deterministic, resolve_provider

ERR_INVALID_INPUT = "invalid_input"
ERR_ENGINE = "engine_error"


def main(argv: list[str] | None = None) -> int:
    for stream in (sys.stdout, sys.stderr):
        if hasattr(stream, "reconfigure"):
            stream.reconfigure(encoding="utf-8")

    parser = argparse.ArgumentParser(
        description="Read a repository into a RepoDossier (Claude Code in-repo, heuristic floor)."
    )
    parser.add_argument("--root", type=Path, required=True)
    parser.add_argument("--lang", type=str, default="en")
    parser.add_argument("--no-llm", action="store_true")
    parser.add_argument("--repo-url", type=str, default=None)
    parser.add_argument("--dossier-id", type=str, default="")
    parser.add_argument("--main-branch", type=str, default="main")
    parser.add_argument("--churn-depth", type=int, default=200)
    args = parser.parse_args(argv)

    try:
        root = args.root
        if not root.exists() or not root.is_dir():
            raise ValueError(f"--root is not a readable directory: {root}")

        provider = None if args.no_llm else resolve_provider("repo_scan", timeout=repo_scan.LLM_TIMEOUT_S)
        if provider is not None and not provider.available():
            provider = None

        result, source = repo_scan.scan_repo(
            root,
            provider=provider,
            lang=args.lang,
            dossier_id=args.dossier_id,
            repo_url=args.repo_url,
            main_branch=args.main_branch,
            generated_at=datetime.now(timezone.utc).isoformat(timespec="seconds"),
            churn_depth=max(1, args.churn_depth),
        )
        if source == repo_scan.SOURCE_HEURISTIC:
            # Keyless / failed-fallback served — record it in the usage ledger so
            # the heuristic traffic stays visible (no-op without KP_LLM_USAGE_LOG).
            emit_deterministic("repo_scan")
        envelope: dict[str, object] = {
            "result": result,
            "source": source,
            "perStepSources": {"repoScan": source},
        }
        reasons = collect_fallback_reasons([("repoScan", result)], pop=True)
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
