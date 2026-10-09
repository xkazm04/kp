# R4-interview-ui-2: a deleted recording attempt takes no more chunks

Commit: `fix(interview): a deleted recording attempt takes no more chunks` — 2798d4891 (the merge may rebase).

## Reconcile at base f6ad8f6a3
- (a) holds: `claimInterviewRecordingChunk` (interviews.ts) built `next` from `{ ...existing }` with no `deletedAt` check; a chunk for a deleted attempt returned `claimed`.
- (b) holds: `app/api/interview/recording/route.ts` answered only missing, duplicate, full before `appendRecordingChunk`.

## Failing on base (tests written first, fix absent)
- status-recording.test.ts: `a deleted attempt takes no more audio` — actual `'claimed'`, expected `'closed'`.
- recruiter-recording-delete.test.ts: `whole session` — actual `'claimed'`, expected `'closed'`.
- recording-door.test.ts: `in_progress` — `200 !== 409` (real POST handler).
All three now pass (5/5, 4/4, 12/12).

## Fix
- `RecordingChunkClaim.outcome` gains `closed`. In the claim transaction, `existing?.deletedAt` returns `{ outcome: "closed", meta: existing, first: false }` after the duplicate check and before the ceiling check; nothing written.
- The upload route answers `closed` with `jsonRefusal("INTERVIEW_RECORDING_CLOSED", 409)` before any append. No new message key.

## Caller audit
`claimInterviewRecordingChunk` has one non-test caller: app/api/interview/recording/route.ts:108 (outcome handling at :119-125, now including `closed`). No other switch over the outcome exists. Test callers: status-recording.test.ts, recruiter-recording-delete.test.ts (new `closed` assertions) and the existing `claimed` assertion in the status harness.

## Report-only answers (nothing changed)
- A NEW attempt (higher number) after a candidate delete is still accepted while `recording_consent_at` stands: the claim only checks the existing attempt's row. So "delete my recording" today means "delete what exists", not "stop recording". Owner decision whether it should also withdraw consent.
- The candidate's delete door (app/api/status/[token]/recording/route.ts) has no live-call guard; it can delete a recording mid-call, and the live MediaRecorder keeps uploading (now refused with 409 for that attempt). A guard is a product call; the 409 makes the unguarded behaviour safe on disk.
- Erasure (`anonymizeEntry`) clearing `recording_consent_at` is R5-db-pipeline-1, queued separately; not examined here.

## Gates (worktree)
- typecheck: pass (`npm run typecheck`, no errors).
- lint: pass (0 errors, 49 pre-existing warnings).
- test:unit: pass 13050/13050; scripts/kpi 85/85.
- test:docs: pass.
- The gates rewrote app/_lib/{contract-constants,schemas,taxonomy}.generated.ts; restored.

## Not updated
CHANGELOG.md — dirty in the shared checkout.
