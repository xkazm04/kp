# LLM model matrix — which model for which recruiter task (judged, 15 ops × 7 models)

**What ran:** the bench harness (`pipeline/jobfit/llm/bench/`) over **15 production
use cases × 7 models**, all routed through **OpenRouter** (one BYOM key, apples-to-apples),
on the **seed corpus** (`data/seed_candidates`, `data/seed_calibration`) through the *real*
production functions — same prompts, same coercion, same deterministic fallbacks. Each cell
is `--limit 2` (n=2 scenarios). Every **real LLM** output was scored on relevance /
correctness / task-adherence (1–10) by an **LLM-as-judge = the Claude CLI** (`bench_judge`),
a different engine than any target column, so no target grades its own generation.

The score shown is a **composite 0–10** (`app/_lib/llm-quality.ts`): correctness 0.40 +
adherence 0.35 + relevance 0.25, with a validity penalty. It is measured from the model's
**real LLM output only** — a scenario that errored or fell back to the deterministic template
is the *same* template for every model, so it never feeds quality; it counts against
**reliability** (`llmRate`) instead. This is the exact number the in-app Models-tab scorecard
shows.

Targets: `z-ai/glm-5.2`, `deepseek/deepseek-v4-flash`, `xiaomi/mimo-v2.5-pro`,
`openai/gpt-5.4-mini`, `anthropic/claude-sonnet-5`, `google/gemini-3.5-flash`, and
`tencent/hy3` (added later, run solo at limit 2). Records: `tmp/bench-full` (11 ops) +
`tmp/bench-new` (4 ops) + `tmp/bench-tencent` (hy3).

> **Read the caveats before acting on this.** n=2 per cell means ±0.5–1.0 of noise; the
> judge is Claude-family (possible style bias); there is **no cost axis** (OpenRouter returned
> no per-call `$`). This ranks **quality, reliability and latency, not spend**. Treat the grid
> as *directional*, not a leaderboard to 2 decimals.

## The grid (composite 0–10; ⚠ = reliability < 90%; — = never produced usable output)

| op | glm-5.2 | deepseek | mimo | gpt-mini | sonnet-5 | gemini | hy3 |
|---|--:|--:|--:|--:|--:|--:|--:|
| automation_offer | 7.3 | 7.8 | 7.7 | 8.2 | 8.2 | 7.8 | **8.4** |
| automation_outreach | 6.6 | 6.0 | 6.3 | 6.8 | **7.0** | 6.7 | 6.6 |
| automation_rejection | 6.7 | 7.2 | 5.3 ⚠ | 6.7 | 7.9 | **8.1** | 6.7 |
| automation_screen | 8.2 | 7.8 | 8.1 | **8.4** | 7.0 | 8.2 | 7.3 |
| campaign_pack | 3.4 | **6.6** ⚠ | 3.4 | 6.2 | 3.8 | 6.0 | 4.9 |
| devcase_analyze | **8.6** | 7.8 | 5.2 | 8.4 | 5.7 | 8.2 | 3.1 ⚠ |
| devcase_case_design | 4.2 | 5.4 | 4.0 | 7.0 | 4.9 | **7.1** | 3.0 ⚠ |
| devcase_interview_scenario | 5.0 | 5.0 | 4.8 ⚠ | 5.0 | 5.5 | **6.0** | 4.8 ⚠ |
| devcase_role_design | 7.9 | **8.2** | **8.2** | 8.1 | 7.8 | 7.4 | — |
| group_compare | 7.3 | 7.7 | 7.5 ⚠ | 7.3 | **8.4** | 7.6 | 7.2 |
| interview_prep | 8.4 | 7.7 | 5.2 | 8.5 | **8.6** | 7.8 | 7.2 |
| interview_scorecard | 7.3 | 6.7 | 5.1 | **8.2** | 7.8 | 7.0 | 7.8 |
| jd_ingest | **7.1** | 5.6 | 1.6 | 5.5 | 6.1 | 5.2 | — |
| match_reasoning | 7.8 | **8.2** | 6.5 | 8.2 | 7.9 | 6.7 | 8.1 |
| weight_proposal | 5.0 | **6.5** | 4.5 ⚠ | 5.0 | 5.3 | 5.2 | 5.5 |
| **mean** | 6.72 | 6.95 | 5.56 | **7.17** | 6.79 | 7.00 | 6.20 |
| **reliability** | 100% | 97% | 87% | 100% | 100% | 100% | 88% |
| **median p50** | 18.2s | 16.7s | 34.2s | 5.9s | 12.1s | **3.8s** | 35.8s |

Bold = each op's winner. hy3 is measured on 13/15 ops; `—` on role_design (always fell back)
and jd_ingest (both attempts hit tencent-side **429**s).

## Headline reads

