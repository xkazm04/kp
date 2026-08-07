# Candidate Onboarding Hand-off — bug-hunter + ui-perfectionist scan

> Context: Post-Hired onboarding hand-off — recruiter Onboarding tab plus the token-gated candidate pre-boarding questionnaire reached from an accepted offer.
> Files reviewed: 8 of 9
> Total: 5

## 1. Candidate token path provisions an onboarding run for a NOT-Hired candidate — the two hand-off gates disagree

- **Severity**: High
- **Lens**: bug-hunter
- **Category**: validation-gap / state-corruption
- **File**: `app/_lib/onboarding-candidate.ts:17-24` vs `app/api/onboarding/route.ts:57-62`
- **Scenario**: An offer is accepted but the recruiter has not yet dragged the entry to `Hired` (offer-accepted and Hired are distinct pipeline states). The candidate opens their onboarding link. `runForToken()` gates only on `offer.status === "accepted"` and immediately calls `startRun(...)`, materialising an onboarding run for an entry still sitting in the `Offer` stage.
- **Root cause**: The invariant "an onboarding run exists only for a Hired entry" is enforced at the recruiter entry point (`route.ts:59` rejects `entry.stage !== "Hired"` with 409) but NOT at the candidate bridge, which never reads the pipeline entry's current stage at all. Two divergent stage checks for the same hand-off.
- **Impact**: The employee-record hand-off fires before the candidate is actually Hired. The recruiter Onboarding tab then lists a run whose source no longer appears in the `hired` roster (GET filters `stage === "Hired"`), so a run exists for a candidate the recruiter can no longer see as onboardable — a phantom, un-cancellable hire record.
- **Fix sketch**: In `runForToken`, before `startRun`, re-read the entry and require `stage === "Hired"` (return null / "not yet available" otherwise). Centralise the Hired predicate in one helper both entry points call so the gate cannot drift.

## 2. A withdrawn hire's onboarding link stays live and the run/PII has no cancel or revoke path

- **Severity**: High
- **Lens**: bug-hunter
- **Category**: edge-case / trust-boundary (consent + retention)
- **File**: `app/_lib/onboarding-candidate.ts:17-24`, `app/api/onboarding/[id]/route.ts:14-56` (no DELETE / cancel action)
- **Scenario**: A candidate accepts, then withdraws (or is un-hired / moved to Rejected) after the recruiter has already started onboarding. Their accepted-offer token still satisfies `offer.status === "accepted"`, so a GET/POST to `/onboarding/[token]` keeps rendering and accepting pre-boarding answers, and `runForToken` will even re-`startRun` if the run was never created.
- **Root cause**: The hand-off is strictly one-way. There is no `cancelled/withdrawn` run status, no DELETE handler, and the candidate gate keys off the frozen offer status rather than the live pipeline stage — so consent/retention basis silently outlives the hire decision. (Distinct from the Privacy sibling on transcript/comms erasure: here the run itself is irreversible and the token never expires.)
- **Impact**: A person no longer being hired can still submit emergency-contact / dietary / equipment PII into a stored `onboarding_intake` row that no operator action can cancel or purge, and the recruiter cannot revoke the link.
- **Fix sketch**: Add a `cancel`/withdraw action (mark run `cancelled`, stop it resolving via token) and a DELETE that removes the run + its `onboarding_intake`/task/signature rows. Have `runForToken` also require the entry still be Hired so an un-hired token stops resolving.

## 3. `startRun` get-or-create is non-atomic — a concurrent recruiter Start + candidate link-open races the UNIQUE(entry_id) constraint into a 500

- **Severity**: Medium
- **Lens**: bug-hunter
- **Category**: race-condition
- **File**: `app/_lib/onboarding-store.ts:213-243`
- **Scenario**: The recruiter clicks "Start" (`POST /api/onboarding`) at the same moment the candidate opens their onboarding link (`runForToken` → `startRun`). Both calls run `SELECT ... WHERE entry_id = ?`, both find no row, and both `INSERT`. The second INSERT violates `entry_id TEXT UNIQUE` and throws.
- **Root cause**: Check-then-insert with no transaction / atomic upsert. The UNIQUE constraint correctly prevents a *duplicate* onboarding run (good — the hand-off can't fork), but the loser's exception surfaces through `safeJsonError` as a 500 `ONBOARDING_FAILED`, so a hand-off that in fact succeeded is reported to the candidate/recruiter as a hard failure.
- **Impact**: Spurious "onboarding failed" on the exact common path (recruiter and candidate acting near-simultaneously); the candidate's "Send my details" or the recruiter's Start shows an error though the run now exists.
- **Fix sketch**: Make it a true upsert: `INSERT INTO onboarding_runs (...) VALUES (...) ON CONFLICT(entry_id) DO NOTHING`, then re-`SELECT` the row and return it — so a concurrent start is idempotent instead of a crash.

## 4. The `sign` action ignores the run id in the URL — a mismatched signatureId signs another run's document and swaps the recruiter's view

- **Severity**: Medium
- **Lens**: bug-hunter
- **Category**: validation-gap / state-corruption
- **File**: `app/api/onboarding/[id]/route.ts:45-46` → `app/_lib/onboarding-store.ts:417-429`
- **Scenario**: A PATCH to `/api/onboarding/RUN_A` with `{ action: "sign", signatureId: <belongs to RUN_B> }`. `markSigned` looks the signature up purely by its global id, marks RUN_B's document signed, and returns `getRunDetail(row.run_id)` — i.e. RUN_B's detail. The client stores that as RUN_A's `detail`, so RUN_A's screen silently swaps to a different candidate's checklist/questionnaire/signatures.
- **Root cause**: Object-level ownership (run → signature) is never enforced on the mutation; the path `id` is accepted but unused for `sign`. Operator-only and single-tenant, so not a cross-tenant breach — but a real scoping bug and view-corruption vector.
- **Impact**: A stray/reused signatureId signs the wrong run's document (a spurious "signed" audit stamp on the wrong candidate) and corrupts the recruiter's on-screen run to another candidate's data.
- **Fix sketch**: Thread the run id through: `markSigned(runId, signatureId, signer)` with `WHERE id = ? AND run_id = ? AND status = 'requested'`, return null (404) on mismatch. Make every signature mutation require both ids so a signature can never be resolved out of its run's context.

## 5. Candidate intake save succeeds but the recruiter timeline event is swallowed with only a console.error

- **Severity**: Low
- **Lens**: bug-hunter
- **Category**: silent-failure
- **File**: `app/_lib/onboarding-candidate.ts:63-71`
- **Scenario**: The candidate submits pre-boarding answers. `saveIntake` persists them, then `recordAutomationEvent(...)` throws (DB busy / entry gone). It is caught, `console.error`'d, and the function still returns `{ ok: true }`.
- **Root cause**: A best-effort cross-surface side effect with no retry/outbox and no reconciliation — the "candidate engaged" signal to the People team can vanish while the write it mirrors succeeded.
- **Impact**: Limited, because the recruiter card's `intakeSubmitted` is derived from the `onboarding_intake` table directly (`onboarding-store.ts:285-291`), so pending→done still flips; only the timeline/notification event is lost. So a recruiter relying on the timeline (not the badge) may never learn the candidate completed pre-boarding.
- **Fix sketch**: Record the automation event in the same transaction as the intake write, or enqueue it to a durable retry queue, so the engagement signal cannot silently diverge from the persisted answers.
