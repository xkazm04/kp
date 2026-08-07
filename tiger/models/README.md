---
type: tiger/models-index
last_updated: 2026-07-15
---

# models/ — Lens-3 benchmark rollups

**Benchmarked so far** (all Claude-only, blind Fable judge):
- [[models/match-reasoning|match-reasoning]] (2026-07-15) → **keep haiku / claude_cli** (near-parity; no upgrade).
- [[models/github-analysis|github-analysis]] (2026-07-16) → **Claude-portable**; prefer sonnet≥haiku (haiku prose over-claim). Strengthens finding #7 (kill the TS bypass).
- [[models/cv-analysis|cv-analysis]] (2026-07-16) → **keep Gemini** (multimodal-only). Injection-resistance + EUR currency-inference held on ALL tiers; sonnet hallucinated tenure → add a derived-fact post-check.
- [[models/grounded-salary|grounded-salary]] (2026-07-16) → **keep Gemini** (web grounding is the point). Surfaced finding #20 **live**: a hardcoded-CZK prompt traps every model on a non-CZ role. Promote #20.
- [[models/automation|automation]] (2026-07-16) → **keep haiku for screen** (verdict-stable, routing-safe). CZ prose: **do NOT upgrade** — sonnet was the *worst* cell (violated the gender-neutral rule twice); keep deterministic templates + add a slashed-gender/vocative post-check.

**Meta-lesson across 5 benchmarks:** for these sites the model tier is rarely the lever —
a bigger model even *lost three times* (haiku's prose slip aside: sonnet hallucinated CV
tenure, and sonnet violated the CZ gender-neutral rule in BOTH prose tasks). The real levers
are **prompt fixes** (CZK lock, name-unmet-must-haves) and **cheap post-checks**
(strength-cites-a-real-token, derived-fact consistency, slashed-gender/vocative) — all
model-independent. **Every benchmarked site keeps its current production model.**

The cost-stamping blocker is **cleared** ([[_plumbing]] F2/F3 resolved 2026-07-15), so
recipe A (`bench_cli`) can now populate real cost/latency columns. The 2026-07-15 run used
recipe B (keyless subagent matrix) under the **Claude-only** engine constraint, judged by
Fable 5. Note the in-repo model-quality matrix ([[bench-judge]]) already covers ~15 text ops;
Tiger Lens 3 targets its blind spots (multimodal cv_analysis, github_analysis, grounded_salary,
voice) + a cross-tier quality read the built-in matrix doesn't judge the same way.

## When ready, run Lens 3
1. Fix [[_plumbing]] F2/F3 (cost stamping) first.
2. Real path (config.md recipe A — drives the production functions over seeded data):
   ```
   python -m pipeline.jobfit.llm.bench.bench_cli \
     --use-cases match_reasoning,automation_screen,campaign_pack \
     --targets claude_cli,anthropic:claude-haiku-4-5,anthropic:claude-sonnet-4-6,gemini,openai:gpt-5-mini \
     --limit 8 --lang en --out tmp/bench
   ```
3. Keyless fallback (config.md recipe B): one subagent per matrix cell via the Agent
   tool's `model`/`effort`, fed the call site's real system prompt + a fixed Character
   input; judge cells with a SEPARATE model. Cache each cell here keyed
   (call-site, model, thinking, input-hash).

## Targets to benchmark (hypotheses from L1)
- ~~[[automation]] subtasks~~ ✅ **DONE 2026-07-16** → keep haiku (screen verdict-stable); CZ prose keep templates (bigger model regressed on neutrality).
- ~~[[match-reasoning]]~~ ✅ **DONE 2026-07-15** → keep haiku.
- ~~[[github-analysis]]~~ ✅ **DONE 2026-07-16** → Claude-portable, prefer sonnet.
- ~~[[cv-analysis]]~~ ✅ **DONE 2026-07-16** (reasoning slice) → keep Gemini (multimodal).
- ~~[[grounded-salary]]~~ ✅ **DONE 2026-07-16** → keep Gemini + fix #20 (proven live).
- [[campaign-pack]] — already sonnet (but the override is dead, see [[campaign-pack]] F1);
  confirm sonnet earns its cost over haiku for copywriting once routing is fixed.

Write one `models/<model>.md` per benchmarked model with per-call-site rows of
`{quality, costUsd, latencyMs, verdict}` + the headline keep/downgrade/upgrade.