1. **No model wins everything, and the top five are tight.** Overall means span 6.72–7.17 for
   five of seven models; the op winner rotates — deepseek 4, gemini/sonnet 3, gpt-mini/glm 2,
   hy3 1, mimo 0. Choose **per-op**, not globally.

2. **gpt-5.4-mini and gemini-3.5-flash are the value picks.** Top-two mean quality *and* the
   two fastest columns (5.9 s / **3.8 s**), 100% reliable, never below ~5. If you want one
   default across the board, it's one of these two.

3. **deepseek-v4-flash is the reasoning specialist** — most op wins (4: campaign_pack,
   role_design, match_reasoning, weight_proposal) and the only model that clears the two
   hardest ops — but **slow** (16.7 s median, long tails).

4. **claude-sonnet-5 is a comms specialist, not a generalist.** Wins the human-voice ops
   (outreach, group_compare, interview_prep) and near-tops offer, but bottoms the
   analytical/structured ops (campaign_pack 3.8, case_design 4.9, analyze 5.7). That the
   Claude-CLI *judge* marks a Claude *generator* down here is a good validity signal — though
   shared-family style bias can't be fully excluded.

5. **mimo-v2.5-pro is the laggard; tencent/hy3 is capable but slow and flaky.** mimo: lowest
   mean (5.56), slowest tier, 87% reliable. hy3: mid-pack **when it works** (6.20, even wins
   automation_offer and is strong on match_reasoning 8.1 / interview_scorecard 7.8) but the
   **slowest** (35.8 s) and **88% reliable** — tencent-side 429s made jd_ingest and role_design
   unmeasurable. Not a safe default on this evidence.

## Per-op recommendations

| op | pick | runner-up | note |
|---|---|---|---|
| match_reasoning | deepseek / gpt-mini (8.2) | hy3 (8.1) | gpt-mini ~3× faster than deepseek |
| automation_screen | gpt-mini (8.4) | glm / gemini (8.2) | pick on speed → gemini |
| automation_offer | hy3 (8.4) | gpt-mini / sonnet (8.2) | hy3 wins but is slow; gpt-mini the practical pick |
| automation_outreach | sonnet (7.0) | gpt-mini (6.8) | low-ceiling op for everyone |
| automation_rejection | gemini (8.1) | sonnet (7.9) | mimo weak (5.3 ⚠) |
| interview_prep | sonnet (8.6) | gpt-mini (8.5) | mimo collapses (5.2) |
| interview_scorecard | gpt-mini (8.2) | sonnet / hy3 (7.8) | |
| weight_proposal | deepseek (6.5) | hy3 (5.5) | **hard for all — see below** |
| jd_ingest | glm (7.1) | sonnet (6.1) | mimo unusable (1.6); hy3 429'd out |
| devcase_analyze | glm (8.6) | gpt-mini (8.4) | sonnet (5.7), mimo (5.2), hy3 (3.1 ⚠) trail hard |
| devcase_role_design | deepseek / mimo (8.2) | gpt-mini (8.1) | flattest op — anything ≥7.4 works |
| devcase_case_design | gemini (7.1) | gpt-mini (7.0) | glm/mimo/sonnet/hy3 weak (3.0–4.9) |
| devcase_interview_scenario | gemini (6.0) | sonnet (5.5) | low-ceiling op |
| group_compare | sonnet (8.4) | deepseek (7.7) | |
| campaign_pack | deepseek (6.6) | gpt-mini (6.2) | **hardest op — see below** |

## The hard ops (low ceilings across the whole panel)

- **campaign_pack (~4.9 avg).** Multi-variant ad copy with channel/targeting constraints. Only
  deepseek (6.6) and gpt-mini/gemini (~6) are usable; glm/mimo bottom out at 3.4. Needs prompt
  work or a stronger tier, not a model swap.
- **devcase_interview_scenario (~5.2), devcase_case_design (~5.1), weight_proposal (~5.4).**
  Complex structured generation / reasoning-under-constraints — where mid-tier models are
  weakest. case_design has a wide spread (3.0→7.1), so the model **does** matter there.

The **easy ops** (winner ≥8, most of the field ≥7): automation_offer, automation_screen,
devcase_analyze, devcase_role_design, interview_prep. Route these on **latency/reliability** —
quality is effectively solved for the whole panel.

## Per-model profiles

- **gpt-5.4-mini** — best mean (7.17), fast (5.9 s), 100% reliable, no weak spot below 5. The
  safe default.
- **gemini-3.5-flash** — 7.00 mean, **fastest by far** (3.8 s), 100% reliable. Weakest on
  jd_ingest (5.2). Best latency/quality trade in the panel.
