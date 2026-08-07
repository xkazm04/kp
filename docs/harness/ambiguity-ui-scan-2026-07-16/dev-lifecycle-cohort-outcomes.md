# Dev Lifecycle, Cohort & Outcomes — ambiguity-guardian + ui-perfectionist scan

> Total: 6 findings (0 critical, 2 high, 4 medium, 0 low)

## 1. Approve route reports success and silently drops reviewer edits when the lifecycle is not at the gate
- **Severity**: High
- **Lens**: ambiguity
- **Category**: silent-noop-success
- **File**: `app/api/devcase/lifecycle/[id]/approve/route.ts:43`
- **Scenario**: A reviewer opens the review drawer, types edits (title/brief/tasks/timebox), and clicks "Approve with edits" — but the lifecycle already moved past `awaiting_approval` (a second tab/reviewer approved, or a retried request lands twice). The route's entire approve block is wrapped in `if (isAtReviewGate(lc.stage))` with no else: it skips the edits, the probe gate, and the audit row, yet still calls `startTask(...)` and returns `{ ok: true, task }`. The UI (`LifecycleRow.tsx` `approve()`) treats any 2xx as success.
- **Root cause**: The gate check is a silent conditional rather than a guard. The sibling `redesign` route returns a 409 (`lifecycle is at 'X', not awaiting review.`) in the same situation — the two routes disagree on the contract.
- **Impact**: Reviewer corrections to the candidate-facing case are lost with a false success signal, and the human never learns their edits didn't land — the published case can differ from what they believe they approved. Also, an un-audited `startTask` fires for a lifecycle in any arbitrary stage.
- **Fix sketch**: Mirror the redesign route: when `!isAtReviewGate(lc.stage)`, return 409 with the current stage (or at minimum `{ ok: true, applied: false, stage }` when the body carried edits). Keep the plain resume-task behavior only for the editless body, and have the ReviewPanel surface the 409 as "already approved elsewhere — reload".

## 2. Public verify API has no freshness dimension — a stale credential is `valid: true` with nothing to distinguish it
- **Severity**: High
- **Lens**: ambiguity
- **Category**: api-page-trust-divergence
- **File**: `app/api/skill-profile/[token]/verify/route.ts:33`
- **Scenario**: A third-party system (or embedded badge) calls the "FICO lookup" endpoint for a credential issued 3 years ago or signed under a superseded `methodologyVersion`. The HTML page (`app/skill/[token]/page.tsx:44-51`) deliberately downgrades exactly this case to a muted "stale" verdict — but the JSON API returns `{ found: true, valid: true, ... }` with no stale/freshness field at all. The consumer renders its own confident green check.
- **Root cause**: The `skillProfileFreshness` honesty fix (PROFILE_FRESHNESS_DAYS, methodology supersession) was wired into the server component only; the machine-readable surface never got it. Bonus dead field: `revoked: v.revoked` on the success path is always `false` (a revoked row fails `v.valid` and 404s at line 30), so the field can never carry information.
- **Impact**: The two public verification surfaces disagree on the trust verdict for the same token. Machine consumers — the audience most likely to automate decisions on the credential — over-trust old or superseded attestations, which is exactly the over-assertion the page fix was written to prevent.
- **Fix sketch**: Compute `skillProfileFreshnessNow(v.profile)` in the route and include `stale`, `staleReason`, and `ageDays` in the response (freshness derives from already-signed fields, so no signature change). Drop or document the constant-false `revoked` field.

## 3. The probe-gate 422 tells the reviewer to use an API flag the UI cannot send
- **Severity**: Medium
- **Lens**: ui
- **Category**: dead-end-error-recovery
- **File**: `app/features/sub_dev/LifecycleRow.tsx:204`
- **Scenario**: A reviewer approves a case whose probes audit to a "none" verdict. `enforceProbeGate` blocks with 422 and the message "…re-submit with overrideProbeAudit:true to ship it anyway" (`app/_lib/devcase-probe-audit.ts:84-86`). The ReviewPanel renders that text as a plain error paragraph — but its `approve()` never sends `overrideProbeAudit`, and no control in the drawer can. The documented override path exists only for curl users.
- **Root cause**: The gate's escape hatch was designed at the API layer (with audit-trail plumbing for the override) but the client was never given the affordance; the error copy leaks an API contract into end-user UI text.
- **Impact**: A reviewer who legitimately wants to ship (e.g. a deliberately probe-less screening case) hits a hard dead end inside the product, while the error message actively instructs them to bypass the UI. The audited-override doctrine is unreachable for the people it was built for.
- **Fix sketch**: On a `code: "probe_audit_failed"` response, render a confirm affordance ("Ship anyway — this will be recorded in the audit trail") that re-posts with `overrideProbeAudit: true`, instead of echoing the raw message. Reword the API error copy to be human-facing and keep the flag name in the `code`/docs only.

