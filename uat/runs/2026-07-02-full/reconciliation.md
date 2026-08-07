# Reconciliation sweep — run 2026-07-02-full

Cross-surface consistency pass per the engine (`.claude/skills/uat.md` § Reconciliation sweep): shared
concepts traced across every surface that uses them, asserting agreement. Defects here live *between*
surfaces — no single character×journey walkthrough produces them. Evidence: code (`file:line`) + live
read-only probes against the running server (`http://localhost:3009`, health OK: jobs 101, profiles 57,
pipeline_entries 60, analyses 105) and a read-only open of `data/kp.sqlite`. Nothing was mutated.

Verdict legend: **AGREE** (one source of truth, consumers consistent) · **DRIFT** (shared source exists,
some consumers bypass it) · **DISAGREE** (multiple unreconciled definitions).

---

## Concept 1 — Match score — **DISAGREE (3+ independent definitions cross the money path)**

There is no such thing as "the match score". Three producers, none reconciled, all rendered as an
undifferentiated 0–100 number under labels like "SHODA"/"Match":

| # | Surface | Value / definition | Source | file:line |
|---|---|---|---|---|
| A | Pipeline board card, candidate drawer header, **offer approval card header** ("57 SHODA") | `pipeline_entries.match_score` — stamped at add-time from whatever match run added the entry, or backfilled by the auto-score sweep (`rankPoolForJob` → python `score_job` total; FILL-ONLY) | stored, stale-able | `app/_lib/useAddToPipeline.ts:22,57` · `app/_lib/automation-pass.ts:157-183` · `app/_lib/db/pipeline.ts:1131-1137` · render `app/features/sub_decisions/RoleDecisionRow.tsx:83` via `app/_components/ScoreBadge.tsx:22-33` (75/50 tone cutoffs) · label `messages/cs.json:1384` ("match": "shoda") |
| B | **Offer salary rationale** ("Match 49/100 places the offer at ~10% of the band") — the number that actually PRICES the offer | `m.total` from a **fresh** `score_job` run at draft time; `f = clamp((total−55)/40, 0.1, 0.9)` positions the salary in the band; never persisted back to the entry | recomputed, divergent | `pipeline/jobfit/automation.py:716-731` · `pipeline/jobfit/automation_cli.py:126,141` · invoked via `app/_lib/automation-run.ts:232-235` |
| C | Analyze report / drawer timeline ("Analýza CV uložena — skóre 70") / history / JD candidate list | `analyses.score` — the Gemini CV-analysis total; **also the ONLY score the calibration engine measures** | third axis | `app/_lib/db/analyses.ts:108-125` (calibrationPairs = analyses.score × disposition) · `app/api/analytics/calibration/route.ts:18` · `app/_lib/calibration.ts:39-47` (score/100 read as probability) |
| D | Group-eval score column | `result?.total ?? c.matchScore ?? 0` — fresh recruiter-ranking total, silent fallback to stored (A), then **fabricated 0** | mixed + fabricated | `app/_lib/group-eval-run.ts:263,327` |

**Live (DB read-only, 2026-07-02):** every Offer/Hired row disagrees A-vs-C — Anna Bartošová board **57**
/ analysis **70** (offer rationale cited **49**, accepted at 48 000 CZK); Adam Sedláček **59/76** (rationale 51);
Vít Malý 75/92; Eliška Králová **46/92**; Jan Procházka 66/92. The L2 offer run saw all three numbers on one
card (OO-L2-10). At low totals A and B clamp to the same 10% band floor so the CZK coincides — at higher
scores the displayed basis and the actual money diverge.

**Calibration disconnect (live):** `GET /api/analytics/calibration` → `{"n":0, "brier":null}` with 105 analyses
and 60 pipeline entries incl. 6 hires on disk. The instrument that promises "a 70 from us advances 70% of the
time" measures `analyses.score × disposition` (`analyses.ts:112-114`) — a pair nothing in the pipeline flow ever
writes — while the scores that actually act (A thresholds screen-wave auto-reject, B prices offers) are never
calibrated. The dial reads "not yet calibrated" forever; the acting scores have no error bar.

**`matchScore ?? 0` fabrication sites** (a never-scored candidate becomes a genuine-looking 0):
- `app/_lib/screen-wave.ts:141` (worst-first sort), `:154` (wave stats), `:168` (`0 < maxMatchToReject` → auto-reject eligible), `:193` (**sealed decision record** claims "match 0 < threshold");
- `app/_lib/group-eval-run.ts:263` (cap eviction by fabricated 0), `:327` (score column);
- `app/api/pipeline/command/route.ts:31` (`advance top N` ranks null-scored last);
- `app/features/simulation/SimulationProvider.tsx:193` (sim picks "best" by fabricated 0).

---

## Concept 2 — Stage vocabulary + candidate-facing projection — **AGREE on the canonical axis; DRIFT at sim/diagrams; one stage-inference LIE (TodayRail)**

| Surface | Stage list / definition | Canonical? | file:line |
|---|---|---|---|
| Canonical constant | `PIPELINE_STAGES = ["Accepted","Screened","Interview","Offer","Hired"]`; `FUNNEL_STAGES` aliases it | source | `app/_lib/pipeline-stages.ts:12,17` |
| cs/en labels | `enums.stage` — Přijato/Prověřeno/Pohovor/Nabídka/Najat/a; resolved via `useEnumLabel` | single-sourced | `messages/cs.json:884-889` · `app/_lib/use-enum-label.ts:13-21` |
| Kanban board | `STAGES = PIPELINE_STAGES` (re-export) | YES | `app/features/sub_pipeline/PipelineTypes.ts:76` |
| Analytics funnel | `FUNNEL_STAGES.map(...)`; Hired in-funnel, rejected/declined separate counters | YES | `app/_lib/db/analytics.ts:5,155,166-186` (render `AnalyticsTab.tsx:190-197`) |
| `candidateStatusFor` | inlines the 5 keys → received/under_review/interview/offer/hired + off-path `not_selected`/`withdrawn` from entry *status* | deliberate copy (unit-tested) | `app/_lib/application-status.ts:24-42` · copy `messages/cs.json:672-681` · `app/api/status/[token]/route.ts:22` |
| Simulation | `SIM_PHASES` — 7 hardcoded-English nodes ("Intake", "Screen" ≠ Accepted/Screened) + hardcoded step titles | **NO — third vocabulary** | `app/features/simulation/constants.ts:74-84` · `SimulationProvider.tsx:425,465,558,591` |
| Diagrams | 16-node `STEP_DETAILS` decomposition (English) | NO (separate, tokens consistent) | `app/diagrams/pipelineSteps.ts:16-260` |
| Board stage help | `STAGE_HELP` hardcoded-English duplicate of `enums.stageHelp` | unguarded copy | `PipelineTypes.ts:80-86` vs `messages/cs.json:974-980` |
| Attention / TodayRail | read live stage string literals | consumers | `app/_lib/attention.ts:40,44` · `TodayRail.tsx:45,50,52` |

