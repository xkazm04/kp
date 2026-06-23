> Total: 6 findings (0c critical, 1h high, 3m medium, 2l low)

## 1. `isDeadLettered` helper is dead code — every consumer hand-rolls `status === "failed"`
- **Severity**: High
- **Category**: dead-code
- **File**: app/_lib/comms-status.ts:33-35 (consumers: app/features/sub_channels/CommsCenter.tsx:88,174,185; app/features/sub_dev/OutboxSection.tsx:113; app/api/comms/route.ts)
- **Scenario**: `grep -rn "isDeadLettered" app/` returns ONLY its own definition (comms-status.ts:33) and its unit test (comms-status.test.ts ×4) — zero production callers. Its own doc comment claims it exists so "readers (UI/alerts) don't string-compare the literal", yet every actual reader does exactly that: CommsCenter `m.status === "failed"`, OutboxSection `m.status === "failed"`, and api/comms/route.ts filters on the literal. The helper was added with the contract but never wired into the call sites it was meant to replace.
- **Root cause**: The status-contract refactor introduced the canonical helper but the existing literal comparisons were never migrated to use it.
- **Impact**: Misleading API — the helper advertises a single source of truth for "is this a dead-letter?" that nobody honors, so the literal `"failed"` checks are the real (scattered) source of truth. A future change to dead-letter semantics would be applied to the helper and silently miss every real consumer. The accompanying test gives false confidence that the helper is load-bearing.
- **Fix sketch**: Either (a) delete `isDeadLettered` + its test block, since the literal comparisons are simple and ubiquitous; or (b) actually adopt it — replace `m.status === "failed"` with `isDeadLettered(m.status)` in CommsCenter.tsx (3 sites), OutboxSection.tsx (1 site), and api/comms/route.ts, then keep the test. Option (b) realizes the original intent; option (a) is the lower-risk cleanup. Do not leave it half-wired as it is now.

## 2. The "recovered dead-letter" predicate is implemented twice with subtly different boundaries
- **Severity**: Medium
- **Category**: duplication
- **File**: app/api/comms/route.ts:26-38 and app/api/comms/[id]/resend/route.ts:38-48
- **Scenario**: Both routes compute the same concept — "a NEWER non-`failed` outbox row exists for the same (ref, kind) after this failed row, so it's already recovered." In `comms/route.ts` the test is `okAt >= m.createdAt` (>=, over a `latestOkAt` map built from the unfiltered window). In `resend/route.ts` it's `m.createdAt > original.createdAt` (strict >, with an extra `m.id !== original.id` guard). I confirmed both call the same `listOutboxFiltered` (app/_lib/db/devcase.ts:353) and both key on `(ref, kind)`. The `>=` vs `>` mismatch means the read view and the resend guard can disagree on a same-millisecond row.
- **Root cause**: The read endpoint (W6-2) and the resend endpoint (W6-1) were built separately and each re-derived the recovery rule inline rather than sharing it.
- **Impact**: Two copies of a correctness-sensitive rule (it gates whether a duplicate offer/rejection goes to a candidate). They can drift — and the `>=`/`>` difference is already a latent inconsistency. Maintenance must remember to edit both.
- **Fix sketch**: Extract a single helper, e.g. `isRecovered(failed: OutboxEntry, siblings: OutboxEntry[]): { recovered: boolean; recoveredAt: string | null }` in app/_lib/comms-status.ts (import-free) or a small comms helper module, decide on one boundary (`>` with the `id` guard is the safer of the two), and call it from both routes.

## 3. Repeated `durationMin → length` interpolation across four dispatchers
- **Severity**: Medium
- **Category**: duplication
- **File**: app/_lib/comms-dispatch.ts:260, 289, 313, 342
- **Scenario**: Four dispatchers (interviewConfirmation, scheduleInvite, interviewReminder, interviewInvite) contain the byte-identical line `const length = opts?.durationMin ? t("<kind>.length", { minutes: opts.durationMin }) : "";`, differing only by the translation key, which always follows the `<kind>.length` convention. Confirmed via `grep -n "opts?.durationMin ? t(" comms-dispatch.ts` (4 hits).
- **Root cause**: Each dispatcher was written by copying the previous one; the shared "optional duration suffix" idiom was never factored out.
- **Impact**: Low individually but multiplied ×4; a change to how durations render (e.g. clamping, rounding, a max) must be made in four places. Adds noise to an already-403-line file.
- **Fix sketch**: Add a tiny local helper `const lengthSuffix = (t, key, min?) => min ? t(key, { minutes: min }) : "";` and call `lengthSuffix(t, "interviewInvite.length", opts?.durationMin)`. Behavior-preserving.

