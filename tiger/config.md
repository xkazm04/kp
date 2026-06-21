---
type: tiger/config
app: kp — AI recruiting / hiring platform (Czech retail bank; ČS-seeded)
last_updated: 2026-06-20
---

# config.md — the per-app engine file (THE Tiger overlay seam)

Everything Tiger needs that is specific to *this* repo. The engine
(`.claude/skills/tiger.md`) is stack-agnostic; this file makes it concrete.
Sibling of `uat/env.md` (which covers run mechanics / fixtures for the whole
app) — this file covers **the LLM call sites only**.

## What counts as a call site here

A "call site" is one **use case** in the LLM provider layer — a logical model
call with its own prompt, schema, grounding, and business job. kp already
funnels (almost) every call through one chokepoint, so the use-case catalog
IS the inventory. A site is in scope if it: builds a prompt, sends it to a
model, and shapes the output back into the product. CRUD, deterministic
scoring, and pure data plumbing are out of scope (that's `/uat` / `/code-review`).

## The chokepoint (the single biggest asset)

kp is **unusually well-wrapped**. Read `docs/LLM_PROVIDER_LAYER.md` first.

- **Python provider layer:** `pipeline/jobfit/llm/`
  - `base.py` — `TextProvider` contract: `available() / complete() / complete_json() / map()`,
    bounded retry+jitter on transient errors, JSON extraction/repair, cost
    stamping (`MTOK_PRICES`), usage normalization.
  - `registry.py` — `resolve_provider(use_case)` → reads `KP_LLM_CONFIG`, returns
    a configured adapter (or `MonitoredClaudeCli` for local dev).
  - `capabilities.py` — `USE_CASE_REQUIREMENTS` (the catalog) + `PROVIDER_CAPABILITIES`
    + `DEFAULT_MODELS` + `USE_CASE_MODEL_OVERRIDES`. **This is the source-of-truth
    use-case list.**
  - `monitor.py` — LightTrack telemetry: `emit_result` / `emit_error` per call
    (provider, model, tokens, cost_usd, latency, use_case as `operation`).
  - `config.py` — parses `KP_LLM_CONFIG` (the resolved use_case→provider/model/key map).
  - `adapters/` — `anthropic_api`, `openai_api`, `azure_openai`, `gemini_api` + `claude_cli` (dev default).
  - `bench/` — **the real Lens-3 harness** (`bench_cli.py` + `runner.py`).
- **Gemini specials (not yet folded into an adapter):** `pipeline/jobfit/gemini.py`
  — `analyze_profile_with_gemini` (multimodal PDF/image + Google Search grounding),
  `extract_profile_text_with_gemini`, `grounded_answer`. Multimodal + grounding
  live here because only Gemini has those caps (`capabilities.py`).
- **TS-side call sites** (outside the Python chokepoint — flag any that bypass it):
  - `app/api/github-analysis/route.ts` — GitHub deep analysis (direct Gemini, TS).
  - `app/api/sim/offer-draft/route.ts` — simulation offer draft.
  - `app/api/profile/draft/route.ts` — profile draft (config-gated; default = direct Gemini).
- **Voice (separate realtime registry, NOT the text wrapper):**
  `app/_lib/voice/` (`openai.ts`, `elevenlabs.ts`, `index.ts`) — interview sessions.

## Discovery globs

```
pipeline/jobfit/**/*.py          # the engine + all Python call sites
pipeline/jobfit/llm/**           # the wrapper (chokepoint)
pipeline/jobfit/gemini.py        # multimodal + grounding specials
pipeline/jobfit/devcase/**/*.py  # the dev-hiring LLM family
app/api/**/route.ts              # TS API call sites (github-analysis, sim, profile)
app/_lib/voice/**                # realtime voice
```

Grep seeds for an unwrapped/new call site (a finding if it bypasses the layer):
`resolve_provider`, `ClaudeCliProvider`, `complete_json`, `generateContent`,
`GoogleGenerativeAI`, `@google/genai`, `models.generate`, `_USE_CASE_BY_COMMAND`.

## The use-case catalog (call-site seed list)

From `capabilities.py::USE_CASE_REQUIREMENTS` + the doc's catalog. Tiger groups
the devcase_* and automation_* sub-steps into family notes:

| use_case | default model | caps | primary file(s) |
|---|---|---|---|
| `cv_analysis` | gemini/flash | file_input (+grounding) | `gemini.py`, `pipeline.py` |
| `profile_extract` | gemini/flash | file_input | `gemini.py` |
| `match_reasoning` | anthropic/haiku | json | `match_reasoning.py` |
| `automation` (screen/outreach/reject/prep/scorecard/rematch) | anthropic/haiku | json | `automation.py` |
| `campaign_pack` | anthropic/sonnet | json | `campaign.py` |
| `jd_ingest` | anthropic/haiku | json | `jobs.py`, `app/_lib/job-ingest.ts` |
| `profile_draft` | anthropic/haiku | json | `profile_draft_cli.py`, `api/profile/draft` |
| `group_compare` | anthropic/haiku | json | `group_compare.py` |
| `weight_proposal` | anthropic/haiku | json | `insights.py` |
| `interview_scorecard` | anthropic/haiku | json | `interview-rubric.ts`, rubric py |
| `devcase_*` (analyze/role_design/case_design/reflect/tooling/evaluate/transfer/judge/interview_scenario/seed) | anthropic/sonnet+haiku | json | `devcase/*` |
| `github_analysis` | gemini/flash | json | `app/api/github-analysis/route.ts` |
| (grounded salary) | gemini grounded | grounding | `gemini.py::grounded_answer`, `market_salary_cli.py` |
| (soft signals) | claude_cli | json | `soft_signals.py` |
| `interview_realtime` | elevenlabs \| openai-realtime | — | `app/_lib/voice/*` |

## Model-invocation recipe (Lens 3 — model optimization)

Two paths, both keyless-friendly for local benchmarking:

**A. Real production bench (preferred — drives the actual prod functions):**
```bash
python -m pipeline.jobfit.llm.bench.bench_cli \
  --use-cases match_reasoning,automation_screen,campaign_pack \
  --targets claude_cli,anthropic:claude-haiku-4-5,anthropic:claude-sonnet-4-6,gemini,openai:gpt-5-mini \
  --limit 8 --lang en --out tmp/bench
```
Reports per (use case × target): contract valid-rate, llm-rate, p50/p95 latency,
mean tokens, total cost → `records.jsonl` + `summary.{json,md}`. Quality beyond
validity = LightTrack's LLM-as-judge (`--include-payloads` + `LIGHTTRACK_URL`).
NEEDS provider keys for the metered targets; `claude_cli` works on the dev
subscription.

**B. Subagent matrix (keyless fallback, learned recipe):** dispatch one Agent
per matrix cell with the Agent tool's `model`/`effort` params, fed the call
site's REAL system prompt + a fixed Character input; it returns schema JSON +
a latency proxy (subagent wall-clock). Judge the cells with a SEPARATE model
(never the one under test). Cache every cell in `models/*` keyed by
(call-site, model, thinking, input-hash) so re-runs are free.

## Fixtures (for Lens-2 L2 live generation)

Same seeders as `uat/env.md`. The cheapest reproducible LLM-input set:
- `pipeline/jobfit/eval/seed_cv_fixtures.py` — candidates → CVs → **real** Gemini
  analysis (needs Gemini key; slow) — the canonical cv_analysis input.
- `data/seed_candidates` × seed job corpus (`seed_jobs_csas.py`) — the bench's
  default input matrix for match_reasoning / automation / campaign.
- `seed_analyses.py` — pre-computed analyses (no key needed) for downstream sites.
- Snapshot/restore: `npm run db:dump` / `npm run db:load`.

## API keys (bounds what Lens 2-L2 / Lens 3-A can run)

Managed in-app (`/api/llm/keys`, `/api/llm/config`, AES-GCM under `KP_SECRET`)
and/or env (`GEMINI_API_KEY`, etc; see `.env.example`). **Open question (resolve
before first --live run): which keys are present locally.** Without keys, Lens 1
(static) + Lens 2-L1 (designed-output / grounding, code-visible) are fully in
scope; Lens 2-L2 + Lens 3-A are `scope_note`, and Lens 3-B (subagent matrix) is
the keyless substitute.

## Telemetry already present (don't re-invent — verify + extend)

- LightTrack: every metered `complete()` + `MonitoredClaudeCli` emits an event.
  Activation double-gated (SDK importable AND `LIGHTTRACK_URL` set), fire-and-forget.
- `llm_usage` table (the ledger the pricing meters read) — writer `insertLlmUsage`
  exists; **Phase-4 emission from every envelope is the documented gap.** A
  call site that doesn't reach the ledger is a Lens-1 finding.
- Cache: `match_reasoning` is cached 168h `llm`-source-only
  (`reasoning-cache-policy.ts`). Check which OTHER sites dedupe by input-hash
  (`app/_lib/cache-key.ts`) vs recompute every call — that's the top Lens-1 yield.

## Open config questions (resolve as Tiger runs)
1. Which provider keys are present locally (gates Lens 2-L2 + Lens 3-A).
2. Is `LIGHTTRACK_URL` set locally (gates whether live runs auto-score)?
3. Confirm the `_USE_CASE_BY_COMMAND` map in `claude_cli.py`/CLIs is complete vs
   the catalog (a command with no use_case tag = mis-attributed telemetry = finding).
