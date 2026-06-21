---
id: campaign-pack
type: tiger/call-site
modality: text
file: pipeline/jobfit/campaign.py:238
wrapper: resolve_provider (but the API route never injects KP_LLM_CONFIG — see Finding 1)
provider: anthropic  model: claude-sonnet-4-6 (USE_CASE_MODEL_OVERRIDES capabilities.py:63) — NOT reached in the app
schema: yes — coerce() (campaign.py:213-230), per-field validate+normalize+deterministic self-repair (best-validated in the family)
grounding: 4/7 sources
quality_score: 3  code_score: 3
recommended_model: "—"
status: assessed
last_scanned: 2026-06-20
characters: ["[[jana-sourcer]]", "[[hr-media-agency-talent]]"]
---
## What it does
Generates a sourcing campaign pack per job: ~8 feed-ready ad-copy variants + 15s vertical video scripts (hook→offer→proof→cta), per candidate language (:1-21). Entry: app/api/jobs/[id]/campaign/route.ts (GET reads stored pack, POST spawns campaign_cli + upserts campaign_packs); campaign_cli.py:54 calls resolve_provider("campaign_pack"). Deterministic builder (:184-211) guarantees a non-empty honest pack with no LLM. NOTE: candidates/outreach/route.ts does NOT use this — it routes through [[automation]] outreach.

## Prompt & grounding
_prompt() (:134-160) is tight: explicit 4-beat, hard JSON shape, null-means-unknown honesty, bilingual boilerplate ban (:154-155). System pins copywriter persona + Czech tech market + honesty (:47-51). lang threads via normalize_lang + language_directive. Grounding gap vs the senior bar: _job_facts() (:91-114) feeds title/seniority/company/location/workMode/languages/salary band/top-6 must-haves/600-char description, with a stated-only filter dropping phantom defaults. Covers **role/JD + comp band + company name = 3 real sources**. Missing for both characters: **target candidate segment (0/1)**, **employer brand/EVP voice (0/1)** (only the company *name*, which the prompt forbids opening with), **competitor differentiation (0/1)**, channel specificity (partial — generic "Reels style", no per-channel framing). Net **4/7** — clears the honesty + real-role bar, only partially the differentiated/segment/on-brand bar; variants risk reading interchangeable.

## Code quality (wrapping · logging · caching)
- Wrapper: routes resolve_provider (campaign_cli.py:54), deterministic fallback (:234-240). Good.
- Schema: strongest in the family — coerce() validates every field, clamps hookType, caps VARIANT_MAX=12, self-repairs to deterministic if zero valid (:213-230).
- **maxTokens under-provisioned for the intended engine** — DEFAULT_MAX_TOKENS 2048 (base.py:32) not raised for campaign_pack despite sonnet + 8 multi-field variants; over-cap truncation → coerce() silently drops variants.
- Telemetry: monitor → LightTrack; no ledger.
- Caching: intentionally none ("Regenerate = fresh creative pass"); pack durable in campaign_packs keyed (job_id, lang). Acceptable.

## Findings
1. [code] **HIGH — the campaign route never injects KP_LLM_CONFIG, so the sonnet override is dead in the app.** route.ts:52-55 spawns campaign_cli with **no `env`** — unlike automation-run.ts:183 and reasoning-run.ts:84 which pass `env: buildLlmConfigEnv()`. So resolve_provider returns the local MonitoredClaudeCli; a customer pinning campaign_pack → anthropic (BYOM) gets it everywhere *except* campaigns. The deliberate claude-sonnet-4-6 quality step (capabilities.py:63) + any maxTokens never reach this site. Fix: pass `env: buildLlmConfigEnv()` to the spawn (one line, mirror automation-run.ts:183).
2. [value] **HIGH — grounding omits segment, brand/EVP, competitor differentiation — the axes both characters grade on.** _job_facts (:91-114) carries role/comp/skills but no audience/brand/differentiator → generic variants. Fix: extend _job_facts/_prompt with optional `segment` + `brand` (stated-only) + per-channel directive; thread from a campaign brief field.
3. [code] **MED — maxTokens not raised for campaign_pack** (base.py:32). Fix: ship params.maxTokens (e.g. 4096) for campaign_pack.
4. [code] **MED — no usage ledger** (spend is observability-only; sonnet is the priciest text use case here). Fix: durable ledger row per complete().
5. [value] **LOW — channel claim generic** (:142). Fix: once a channel input exists, template format/length/tone per channel.

**Strengths:** honesty contract (phantom suppression :96-111), per-field coerce self-repair, per-variant apply-link attribution, stable localized warning codes.
