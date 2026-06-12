"""CLI: one canary completion through the configured provider for a use case.

    python -m pipeline.jobfit.llm.test_cli --use-case match_reasoning

Resolves the provider exactly like production (KP_LLM_CONFIG env → registry),
runs a trivial JSON prompt, and emits one JSON line:

    { "ok": true, "provider": "anthropic", "model": "claude-haiku-4-5",
      "latencyMs": 812, "usage": {...} }

On failure: { "ok": false, "provider": ..., "model": ..., "error": "..." }
with exit code 0 (the verdict IS the payload — the admin Test button renders
it either way). Invoked by /api/llm/test.
"""

from __future__ import annotations

import argparse
import json
import time

from .registry import resolve_provider


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Canary-test the configured LLM provider for a use case.")
    parser.add_argument("--use-case", required=True)
    args = parser.parse_args(argv)

    provider_name = "unknown"
    model = None
    try:
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