**The TodayRail seam (confirmed):** `TodayRail.tsx:50` — `offersOut = active.filter(e => e.stage === "Offer"
&& !e.approvalKind)` → copy `messages/cs.json:1149` *"# nabídek u kandidátů — čeká se na odpovědi"* /
en *"# offers with candidates — awaiting their responses"*. The count is computed **entirely from
pipeline_entries** (component imports only `./PipelineTypes`, header comment `TodayRail.tsx:12-15`); the real
offer records live in the separate `offers` table (`app/_lib/offers-store.ts:26-45`), populated only on offer
approval. A drag/bulk-move into the Offer column claims "awaiting their response" with zero offer rows —
exactly what L2 observed (OO-L2-11). **Live now:** 3 active Offer-stage entries; **2 of 3 (pe-009, pe-042) have
no `offers` row at all** — nothing was ever extended for them, yet stage-inference presents the column as
"offers with candidates". A genuine check exists and is unused (`offers-store.ts:253` `getOpenOfferForEntry`).

---

## Concept 3 — Salary / currency / period — **DRIFT (contract exists; ≥6 surfaces bypass it; period missing at the money moment)**

Canonical contract: `APP_CURRENCY = "CZK"`, no FX (`app/_lib/format.ts:18`); shared `formatSalaryRange`
(cs-CZ grouping, "45 000–60 000 CZK / month", `format.ts:39-54`); cross-currency comparability guard
(`app/_lib/salary-band.ts:31-58`); bands are CZK/month gross by contract (`pipeline/jobfit/salary_band.py:20-33`,
fallback bands `automation.py:703-709`).

| Surface | Currency | Period | Deviation | file:line |
|---|---|---|---|---|
| JD posting markdown | "CZK" literal | "/ month" literal | hand-rolled, bypasses formatter | `app/features/sub_jobs/jobMarkdown.ts:3-4,97` |
| Coach winnability band | " CZK" literal | none | bypass | `app/features/sub_jobs/CoachPanel.tsx:30` |
| `formatBand` | **none** | **none** | "45–60k" bare | `app/features/sub_jobs/JobsTypes.ts:147-150` |
| Campaign ad copy | **"Kč"** (cs) vs "CZK" (en) | /měsíc · /month | symbol/code split | `pipeline/jobfit/campaign.py:87` |
| Analyze salary gauge + market range | `analysis.salary.currency` (real, multi-currency) | `analysis.salary.period` via enum | ✓ correct | `app/_components/results/salary/SalaryTab.tsx:44-47,92-95` · `SalaryGauge.tsx:27,72` |
| Analyze **growth-target callout** | hardcoded "CZK" | hardcoded "/ month" | **mislabels a EUR/annual analysis**; `midpoint*1.3` duplicated with different rounding | `SalaryTab.tsx:18,52` · `SalaryGauge.tsx:28,113` · `messages/en.json:117` |
| Offer letter (python) | "CZK" literal | "Gross **monthly**" in body | ✓ states period | `automation.py:722,730,735,745-773` |
| **Offer page (candidate)** | `offer.currency` (nullable → unit silently omitted) | **no period label** | monthly figure shown bare at the accept moment | `app/offer/[token]/page.tsx:220-229` · null seam `app/api/pipeline/[id]/route.ts:43-44`, `offers-store.ts:33-34` |
| AI-review offer card | `currency ?? "CZK"` | **no period** | `toLocaleString()` **no locale** → "85,000" vs "85 000" elsewhere | `app/features/sub_decisions/AiReviewCard.tsx:57,79-80` |
| Pipeline offer result | `currency ?? "CZK"` | `perMonth` ✓ | no-locale toLocaleString | `sub_pipeline/CandidateResultView.tsx:89-90,102-103` |
| Group-eval comparison | roleBand=CZK; expectation carries own currency; cross-currency verdict withheld | — | ✓ honest guard | `app/_lib/group-eval-run.ts:145,214-217,470-475` · `ComparisonCells.tsx:145-201` |
| Billing | CZK + approx USD | /mo | ✓ | `app/_lib/billing/plans.ts:6-9` · `BillingTab.tsx:127-134` |

