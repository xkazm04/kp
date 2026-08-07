# Sourcing, Campaigns & Rediscovery — bug-hunter + ui-perfectionist scan

> Context: Surface matching candidates for a role, run outreach campaigns, rediscover past applicants, and assess role winnability.
> Files reviewed: 15 of 21
> Total: 5

## 1. Rediscovery "Reach out" mints a fresh pipeline entry that resets consent — re-contacting expired/anonymized candidates the suppression gate exists to block

- **Severity**: High
- **Lens**: bug-hunter
- **Category**: validation-gap
- **File**: `app/api/jobs/[id]/candidates/outreach/route.ts:45-61`; gate `app/_lib/comms-dispatch.ts:206-226`; consent read `app/_lib/consent.ts:70-78`; entry insert `app/_lib/db/pipeline.ts:609-618`
- **Scenario**: A candidate applied to Role X; their consent later expired (or they were anonymized) on entry `m-<cand>-X`. Rediscovery surfaces them as a silver medalist for a *different* Role Y. The recruiter clicks "Reach out". The route calls `createPipelineEntry({candidateId, jobId: Y, ...})` — a brand-new id `m-<cand>-Y` that never existed, so it INSERTs a row with `consent_given_at`/`consent_expires_at`/`anonymized_at` all NULL. `runAutomationTask("outreach")` then dispatches against *that* entry.
- **Root cause**: Consent/anonymization is stored per pipeline ENTRY (per candidate×job), but `outreachSuppressionReason` reads the consent of the *new* Role-Y entry — which is blank → `consentStatus` = `"none"` → contactable. The old entry's expired/anonymized state does not carry across roles, so the gate whose docstring says "outreach — especially via rediscovery, which re-contacts previously-REJECTED candidates — must never send to a candidate whose processing consent has EXPIRED" is silently defeated for exactly the cross-role case rediscovery is built on.
- **Impact**: GDPR / e-privacy harm: a real candidate whose lawful retention window lapsed (or who was scrubbed) receives fresh unsolicited outreach, and it is audited as a legitimate `outreach_sent`.
- **Fix sketch**: Resolve consent at the CANDIDATE level, not the entry: before dispatch, look up the candidate's most-restrictive consent across all their entries (any `anonymized_at`, or the latest `consent_expires_at`) and suppress on that. Make the class impossible by having `createPipelineEntry` seed a sourced entry's consent snapshot from the candidate's prior entries instead of NULL.

## 2. `sweepRediscoveryAlerts` fans out one Python CLI per published role with no cap and no `maxDuration` — unbounded subprocess/CPU blowup

- **Severity**: High
- **Lens**: bug-hunter
- **Category**: edge-case
- **File**: `app/_lib/rediscover.ts:126-138` (sweep) and `:108-120`; route `app/api/rediscovery/alerts/route.ts:53-61`
- **Scenario**: A recruiter clicks "Refresh" on the rediscovery feed. POST `/api/rediscovery/alerts` runs `sweepRediscoveryAlerts`, which takes *every* published role and, sequentially, calls `raiseRediscoveryAlertsForJob → rediscoverForJob → rankPoolForJob`, each spawning a `recruiter_cli` child that ranks the whole pool (up to ~160 candidates). N published roles = N sequential multi-second subprocess spawns.
- **Root cause**: The code comments assume "cheap: the free plan caps active roles," but no cap is enforced on this path — `listJobStatuses()` returns all published roles with no slice, and the route exports no `maxDuration` (unlike `campaign/route.ts`, which sets 180s for a single CLI). A paid/seeded workspace with dozens of open roles turns one click into a minutes-long request.
- **Impact**: A normal multi-role workspace can exhaust CPU, pile up ranking children, and blow the platform's default serverless timeout mid-sweep — persisting a partial alert set with no signal to the user. The `opts.signal` break helps only if the client actually aborts.
- **Fix sketch**: Bound the sweep: cap the number of roles per sweep (e.g. top-N most-recently-published), export a `maxDuration`, and/or move the sweep to a queued background task that reports progress — so the request cost can never scale linearly with the role count.

## 3. `RecruiterCandidates.load()` has no request key / abort — a slow ranking for the previous role clobbers the new role's list

