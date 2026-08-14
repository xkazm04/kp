"""CLI: one canary completion, either through a use case's configured provider
or straight at one named provider.

    python -m pipeline.jobfit.llm.test_cli --use-case match_reasoning
    python -m pipeline.jobfit.llm.test_cli --provider anthropic [--model claude-haiku-4-5]

``--use-case`` resolves the provider exactly like production (KP_LLM_CONFIG env →
registry) and answers "is this pin working". ``--provider`` bypasses routing and
answers the different question the keys panel asks: "does this credential work at
all", which must be answerable for a provider no use case is pinned to yet.

Either way it runs a trivial JSON prompt and emits one JSON line:

    { "ok": true, "provider": "anthropic", "model": "claude-haiku-4-5",
      "latencyMs": 812, "usage": {...} }

On failure: { "ok": false, "provider": ..., "model": ..., "error": "..." }
with exit code 0 (the verdict IS the payload — the admin Test buttons render
it either way). Invoked by /api/llm/test and /api/llm/keys/test.
"""

from __future__ import annotations

import argparse
import json
import time

from .registry import probe_provider, resolve_provider


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Canary-test an LLM provider.")
    target = parser.add_mutually_exclusive_group(required=True)
    target.add_argument("--use-case", help="Resolve through the configured routing for this use case.")
    target.add_argument("--provider", help="Probe this provider directly, ignoring routing.")
    parser.add_argument("--model", help="Explicit model/deployment/slug (required for providers with no built-in default).")
    args = parser.parse_args(argv)

    provider_name = args.provider or "unknown"
    model = None
    try:
        if args.provider:
            provider = probe_provider(args.provider, model=args.model, timeout=60)
        else:
            provider = resolve_provider(args.use_case, timeout=60)
        provider_name = getattr(provider, "name", type(provider).__name__)
        model = getattr(provider, "model", None)
        if type(provider).__name__ in ("ClaudeCliProvider", "MonitoredClaudeCli"):
            provider_name = "claude_cli"
        if not provider.available():
            print(json.dumps({
                "ok": False, "provider": provider_name, "model": model,
                "error": "provider unavailable (missing key or SDK/CLI)",
            }, ensure_ascii=False))
            return 0
        started = time.monotonic()
        payload = provider.complete_json(
            'Return exactly this JSON object: {"ok": true}', timeout=60, expected_keys=["ok"]
        )
        latency_ms = int((time.monotonic() - started) * 1000)
        ok = isinstance(payload, dict) and payload.get("ok") is True
        print(json.dumps({
            "ok": ok, "provider": provider_name, "model": model, "latencyMs": latency_ms,
            **({} if ok else {"error": f"unexpected canary payload: {json.dumps(payload)[:200]}"}),
        }, ensure_ascii=False))
    except Exception as exc:  # noqa: BLE001 — the verdict envelope carries it
        print(json.dumps({
            "ok": False, "provider": provider_name, "model": model,
            "error": f"{type(exc).__name__}: {exc}"[:400],
        }, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
