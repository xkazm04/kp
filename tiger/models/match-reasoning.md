---
type: tiger/model-benchmark
call_site: "[[match-reasoning]]"
date: 2026-07-15
lens: 3 (model optimization)
recipe: B (keyless subagent matrix — Agent tool model/effort params)
engine_constraint: Claude-only (user directive: own engine or Claude Code CLI); judge = Fable 5 (never a tier under test)
inputs: 2 fixed ČS-domain pairs — A=strong-fit senior engineer (missing 1 must-have), B=partial-fit QA candidate (missing all 4)
recommendation: KEEP haiku / claude_cli (no upgrade justified)
---

# Lens 3 — [[match-reasoning]] model matrix (2026-07-15)

First real Tiger Lens-3 benchmark. Held the **real** production system+user prompt
(`match_reasoning._system_for` + `build_prompt` + `language_directive("en")`) fixed and
ran it across 5 Claude cells × 2 grounded inputs = 10 cells. Each generation subagent
acted purely as the model under test (no tools). Two blind **Fable 5** judges (one per
input) scored the 5 anonymized outputs (cell labels shuffled) on the senior-bar:
groundedness · honesty/correctness · probe quality · ship-ability.

## The matrix (overall /10, blind judge — corrected for 2 judge context errors, see below)

| cell (model × effort) | A: strong-fit | B: weak-fit (honesty test) | contract | latency proxy* |
|---|---|---|---|---|
| **haiku × low** | 6–7 ⚠ | 8 ✓ | valid | ~11.4s / 11.5s |
| **haiku × high** | 8 ✓ (raw 6) | 8 ✓ | valid | ~12.0s / 10.8s |
| **sonnet × low** | 9 ✓ | 9 ✓ | valid | ~10.2s / 9.6s |
| **sonnet × high** | 9 ✓ | 9 ✓ | valid | ~9.5s / 39.0s (outlier) |
| **opus × low** | 9 ✓ (raw 8) | 9 ✓ (raw 8) | valid | ~13.4s / 11.8s |

\* Subagent wall-clock — dominated by agent scaffolding, **too noisy to rank tiers**.
Real latency/cost needs recipe A (`bench_cli`). Every cell returned contract-valid JSON
(llm-rate 100%); some wrapped in ```json fences, which prod `_extract_json` handles.

## Judge-error corrections (honesty note — evidence or it didn't happen)
Fable made **two false-positive hallucination flags**, both corrected upward above:
1. On input A it docked the two cells that mentioned a *"monolith-to-microservices
   migration"* and *"CI/CD"* as fabrications — but **both are in the candidate facts**
   (summary + skills). Those cells (haiku-high, opus-low) were unfairly penalized.
2. On input B it docked the opus cell for *"inventing"* Kafka/Go nice-to-haves and
   `entryEligible:false` — but those **were in the job input**; I had abbreviated them
   out of the *judge's* context, not the generators'. My briefing error, not the model's.
Lesson for next Lens-3 run: give the judge the **verbatim** input, never a paraphrase.

## The one REAL quality miss
haiku × low on the strong case hallucinated that *ledger-bench "measures single-machine
PostgreSQL throughput"* (the facts only say "benchmark harness for the ledger service"),
and leaned on hypothetical-design probes over experience probes. This is exactly the
failure mode [[match-reasoning]] **finding #2** (verify a strength/claim cites a real CV
token) would catch — the benchmark independently reinforces that backlog item.

## Frontier & recommendation → **KEEP haiku / claude_cli**
- **Quality is at near-parity.** After corrections, sonnet ≈ opus ≈ 9; haiku ≈ 7.5–8.
  All tiers correctly **discriminated** strong-vs-weak and, critically, **none flattered
  the unqualified QA candidate** — every cell opened with an unambiguous rejection and
  named all four missing must-haves. The honesty test passed across the board.
- **No upgrade justified.** Sonnet/opus add only second-order polish (slightly crisper
  verdicts, one fewer micro-slip) that does **not** clear sonnet's ~3–5× or opus's ~15×
  cost multiple for an internal-facing rationale. Production already runs the cheapest
  tier (claude_cli haiku-class) — the frontier is already at the floor.
- **Cheapest robustness win is code, not model:** implement finding #2's post-check to
  neutralize haiku's lone weakness for ~$0.
- **Effort axis:** `high` effort gave haiku a small lift (fewer slips) at higher latency;
  not worth forcing — the post-check is a better lever.

## Honest ceilings
- n=1 input per fit-tier → **directional, not statistical**. Confirm with recipe A over
  the seeded corpus (`--use-cases match_reasoning --targets claude_cli,anthropic:claude-haiku-4-5,anthropic:claude-sonnet-4-6 --limit 8`)
  once you want hard cost/latency columns (now unblocked — cost stamping works).
- Cross-model here = cross-Claude-tier only (per the engine constraint). A Gemini/OpenAI
  comparison for this site would need the metered path + keys.
