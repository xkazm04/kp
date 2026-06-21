# Tri-Lens Scan — kp ("Kandidate"), 2026-06-18

> Combined **bug-hunter 🐛 + ui-perfectionist 🎨 + business-visionary 🚀** audit.
> Each of the **42 contexts** was scanned by one subagent wearing all three lenses, surfacing the **top-5 highest-value findings** per context (value = impact ÷ effort·risk). 6 waves of ≤8 parallel subagents.
> Scope: full-stack (Next.js 16 / React 19 / SQLite + Python `jobfit` pipeline). Read-only — **no code changed**.

---

## Totals

| | Critical | High | Medium | Low | **Total** |
|---|---:|---:|---:|---:|---:|
| Across 42 contexts | 30 | 95 | 81 | 5 | **211** |
| Share | 14% | 45% | 38% | 2% | 100% |

Counts verified two ways (sum of `> Total:` headers = 211; count of `**Severity**:` bullets = 211). One context (auth-sessions-tenancy) returned 6; the other 41 returned exactly 5.

---

## ⚠️ Cross-cutting ground truth — multi-workspace tenancy is LIVE, not latent

The dedicated **auth-sessions-tenancy** scan settled the question that recurred in ~10 contexts: **multi-workspace is real and switchable today** (create-then-switch is a 2-click UI action; `current-workspace` derives from the signed session cookie). But **only `analyses` + `profiles` carry/filter `workspace_id`** — every other table (candidate pipeline + PII, interviews, dev-cases, billing, llm keys) is workspace-blind. **The moment a second workspace is created, all the "latent" cross-tenant reads/writes become live data leaks.** This elevates tenancy from "dead code" to the single highest-priority theme. Criticals #2, #3, #7, #9 are direct instances; many Highs/Mediums across the app are the same root cause.

---

## Per-context breakdown

Sorted by criticals, then total.

