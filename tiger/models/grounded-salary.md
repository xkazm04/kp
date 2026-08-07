---
type: tiger/model-benchmark
call_site: "[[grounded-salary]]"
date: 2026-07-16
lens: 3 (model optimization — surfaced a live prompt bug instead)
recipe: B (keyless subagent matrix)
engine_constraint: Claude-only (user directive); no blind judge — the finding is structural, not a ranking
production_model: gemini-3-flash-preview WITH Google-Search grounding
inputs: 1 fixed role — Senior Data Analyst, MUNICH, German automotive OEM (a non-CZ market)
recommendation: KEEP Gemini (web grounding is the entire point; Claude has none) AND fix the CZK prompt-lock (finding #20 — proven live + model-independent)
---

# Lens 3 — [[grounded-salary]] model matrix (2026-07-16)

This benchmark **did not produce a model ranking** — it exposed a live prompt bug that traps
every model, which is the more valuable result. 3 Claude cells × 1 non-CZ input (Munich).

## What every cell did (the finding)
The production prompt (`market_salary_cli.py:117-127`) hardwires the currency to **CZK**
(`<int CZK/month>`, `"currency":"CZK"`) even though `region` was **Munich, Germany**. Result:
**all three tiers** dutifully priced the German role, then **converted EUR→CZK at ~24.5–25**
and emitted a *"CZK/month for a Munich job"* figure:
| cell | output | confidence |
|---|---|---|
| haiku × low | 110,000–185,000 CZK/mo | low (self-noted "no web access, pre-2025 data") |
| sonnet × high | 155,000–220,000 CZK/mo | medium |
| opus × low | 140,000–190,000 CZK/mo | medium |

**Even opus obeyed the CZK instruction.** This is [[grounded-salary]] **finding #20
(currency lock) demonstrated live** — and it proves the bug is **in the prompt, not the
model**: no tier escaped it, so a smarter model will never fix it. (Compare [[cv-analysis]],
whose prompt DOES infer market currency — there all tiers correctly produced EUR.)

## The capability ceiling (why this site can't go Claude)
The whole value of this call is **live Google-Search grounding** (`use_grounding=True`).
Claude cells have **no web access**, so every "grounded" number here is **parametric recall**
— haiku was honest about it ("based on pre-February-2025 training data ... not verified").
Swapping to Claude would silently drop the site to un-grounded low-confidence estimates —
effectively no better than the deterministic taxonomy band it's meant to beat.

## Recommendation
1. **KEEP Gemini** — grounding is the point; a Claude swap loses it. Not a portable site.
2. **Fix finding #20 (now proven live):** derive currency + period from `region`/`ACTIVE_MARKET`
   instead of the hardcoded `CZK/month`, so a Munich role prices in EUR/year. Model-independent
   — the benchmark confirms no model choice substitutes for the fix. **Promote #20 up the backlog.**
3. Consider a `region → currency/period` map shared with [[cv-analysis]]'s (working) inference.

## Honest ceilings
- n=1 (one non-CZ market). A CZ-market input would mask the bug entirely (CZK would be right),
  which is exactly why it survived — the default region is Czech.
- No blind judge: ranking three cells trapped in the same broken prompt isn't meaningful; the
  cross-cell agreement IS the evidence.
