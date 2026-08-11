# LLM model matrix — which model for which recruiter task (judged, 15 ops × 4 models)

> **Dated benchmark snapshot** (generated 2026-08-11). Rerun via
> `docs/architecture/llm-provider-layer.md` → Benchmarks before treating any
> single number here as current — models and prices move.

**What ran:** the bench harness (`pipeline/jobfit/llm/bench/`) over **15 production
use cases × 4 models** on the seed corpus (`data/seed_candidates`,
`data/seed_calibration`) through the *real* production functions — same prompts, same
coercion, same deterministic fallbacks. Each cell is `--limit 2` (n=2 scenarios).
Targets ran on their **native providers** (gemini / qwen-gateway / Claude CLI), not
OpenRouter. Judge = **Fable 5** via the Claude CLI (`--judge-model fable`), scoring
relevance / correctness / adherence 1–10 against an **anchored rubric** with
**per-scenario input evidence** (see below — this round's numbers are NOT comparable
to the 2026-07-07 matrix).

Targets: `gemini-3.6-flash` (gemini), `deepseek-v4-flash` (qwen gateway, GA slug),
`claude-sonnet-5` and `claude-opus-5` (Claude CLI). `gpt-5.4-mini` is the openai
provider default but was NOT measurable (no `OPENAI_API_KEY` in this environment);
`glm-5.2` / `tencent-hy3` / `mimo-v2.5-pro` were **descoped** this round.
Records: `tmp/bench/round-20260811/` (`full-api-keep` + `full-api2-keep` +
`full-api3` + `full-cli`; the `calib-a`/`calib-b` dirs are the judge-calibration
evidence).

## Why this round's scale is different (the 7.2 ceiling was the harness)

The 2026-07-07 matrix averaged ~7 with no cell above 8.6 — which read as "all
models are mediocre". Re-evaluation showed the ceiling was **ours**, not the
models':

1. **Unanchored judge** — "score 1–10, be critical" compresses an LLM judge into
   the 5–8 band. The rubric now anchors each band to the decision a recruiter
   would make (9–10 = ship as-is) and instructs the judge to use the tails.
2. **Evidence-free judge** — the judge saw seed *ids*, never the input, so it
   couldn't ground correctness (and once evidence was added, an *excerpt that was
   too thin* made it read grounded facts as fabrications — a model scored 2/10
   for "inventing" a role that was verbatim in the candidate's highlights).
   Every scenario now stamps `meta.judgeInput` covering every fact category the
   production prompt feeds.
3. **Wrong task description** — the campaign_pack judge graded "channels, copy,
   targeting", a deliverable the op never produces.
4. **2048-token output ceiling** — weight_proposal (one proposal × 66 candidates),
   campaign_pack and the devcase designs truncated on API adapters and shipped
   fallback stubs (`capabilities.USE_CASE_MAX_TOKENS` now sizes these per op;
   weight_proposal needs 16k).
5. **Silent template backfill** — `match_reasoning` and the `automation.py` ops
   could coerce a failed payload to the deterministic template and still report
   `source="llm"`, so the judge graded the *fallback* as the model. Sources are
   now truthful, and judged quality measures only real model output.

Production fixes that fell out of the recalibration: sentence-aware
`caseIntro` clipping (interview scenarios shipped mid-word cuts), weight
proposals resolved into each candidate's bounds at the trust boundary, an
always-auditable rationale per weight proposal, and the match-reasoning
grounding check accepting highlight-grounded strengths (it was silently
replacing good output with the template).

Calibration evidence (sonnet-5, same scenarios, before → after):
campaign_pack 3.5 → 8.0 · devcase_interview_scenario 4.5 → 8.5 ·
match_reasoning artifacts eliminated. weight_proposal on the flash tier:
4.5 → 7.0–7.5 after the ceiling + bounds fixes.

## The grid (composite 0–10: correctness 0.40 + adherence 0.35 + relevance 0.25)