| Context | C | H | M | L | Total | Report |
|---|---:|---:|---:|---:|---:|---|
| Auth, Sessions & Workspace Tenancy | 2 | 2 | 1 | 1 | 6 | [auth-sessions-tenancy](auth-sessions-tenancy.md) |
| Billing Engine & Webhooks | 2 | 2 | 1 | 0 | 5 | [billing-engine-webhooks](billing-engine-webhooks.md) |
| Model & API Key Management | 2 | 2 | 0 | 1 | 5 | [model-api-key-mgmt](model-api-key-mgmt.md) |
| Application Intake & Apply Flows | 1 | 2 | 2 | 0 | 5 | [application-intake-apply](application-intake-apply.md) |
| Plans, Checkout & Billing UI | 1 | 2 | 2 | 0 | 5 | [billing-ui](billing-ui.md) |
| Candidate Profile & Job Matching | 1 | 2 | 2 | 0 | 5 | [candidate-profile-matching](candidate-profile-matching.md) |
| Communications & Inbound Channels | 1 | 2 | 2 | 0 | 5 | [comms-inbound-channels](comms-inbound-channels.md) |
| CV Analysis Workspace | 1 | 2 | 2 | 0 | 5 | [cv-analysis-workspace](cv-analysis-workspace.md) |
| CV Extraction & Pipeline Services | 1 | 3 | 1 | 0 | 5 | [cv-extraction-services](cv-extraction-services.md) |
| Data Store & Persistence | 1 | 2 | 2 | 0 | 5 | [data-store-persistence](data-store-persistence.md) |
| Dev Lifecycle, Cohort & Outcomes | 1 | 2 | 2 | 0 | 5 | [dev-lifecycle-cohort](dev-lifecycle-cohort.md) |
| Dev Submissions & Live Work Surface | 1 | 3 | 1 | 0 | 5 | [dev-submissions-live](dev-submissions-live.md) |
| Dev Case Authoring & Publishing | 1 | 2 | 2 | 0 | 5 | [devcase-authoring](devcase-authoring.md) |
| Dev Case Pipeline (Python) | 1 | 3 | 1 | 0 | 5 | [devcase-pipeline-py](devcase-pipeline-py.md) |
| Evaluation, Fairness & Seed Data | 1 | 3 | 1 | 0 | 5 | [eval-fairness-seed](eval-fairness-seed.md) |
| GitHub Evidence & CV Utilities | 1 | 1 | 2 | 1 | 5 | [github-evidence-cv](github-evidence-cv.md) |
| Group Evaluation & Fairness | 1 | 2 | 2 | 0 | 5 | [group-eval-fairness](group-eval-fairness.md) |
| Guided Pipeline Simulation | 1 | 2 | 2 | 0 | 5 | [guided-simulation](guided-simulation.md) |
| Interview Scheduling, Prep & Rubric | 1 | 2 | 2 | 0 | 5 | [interview-scheduling-prep](interview-scheduling-prep.md) |
| Interview Simulation & Comparison | 1 | 2 | 2 | 0 | 5 | [interview-simulation](interview-simulation.md) |
| JD Authoring Library & Templates | 1 | 3 | 1 | 0 | 5 | [jd-authoring-library](jd-authoring-library.md) |
| Job Postings & Lifecycle | 1 | 2 | 2 | 0 | 5 | [job-postings-lifecycle](job-postings-lifecycle.md) |
| Landing & Marketing | 1 | 3 | 1 | 0 | 5 | [landing-marketing](landing-marketing.md) |
| Matching & Transformation Engine | 1 | 3 | 1 | 0 | 5 | [matching-transformation-engine](matching-transformation-engine.md) |
| Offers & Onboarding | 1 | 2 | 2 | 0 | 5 | [offers-onboarding](offers-onboarding.md) |
| Sourcing, Campaigns & Rediscovery | 1 | 2 | 2 | 0 | 5 | [sourcing-campaigns-rediscovery](sourcing-campaigns-rediscovery.md) |
| Tasks & System Operations | 1 | 2 | 2 | 0 | 5 | [tasks-system-ops](tasks-system-ops.md) |
| Analysis Result Panels | 0 | 2 | 3 | 0 | 5 | [analysis-result-panels](analysis-result-panels.md) |
| Analytics & Calibration Dashboards | 0 | 1 | 4 | 0 | 5 | [analytics-calibration](analytics-calibration.md) |
| App Shell & Navigation | 0 | 1 | 3 | 1 | 5 | [app-shell-navigation](app-shell-navigation.md) |
| Architecture Diagrams | 0 | 1 | 3 | 1 | 5 | [architecture-diagrams](architecture-diagrams.md) |
| Hiring Automation & Scheduler | 0 | 3 | 2 | 0 | 5 | [hiring-automation-scheduler](hiring-automation-scheduler.md) |
| LLM Provider Layer (Python) | 0 | 3 | 2 | 0 | 5 | [llm-provider-layer-py](llm-provider-layer-py.md) |
| Pipeline Board & Candidate Drawer | 0 | 3 | 2 | 0 | 5 | [pipeline-board-drawer](pipeline-board-drawer.md) |
| Pipeline CLIs & Script Bridges | 0 | 3 | 2 | 0 | 5 | [pipeline-clis-bridges](pipeline-clis-bridges.md) |
| Pipeline Test Suite (Python) | 0 | 4 | 1 | 0 | 5 | [pipeline-test-suite-py](pipeline-test-suite-py.md) |
| Privacy, Consent & Provenance | 0 | 3 | 2 | 0 | 5 | [privacy-consent-provenance](privacy-consent-provenance.md) |
| Screening Decisions & Records | 0 | 2 | 3 | 0 | 5 | [screening-decisions](screening-decisions.md) |
| Shared UI & Design System | 0 | 3 | 2 | 0 | 5 | [shared-ui-design-system](shared-ui-design-system.md) |
| Shared Utility Libraries | 0 | 2 | 3 | 0 | 5 | [shared-utility-libs](shared-utility-libs.md) |
| Skill Matrix & Coverage | 0 | 2 | 3 | 0 | 5 | [skill-matrix-coverage](skill-matrix-coverage.md) |
| Voice Interview | 0 | 2 | 3 | 0 | 5 | [voice-interview](voice-interview.md) |

