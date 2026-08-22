# LLM model matrix — which model for which recruiter task (judged, 15 ops × 4 models, n=4)

> **Dated benchmark snapshot** (generated 2026-08-12, round `tmp/bench/round-20260811/`).
> Rerun via `docs/architecture/llm-provider-layer.md` → Benchmarks before treating any
> single number here as current — models and prices move.

**What ran:** the bench harness (`pipeline/jobfit/llm/bench/`) over **15 production
use cases × 4 models × n=4 scenarios/cell** on the seed corpus, through the *real*
production functions — same prompts, coercion, deterministic fallbacks. Targets ran
on their **native providers** (gemini / qwen-gateway / Claude CLI). Judge = **Fable 5**
via the Claude CLI, scoring relevance / correctness / adherence 1–10 against an
**anchored rubric** with **per-scenario input evidence**. This grid measures the
**tuned prompts** (letters v3 / offer v4 / prep v2 / match-reasoning v3 /
role-design v4), the per-use-case output ceilings, and the catalog-migrated
calibration seed — earlier grids in this file's git history are not comparable.

Targets: `gemini-3.6-flash` (gemini), `deepseek-v4-flash` (qwen gateway, GA slug),
`claude-sonnet-5`, `claude-opus-5` (Claude CLI). `gpt-5.4-mini` is the openai
provider default but was NOT measurable (no `OPENAI_API_KEY` in this environment);
glm/hy3/mimo are descoped.

## The journey to this grid (why earlier numbers were wrong)

The 2026-07-07 matrix averaged ~7 and read as "all models are mediocre". Every
recalibration step found the ceiling in OUR stack, not the models:

1. **Judge**: unanchored rubric compressed scores into 5–8; no input evidence meant
   correctness was scored on vibes (and a too-thin evidence excerpt made the judge
   read verbatim CV facts as fabrications); campaign_pack was graded against a
   deliverable the op never produces.
2. **Output ceilings**: the 2048-token default truncated weight_proposal (needs
   16k for a 60-candidate pool), campaign_pack, the devcase designs, then the
   letters/prep (`automation` → 4096) and jd_ingest (→ 6144). Truncation coerced
   to deterministic fallbacks that were then graded as the model — "gemini is weak
   at letters" was actually gemini's thinking tokens eating the cap
   (`capabilities.USE_CASE_MAX_TOKENS` is the fix; CLI targets have no ceiling,
   which is why the Claude columns never showed it).
3. **Silent template backfill**: coercion could discard a model payload and ship
   the deterministic template as `source="llm"` (match_reasoning, automation
   tasks) — the judge graded the fallback. Sources are truthful now.
4. **Prompt starvation**: the letters saw a name + three skill tags; no model
   could personalize. The tuned prompts feed a shared evidence context and demand
   anchoring (aspirations → highlights → matched skills), evidence-checked
   feedback, and hard constraints for weaker models (figure in the body, all
   question fields filled, no implied interviews).
5. **Stale seed taxonomy**: the calibration corpus carried pre-lock family labels
   (`administration`, `consulting`…) no component knows — correct catalog picks
   were judged as contradictions. Migrated to the locked 16-family catalog.

## The grid (composite 0–10: correctness 0.40 + adherence 0.35 + relevance 0.25)

| op | gemini-3.6-flash | deepseek-v4-flash | sonnet-5 | opus-5 |
|---|--:|--:|--:|--:|
| automation_offer | 9.0 | 8.8 | 8.7 | 9.0 |
| automation_outreach | 7.9 | 7.7 | 8.1 | **8.8** |
| automation_rejection | 8.7 | 8.8 | 9.0 | **9.1** |
| automation_screen | 8.6 | 8.3 | 8.6 | **8.8** |
| campaign_pack | 8.6 | 8.6 | 8.6 | **8.7** |
| devcase_analyze | 8.4 | 8.2 | **9.0** | 8.9 |
| devcase_case_design | 8.5 | 8.7 | 8.7 | **9.0** |
| devcase_interview_scenario | 8.6 | 8.2 | 8.4 | **8.8** |
| devcase_role_design | 8.6 | 8.6 | 8.8 | 8.8 |
| group_compare | 9.0 | 8.6 | **9.5** | 9.3 |
| interview_prep | 9.0 | 8.6 | 9.1 | **9.3** |
| interview_scorecard | 8.2 | 8.4 | 8.8 | **9.0** |
| jd_ingest | 7.7 | **8.6** | 8.2 | 8.0 |
| match_reasoning | 9.0 | 8.6 | 9.0 | **9.1** |
| weight_proposal | 5.7 | 8.1 | 8.2 | **8.8** |
| **mean** | 8.4 | 8.5 | 8.7 | **8.9** |
| **reliability** | 98% | 98% | 97% | **100%** |
| **median p50** | **13s** | 18s | 30s | 19s |
| **$/task (measured)** | ~$0.004–0.06 | **~$0.0004–0.006** | ~$0.12–0.41 (CLI) | ~$0.23–0.59 (CLI) |

