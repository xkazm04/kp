---
type: tiger/models-index
last_updated: 2026-06-20
---

# models/ — Lens-3 benchmark rollups

**No benchmark has run yet.** Lens 3 (model × thinking-level optimization) was
deferred in the [[2026-06-20-init-scan]] session: the default `/tiger run` is L1
only, and a meaningful cost comparison is **blocked** until the cost-stamping gaps
are fixed ([[_plumbing]] findings 2 & 3 — 3/4 adapters return `cost_usd=None` and
`MTOK_PRICES` omits every non-Anthropic model, so the bench's cost column is blank).

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

## First targets to benchmark (hypotheses from L1)
- [[automation]] subtasks — uniformly haiku-class; is there downgrade headroom on the
  cheaper subtasks, and does the routing-critical `screen` verdict or candidate-facing
  `outreach`/`rejection` prose want an *upgrade*?
- [[match-reasoning]] — high traffic; cheapest cell that still clears Petra's senior bar.
- [[campaign-pack]] — already sonnet (but the override is dead, see [[campaign-pack]] F1);
  confirm sonnet earns its cost over haiku for copywriting once routing is fixed.

Write one `models/<model>.md` per benchmarked model with per-call-site rows of
`{quality, costUsd, latencyMs, verdict}` + the headline keep/downgrade/upgrade.
