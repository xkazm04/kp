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

from ._cli import configure_stdio
from .gemini import GroundedAnswer, grounded_answer, load_local_env
from .market_config import ACTIVE_MARKET, MarketConfig
from .taxonomy import role_band

# Region phrase and currency default to the ACTIVE market instead of hardcoded
# Czech/CZK literals — byte-identical ("Czech Republic (Prague)" / "CZK") for the
# Czech default, but a re-homed market researches ITS region and labels the band in
# ITS currency instead of asking the model for a CZK figure in Prague regardless.
REGION_DEFAULT = ACTIVE_MARKET.region_label


# SCOR6 — the deterministic fallback summary lands in the candidate-facing JD
# ("About the role" interpolates it), so localize it: an English fallback inside
# a Czech JD is the exact mixed-language seam the bilingual i18n closed. Keyed by
# normalized lang; falls back to English for any unknown code.
_FALLBACK_SUMMARY = {
    "en": "Estimated from the internal role-family salary table (no live web evidence).",
    "cs": "Odhadnuto z interní tabulky mezd podle oborů (bez živých webových podkladů).",
}


def _fallback(
    role_family: str, seniority: str, lang: str = "en", *, market: MarketConfig = ACTIVE_MARKET
) -> dict:
    from .i18n import normalize_lang

    band = role_band(role_family, seniority) or (0, 0)
    return {
        "suggestedMinimum": int(band[0]),
        "suggestedMaximum": int(band[1]),
        "currency": market.currency,
        "confidence": "low",
        "summary": _FALLBACK_SUMMARY[normalize_lang(lang)],
    }


def _coerce(
    payload: dict, role_family: str, seniority: str, lang: str = "en", *, market: MarketConfig = ACTIVE_MARKET
) -> tuple[dict, bool]:
    """Validate the grounded JSON; repair to the taxonomy band if unusable.

    Returns (result, grounded) where ``grounded`` is True only when the payload
    supplied a usable range. The int() parse stays inside the try/except so bad
    grounded values (e.g. "85 000", "~85000") degrade to the band instead of
    raising — the caller derives its source label from this flag rather than
    re-parsing the raw payload.
    """
    fb = _fallback(role_family, seniority, lang, market=market)
    try:
        lo = int(payload.get("suggestedMinimum") or 0)
        hi = int(payload.get("suggestedMaximum") or 0)
    except (TypeError, ValueError, OverflowError):
        # int(float('inf')) raises OverflowError, not ValueError: the grounded
        # decoder admits Infinity, and without this it escaped to main()'s 500
        # handler instead of degrading to the promised taxonomy band.
        lo = hi = 0
    if lo <= 0 or hi < lo:
        return fb, False
    return {
        "suggestedMinimum": lo,
        "suggestedMaximum": hi,
        "currency": str(payload.get("currency") or market.currency),
        "confidence": str(payload.get("confidence") or "medium"),
        "summary": str(payload.get("summary") or fb["summary"]),
    }, True


def main(argv: list[str] | None = None) -> int:
    configure_stdio(errors="replace")

    parser = argparse.ArgumentParser(description="Grounded market-salary estimate for a role.")
    parser.add_argument("--input-json", type=Path, help="Role JSON. Reads stdin if omitted.")
    parser.add_argument("--no-grounding", action="store_true", help="Skip web search; taxonomy band only.")
    parser.add_argument("--lang", default="en", help="Output locale for the summary text (en, cs).")
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
            result = _fallback(role_family, seniority, args.lang)
            print(json.dumps({"result": result, "sources": [], "source": "deterministic"}, ensure_ascii=False))
            return 0

        from .i18n import language_name

        # #20 (currency lock) — the currency the model prices in follows the REQUESTED
        # REGION, not a hardcoded CZK. The Tiger Lens-3 benchmark proved every model
        # (incl. opus) otherwise obeys a hardcoded-CZK prompt and emits a nonsensical
        # "CZK/month for a Munich job" — the fix is model-independent and lives here in
        # the prompt (_coerce already passes through the model-returned currency). For
        # the active market (the default, and any region naming it) the prompt is
        # byte-identical to before; for any OTHER region the model prices in that
        # region's own natural currency and is told NOT to convert to CZK.
        cur = ACTIVE_MARKET.currency
        active_region = region.strip().lower() == REGION_DEFAULT.strip().lower()
        if active_region:
            prompt = (
                "You are a compensation analyst. Using current web search results, estimate the typical MONTHLY GROSS "
                f"salary range for this role in {region}.\n"
                f"- Title: {title}\n- Seniority: {seniority}\n- Field: {role_family}\n"
                f"- Company profile: similar to {company}\n- Key stack: {stack}\n\n"
                f"Write the summary in {language_name(args.lang)}; keep the currency code and numbers as specified.\n"
                "Respond with ONLY a JSON object (no prose, no fences):\n"
                f'{{"suggestedMinimum": <int {cur}/month>, "suggestedMaximum": <int {cur}/month>, '
                f'"currency": "{cur}", "confidence": "low|medium|high", '
                '"summary": "<1-2 sentences of market context grounded in what you found>"}'
            )
        else:
            prompt = (
                "You are a compensation analyst. Using current web search results, estimate the typical MONTHLY GROSS "
                f"salary range for this role in {region}.\n"
                f"- Title: {title}\n- Seniority: {seniority}\n- Field: {role_family}\n"
                f"- Company profile: similar to {company}\n- Key stack: {stack}\n\n"
                f"Price the range in the NATURAL CURRENCY of {region} (its own ISO 4217 code, e.g. EUR, USD, GBP, "
                "PLN) — do NOT convert to CZK. State that currency in the 'currency' field.\n"
                f"Write the summary in {language_name(args.lang)}; name the market and keep the currency code and numbers as specified.\n"
                "Respond with ONLY a JSON object (no prose, no fences):\n"
                '{"suggestedMinimum": <int in the region\'s own currency, per month>, '
                '"suggestedMaximum": <int in the region\'s own currency, per month>, '
                '"currency": "<ISO 4217 code for the region\'s currency>", "confidence": "low|medium|high", '
                '"summary": "<1-2 sentences of market context grounded in what you found>"}'
            )
        ans: GroundedAnswer = grounded_answer(
            prompt=prompt,
            use_grounding=True,
            parse_json=True,
            expected_keys=("suggestedMinimum", "suggestedMaximum", "currency", "confidence", "summary"),
            fallback=GroundedAnswer(text="", payload={}, sources=[]),
            use_case="grounded_salary",
        )
        result, grounded = _coerce(ans.payload or {}, role_family, seniority, args.lang)
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