---

## All 30 Critical findings — grouped by theme

### A. Multi-tenancy / workspace isolation (4 + the ground-truth above)
1. **auth-sessions-tenancy** — Workspace switch exposes another tenant's data: only 2 of ~25 tables are scoped. `db/workspaces.ts`, `current-workspace.ts`
2. **auth-sessions-tenancy** — Workspace export/import operate on the WHOLE database, not one workspace → cross-tenant exfil + `DROP TABLE` clobber; unauthenticated by default. `db-portability.ts`
3. **candidate-profile-matching** — Match & candidate-pool resolution drops the workspace, then reads jobs from an unscoped corpus. `match-candidate.ts`, `db/jobs.ts`
4. **cv-analysis-workspace** — Saved-analysis "on board" link and disposition echo cross workspace boundaries (label-matched, no `workspace_id` filter). `pipeline.ts`

### B. Unauthenticated / under-protected endpoints (5)
5. **model-api-key-mgmt** — Provider-key & model-routing API routes (`/api/llm/{keys,config,test}`) have NO authentication. `api/llm/keys/route.ts`
6. **model-api-key-mgmt** — Azure `endpoint` is an unvalidated user URL fed to the client → SSRF + key exfil (chains with #5). `api/llm/test/route.ts`
7. **jd-authoring-library** — Public JD pages expose Edit / Archive / Revert controls to anonymous visitors; the PATCH/revisions routes have no session check. `api/jds/[slug]/route.ts`
8. **application-intake-apply** — Public apply + quick-apply POSTs have no rate limiting (the sibling inbound route already uses `rate-limit.ts`). `api/apply/[id]/route.ts`
9. **comms-inbound-channels** — Inbound webhook accepts unlimited duplicate/replayed leads — no payload idempotency. `api/channels/inbound/[token]/route.ts`

### C. Billing / revenue integrity (4)
10. **billing-engine-webhooks** — Idempotency claim committed BEFORE the side effect succeeds → a transient apply failure + Polar retry permanently loses a paid subscription/credit grant. `billing/webhook-verify.ts`, `api/billing/webhook/route.ts`
11. **billing-engine-webhooks** — `recordMeterUsage` is a non-atomic read-modify-write → concurrent debits over-spend the meter/credits. `db/billing.ts`
12. **job-postings-lifecycle** — Free-plan active-job cap is bypassable by concurrent publishes (check-then-set race). `api/jobs/[id]/publish/route.ts`
13. **billing-ui** — Successful checkout returns to `/?billing=success`, but nothing reads the param → no confirmation, no entitlement refresh; user sees old plan. `BillingTab.tsx`

### D. AI-quality / fairness / scoring integrity (4)
14. **eval-fairness-seed** — `pedigree_neutrality` fairness probe tests nothing — the university name never reaches the scorer, so the delta is structurally 0 (cross-validated by pipeline-test-suite-py). `eval/matching_eval.py`
15. **matching-transformation-engine** — `score_personal` silently zeroes short-named real skills (Go, R, C, C++, SQL, AI) and saturates overlap at 5 hits. `matching.py:358`
16. **devcase-pipeline-py** — Candidate-controlled commit messages / DECISIONS log are concatenated raw into the judge/eval prompts → prompt injection to inflate own score. `reflect.py:104`, `evaluate.py:118`
17. **cv-extraction-services** — Blind screening silently uploads the original file (name + photo) to Gemini when local extraction fails, while the audit note falsely claims "identity redacted". `pipeline.py:114`, `gemini.py:398`

### E. Decision-record & pipeline-state integrity — "phantom hires" (2)
18. **group-eval-fairness** — A knockout-failed candidate can be crowned "recommended lead" and sealed into the tamper-evident decision record (ranks on raw score, never gates on `koPassed`). `group-eval-run.ts:345`
19. **offers-onboarding** — Accept on a stale offer token has no stage/terminal guard → resurrects a rejected entry to Hired + fires onboarding while status stays `rejected`. `api/offer/[token]/route.ts`

### F. Built-but-unwired features (4)
20. **interview-simulation** — "Attach to candidate" 404s every time — simulate mints `candidate` mode, attach demands `test`. `api/interview/simulate/attach/route.ts:22`
21. **dev-submissions-live** — Live-session submissions are scored as if no work history exists — observed events/files never feed authenticity, so the no-commit penalty always fires. `devcase-run.ts:446`
22. **dev-lifecycle-cohort** — Closed posting still accepts submissions via the internal `submit` route (guard lives only in the public `inbound` route). `api/devcase/submit/route.ts`
23. **devcase-authoring** — A candidate applying mid-evaluation-batch is silently dropped — `startTask` dedup coalesces the resume into the still-running task. `devcase-orchestrator.ts`

### G. Data durability / persistence (2)
24. **data-store-persistence** — `foreign_keys` pragma is never enabled and no table declares `REFERENCES` → every FK relation is unenforced; GDPR erasure strands orphans. `db-path.ts:30`
25. **tasks-system-ops** — Workspace backup `dumpWorkspace` reads tables without a transaction → a referentially torn snapshot is reported as a clean success. `db-portability.ts:57`

### H. Trust-boundary input handling (1)
26. **github-evidence-cv** — Stored XSS via unvalidated `profileUrl` / repo `url` (no scheme check) → `javascript:` URL fires when a recruiter clicks the GitHub link in the candidate drawer. `github-evidence.ts`

### I. Conversion / funnel (business) (3)
27. **landing-marketing** — Every CTA is a dead fragment anchor (`#cta` / `href="#"`) — no link to login/signup, no email capture; the conversion surface has no funnel exit. `landing/page.tsx`
28. **guided-simulation** — The keyless demo's JD→Hired climax has no sign-up/book-a-demo CTA — it dead-ends on "Run again," leaking peak-intent prospects. `SimulationProvider.tsx`
29. **sourcing-campaigns-rediscovery** — Outreach / rediscovery re-contacts candidates with no opt-out / do-not-contact suppression (CAN-SPAM / GDPR class gap on a revenue feature). `comms-dispatch.ts`, `rediscover.ts`

### J. Timezone / clock (1)
30. **interview-scheduling-prep** — Slots validated in SERVER-local wall-clock but rendered in BROWSER-local → remote candidates see shifted times and valid picks get rejected, breaking "timezone-aware" scheduling. `schedule-slots.ts`

---

## Triage themes (suggested fix-wave clustering)

| Theme | Criticals | Approx total (C+H+M) | Why it's a wave, not isolated fixes |
|---|---|---:|---|
| **T1 — Workspace tenancy isolation** | #1–4 | ~12 | One root cause (workspace-blind queries) repeated across stores; fix the scoping helper + thread `workspace_id`, then sweep callers. Highest priority per ground truth. |
| **T2 — Endpoint auth & abuse limits** | #5–9 | ~10 | Missing auth / rate-limit / idempotency at public + admin trust boundaries; shared middleware-style remedy. |
| **T3 — Billing / revenue integrity** | #10–13 | ~9 | Webhook idempotency, atomic meter debit, cap race, post-checkout refresh — all money-path, one mental model. |
| **T4 — AI quality, fairness & scoring** | #14–17 | ~14 | Hollow fairness probe, skill-drop scoring, prompt injection, blind-screen leak — the product's core promise + compliance. |
| **T5 — Decision/state integrity (phantom hires)** | #18–19 | ~8 | Stage/terminal guards + KO-gating so the pipeline can't reach Hired wrongly; ties to screening-record gaps. |
| **T6 — Built-but-unwired features** | #20–23 | ~8 | Features that silently never work; each is a small, high-value wire-up. |
| **T7 — Durability & data model** | #24–25 | ~6 | FK enforcement + transactional backup; foundational, moderate risk (touches every store). |
| **T8 — Trust-boundary input (XSS/validation)** | #26 | ~5 | Stored XSS + url/scheme validation; cheap, high-value. |
| **T9 — Conversion & funnel** | #27–29 | ~8 | Landing CTAs, demo CTA, outreach opt-out — business/growth surface. |
| **T10 — Clock/timezone & scheduling** | #30 | ~5 | Server-vs-browser time + double-booking authority. |
| **T11 — UI polish / a11y / i18n** | — | ~30 | Half-translated result tabs (cs), NaN score dial, mobile nav collapse, empty-state gaps, chart a11y — cross-cutting High/Med UX. |

---

## Suggested next-phase split (fix waves)

Each wave is one focused session (~5–7 fixes, shared mental model), atomic commits, `tsc` + `node --test` (+ Python `unittest` where touched) green before the wave-summary doc. Recommended order:

- **Wave 1 — T2 Endpoint auth & abuse** (criticals #5,#6,#7,#8,#9): close the unauthenticated/abusable boundaries first; lowest-effort, highest external risk.
- **Wave 2 — T1 Workspace tenancy** (criticals #1,#2,#3,#4): scope helper + thread `workspace_id` + export/import scoping. Must precede any 2nd-workspace onboarding.
- **Wave 3 — T3 Billing integrity** (criticals #10,#11,#12,#13): idempotency-after-effect, atomic meter, publish CAS, checkout refresh.
- **Wave 4 — T5 + T6 Pipeline state & unwired features** (criticals #18,#19,#20,#21,#22,#23): guards against phantom hires + wire up the dead features.
- **Wave 5 — T4 AI quality & fairness** (criticals #14,#15,#16,#17): fairness probe, skill scoring, prompt-injection fencing, blind-screen leak.
- **Wave 6 — T7 + T8 + T10 Durability / XSS / timezone** (criticals #24,#25,#26,#30): FK pragma, transactional backup, url validation, slot timezone.
- **Wave 7 — T9 + T11 Conversion & UI polish** (criticals #27,#28,#29 + the High UX tail): CTAs, outreach opt-out, i18n result tabs, ScoreDial NaN, mobile nav.

(Waves 1–6 are reliability/security/revenue; Wave 7 is growth/polish. Re-orderable to your priority.)

---

## How this scan was run

- **Scanners**: combined role prompts `bug_hunter` + `ui_perfectionist` + `business_visionary` from Vibeman's registry (`src/lib/prompts/registry/agents/`).
- **Method**: one `general-purpose` subagent per context, applying all three lenses, value-ranked to the top-5 per context. 6 waves of ≤8 parallel subagents. Orchestrator read only the terse replies (not the per-context reports) to stay within context.
- **Scope**: full-stack — TS/React frontend + Next.js API routes + Python `pipeline/jobfit` engine + JSON seed data.
- **Project baseline at scan time**: `tsc --noEmit` = 0 errors; `node --test` = 935/935 passing. (Pre-existing uncommitted dev-inspector changes on `main` left untouched.)
- **Files read**: ~700+ across all subagents (avg ~17/context).
- **Verification**: findings counted two ways — sum of `> Total:` headers (211) = count of `**Severity**:` bullets (211). ✓
- **Notable cleared suspicions** (verified NOT bugs): Anthropic adapter model IDs are current; PUML renderer has no XSS (labels are JSX children); OG-font load is hardened; app-shell search SQL is parameterized; matrix-stats math is sound.