| op | gemini-3.6-flash | deepseek-v4-flash | sonnet-5 | opus-5 |
|---|--:|--:|--:|--:|
| automation_offer | **8.6** | 8.5 | 8.5 | 8.0 |
| automation_outreach | 6.3 | 6.2 | 5.8 | **7.4** |
| automation_rejection | 5.6 | 6.1 | **7.0** | 5.8 |
| automation_screen | **8.8** | 7.9 | 8.2 | 8.4 |
| campaign_pack | 8.6 | **8.8** | 8.4 | 8.6 |
| devcase_analyze | 8.4 | 7.9 | 8.5 | **8.7** |
| devcase_case_design | 8.7 | 8.0 | 8.8 | **9.0** |
| devcase_interview_scenario | 8.0 | 7.8 | 7.3 | **8.7** |
| devcase_role_design | **8.4** | 8.2 | 8.2 | 7.8 |
| group_compare | **9.4** | 8.4 | 8.9 | 9.3 |
| interview_prep | **9.4** | 8.3 | 8.8 | 8.3 |
| interview_scorecard | 8.4 | 8.6 | **9.0** | 8.8 |
| jd_ingest | 4.1 | 6.5 | 6.8 | **7.3** |
| match_reasoning | **8.8** | 8.4 | 8.4 | 8.2 |
| weight_proposal | 7.3 | 8.0 | 7.8 | **8.4** |
| **mean** | 7.9 | 7.8 | 8.0 | **8.2** |
| **reliability** | 97% | 93% | 97% | 100% |
| **median p50** | **10s** | 14s | 24s | 26s |
| **$/task (measured)** | ~$0.005–0.06 | **~$0.0002–0.006** | ~$0.15–0.27 (CLI) | ~$0.21–0.58 (CLI) |

Bold = op winner. n=2/cell — ties and sub-0.5 gaps are noise.

## Headline reads

1. **The 8–9 band is real now.** 12 of 15 ops have a winner at ≥8.0; the panel
   means sit 7.8–8.2 vs the old 5.6–7.2. What remains below 7 is
   concentrated, not diffuse.
2. **claude-opus-5 is the quality ceiling** (8.2 mean, 6 op wins, 100%
   reliability) — it wins the *hard* ops (case design 9.0, interview scenario
   8.7, weight proposal 8.4, jd_ingest 7.3). It is also the slowest and most
   expensive column; buy it for the assignment-design pipeline, not for volume.
3. **gemini-3.6-flash is the workhorse** — 7.9 mean at ~10s median and
   fractions of a cent, winning 6 ops outright (group_compare 9.4,
   interview_prep 9.4, match_reasoning 8.8, screen 8.8). One real weakness:
   **jd_ingest 4.1** (structured JD parsing, 50% contract validity) — do not
   route jd_ingest to it.
4. **deepseek-v4-flash is the budget pick** (7.8 mean at ~$0.0002–0.006/task,
   GA repricing) — within noise of gemini on most ops, no sub-6 cell except the
   comms pair, but the lowest reliability (93%) and long tails on big payloads
   (weight_proposal p50 2min).
5. **claude-sonnet-5** (8.0 mean) wins scorecard 9.0 and rejection 7.0;
   the middle option when the CLI subscription is already paid.
6. **The comms low-ceiling is genuine.** outreach (5.8–7.4) and rejection
   (5.6–7.0) stay low for every model under an evidence-grounded judge —
   short persuasive prose with thin per-candidate evidence. That is the next
   *prompt* target, not a model-selection problem.

## Per-op routing recommendation

| op | pin | note |
|---|---|---|
| match_reasoning, group_compare, interview_prep, automation_screen/offer | gemini-3.6-flash | top or tied-top quality AND the fastest/cheapest column |
| campaign_pack | deepseek-v4-flash (gemini within noise) | background op — cost rules |
| interview_scorecard | claude-sonnet-5 (deepseek close at 1/100th cost) | online op |
| jd_ingest | claude-opus-5 (7.3) / sonnet-5 | gemini unusable (4.1); the op itself needs prompt work |
| weight_proposal | claude-opus-5 (8.4); deepseek (8.0) for budget | slowest op everywhere — consider batching |
| devcase_analyze / case_design / interview_scenario | claude-opus-5 | the quality-critical assignment pipeline |
| devcase_role_design | gemini-3.6-flash | flattest op — anything ≥7.8 works |
| automation_outreach / rejection | sonnet-5 / opus-5, but see §6 | low ceiling panel-wide; fix the prompt first |