## 4. `dataFooter` doc comment is split by an out-of-place type definition
- **Severity**: Medium
- **Category**: structure
- **File**: app/_lib/comms-dispatch.ts:74-96
- **Scenario**: The multi-line block comment describing `dataFooter` (lines 74-82) runs straight into a paragraph documenting `CandidateCommTarget`, then the `CandidateCommTarget` type is declared (83-89), and only then does `dataFooter` appear (91). So the function's own doc comment is physically separated from the function by an unrelated type declaration, and the type's documentation is glued to the tail of the function's comment. Reading top-to-bottom, the `publicBaseUrl()` / "detached run" notes appear to describe `CandidateCommTarget`, which they don't.
- **Root cause**: `CandidateCommTarget` was hoisted above `dataFooter` (because `sendCandidateComm` also needs it) but inserted into the middle of the pre-existing comment instead of before it.
- **Impact**: Confusing for maintainers — the comment-to-symbol mapping is wrong, which is exactly the kind of doc rot that misleads the next editor. Pure readability cost.
- **Fix sketch**: Move the `CandidateCommTarget` type (and its one-line doc) to sit BEFORE the `dataFooter` comment block, so each comment is adjacent to the symbol it documents. No code change.

## 5. `KNOWN_COMM_KINDS` is an export with no production consumer
- **Severity**: Low
- **Category**: dead-code
- **File**: app/_lib/comms-envelope.ts:25-34
- **Scenario**: `grep -rn "KNOWN_COMM_KINDS" app/` shows only the definition (comms-envelope.ts:25) and the test (comms-envelope.test.ts:10,72). The envelope builder itself does NOT use it — `kind` passes through verbatim (the comment even says "Documentation-adjacent, not enforcement … a relay should treat this list as open"). So it is a documentation-only constant exercised solely by a test that re-asserts the literal array.
- **Root cause**: Added as a self-documenting vocabulary for the export schema, but nothing in code reads it (by design — kinds are open).
- **Impact**: Minor. It is genuinely informative for the wire contract, but it is unused code that the test pins, so any new comm kind requires touching the constant AND the test purely for bookkeeping. Borderline-keep; flagging so the team can decide whether the doc value justifies the maintenance.
- **Fix sketch**: Keep if the team values it as the documented vocabulary (then leave as-is — it is honest about being non-enforcing). Otherwise drop the constant + its test assertion and rely on docs/OUTBOUND_EXPORT.md. Do NOT start enforcing it (that would break the deliberately-open contract).

## 6. Two near-identical post-send "audit write failed" swallow blocks
- **Severity**: Low
- **Category**: duplication
- **File**: app/_lib/comms-dispatch.ts:319-323 and 397-401
- **Scenario**: `dispatchInterviewReminder` and `dispatchOfferReminder` end with the same try/catch that swallows a post-send `recordAutomationEvent` failure and logs `"[<x>] delivered but audit-log write failed for entry … "`. Confirmed two hits of the identical log shape. The pattern (and its rationale: a throw after delivery would trigger a duplicate send) is genuinely shared between the two heartbeat-driven, at-most-once dispatchers.
- **Root cause**: The second reminder dispatcher copied the delivery-boundary pattern from the first.
- **Impact**: Small; two copies of a delivery-safety idiom. Low risk but worth a shared helper so the "never re-throw after the message left" guarantee lives in one place.
- **Fix sketch**: Extract `recordPostSend(entryId, event, detail, tag)` that wraps `recordAutomationEvent` in the try/catch + the standard log line, and call it from both reminders (and any future heartbeat dispatcher). Behavior-preserving.
