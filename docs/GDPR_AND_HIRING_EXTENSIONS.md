# GDPR lifecycle + hiring extensions — design & plan

Seven features derived from the Sloneek / Recruitis / Datacruit research
(`Czech/CEE market + GDPR angle`). Built in recommended order; each ships behind
the gates (tsc · eslint · unit · build · i18n parity), dual-theme verified, one
commit per feature. Branch: `feat/gdpr-lifecycle-hiring-extensions`.

> **DPO note (must read before #1 ships to a real tenant):** "retain match
> scores + recruiter notes after anonymization" is a defensible GDPR
> data-minimization interpretation (keep non-identifying recruitment artifacts to
> re-engage a re-consenting candidate), but it is a *legal judgment call*.
> Confirm with the customer's DPO before enabling auto-anonymization in prod.

---

## 1. Consent lifecycle (foundation) — `consent`

**Goal:** capture data-processing consent with an expiry at apply; on expiry,
auto-anonymize the candidate while **retaining** the scoring/stage/notes that let
talent-rediscovery re-surface them if they re-consent (Recruitis pattern).

**Data** (`pipeline_entries`, migration in `db/core.ts`):
- `consent_given_at TEXT` · `consent_expires_at TEXT` · `consent_source TEXT`
  (`apply` | `quick-apply` | `recruiter` | webhook id) · `anonymized_at TEXT`.

**Pure, tested helpers** (`app/_lib/consent.ts`, import-free):
- `maskCandidateName(label) → "Monika M."` (first token + last initial).
- `consentExpiresAt(givenAtMs, ttlDays=CONSENT_TTL_DAYS=365) → iso`.
- `consentStatus({givenAt, expiresAt, anonymizedAt}, nowMs) → "none"|"active"|"expiring"|"expired"|"anonymized"` (expiring = <30d left).

**Store** (`db/pipeline.ts`): `recordEntryConsent(id, {source, ttlDays})`,
`anonymizeEntry(id)` (mask label, null `contact`/`github_handle`/`github_json`,
scrub linked profile + analyses PII via `anonymizeProfilePayload`, **keep**
`match_score`/stage/events/`notes`/scorecards, stamp `anonymized_at`, log a
consent event), `anonymizeExpiredConsents()` (sweep: `consent_expires_at < now
AND anonymized_at IS NULL`).

**Capture:** a required consent `ApplyStep` (`app/_lib/apply.ts`) after email;
persisted in `app/api/apply/[id]/route.ts` → `createPipelineEntry({consentSource})`.

**Sweep:** registered in `instrumentation.ts` beside `lapseExpiredOffers()`.

## 2. Self-service erasure — `erasure`

**Goal:** every candidate email carries a "manage your data" link; a public
token page lets the candidate see what's held and request erasure (right to
erasure / Art. 17).

- **Token:** `erasure_token` on the entry, minted by `ensureErasureToken(id)`
  (mirrors `ensureLeadEnrichToken`, `randomToken("er")`).
- **Routes:** `app/data/[token]/page.tsx` (candidate-facing summary + erase
  button) · `app/api/data/[token]/route.ts` (GET projection / POST → `anonymizeEntry`).
- **Email footer:** shared injection in `comms-dispatch`/`comms-envelope` →
  `comms.dataFooter` (en/cs); link built from the entry's erasure token.

## 3. Consent audit log + drawer panel — `consent-audit`

- **Table** `consent_events(id, entry_id, kind, detail, created_at)`, append-only.
  `kind ∈ granted|renewed|expiring_notified|expired|anonymized|erasure_requested|erased`.
- `logConsentEvent(id, kind, detail)` called from every consent transition.
- **UI:** a "Data & consent" section in `CandidateDrawer` (status chip + expiry +
  source + event history); data via `/api/pipeline/[id]` extension or
  `/api/pipeline/[id]/consent`.

## 4. Analytics — `analytics-stage-dwell`

- **4a (surface a dark capability):** `perStageDays` is computed but only the
  single worst `bottleneck` is shown. Return `stageDwell: {stage, avgDays,
  count}[]` from `pipelineAnalytics()` and render a per-stage table in
  `AnalyticsTab`.
- **4b (stretch):** per-(job × channel) effectiveness — genuinely missing;
  optional, lighter add once 4a lands.

## 5. Pool Fit (internal-mobility analog) — `pool-fit`

**Goal:** role-centric view that ranks the **existing profile pool** for one open
role and highlights strong **non-pipelined** matches. Reuses
`/api/jobs/[id]/candidates` (already ranks the whole pool + decorates
`inPipeline`); the surface filters `inPipeline === null && score ≥ FIT_FLOOR`,
ranks, and offers one-click add-to-pipeline. Complements silver-medalist alerts
(candidate-centric across roles) with a role-centric pool sweep. New panel in
`JobPostingModal` (reuses the `CoachPanel`/`RecruiterCandidates` patterns).

## 6. Onboarding hand-off — `onboarding`

**Goal:** continue the lifecycle past Hired. New `onboarding` tab.

- **Data:** `onboarding_templates(id, name, tasks_json)` ·
  `onboarding_runs(id, entry_id, template_id, status, started_at)` ·
  `onboarding_task_states(run_id, task_id, done, done_at)` · a pre-boarding
  **entry questionnaire** whose answers populate the run's hire record.
- **E-sign:** a **provider seam** — `requestSignature` / `markSigned` write an
  audit-stamped signature record; the real eIDAS provider (Signicat/DocuSign) is
  a documented integration point, **not** faked as "compliant" in-app.
- `dispatchOnboarding(entry)` already exists in `comms-dispatch` — reuse it.
- New tab via `tabs.ts` (`WORKSPACE_TAB_IDS` + `NAV_GROUPS`) + `Workspace.tsx`.

## 7. NL command bar — `command-bar`

**Goal:** a slim natural-language command surface over the pipeline that maps an
utterance to one of kp's **existing** actions.

- Separate slim bar (not the search palette), chord-triggered.
- **Parse:** deterministic intent matcher first (regex/keyword over a small intent
  set — reject below N% on job X, advance top N, schedule round 2 for top N,
  export, run policy pass), LLM fallback for the ambiguous rest.
- **Dispatch:** to existing endpoints (`actOnPipelineEntry`, screen-wave,
  scheduler). **Destructive ops require an explicit confirm** with a preview of
  the affected candidates.
- New capability = the parse layer only; the actions already exist (and already
  have fairness backstops + supervised mode).

---

## Status
- [x] 1 consent · [x] 2 erasure · [x] 3 consent-audit · [x] 4 analytics-stage-dwell (4a; 4b per-role channel deferred)
- [x] 5 pool-fit · [x] 6 onboarding · [ ] 7 command-bar