## 4. Bounced outbox rows are styled as "chase this" but offer no Resend, and the legend never explains `bounced`
- **Severity**: Medium
- **Lens**: ui
- **Category**: missing-recovery-action
- **File**: `app/features/sub_dev/OutboxSection.tsx:114`
- **Scenario**: A relay callback records a hard bounce on an offer/rejection. The Outbox tab shows the row in the loudest style in the table (`bounced: "text-red-800 font-semibold"`, line 58) — but the ResendButton renders only for `m.status === "failed"`. The explainer paragraph (lines 80-85) documents queued/sent/failed and omits `bounced` entirely.
- **Root cause**: The resend backend was explicitly extended to support bounced rows (`app/api/comms/[id]/resend/route.ts` — "otherwise a bounced message could never be resent (comms #3)"), but this table's render condition was never widened past `failed`; the legend copy predates the fourth status.
- **Impact**: The exact case the status contract calls "what a recruiter must chase" (comms-status.ts:29-34) is a visual dead end in the primary triage table: loud red, no action, no explanation of what the word means — the recruiter must find the Channels Comms Center to recover it.
- **Fix sketch**: Change the condition to `m.status === "failed" || m.status === "bounced"` (the resend route already handles both and dedupes newer successful sends). Add one clause to the legend: "bounced = the relay accepted it but delivery hard-failed later — resend or use another address."

## 5. Re-source failures are completely silent — including quota refusals
- **Severity**: Medium
- **Lens**: ui
- **Category**: swallowed-error-state
- **File**: `app/features/sub_dev/LifecycleRow.tsx:55`
- **Scenario**: A recruiter clicks "Re-source" on a stalled lifecycle. `reSource()` does `if (r.ok) onChanged?.()` and nothing else: on a non-2xx (404 case gone, 402 billing/quota, 500) or a network throw, the button simply returns to idle "Re-source" with no message, no retry hint, and the stalled badge unchanged.
- **Root cause**: The handler only implements the happy path. Ten lines below, `closeCase()` in the same file shows the correct pattern (`closeError` state + `role="alert"` paragraph), so this is an inconsistency within one component, not a missing pattern.
- **Impact**: The user cannot distinguish "re-source kicked off but the list hasn't refreshed" from "nothing happened". Since the case stays visibly stalled either way, the likely response is repeated clicking — each attempt potentially re-hitting a metered sourcing pipeline.
- **Fix sketch**: Mirror `closeCase`: parse the error body, store `sourceError`, render it in the existing `role="alert"` slot, and clear it on the next attempt. Surface a 402 distinctly ("sourcing quota exhausted") since that one is actionable elsewhere.

## 6. Outbox tenant derivation only understands pipeline-entry refs — every devcase comm silently falls back to the default workspace
- **Severity**: Medium
- **Lens**: ambiguity
- **Category**: silent-assumption-tenancy
- **File**: `app/_lib/db/devcase.ts:385`
- **Scenario**: `recordOutbox` derives `workspace_id` by looking `input.ref` up in `pipeline_entries` ("ref = entry id — comms.ts resolves it via getPipelineEntry"). But two in-scope callers pass a *submission* id as `ref`: the feedback route (`app/api/devcase/feedback/route.ts:40`, `ref: sub.id`) and the close route's wrap-up notes (`ref: submission.id` via sendComm). The lookup always misses and the row falls back to the hard-coded literal `"workspace"`.
- **Root cause**: The ref parameter is overloaded — "pipeline entry id" by the comment's contract, "submission id" in devcase practice — and the fallback uses a string literal instead of `DEFAULT_WORKSPACE_ID`, so the assumption is invisible: today `DEFAULT_WORKSPACE_ID === "workspace"` makes it accidentally correct.
- **Impact**: Latent cross-tenant defect: the moment a second workspace exists, that workspace's candidate feedback and close-out rejections are stamped into the *default* workspace's outbox — invisible to the recruiters who own them (`listOutbox` is workspace-scoped) and visible to another tenant. The literal also breaks silently if the default id constant ever changes.
- **Fix sketch**: Make the derivation ref-type aware: try `pipeline_entries`, then `dev_submissions`, by the same id. Replace the `"workspace"` literal with `DEFAULT_WORKSPACE_ID`. A one-line comment on `recordOutbox`'s `ref` documenting both accepted id kinds closes the ambiguity.