## In-app scorecard (Models tab)

Pipeline: bench matrix → `bake_quality.py` → `app/_lib/llm-quality-scores.ts`
(generated, **do not hand-edit**) → `app/_lib/llm-quality.ts` → **Settings →
Models** (`ModelsQualityOverview.tsx`). This round bakes judge label `fable-5`
and drops the descoped models from the scorecard.

## Reproduce

```bash
# calibrate the judge on the strongest model first, then run the matrix
LIGHTTRACK_QUIET=1 python -m pipeline.jobfit.llm.bench.bench_cli \
  --use-cases match_reasoning,campaign_pack,weight_proposal \
  --targets gemini:gemini-3.6-flash,qwen:deepseek-v4-flash,claude_cli:claude-sonnet-5,claude_cli:claude-opus-5 \
  --limit 2 --judge --judge-model fable --out tmp/bench/<round>

python -m pipeline.jobfit.llm.bench.bake_quality tmp/bench/<round>/... --judge fable-5
# → rewrites app/_lib/llm-quality-scores.ts (commit it)
```

Caveats: n=2/cell (±0.5–1.0 noise); the judge is Claude-family scoring two
Claude targets (style-bias risk on the *ordering* of sonnet vs opus; the API
models are graded cross-family); CLI $/task includes per-call process spawn and
reflects API-equivalent pricing, not subscription marginal cost; a transient
DNS outage during the first API pass was detected and those cells re-run
(`full-api` → `full-api2`), so no outage books against model reliability.

## Prompt-tuning addendum (same day, opus-only verification)

The weak ops were then tuned — prompts, not models (records:
`tmp/bench/round-20260811/tune-a|b|c`, n=2, opus-5, Fable judge; the full-grid
numbers above predate these fixes and now UNDERSTATE the tuned ops):

| op | grid (opus) | tuned | what changed |
|---|--:|--:|---|
| automation_rejection | 5.8 | **8.5** | letters get the shared `_letter_context` evidence; the body names the real decisive gap; when the tier is strong the honest reason is competition, never an invented gap; feedback is evidence-checked |
| automation_offer | 8.0 | **9.0** | cites real profile facts, alludes to (never quotes) aspirations, decided-offer register, consistent sender voice |
| automation_outreach | 7.4 | **8.0** | anchors on aspirations → highlights → matched skills; names what is distinctive about the role |
| interview_prep | 8.3 | **9.0** | questions anchor in named highlights, verify rather than assume, probe stated aspirations |
| match_reasoning | 8.2 | **9.0** | aspirations for every archetype, verdict states total+tier, probes without unstated premises, no constructed URLs/metrics |
| devcase_role_design | 7.8 | **9.0** | must-haves trace to stated input; seniority read off JD signals |
| jd_ingest | 7.3 | 7.5 | `high_school` added to the education enum (the "none-vs-diploma" contradiction was a schema gap), duties-vs-requirements rule, assumption-labelled entry rationale; residual is role-family classification, a taxonomy problem not a prompt one |

Comms letters also carry hardened Czech register rules (consistent vykání,
plural sender voice, gender-neutrality by recast, single-script output). All
letter/prep/reasoning prompt versions bumped in lockstep with the TS cache
mirrors (`automation-run.ts` / `reasoning-run.ts`), so cached prior outputs
self-invalidate.

## Prior rounds

- **2026-07-07** — 15 ops × 7 models via OpenRouter, unanchored Claude-CLI
  judge (means 5.6–7.2; glm/hy3/mimo still in scope). Superseded and NOT
  score-comparable (see "Why this round's scale is different"). In git history
  of this file.
- **2026-08-05** — local-model snapshot (Claude CLI vs Ollama `lfm2.5:8b`,
  + qwen-cloud expansion): the 8B edge tier held ~4.9 vs sonnet 7.3 under the
  old judge; substance-under-complexity, not format, was the failure mode.
  Also in git history; re-run under the new judge before citing numbers.
