# Model benchmark — which model should you run? (measured 2026-08-05)

> **Dated snapshot.** This is the 6-model × 8-op run that used to live in the root
> README. A later, larger grid (15 ops × 4 models, n=4, 2026-08-12) with a
> recalibrated judge is in
> [`../architecture/llm-model-matrix.md`](../architecture/llm-model-matrix.md); read
> that one first for current model choice, and rerun via the harness described in
> [`../architecture/llm-provider-layer.md`](../architecture/llm-provider-layer.md)
> → Benchmarks before treating any single number as current. This page is kept
> because it is the only run that includes open/challenger models and a local 8B.

Short version: a local 8B is genuinely fine for single-extraction and single-decision
work and noticeably weaker on multi-deliverable output (scorecards, campaign packs).

8 production use cases × n=3, run through the real production prompts/fallbacks via
`pipeline/jobfit/llm/bench/`. `claude_cli` Sonnet/Opus; `qwen` = Qwen Cloud API
(qwen3.8-max, glm-5.2, deepseek-v4-flash-0731); `ollama` = local LFM2.5-8B-A1B.
The three axes are kept separate: **quality** is LLM-judged (Claude-CLI judge, 1–10,
over real LLM outputs only — a run that degraded to the deterministic fallback never
feeds quality), while **reliability** and **economics** are measured facts from the
call envelopes. Whether cost or latency binds depends on the op's mode: *online* ops
(match_reasoning, jd_ingest, scorecard, group_compare, weight_proposal) answer to
p50; *background* ops (automation passes, campaign, devcase design) answer to $/task.

**Judged quality** (1–10):

| use case | sonnet | opus | qwen3.8-max | glm-5.2 | deepseek-v4 | lfm2.5:8b |
|---|--:|--:|--:|--:|--:|--:|
| automation_screen | 8.0 | 6.3 | 5.5 | 7.0 | 6.3 | 6.7 |
| campaign_pack | 6.0 | 5.0 | 3.0 | 3.3 | 3.0 | 3.3 |
| devcase_case_design | 8.0 | 7.7 | 3.0 | 3.0 | 3.0 | 6.0 |
| group_compare | 8.3 | 7.0 | 5.0 | 6.5 | 7.0 | 4.3 |
| interview_scorecard | 7.3 | 7.0 | 3.0 | 2.0 | 2.0 | 4.3 |
| jd_ingest | 6.0 | 6.0 | 5.0 | 4.0 | 4.3 | 5.0 |
| match_reasoning | 7.3 | 6.0 | 6.7 | 7.3 | **8.0** | 5.7 |
| weight_proposal | 7.7 | 5.7 | 4.0 | 4.0 | 4.0 | 3.7 |
| **mean** | **7.3** | **6.3** | **4.4** | **4.6** | **4.7** | **4.9** |

**Measured reliability & economics** (8-op means):

| model | llm-rate | $/task | p50 |
|---|--:|--:|--:|
| sonnet (CLI) | 100% | $0.19 | 34.4s |
| opus (CLI) | 100% | $0.31 | 47.5s |
| qwen3.8-max | 66% | $0.020 | 57.0s |
| glm-5.2 | 92% | $0.013 | 41.7s |
| deepseek-v4-flash | 88% | **$0.0015** | 26.9s |
| lfm2.5:8b (local) | 100% | $0 | **12.5s** |

What this table is for: the **open-vs-commercial gap**, not a leaderboard. At n=3
per cell with a Claude-family judge, the Sonnet-vs-Opus ordering is within noise
(and short structured recruiter tasks don't reward the deliberation tier anyway) —
read the commercial columns as one ~7-point tier. The real picture: commercial
Claude holds a ~2.5-point quality lead over every open/challenger model on
multi-deliverable tasks (scorecards, campaign packs, weight rationales), while the
gap nearly closes on single-extraction/single-decision ops — deepseek-v4-flash even
tops match_reasoning at ~1/100th of Sonnet's $/task, and the local 8B is the most
*reliable* challenger (100% served, valid JSON, fastest, $0). Full method, per-op
economics and caveats (qwen-cloud scorecard/devcase runs hit the 2048 maxTokens
ceiling): see
[`../architecture/llm-model-matrix.md`](../architecture/llm-model-matrix.md).