- **Severity**: Medium
- **Lens**: bug-hunter
- **Category**: race-condition
- **File**: `app/features/sub_jobs/RecruiterCandidates.tsx:53-84`
- **Scenario**: The posting modal is reused across jobs. The recruiter scores Role A (slow `recruiter_cli` GET in flight), then switches the modal to Role B; `autoLoad` fires `load()` for B. Two fetches race. If A's response lands last, `setData(payload)` writes A's candidates while the modal header shows Role B.
- **Root cause**: `load()` writes `setData` unconditionally in its `.then`, with no per-request key guard and no `AbortController`/signal. `CampaignTab` solves exactly this with a `requestKeyRef` that re-checks the key before every state write (`CampaignTab.tsx:59,76`); `RecruiterCandidates` was never given the same guard, and `loadedJobRef` only gates *initiation*, not late resolution.
- **Impact**: Recruiter acts on the wrong role's ranked pool — adds/reaches out to candidates who were scored against a different job. Silent wrong result.
- **Fix sketch**: Capture a `requestKeyRef` (or `AbortController`) per `jobId` and drop any response whose key ≠ current before `setData`; thread the signal into the fetch so a role switch cancels the stale ranking (which also SIGKILLs the orphaned CLI child).

## 4. RediscoveryFeed's "Added ✓" success state is unreachable dead code — a filed candidate's row just vanishes with no confirmation

- **Severity**: Medium
- **Lens**: ui-perfectionist
- **Category**: missing-ui-state
- **File**: `app/features/sub_jobs/RediscoveryFeed.tsx:107-134` (add), `:93-105` (dismiss), `:185-188` (badge)
- **Scenario**: A recruiter clicks "+ pipeline" on a feed alert. On success, `addToPipeline` does `setAdded(...add(candidateId))` and then immediately calls `dismiss(a.id)`, which `setAlerts(prev => prev.filter(a => a.id !== id))` — removing the row in the same render tick.
- **Root cause**: The `added.has(a.candidateId)` branch that renders the green `Check + "Added"` badge lives inside `alerts.map`, but the row is filtered out of `alerts` the instant it succeeds, so that branch can never render. The `added` Set becomes write-only. The row silently disappears with no toast or confirmation — inconsistent with `RediscoverPanel`/`RecruiterCandidates`, which keep the row and badge it "Added".
- **Impact**: No positive confirmation that the add worked; the disappearance reads as ambiguous (added? dismissed by mistake?), and dead code invites future confusion.
- **Fix sketch**: Either keep the row and show the "Added" badge for a beat before dismissing (setTimeout, matching the other two surfaces), or replace the vanish with an explicit success toast. Extract a shared "silver-medalist row" component so the three surfaces render the added/reached state identically.

## 5. CoachPanel hardcodes `CZK` + `cs-CZ` for the salary band, bypassing the app's `APP_CURRENCY` salary contract

- **Severity**: Low
- **Lens**: ui-perfectionist
- **Category**: visual-consistency
- **File**: `app/features/sub_jobs/CoachPanel.tsx:29-30`
- **Scenario**: The winnability coach renders the role's salary band via `fmtBand`, which formats with `toLocaleString("cs-CZ")` and appends a literal `" CZK"`.
- **Root cause**: The salary domain elsewhere deliberately routes currency through `APP_CURRENCY` and `formatSalaryRange` to prevent this exact drift (`app/_lib/salary-band.ts:128-130` comments "not a hardcoded 'CZK' literal that silently mislabels bands if APP_CURRENCY ever changes"). `fmtBand` re-introduces the hardcode and pins Czech digit grouping regardless of the viewer's locale.
- **Impact**: If `APP_CURRENCY` changes or the app serves a non-CZK deployment, the coach mislabels the band's currency and uses Czech grouping for a de/fr/en user — a subtle correctness/consistency defect in a money figure.
- **Fix sketch**: Format the band through the shared `formatSalaryRange`/`APP_CURRENCY` helper (as `salary-band.ts` and the JD builder do) rather than a local `cs-CZ`+`CZK` template, so every salary surface reads the same currency and locale.
