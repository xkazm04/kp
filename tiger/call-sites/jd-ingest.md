---
id: jd-ingest
type: tiger/call-site
modality: text
file: pipeline/jobfit/jobs_cli.py:44-49
wrapper: resolve_provider
provider: claude_cli (MonitoredClaudeCli default; metered adapter if KP_LLM_CONFIG sets jd_ingest)  model: CLI default (no model pinned)
schema: no strict schema — prompt-embedded key list + normalize_job coercion (jobs.py:399-417 prompt; :296-384 coercion)
grounding: 1/3 sources
quality_score: 3  code_score: 4
recommended_model: "—"
status: assessed
last_scanned: 2026-06-20
characters: ["[[petra-recruiter]]", "[[jana-sourcer]]"]
---
## What it does
Turns a pasted prose job ad into a structured Job. Route app/api/jobs/ingest/route.ts:27 → ingestJobAd (job-ingest.ts:162) spawns jobs_cli ingest → resolve_provider("jd_ingest") (jobs_cli.py:46) → ingest_raw_ad (jobs.py:423). normalize_job (jobs.py:296) resolves taxonomy/salary band/seniority + the deterministic entry profile, stamping defaulted_fields. Result upserted with content-hash dedup as draft (route.ts:32).

## Prompt & grounding
Prompt at jobs.py:394-420 is disciplined for Petra: "never invent requirements" (:396), salary "NEVER estimate one" null-when-unstated (:413-414), must/nice × prerequisite/learnable split (:415-417) — faithful structured extraction, with defaulted_fields provenance. Grounding **1/3**: only the raw ad text feeds the prompt. The role-family taxonomy + CZK anchor bands are applied *deterministically after* the call (:324-352), so the model picks role_family from a bare 3-value enum (:405) with no definitions — a thin ad can be misfamilied, and since the anchor band is keyed on role_family×seniority, a wrong family silently yields a wrong phantom salary band.

## Code quality (wrapping · logging · caching)
Routes cleanly through resolve_provider → MonitoredClaudeCli, LightTrack operation=jd_ingest. source contract preserved. Abort signal threaded (job-ingest.ts:162). maxDuration=180 > 120s timeout. Gaps: (1) **no input-hash dedupe before the model** — jobContentHash/job_ingests dedup runs *after* ingestJobAd returns (route.ts:27 then :32), cache-key.ts is analyze-only, so the same ad pasted twice re-calls the LLM; bulk import (IngestAdPanel.tsx:106) makes this routine; (2) **no lang threading** — ingest_raw_ad/the prompt take no locale (jobs.py:423), violating the lang invariant; a cs recruiter gets an English-prompted parse; (3) **maxTokens not set** for the metered path (base.py:32 2048, tight for a long ad); (4) ledger gap.

## Findings
- [value] **HIGH — role_family chosen from a bare enum, no definitions** (jobs.py:405). Mis-classification → role_band stamps the wrong phantom salary band. Fix: inline role_family_catalog() descriptions into the prompt (as gemini.py:444-446 does), or pass the deterministic classify_role_family guess as a hint.
- [code] **MED — same ad re-calls the model** (route.ts:27 before :32). Fix: compute jobContentHash(adText) and check job_ingests *before* ingestJobAd.
- [code] **MED — lang not threaded** (jobs.py:423). Fix: add --lang + language_directive(lang); keep enums canonical.
- [code] **LOW — no per-use-case maxTokens** for jd_ingest (base.py:32). Fix: set params.maxTokens (e.g. 3072).