Bold = op winner. n=4/cell (~±0.3–0.5 noise); ties within 0.3 are noise.

## Headline reads

1. **The 8–9 band is the panel norm now.** Panel means 8.4–8.9 (was 5.6–7.2 two
   harness generations ago); every op's winner scores ≥8.6; 56 of 60 cells sit
   at 7.7+.
2. **claude-opus-5 is the across-the-board quality leader** — 8.9 mean, top or
   joint-top on 12 of 15 ops (10 outright, plus dead heats with gemini on
   `automation_offer` and sonnet on `devcase_role_design`), 100% reliability, and
   after the CLI's own latency profile it is not even
   slow (19s median). It is the priciest column; buy it where quality binds
   (assignment design, weight proposal, outreach).
3. **The flash tier is within half a point of the frontier.** deepseek 8.5 at
   ~1/100th of the CLI-equivalent cost is the value pick (and the jd_ingest
   winner, 8.6); gemini 8.4 is the latency pick (13s). Route volume ops there
   with confidence.
4. **Two genuine weak spots remain**: gemini on weight_proposal (5.7 — it
   under-covers a 60+ candidate pool even with a 16k ceiling; do not route that
   op to it) and outreach across the panel except opus (7.7–8.1 vs 8.8) — short
   persuasive prose with thin evidence stays the hardest register for smaller
   models.
5. **jd_ingest is the last op without a 9-capable model** (winner 8.6). The
   residual is role-family classification granularity and entry-profile
   heuristics — taxonomy/deterministic-code work, not prompts.

## Per-op routing recommendation

| op | pin | note |
|---|---|---|
| match_reasoning, group_compare, interview_prep, screen, offer | gemini-3.6-flash | 8.6–9.0 at the panel's best latency/cost |
| campaign_pack, jd_ingest | deepseek-v4-flash | jd_ingest winner; campaign tied — cost rules a background op |
| interview_scorecard, devcase_analyze | claude-sonnet-5 (deepseek close behind) | |
| weight_proposal, outreach, devcase case/scenario design | claude-opus-5 | the ops where the frontier margin is real |
| rejection, role_design | any column ≥8.6 | flattest ops — route on cost |

## In-app scorecard (Models tab)

Pipeline: bench matrix → `bake_quality.py` → `app/_lib/llm-quality-scores.ts`
(generated, **do not hand-edit**) → `app/_lib/llm-quality.ts` → **Settings →
Models** (`ModelsQualityOverview.tsx`). Baked from
`n4-api-keep + n4-api2-keep + n4-api3 + n4-cli`, judge label `fable-5`.

**The Wins column credits every model in a dead heat** (`topModelsForOp` in
`llm-quality.ts`), so per-model counts can sum above the op count. It used to ask
"is this model `bestModelForOp`", which awards a tie to whichever model the bench
run happened to write into `models` first — the record order is not a ranking, and
that artifact was reaching a published number (opus read 10/15 on the ops it is
top or joint-top on 12 of). Composites are rounded to one decimal before the
comparison, so a tie means a tie at the precision the table shows.

## Reproduce

```bash
LIGHTTRACK_QUIET=1 python -m pipeline.jobfit.llm.bench.bench_cli \
  --use-cases <ops> \
  --targets gemini:gemini-3.6-flash,qwen:deepseek-v4-flash,claude_cli:claude-sonnet-5,claude_cli:claude-opus-5 \
  --limit 4 --judge --judge-model fable --out tmp/bench/<round>

python -m pipeline.jobfit.llm.bench.bake_quality tmp/bench/<round>/... --judge fable-5
```

Method notes: calibrate the judge on the strongest model first and READ the
transcripts as arbiter before trusting a low cell — across this round, most "low
model scores" were harness or production defects (truncation, template backfill,
starved prompts, stale seed labels), and the judge's issue lists located every one
of them. Run CLI generation and Fable judging sequentially (subscription limits);
a judge pass that scores 0 fails loudly.

Caveats: the judge is Claude-family scoring two Claude targets (style-bias risk on
the sonnet-vs-opus ordering; the API models are graded cross-family); CLI $/task
reflects API-equivalent pricing, not subscription marginal cost; two campaign_pack
p95 outliers (~15min/~90min waits) came from CLI contention, not the models.

## Prior rounds (git history of this file)

- **2026-08-11 n=2 grid** — first anchored-judge round (means 7.8–8.2, pre-tuning).
- **2026-08-11 prompt-tuning addendum** — weak ops 5.8–8.3 → 8.0–9.0 on opus.
- **2026-07-07** — 15 ops × 7 models via OpenRouter, unanchored judge (5.6–7.2;
  glm/hy3/mimo in scope). Not score-comparable.
- **2026-08-05** — local-model snapshot (Ollama lfm2.5:8b vs CLI Sonnet): re-run
  under the new judge before citing.
