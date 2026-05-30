"""CLI: grounded market-salary estimate for a role.

    python -m pipeline.jobfit.market_salary_cli --input-json <path>

Input JSON: {title, seniority, roleFamily, company, region, stack:[...]}.
Uses Gemini Google-Search grounding to research a current market band for a
similar role+company, with cited sources. Falls back to the deterministic
taxonomy band (role_family x seniority) when no key / grounding fails, so it
always returns a usable range. Invoked by the JD builder via a TS bridge.
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

from .gemini import GroundedAnswer, grounded_answer, load_local_env
from .taxonomy import role_band

REGION_DEFAULT = "Czech Republic (Prague)"


def _fallback(role_family: str, seniority: str) -> dict:
    band = role_band(role_family, seniority) or (0, 0)
    return {
        "suggestedMinimum": int(band[0]),
        "suggestedMaximum": int(band[1]),
        "currency": "CZK",
        "confidence": "low",
        "summary": "Estimated from the internal role-family salary table (no live web evidence).",
    }


def _coerce(payload: dict, role_family: str, seniority: str) -> dict:
    """Validate the grounded JSON; repair to the taxonomy band if unusable."""
    fb = _fallback(role_family, seniority)
    try:
        lo = int(payload.get("suggestedMinimum") or 0)
        hi = int(payload.get("suggestedMaximum") or 0)
    except (TypeError, ValueError):
        lo = hi = 0
    if lo <= 0 or hi < lo:
        return fb
    return {
        "suggestedMinimum": lo,
        "suggestedMaximum": hi,
        "currency": str(payload.get("currency") or "CZK"),
        "confidence": str(payload.get("confidence") or "medium"),
        "summary": str(payload.get("summary") or fb["summary"]),
    }


def main(argv: list[str] | None = None) -> int:
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")
        sys.stderr.reconfigure(encoding="utf-8", errors="replace")

    parser = argparse.ArgumentParser(description="Grounded market-salary estimate for a role.")
    parser.add_argument("--input-json", type=Path, help="Role JSON. Reads stdin if omitted.")
    parser.add_argument("--no-grounding", action="store_true", help="Skip web search; taxonomy band only.")
    args = parser.parse_args(argv)

    try:
        raw = json.loads(args.input_json.read_text(encoding="utf-8")) if args.input_json else json.loads(sys.stdin.read() or "{}")
        title = str(raw.get("title") or "the role")
        seniority = str(raw.get("seniority") or "medior")
        role_family = str(raw.get("roleFamily") or "software_engineering")
        company = str(raw.get("company") or "a mid-size company")
        region = str(raw.get("region") or REGION_DEFAULT)
        stack = ", ".join([str(s) for s in (raw.get("stack") or [])][:10]) or "n/a"

        load_local_env()

        if args.no_grounding:
            result = _fallback(role_family, seniority)
            print(json.dumps({"result": result, "sources": [], "source": "deterministic"}, ensure_ascii=False))
            return 0

        prompt = (
            "You are a compensation analyst. Using current web search results, estimate the typical MONTHLY GROSS "
            f"salary range for this role in {region}.\n"
            f"- Title: {title}\n- Seniority: {seniority}\n- Field: {role_family}\n"
            f"- Company profile: similar to {company}\n- Key stack: {stack}\n\n"
            "Respond with ONLY a JSON object (no prose, no fences):\n"
            '{"suggestedMinimum": <int CZK/month>, "suggestedMaximum": <int CZK/month>, '
            '"currency": "CZK", "confidence": "low|medium|high", '
            '"summary": "<1-2 sentences of market context grounded in what you found>"}'
        )
        ans: GroundedAnswer = grounded_answer(
            prompt=prompt,
            use_grounding=True,
            parse_json=True,
            fallback=GroundedAnswer(text="", payload={}, sources=[]),
        )
        grounded = bool(ans.payload) and int(ans.payload.get("suggestedMinimum") or 0) > 0
        result = _coerce(ans.payload or {}, role_family, seniority)
        print(
            json.dumps(
                {"result": result, "sources": ans.sources[:8], "source": "llm" if grounded else "deterministic"},
                ensure_ascii=False,
            )
        )
        return 0
    except Exception as exc:  # noqa: BLE001 — any failure degrades to a clean error envelope
        print(json.dumps({"error": str(exc), "status": 500}, ensure_ascii=False), file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