The three offer surfaces disagree on whether the period is shown at all (letter: yes; result card: yes;
candidate page + approval card: no). The `+30%` growth constant lives twice with different rounding
(`SalaryTab.tsx:18` rounds to 5000; `SalaryGauge.tsx:28` doesn't) — backlog `idea-615cbc37` targets exactly
this and is not yet implemented.

---

## Concept 4 — Consent / retention TTL — **DRIFT (enforcement is configurable; the promise is hardcoded)**

| Surface | Value | file:line |
|---|---|---|
| Env read + default | `KP_CONSENT_TTL_DAYS` clamped 1..3650, default **365**, frozen at module load | `app/_lib/consent.ts:14-18,35-37` |
| Grant stamps expiry | `recordEntryConsent` bakes `consent_expires_at` per row at grant time | `app/_lib/db/pipeline.ts:944-959` |
| Erasure sweep | `anonymizeExpiredConsents` — `WHERE consent_expires_at <= now` (honors the stored per-row TTL; never re-reads the env) | `app/_lib/db/pipeline.ts:1065-1082` |
| Self-service erasure | `/api/data/[token]` → `anonymizeEntry` (TTL-independent, immediate) | `app/api/data/[token]/route.ts:36-39` · `pipeline.ts:1005-1058` |
| **Apply consent copy (cs+en)** | *"…zpracovávat vaše osobní údaje … **po dobu až 12 měsíců**…"* — hardcoded | `messages/cs.json:548` / `en.json:548` · rendered `app/_components/AiDisclosure.tsx:60` on `QuickApplyForm.tsx:126`, `ConversationalApply.tsx:601`, `devcase/apply/[token]/page.tsx:72` |
| **Compliance page copy (cs+en)** | *"…s **dobou uchování 12 měsíců** a samoobslužným výmazem."* — flat claim | `messages/cs.json:1458` / `en.json:1458` · `app/features/sub_decisions/ComplianceSection.tsx:129` |

Set `KP_CONSENT_TTL_DAYS=180`: enforcement moves, both copy strings keep saying 12 months (the compliance
one becomes flatly false; at TTL>365 the apply statement **under-discloses** — the GDPR-worse direction).
Also: changing the env only affects *future* grants (expiry baked per-row) — no surface explains that.
**Live note:** `consent_expires_at` is NULL on all current seeded entries (consentSample empty) — the whole
TTL machinery currently governs only fresh applies; today (default 365 ≈ 12 months) copy and enforcement
coincide, so this is a config-seam finding, not a live lie.

---

## Concept 5 — Workspace/tenant scoping — **DISAGREE (2 tables scoped; 46 gaps; the manifest itself admits it)**

Resolver: `currentWorkspace()` (`app/_lib/auth/current-workspace.ts:10`) → session cookie → fallback
`DEFAULT_WORKSPACE = "workspace"` (`app/_lib/auth/session.ts:13,82`). Multi-workspace is locked OFF
(`app/_lib/workspace-lock.ts:24`); the canonical manifest `app/_lib/tenancy.ts:22-35` lists **only
`analyses` + `profiles`** as scoped, 5 exempt system tables (`workspaces`, `gemini_cache`, `llm_config`,
`scheduler`, `scheduler_runs`), and fail-closes boot under `KP_MULTI_WORKSPACE` while gaps exist
(`tenancy.ts:63`, wired `db/core.ts:820`).

**Inventory (53 tables): 2 scoped · 5 exempt · 46 global gaps.**

- **Scoped (verified, filter in every query):** `analyses` (`db/analyses.ts:78,95,114,137,151,166,192`), `profiles` (`db/profiles.ts:46,58,76,94,130,141`).
- **Column present, reads blind:** `pipeline_entries` — ws column `core.ts:672`, but `listPipeline` (`db/pipeline.ts:286,301`) and the analytics funnel/ROI (`db/analytics.ts:135-138`) read globally; `profiles.ts:161,179` read it unscoped from inside the scoped module. Live: single workspace `"workspace"`, 60/60 rows.
- **No tenant column at all (selected, sensitive):** `decision_records` (hash-chained hiring ledger, `decision-record-store.ts:57`; live PRAGMA confirms no ws column) → `/api/decisions/records` global; `offers` (salary+PII, `offers-store.ts:26`); `group_evals` (`db/group-eval.ts:18`; live PRAGMA: role_key/role_title/payload_json/created_at only); `schedule_invites` (`schedule-store.ts:21`); `interview_sessions` (full transcripts+scorecards, `core.ts:458`); `application_status_links` (`application-status-store.ts:21`); `onboarding_*` (`onboarding-store.ts:27-57`); `consent_events` (`core.ts:699`); `dev_outbox` (`core.ts:417`); `llm_usage` (`core.ts:513`); `jobs`/`jds` (`core.ts:232,145`); `tasks`, `dev_*`, `billing_*` (hardcoded single `WORKSPACE`, `db/billing.ts:19`), `ats_config`, `interview_preps`, `rediscovery_alerts`, `jd_templates`, `analytics_targets`, `channel_*`, `campaign_packs`, `decision_config`, `dev_outcomes`, `skill_profiles`, `provider_keys` (deploy-level but NOT on the exempt allowlist).
- **Sharpest seams:** (1) `searchEntities` — the command palette runs raw SQL over `profiles`/`analyses`/`pipeline_entries`/`jobs`/`jds` with **no workspace filter** (`db/analytics.ts:570-631`, profiles `:577`, analyses `:617`) — **the two tables that ARE scoped everywhere else leak through global search**; (2) the shared candidate pool pins the DEFAULT workspace (`app/_lib/candidate-pool.ts:49,57` — no ws arg passed); (3) ~10 of 131 API routes resolve a workspace at all.
- L2 corroboration (evaluate-and-buy): an anonymous demo session read 53 named seeded candidates + audit history (EB-H1-04, shot 21) — the `/api/demo` sandbox comment itself counts "~28 unscoped tables" (`app/api/demo/route.ts:26-45`).

---

## Concept 6 — Delivery truth-language — **DISAGREE (delivery layer: `queued` is terminal; ~8 surface families say "sent/emailed")**

Ground truth: `OutboxChannel.send()` records `status:"queued"` — *"a terminal dev state: the outbox IS the
delivery target; nothing dequeues it"* (`app/_lib/comms.ts:13-14,34-42`); real delivery only with
`COMMS_WEBHOOK_URL`. Recipient is a display NAME, not an address (`comms-dispatch.ts:63-68`).
**Live: `dev_outbox` = 12 rows, ALL `queued/outbox`, zero `sent`** — 5 offer, 3 onboarding, 1 rejection,
1 schedule_invite, 1 offer_reminder, 1 interview_confirmation.

| # | Surface claiming delivery | Exact claim | Truth | file:line |
|---|---|---|---|---|
| 1 | Quick-apply success (candidate-facing) | *"Potvrzení jsme vám poslali e-mailem"* / *"We've emailed you a confirmation"* | ack → outbox `queued`, name-addressed | copy `messages/cs.json:719`/`en.json:719` · returned `app/api/apply/[id]/quick/route.ts:140` · dispatch `app/_lib/lead-intake.ts:129-131` → `comms.ts:37-42` |
| 2 | Drawer scheduling link | green *"✓ Odkaz na výběr termínu odeslán kandidátovi"* — driven by `dispatched:true`, which means "outbox row recorded" | queued-terminal | `app/api/schedule/invite/route.ts:43-54` · `CandidateDrawer.tsx:883-885` · copy `cs.json:1243` |
| 3 | Drawer voice-interview invite | green *"✓ Pozvánka odeslána kandidátovi"* (`delivered` flag) | queued-terminal | `CandidateDrawer.tsx:819-821` · copy `cs.json:1241` |
| 4 | Offer timeline + drawer | *"Nabídka odeslána"* (offer_sent / offerExtended); analytics *"# odeslaných nabídek"* | 5 offers live-queued to a NAME | `CandidateDrawer.tsx:940` · copy `cs.json:1193,2915,2006` · dispatch `comms-dispatch.ts:235` |
| 5 | Rejection events (incl. screen-wave + **sim wave**) | *"Zamítnutí odesláno"* | 1 live-queued | copy `cs.json:2909` · `comms-dispatch.ts:194` (sim dispatches real ones, `screen-wave.ts:281`) |
| 6 | Outreach | *"Oslovení odesláno"* — durable `outreach_sent` marker written after `sendComm` | queued dead-letter (name-addressed) | copy `cs.json:2908` · `automation-run.ts:45-53` · `comms.ts:19-23` |
| 7 | Reminders / onboarding welcome | *"Odeslána připomínka vypršení"*, *"Připomínka před nástupem odeslána"*; code comment asserts "the candidate has been reminded" | queued-terminal | copy `cs.json:1225,2930` · `comms-dispatch.ts:365-372,388` · `preboarding-reminders.ts:10` |
| 8 | Candidate status/consent pages promise future email | *"pošlou vám e-mailem nový odkaz"*; *"přes odkaz v našich e-mailech"* | no email will ever leave | `cs.json:624,548` |

**The one honest surface (the reference):** Comms Center — red banner *"Není nakonfigurováno doručovací
relé — tyto zprávy se NEodesílají kandidátům. Doručování zapnete nastavením COMMS_WEBHOOK_URL."*
(`CommsCenter.tsx:142`, copy `cs.json:2461`), an honest per-row chip that shows the channel instead of a fake
"sent" (`CommsCenter.tsx:234`), and the no-address warning (`cs.json:2456`). Also honest: the full-apply ack
copy claims no email (`cs.json:706`, `app/api/apply/[id]/route.ts:491`). Every other surface converts
"row recorded in a local table" into "odesláno kandidátovi".

---

## Concept 7 — (SIM) data hygiene — **DISAGREE (the marker is a purge key, not a filter key — zero read surfaces filter it)**

Marker: `SIM_MARKER = "(SIM)"` applied to the **job title only** (`app/features/simulation/constants.ts:7-8`);
sim candidates are real seeded pool people (e.g. "Vít Malý"), so downstream rows carry a real name and no
visible marker. Sim writes: jobs/jds (marked), pipeline_entries (inherit marked `job_title`), pipeline_events,
offers, decision_records, group_evals, dev_outbox, tasks/schedule (unmarked). The only marker-aware query in
the app is the destructive cleanup `resetSim` (`app/_lib/sim-store.ts:38-67`), which also leaves dev_outbox /
decision_records / group_evals / tasks residue behind.

| Aggregate / read surface | Filters (SIM)? | file:line |
|---|---|---|
| TodayRail "hired this week" (+ name list) | **No** — `stage==="Hired" && daysSince<=7` | `sub_pipeline/TodayRail.tsx:51-53` |
| Analytics funnel / hired / byJob / bySource / byChannel | **No** — only a `created_at` window | `app/_lib/db/analytics.ts:131-138,166,181-258` |
| Momentum / forecast | **No** — same unfiltered events/funnel | `db/analytics.ts:287-296` · `analytics-momentum.ts:58` · `analytics-forecast.ts` |
| Automation impact + ROI + **cost-per-hire** | **No** — divides spend by SIM-inclusive hires | `db/analytics.ts:302-329,473,503` |
| Decision records list | **No** | `decision-record-store.ts:159-165` |
| Comms Center outbox | **No** | `db/devcase.ts:337-372` |
| Cross-entity search | **No** (actively surfaces SIM rows) | `db/analytics.ts:583-596` |
| Rediscovery pool | no filter, structurally unpolluted (reads profiles/analyses) | `candidate-pool.ts:46-66` |

**Live:** `pipeline_entries` holds 9 (SIM) rows; **"Vít Malý / Senior Java Backend Engineer (SIM)" is
`Hired`, stage_changed today (2026-07-02T14:22Z)** → "hired this week" = 2, one of them sim residue —
exactly the L2 symptom (gsim-l2-105). Live funnel: `hired: 6` includes it; every ROI/cost-per-hire figure
downstream inherits it. The demo-workspace sandbox that would isolate this only engages when `KP_SECRET`
is set (`app/api/demo/route.ts:26-45`) — and the aggregates carry no workspace predicate anyway (Concept 5).

---

## Findings

```json
[
  {
    "id": "REC-01",
    "journey": "reconciliation-sweep",
    "character": "panel",
    "cert_level": "L2",
    "type": "trust",
    "severity": "major",
    "impact": { "frequency": "high", "reachability": "high", "trust_erosion": "high" },
    "dimension": "trust",
    "title": "\"Match score\" has three unreconciled definitions (stored entry score / fresh offer-pricing recompute / CV-analysis score) rendered as one undifferentiated 0-100 number across board, drawer, approval card, analyze report and group-eval",
    "expected": "One score with one provenance per surface — or each number explicitly named (\"board score 57 · fresh fit check 49 · CV analysis 70\").",
    "got": "pipeline_entries.match_score (add-time/sweep, useAddToPipeline.ts:22, automation-pass.ts:157-183) renders on board/drawer/approval-card header as SHODA; draft_offer re-runs score_job and prices the salary from ITS m.total, quoting \"Match {total}/100\" in the rationale (automation.py:716-731); the drawer timeline shows analyses.score from the CV analysis; group-eval shows result?.total with silent fallback (group-eval-run.ts:327). Live DB: every Offer/Hired row disagrees — Anna 57 board / 49 rationale / 70 analysis; Eliška Králová 46 board / 92 analysis.",
    "evidence": [
      "app/_lib/useAddToPipeline.ts:22,57",
      "app/_lib/automation-pass.ts:157-183 + app/_lib/db/pipeline.ts:1131-1137",
      "pipeline/jobfit/automation.py:716-731 + pipeline/jobfit/automation_cli.py:126,141",
      "app/_lib/db/analyses.ts:108-125",
      "app/_lib/group-eval-run.ts:263,327",
      "live kp.sqlite (read-only, 2026-07-02): tripleCheck rows 57/70, 59/76, 75/92, 46/92, 66/92",
      "OO-L2-10 shots: l2-offer-p3-send-anna-02-card.png ('57 SHODA' + 'Match 49/100')"
    ],
    "code_check": "present-broken",
    "verdict": "confirmed",
    "resolution": "open",
    "ceiling": null,
    "scope_note": "Generalizes OO-L2-10 from one card to the systemic seam: the three producers never reconcile anywhere, and the divergence is live on every Offer/Hired row, not just the observed card.",
    "suggested_acceptance": "Any surface showing a fit number names its source; the offer rationale cites the same number the card header displays or explicitly labels its own."
  },
  {
    "id": "REC-02",
    "journey": "reconciliation-sweep",
    "character": "panel",
    "cert_level": "L2",
    "type": "trust",
    "severity": "major",
    "impact": { "frequency": "med", "reachability": "high", "trust_erosion": "high" },
    "dimension": "trust",
    "title": "Analytics calibration measures a score that never acts (analyses.score × disposition) while the scores that act (entry match_score thresholds, offer-pricing m.total) are never calibrated — live n=0 despite 105 analyses and 6 hires",
    "expected": "The reliability curve measures the score the pipeline actually decides with, or is labeled as analysis-score-only.",
    "got": "calibrationPairs = analyses.score + disposition IN ('advance','pass') (db/analyses.ts:108-125) — a pair the pipeline flow never writes; screen-wave auto-rejects on matchScore ?? 0 and draft_offer prices on a fresh m.total, neither of which enters calibration. GET /api/analytics/calibration live: {\"n\":0,\"brier\":null,\"calibrated\":false} with a full pipeline on disk.",
    "evidence": [
      "app/_lib/db/analyses.ts:108-125",
      "app/api/analytics/calibration/route.ts:18",
      "app/_lib/calibration.ts:4-8,39-47",
      "app/_lib/screen-wave.ts:168",
      "live GET http://localhost:3009/api/analytics/calibration → n:0 (2026-07-02)"
    ],
    "code_check": "present-broken",
    "verdict": "confirmed",
    "resolution": "open",
    "ceiling": null,
    "suggested_acceptance": "Calibration pairs are fed from pipeline outcomes keyed to the acting score (entry match_score at decision time), or the tab states which score it calibrates and that pipeline decisions are uncalibrated."
  },
  {
    "id": "REC-03",
    "journey": "reconciliation-sweep",
    "character": "panel",
    "cert_level": "L1",
    "type": "trust",
    "severity": "major",
    "impact": { "frequency": "med", "reachability": "high", "trust_erosion": "high" },
    "dimension": "trust",
    "title": "Systemic `matchScore ?? 0` fabrication — a never-scored candidate becomes an indistinguishable genuine 0 at seven decision sites (auto-reject threshold, sealed decision record, group-eval cap eviction and score column, advance-top-N, sim pick)",
    "expected": "A null score is excluded or shown as '—' (as ScoreBadge already does) wherever it ranks, thresholds, or is sealed into a record.",
    "got": "screen-wave.ts:141,154,168,193 sorts/thresholds/seals on matchScore ?? 0 (a never-scored candidate ranks worst, passes 0 < maxMatchToReject, and the sealed rationale claims 'match 0'); group-eval-run.ts:263,327 evicts and scores by fabricated 0; command/route.ts:31 ranks; SimulationProvider.tsx:193 picks. The UI layer (ScoreBadge.tsx:29-31) handles null honestly — only the decision layer fabricates.",
    "evidence": [
      "app/_lib/screen-wave.ts:141,154,168,193",
      "app/_lib/group-eval-run.ts:263,327",
      "app/api/pipeline/command/route.ts:31",
      "app/features/simulation/SimulationProvider.tsx:193",
      "app/_components/ScoreBadge.tsx:29-31 (the honest counter-example)"
    ],
    "code_check": "present-broken",
    "verdict": "confirmed",
    "resolution": "open",
    "ceiling": null,
    "scope_note": "Consolidates SD-L1-002 (screen-wave) and extends it: the same fabrication idiom recurs at six more sites; fixing only screen-wave leaves group-eval crowning on a fabricated 0.",
    "suggested_acceptance": "One shared 'rankableScore(entry)' that excludes nulls from cohorts and never writes a fabricated 0 into a sealed rationale."
  },
  {
    "id": "REC-04",
    "journey": "reconciliation-sweep",
    "character": "panel",
    "cert_level": "L2",
    "type": "trust",
    "severity": "major",
    "impact": { "frequency": "high", "reachability": "high", "trust_erosion": "med" },
    "dimension": "trust",
    "title": "TodayRail infers \"offers with candidates — awaiting their responses\" from stage position alone (pipeline_entries.stage === 'Offer'), never consulting the offers store — live, 2 of 3 Offer-stage entries have NO offer record",
    "expected": "\"Awaiting their response\" means an offer was extended: count offers WHERE status='extended' (getOpenOfferForEntry exists and is unused here).",
    "got": "TodayRail.tsx:50 counts active entries at stage Offer without approvalKind; the copy (cs.json:1149 'nabídek u kandidátů — čeká se na odpovědi') asserts a candidate-side wait. The offers table is a separate store populated only on approval (offers-store.ts:117,268). Live DB: 3 active Offer-stage entries, 2 with no offers row (pe-009, pe-042); L2 earlier observed the claim with ZERO offer records (OO-L2-11).",
    "evidence": [
      "app/features/sub_pipeline/TodayRail.tsx:12-15,50,96-105",
      "messages/cs.json:1149 + messages/en.json:1149",
      "app/_lib/offers-store.ts:26-45,117,253,268",
      "live kp.sqlite (read-only, 2026-07-02): offerStageWithoutOfferRow = [pe-009, pe-042]; offers = 1 extended + 1 accepted"
    ],
    "code_check": "present-broken",
    "verdict": "confirmed",
    "resolution": "open",
    "ceiling": null,
    "scope_note": "Same claim-vs-store pattern as Concept 6: stage vocabulary projected into a delivery/lifecycle promise the backing store does not support.",
    "suggested_acceptance": "The rail row counts extended offers from the offers store; stage-parked entries without an offer get their own honest row ('parked in Offer, nothing extended')."
  },
  {
    "id": "REC-05",
    "journey": "reconciliation-sweep",
    "character": "panel",
    "cert_level": "L1",
    "type": "confusion",
    "severity": "minor",
    "impact": { "frequency": "med", "reachability": "med", "trust_erosion": "low" },
    "dimension": "clarity",
    "title": "Stage vocabulary is single-sourced (PIPELINE_STAGES + enums.stage) but three consumers keep unguarded parallel copies: the simulation's 7-node hardcoded-English SIM_PHASES ('Intake'/'Screen' ≠ Accepted/Screened), STAGE_HELP, and candidateStatusFor's inline map",
    "expected": "Consumers import the canonical constant/labels, or the copies carry a build-time guard (the diagrams already test alias parity, pipelineSteps.test.ts:81).",
    "got": "SIM_PHASES (simulation/constants.ts:74-84) and the sim step titles (SimulationProvider.tsx:425,465,558,591) are a third, non-i18n vocabulary a stage rename would silently orphan; PipelineTypes.STAGE_HELP:80-86 duplicates enums.stageHelp; application-status.ts:24-30 inlines the 5 keys (unit-tested, the safest copy).",
    "evidence": [
      "app/_lib/pipeline-stages.ts:12,17",
      "app/features/simulation/constants.ts:74-84",
      "app/features/simulation/SimulationProvider.tsx:425,465,558,591",
      "app/features/sub_pipeline/PipelineTypes.ts:76,80-86",
      "app/_lib/application-status.ts:24-42"
    ],
    "code_check": "present-but-missed",
    "verdict": "confirmed",
    "resolution": "open",
    "ceiling": null,
    "suggested_acceptance": "A parity test pinning SIM_PHASES/STAGE_HELP keys to PIPELINE_STAGES (mirroring pipelineSteps.test.ts:81)."
  },
  {
    "id": "REC-06",
    "journey": "reconciliation-sweep",
    "character": "panel",
    "cert_level": "L1",
    "type": "trust",
    "severity": "major",
    "impact": { "frequency": "high", "reachability": "high", "trust_erosion": "med" },
    "dimension": "clarity",
    "title": "The salary figure loses its period exactly at the money moments: the candidate offer page and the recruiter approval card render a gross-MONTHLY figure with no '/month' (and the approval card formats with no locale, mixing '85,000' into a cs UI)",
    "expected": "Every comp figure carries currency AND period, formatted via the shared formatSalaryRange/formatCzk (format.ts contract).",
    "got": "offer/[token]/page.tsx:220-229 shows salary.toLocaleString(locale) + nullable offer.currency, no period; AiReviewCard.tsx:57,79-80 shows toLocaleString() with NO locale + no period; the letter body meanwhile says 'Gross monthly compensation' (automation.py:735). Three offer surfaces disagree on whether the period appears at all (CandidateResultView.tsx:90 has it).",
    "evidence": [
      "app/offer/[token]/page.tsx:220-229",
      "app/api/pipeline/[id]/route.ts:43-44 (currency nullable into offers-store.ts:33-34)",
      "app/features/sub_decisions/AiReviewCard.tsx:57,79-80",
      "app/features/sub_pipeline/CandidateResultView.tsx:89-90,102-103",
      "pipeline/jobfit/automation.py:735",
      "app/_lib/format.ts:18,39-54 (the unused-here contract)"
    ],
    "code_check": "present-broken",
    "verdict": "confirmed",
    "resolution": "open",
    "ceiling": null,
    "suggested_acceptance": "The candidate offer page and approval card render '48 000 CZK / month' via formatSalaryRange; a null stored currency falls back to APP_CURRENCY, never a bare number."
  },
  {
    "id": "REC-07",
    "journey": "reconciliation-sweep",
    "character": "panel",
    "cert_level": "L1",
    "type": "quality-gap",
    "severity": "minor",
    "impact": { "frequency": "med", "reachability": "med", "trust_erosion": "low" },
    "dimension": "trust",
    "title": "Salary convention drift around the shared contract: 6 surfaces hand-roll 'CZK' strings; the +30% growth target is duplicated with different rounding and hardcodes 'CZK / month' onto multi-currency analyses; campaign copy says 'Kč' where everything else says 'CZK'",
    "expected": "One formatter (format.ts) + one growth-target helper (backlog idea-615cbc37) so a EUR/annual analysis is never labeled 'CZK / month'.",
    "got": "SalaryTab.tsx:18 rounds midpoint*1.3 to 5000, SalaryGauge.tsx:28 doesn't; the callout string (en.json:117) hardcodes 'CZK / month' while the sibling gauge on the same panel respects analysis.salary.currency/period; jobMarkdown.ts:3-4, CoachPanel.tsx:30, company-template.ts:16, JobsTypes.ts:147-150 bypass the formatter; campaign.py:87 prints 'Kč' (cs) vs 'CZK' (en).",
    "evidence": [
      "app/_components/results/salary/SalaryTab.tsx:18,52 + SalaryGauge.tsx:28,113",
      "messages/en.json:117",
      "app/features/sub_jobs/jobMarkdown.ts:3-4 + CoachPanel.tsx:30 + JobsTypes.ts:147-150",
      "app/features/simulation/company-template.ts:16",
      "pipeline/jobfit/campaign.py:87"
    ],
    "code_check": "present-broken",
    "verdict": "confirmed",
    "resolution": "open",
    "ceiling": null,
    "suggested_acceptance": "salaryGrowthTarget(midpoint) helper in format.ts consumed by both gauge and tab; grep for 'CZK' string literals outside format.ts returns only the contract."
  },
  {
    "id": "REC-08",
    "journey": "reconciliation-sweep",
    "character": "panel",
    "cert_level": "L1",
    "type": "trust",
    "severity": "minor",
    "impact": { "frequency": "low", "reachability": "med", "trust_erosion": "high" },
    "dimension": "trust",
    "title": "Retention promise is hardcoded '12 months' in candidate-facing consent copy and the compliance page while enforcement follows KP_CONSENT_TTL_DAYS (default 365, clamp 1..3650) — any operator retune silently falsifies the GDPR statement",
    "expected": "The copy interpolates the effective TTL (consent.ts exports it) or the compliance page reads it at render.",
    "got": "aiDisclosure.dataConsent (cs/en.json:548, rendered on quick-apply, conversational apply and devcase apply via AiDisclosure.tsx:60) and compliance covered5 (cs/en.json:1458, ComplianceSection.tsx:129) both hardcode 12 months; consent.ts:14-18 makes the real window configurable and per-row-baked (pipeline.ts:944-959), so at TTL>365 the candidate statement UNDER-discloses. Today (default 365) copy and enforcement coincide — config seam, not a live lie. Live note: all current seeded entries have consent_expires_at NULL, so the sweep governs only fresh applies.",
    "evidence": [
      "app/_lib/consent.ts:8-18,35-37",
      "app/_lib/db/pipeline.ts:944-959,1065-1082",
      "messages/cs.json:548 + messages/en.json:548 + app/_components/AiDisclosure.tsx:60",
      "messages/cs.json:1458 + app/features/sub_decisions/ComplianceSection.tsx:129",
      "live kp.sqlite (read-only): consent_expires_at NULL on all sampled entries"
    ],
    "code_check": "present-broken",
    "verdict": "confirmed",
    "resolution": "open",
    "ceiling": null,
    "scope_note": "A DPO character (Lucie) rates this major the day KP_CONSENT_TTL_DAYS diverges from 365 — the falsified statement is the legal basis text itself.",
    "suggested_acceptance": "Setting KP_CONSENT_TTL_DAYS=180 changes both the apply consent statement and the compliance page without a code change."
  },
  {
    "id": "REC-09",
    "journey": "reconciliation-sweep",
    "character": "panel",
    "cert_level": "L1",
    "type": "trust",
    "severity": "major",
    "impact": { "frequency": "high", "reachability": "med", "trust_erosion": "high" },
    "dimension": "trust",
    "title": "Definitive tenancy inventory: 53 tables — 2 scoped (analyses, profiles), 5 exempt, 46 global gaps; pipeline_entries carries the column but every read is blind; global search leaks even the two scoped tables; the decision ledger, offers, group-evals, schedule and interview transcripts have no tenant column at all",
    "expected": "The scoped set covers everything holding per-tenant candidate/comp/decision data before any multi-workspace or public-demo exposure.",
    "got": "tenancy.ts:22 admits only analyses+profiles are scoped and fail-closes KP_MULTI_WORKSPACE (tenancy.ts:63, core.ts:820); pipeline reads are workspace-blind (db/pipeline.ts:286,301; db/analytics.ts:135-138); searchEntities runs unscoped raw SQL over profiles/analyses too (db/analytics.ts:570-631); decision_records (decision-record-store.ts:57 — live PRAGMA confirms no ws column), offers (offers-store.ts:26), group_evals (db/group-eval.ts:18), schedule_invites (schedule-store.ts:21), interview_sessions (core.ts:458), dev_outbox (core.ts:417), llm_usage (core.ts:513) are global; candidate-pool.ts:49,57 pins the DEFAULT workspace; ~10 of 131 API routes resolve a workspace at all. Live today: a single workspace row exists, so exposure is structural — except the demo-session path, where L2 already watched an anonymous session read 53 named candidates (EB-H1-04, shot 21).",
    "evidence": [
      "app/_lib/tenancy.ts:22-35,63 + app/_lib/db/core.ts:820",
      "app/_lib/workspace-lock.ts:1-27 + app/_lib/auth/session.ts:13,82",
      "app/_lib/db/pipeline.ts:286,301 + app/_lib/db/analytics.ts:135-138,570-631",
      "app/_lib/decision-record-store.ts:57 + app/_lib/offers-store.ts:26 + app/_lib/db/group-eval.ts:18 + app/_lib/schedule-store.ts:21 + app/_lib/db/core.ts:458,417,513",
      "app/_lib/candidate-pool.ts:49,57",
      "app/api/demo/route.ts:26-45 + EB-H1-04 shot 21",
      "live kp.sqlite (read-only): PRAGMA decision_records/group_evals/offers — no workspace column; workspaces = ['workspace']"
    ],
    "code_check": "confirmed-absent",
    "verdict": "confirmed",
    "resolution": "open",
    "ceiling": null,
    "scope_note": "Ship-bar item. Consolidates the per-journey tenant-blind majors (screening-decisions, group-eval, jd-to-shortlist, analytics-calibration, EB-H1-04) into ONE inventory so the fix is planned against the full 46-gap list, not store-by-store. Honest strength: tenancy.ts names its own gap and fail-closes the flag.",
    "suggested_acceptance": "TENANCY_SCOPED_TABLES covers every table holding candidate/comp/decision data (or the table is justified on the exempt list); searchEntities takes a workspace predicate; assertTenancyReady passes with KP_MULTI_WORKSPACE=1."
  },
  {
    "id": "REC-10",
    "journey": "reconciliation-sweep",
    "character": "panel",
    "cert_level": "L2",
    "type": "trust",
    "severity": "major",
    "impact": { "frequency": "high", "reachability": "high", "trust_erosion": "high" },
    "dimension": "trust",
    "title": "Systemic delivery truth-language inventory: the channel layer defines `queued` as a terminal non-delivery state, yet 8 surface families translate it as 'sent/emailed' — live, 12 of 12 outbox rows are queued (5 offers, 3 onboarding, 1 rejection, 1 invite, 1 reminder, 1 confirmation) while the UI said 'odesláno' for each",
    "expected": "Delivery language matches the outbox status: 'queued (not delivered — no relay configured)' everywhere, with 'sent' reserved for a relayed 2xx — as the Comms Center already does.",
    "got": "comms.ts:13-14,34-42 (queued = terminal). Claim sites: quick-apply 'We've emailed you a confirmation' (cs/en.json:719, quick/route.ts:140, dispatch lead-intake.ts:129-131); drawer green '✓ odeslán kandidátovi' driven by dispatched:true = outbox-row-recorded (schedule/invite/route.ts:43-54, CandidateDrawer.tsx:819-821,883-885, cs.json:1241,1243); offer 'Nabídka odeslána' (CandidateDrawer.tsx:940, cs.json:1193,2915,2006); rejection 'Zamítnutí odesláno' (cs.json:2909, incl. sim-dispatched real rejections screen-wave.ts:281); outreach 'Oslovení odesláno' (cs.json:2908, automation-run.ts:45-53); reminders/onboarding (cs.json:1225,2930; comms-dispatch.ts:365-372 comments 'the candidate has been reminded'); candidate pages promising future email (cs.json:624,548). All recipients are display NAMES (comms-dispatch.ts:63-68).",
    "evidence": [
      "app/_lib/comms.ts:13-23,34-42",
      "messages/cs.json:719,1241,1243,1193,2908,2909,2915,1225,2930,624,548 (+ en.json:719)",
      "app/api/apply/[id]/quick/route.ts:140 + app/_lib/lead-intake.ts:129-131",
      "app/api/schedule/invite/route.ts:43-54 + app/features/sub_pipeline/CandidateDrawer.tsx:819-821,883-885,940",
      "app/_lib/automation-run.ts:45-53 + app/_lib/comms-dispatch.ts:63-68,194,235,365-372",
      "live kp.sqlite (read-only, 2026-07-02): dev_outbox 12/12 status=queued channel=outbox, zero sent"
    ],
    "code_check": "present-broken",
    "verdict": "confirmed",
    "resolution": "open",
    "ceiling": null,
    "scope_note": "Consolidates the per-journey delivery majors (candidate-apply-status, sourcing, offer-onboarding OO-L2-x, screening) into one inventory. The reference implementation ships in-product: CommsCenter.tsx:142 (cs.json:2461 'tyto zprávy se NEodesílají kandidátům') + the honest channel chip CommsCenter.tsx:234 + noAddressHint cs.json:2456; the full-apply ack (cs.json:706) is also honest.",
    "suggested_acceptance": "With COMMS_WEBHOOK_URL unset, no surface uses the words sent/odesláno/emailed; each claim site reflects the outbox row's real status the way the Comms Center does."
  },
  {
    "id": "REC-11",
    "journey": "reconciliation-sweep",
    "character": "panel",
    "cert_level": "L2",
    "type": "trust",
    "severity": "major",
    "impact": { "frequency": "med", "reachability": "high", "trust_erosion": "high" },
    "dimension": "trust",
    "title": "(SIM) is a purge key, not a filter key: zero read/aggregate surfaces exclude simulation rows — live, 'Vít Malý / Senior Java Backend Engineer (SIM)' sits Hired inside the 7-day window, inflating 'hired this week', the funnel (hired:6), ROI and cost-per-hire",
    "expected": "Live aggregates exclude rows whose job_title carries SIM_MARKER (or sim runs are isolated by workspace) so a demo can never move a leadership metric.",
    "got": "The only marker-aware query is the destructive resetSim (sim-store.ts:38-67), which itself leaves dev_outbox/decision_records/group_evals/tasks residue. TodayRail.tsx:51-53, db/analytics.ts:131-138,166,181-258,302-329,473,503, analytics-momentum.ts:58, analytics-forecast.ts, decision-record-store.ts:159-165, db/devcase.ts:337-372 and search (db/analytics.ts:583-596) all read unfiltered. The demo-workspace sandbox engages only with KP_SECRET (api/demo/route.ts:26-45) and aggregates carry no workspace predicate anyway. Live DB: 9 (SIM) pipeline rows; simHired = Vít Malý, stage_changed 2026-07-02T14:22Z; hiredLast7d = [Anna Bartošová (real), Vít Malý (SIM)]; GET /api/analytics funnel hired:6 includes it.",
    "evidence": [
      "app/features/simulation/constants.ts:7-8",
      "app/_lib/sim-store.ts:38-67",
      "app/features/sub_pipeline/TodayRail.tsx:51-53",
      "app/_lib/db/analytics.ts:131-138,166,302-329,473,503,583-596",
      "app/api/demo/route.ts:26-45",
      "live kp.sqlite (read-only, 2026-07-02): simHired=Vít Malý @2026-07-02T14:22Z; 9 (SIM) entries; live GET /api/analytics → hired:6"
    ],
    "code_check": "confirmed-absent",
    "verdict": "confirmed",
    "resolution": "open",
    "ceiling": null,
    "scope_note": "Confirms and generalizes gsim-l2-105: the pollution is not one badge — it is every aggregate, because filtering was never a design property of the marker.",
    "suggested_acceptance": "After a sim run, /api/analytics and TodayRail report the same hired count as before the run; search may still find (SIM) rows but labels them."
  },
  {
    "id": "REC-S1",
    "journey": "reconciliation-sweep",
    "character": "panel",
    "cert_level": "L1",
    "type": "trust",
    "severity": "polish",
    "impact": { "frequency": "high", "reachability": "high", "trust_erosion": "low" },
    "dimension": "trust",
    "title": "STRENGTH — the canonical seams that DO hold: one stage axis (PIPELINE_STAGES + enums.stage via useEnumLabel), one salary contract (APP_CURRENCY + formatSalaryRange + the cross-currency comparability guard), and a tenancy manifest that names its own gap and fail-closes the multi-workspace flag",
    "expected": "—",
    "got": "pipeline-stages.ts:12 is imported by board and funnel alike; use-enum-label.ts:13-21 keeps cs/en labels single-sourced; salary-band.ts:31-58 refuses cross-currency verdicts instead of faking them; tenancy.ts:22-35,63 is machine-checked honesty (assertTenancyReady). These are the patterns the fixes for REC-05/06/07/09 should extend, not replace.",
    "evidence": [
      "app/_lib/pipeline-stages.ts:12,17",
      "app/_lib/use-enum-label.ts:13-21",
      "app/_lib/format.ts:18,39-54 + app/_lib/salary-band.ts:31-58",
      "app/_lib/tenancy.ts:22-35,63"
    ],
    "code_check": "n-a",
    "verdict": "confirmed",
    "resolution": "by-design",
    "ceiling": "Single-sourcing stops at the module boundary: python (campaign.py, automation.py) and the simulation keep their own literals with no parity test.",
    "suggested_acceptance": null
  },
  {
    "id": "REC-S2",
    "journey": "reconciliation-sweep",
    "character": "panel",
    "cert_level": "L2",
    "type": "trust",
    "severity": "polish",
    "impact": { "frequency": "high", "reachability": "high", "trust_erosion": "low" },
    "dimension": "trust",
    "title": "STRENGTH — the honest-delivery reference implementation already ships: Comms Center's red 'tyto zprávy se NEodesílají kandidátům' banner, per-row channel chips instead of a fake 'sent', and the no-deliverable-address warning",
    "expected": "—",
    "got": "CommsCenter.tsx:142 renders relayNotConfigured (cs.json:2461) whenever the relay is absent; :234 shows the raw channel for queued rows; cs.json:2456 warns when the recipient is not a deliverable address. This is the exact language REC-10's eight claim sites should adopt — the design problem is already solved in one place.",
    "evidence": [
      "app/features/sub_channels/CommsCenter.tsx:142,234",
      "messages/cs.json:2456,2458,2461",
      "L2 shot reference: OO-L2-S7 (offer-onboarding run)"
    ],
    "code_check": "n-a",
    "verdict": "confirmed",
    "resolution": "by-design",
    "ceiling": "The honesty lives only on the operator-facing Comms Center tab; no candidate-facing or drawer surface reuses it yet.",
    "suggested_acceptance": null
  }
]
```

---

## Summary (5 lines)

1. **Match score DISAGREES systemically**: three producers (stored entry score, fresh offer-pricing recompute, CV-analysis score) never reconcile — live, every Offer/Hired row diverges (57/49/70 on the money card) and the calibration engine measures the one score that never acts (live n=0); seven `?? 0` sites fabricate scores into sealed records.
2. **Stage vocabulary AGREES at the core** (one canonical constant + single-sourced cs/en labels) but the simulation keeps a third hardcoded-English vocabulary, and TodayRail projects stage position into the false claim "offers awaiting replies" — live, 2 of 3 Offer-stage entries have no offer record at all.
3. **Salary DRIFTS around a good contract**: the candidate offer page and approval card drop the "/month" on a monthly figure, six surfaces hand-roll "CZK", the +30% growth target is duplicated with different rounding, and consent/retention copy hardcodes "12 months" against a configurable KP_CONSENT_TTL_DAYS.
4. **Tenancy and (SIM) hygiene are the two structural DISAGREEs**: 2 of 53 tables workspace-scoped (46 gaps incl. the decision ledger, offers, transcripts; global search leaks even the scoped two), and the (SIM) marker filters nothing — a demo hire sits live in "hired this week", the funnel, ROI and cost-per-hire.
5. **Delivery truth-language is the sharpest adoption risk**: the channel layer defines `queued` as terminal non-delivery, yet 8 surface families say "sent/emailed" — live 12/12 outbox rows queued while the UI said "odesláno"; the honest Comms Center banner is the ready-made reference language. **13 findings: 11 defects (5 live-confirmed L2, 6 code-grounded L1) + 2 strengths.**
