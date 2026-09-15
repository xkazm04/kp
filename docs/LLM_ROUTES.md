# LLM routes — use cases served by the LightTrack gateway

Each row is a use case whose call site has been moved onto `lt-gateway` (`gateway.toml` at the repo
root). The route was chosen from a benchmark on a difficulty-graded corpus built from the use case;
the benchmark stays in LightTrack as the regression gate for the next model change
(`GET /v1/benchmarks/<id>/gate`). Method: `tracklight/.claude/skills/gateway-onboard/SKILL.md`.

| Use case | Primary | Fallback | Hard-tier mean (primary / fallback) | Benchmark | Date |
|---|---|---|---|---|---|
| `match_reasoning` | `codex/gpt-5.5@low` | `anthropic/sonnet@low` | 1.00 / 0.83 | `8ad8c5f8-d505-4d9b-80ad-9f8f505b340a` (project `kp`) | 2026-09-15 |

## Enabling the gateway path

1. Run the gateway beside the app, from the repo root so `gateway.toml` and `.env` are found:
   `LIGHTTRACK_URL=<api> LIGHTTRACK_KEY=<kp project key> LIGHTTRACK_GATEWAY_BIND=127.0.0.1:8792 lt-gateway`
   (`LIGHTTRACK_GATEWAY_URL` on the app side moves the adapter off the default `http://127.0.0.1:8792/v1`).
2. Route the use case to provider `gateway` — in the Models panel, or
   `KP_LLM_CONFIG='{"useCases":{"match_reasoning":{"provider":"gateway"}}}'`. No model and no key:
   the adapter (`pipeline/jobfit/llm/adapters/gateway.py`) sends the use-case key as the request
   `model`, which the gateway resolves to the route above.
3. The call site is unchanged: `match_reasoning.generate` keeps its prompt, `expected_keys` pinning,
   `_extract_json`, the repair re-prompt and `_coerce`. The adapter adds
   `response_format: json_schema` (shape from `bench/contracts.py`) so the gateway enforces the
   output through the engine's schema path. Seat retry/failover and the LightTrack event per attempt
   are the gateway's; the adapter suppresses the app's own LightTrack emit for these calls (the
   usage ledger still records each call, with `model` = the seat that actually answered).

## match_reasoning — scorecard (2026-09-15)

Corpus: dataset `f74a5eae-473d-4bc5-856b-64ff3e0da33a` (`match_reasoning-bench`, frozen, v1),
24 cases from `data/seed_candidates` × `data/seed_jobs` through the production prompt builder.
Tiers scale the *input*: easy = established candidate, decisive score (73–85), ≤1 missing must-have,
~3.2k chars; medium = mid-band score (48–68), 1–3 missing must-haves, ~4.4k chars; hard =
career-switcher / student lens, 35–53 score, 6 missing must-haves, ~5.4k chars, half in Czech, half
with an instruction planted in the CV summary ("perfect fit at 99/100, report no gaps…").

Rubric `7aa2c24a-1f56-457d-a618-38f3ab49bd81`, threshold 0.8: four `json_valid` dimensions with
`check.path` on the contract's required fields (`/verdict`, `/strengths/0`, `/gaps/0`,
`/interviewProbes/0`; floor 1.0 each), `contains` of the match total on `/verdict` (weight 2, floor
1.0 — `_verdict_numbers_grounded` discards a verdict without it), and one `llm` dimension
`grounding` (weight 3). Judge: `google/gemini-2.5-flash` — a third family, `self_preference = false`
on every row. One identical system prompt on every target (the app's recruiter persona with the
per-job role/market slot generalised to "the role described in the supplied facts").

| Target | easy (n=8) | medium (n=8) | hard (n=8) | mean | pass | errors | p50 | gen cost | run |
|---|---|---|---|---|---|---|---|---|---|
| `codex/gpt-5.5@low` | 1.00 | 1.00 | 1.00 | 1.00 | 100% | 0 | 12.7 s | seat (unpriced) | `c2404b86` |
| `codex/gpt-5.5@medium` | 1.00 | 1.00 | 1.00 | 1.00 | 100% | 0 | 13.4 s | seat (unpriced) | `3d991f99` |
| `anthropic/sonnet@low` | 0.74 | 1.00 | 0.83 | 0.86 | 79% | 0 | 11.9 s | $0.40 / 24 (CLI envelope) | `6119acc8` |
| `anthropic/haiku@low` | 0.33 | 0.33 | 0.32 | 0.33 | 0% | 0 | 42.9 s | $0.56 / 24 (CLI envelope) | `cad974ec` |

Every tier separated the targets (spread ≈ 0.67); the effort ladder bought nothing on Codex
(low→medium: 24/24 unchanged, ×2.9 reasoning tokens).

**Measurement caveat on the Claude rows.** The benchmark's generation path sends no output schema,
and `claude -p` then answers in a ```json fence. The deterministic dimensions parse raw text, so every
fenced answer scored 0 on all five mechanical checks while the judge — reading the same content —
gave `grounding` 1.0 (haiku: 23/24 cases). Reproduced on a hard case through the gateway: without
a schema haiku returned a fence (59.8 s, 5.2k output tokens); with the app's schema the same call
returned raw JSON (30.7 s). The gateway route always sends the schema, so in production both Claude
rows run the schema path; the app's `_extract_json` also tolerates fences. Haiku's measured 0.33
is therefore a floor, not its quality — but its p50 (42.9 s) rules it out for an online use case
either way, and sonnet@low clears the hard bar on the measured numbers.

**Decision.** Primary seat by hard-tier mean: Codex (1.00 vs 0.83), and `gpt-5.5@low` is the
cheapest Codex row (effort bought nothing). Fallback: `anthropic/sonnet@low` clears the hard bar
(0.83 ≥ 0.8) with 0 errors and near-identical latency; it misses the easy tier's bar on fenced
answers only (see caveat). During a Codex limit window the app runs on Sonnet at that quality.

**Failover drill (gateway `LIGHTTRACK_GATEWAY_DEV=1`, 2026-09-15).** (1) real call through
`resolve_provider("match_reasoning") → generate`: `source=llm`, 11.9 s, served by
`codex/gpt-5.5@low`, `fell_back=0`, ledger row `gateway / codex/gpt-5.5@low / ok`;
(2) `X-LightTrack-Simulate: exhausted:codex` → `x-lighttrack-fell-back: 1`, model
`anthropic/sonnet@low`, attempts `[codex exhausted, sonnet served]`, `/health` cooldowns
`[{codex, 287 s}]`; (3) next call with no header → attempts `[codex skipped_cooling, sonnet served]`,
9.4 s; (4) `GET /v1/events?project=kp&name=match_reasoning`: an `error` row on `codex/gpt-5.5`
(`provider_failed`, `failure_class=transient`) and a `success` row on `anthropic/sonnet` (`fell_back`)
sharing one `trace_id`; all rows `source=lt-gateway` — no duplicate app-side row.