- **deepseek-v4-flash** — 6.95 mean, most op wins (4), the reasoning/structured specialist —
  but slow (16.7 s) with long tails, and one deterministic fallback (campaign_pack, 97%).
- **claude-sonnet-5** — 6.79 mean; comms specialist (wins outreach/group_compare/interview_prep)
  that bottoms the analytical ops. 100% reliable, mid speed.
- **glm-5.2** — 6.72 mean, best at devcase_analyze (8.6) and jd_ingest (7.1), but slow (18.2 s)
  and weak on campaign_pack / case_design.
- **tencent/hy3** — 6.20 mean on the 13 ops it completed; wins automation_offer, strong on
  match_reasoning (8.1). But the **slowest** (35.8 s) and **88% reliable** (tencent-side 429s
  blanked jd_ingest + role_design). Capable but operationally flaky via OpenRouter today.
- **mimo-v2.5-pro** — 5.56 mean, slow (34.2 s), 87% reliable, no op wins, unusable on jd_ingest
  (1.6). Not production-ready for this workload.

## Reliability (the source-aware correction)

A deterministic fallback is the *identical* template for every model, so judging it measures
nothing about the model — the bake **excludes fallbacks/errors from quality** and books them
against `llmRate`. Latency is LLM-only too, so the near-instant fallback can't fake a fast p50.
Cells flagged ⚠ (reliability < 90%) or `—` (0 usable outputs) are where a model *often or
always failed*, even if its rare successes scored well:

- **tencent/hy3** — 429-rate-limited on OpenRouter: jd_ingest + role_design blanked, several
  ops at 50%. Running it **solo** lifted its overall llmRate from **22% → 77%**, confirming the
  first (concurrent) run's failures were contention, not the model.
- **mimo-v2.5-pro** — 87% reliable; multiple 50% cells and the unusable jd_ingest.
- **deepseek** — one campaign_pack fallback (97%). Everyone else 100%.

## Caveats (don't over-read this)

- **n=2 per cell.** Half-point scores are the median of two runs; a single run can move a cell
  ±0.5–1.0. Ties and sub-0.5 gaps are noise. Re-run at `--limit 8+` before treating any single
  number as load-bearing. (A `--limit 6` full re-run was attempted and stopped; hy3 was added
  at limit 2 to stay consistent with the existing data.)
- **Judge = Claude CLI.** One judge engine, Claude-family. It marks the Claude generator down
  on several ops (good), but shared-family style preference can't be excluded. A second judge
  from a different family would strengthen this.
- **No cost axis.** OpenRouter returned no per-call `$` and these slugs aren't in the price
  book. Output-token counts in each `summary.md` are a rough cost proxy (mimo/deepseek/hy3 are
  the token-heaviest).
- **Judge sees context, not full raw input** — it weights coherence/adherence/completeness and
  does not re-verify factual correctness against the full rendered prompt (the prompt says so).

## In-app scorecard (Models tab)

This data is surfaced to operators in the **Models tab** (`app/features/sub_models/`) so BYOM
users can balance a package on evidence, not vibes:

- **Measured model quality** (`QualityOverview.tsx`) — a per-model ranking (composite score,
  ops won, coverage, median speed, ⚠ reliability) plus a **best-model-per-case** board.
- **Routing ★ hint** — each routing row shows the best measured model for that use case
  (`bestModelForUseCase` rolls the comms sub-ops up into the `automation` use case).

Pipeline: Python bench matrix → `bake_quality.py` → `app/_lib/llm-quality-scores.ts`
(generated, **do not hand-edit**) → pure helpers in `app/_lib/llm-quality.ts` → the UI.
Composite weighting and the op→use-case map live in `llm-quality.ts`; re-bake after any run:

```bash
python -m pipeline.jobfit.llm.bench.bake_quality tmp/bench-full tmp/bench-new tmp/bench-tencent
# → rewrites app/_lib/llm-quality-scores.ts (commit it)
```

## Reproduce

```bash
# generation + judged scorecard for any op set (spends real tokens)
OPENROUTER_API_KEY=… python -m pipeline.jobfit.llm.bench.bench_cli \
  --use-cases match_reasoning,campaign_pack,group_compare \
  --targets openrouter:openai/gpt-5.4-mini,openrouter:google/gemini-3.5-flash \
  --limit 8 --judge --out tmp/bench

# a --judge pass prints "judged N/M" and WARNs loudly if the Claude-CLI judge scored 0
# (unauthenticated / usage-capped) — so an empty judge column can't ship silently.
# A model that 429s under concurrency (e.g. tencent/hy3) is best run SOLO.
```

_Generated 2026-07-07 from `tmp/bench-full` + `tmp/bench-new` + `tmp/bench-tencent`.
15 ops × 7 models, n=2/cell, judge = Claude CLI, composite + reliability from real LLM output._
