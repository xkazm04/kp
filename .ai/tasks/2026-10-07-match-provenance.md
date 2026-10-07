# Match provenance: the add door checks a stored result

Date: 2026-10-07 · Charter: accepted-idea-delivery · Branch: `autopilot/accepted-idea-delivery-e0d77d32`

Closes finding 1 (High) of [`docs/security/2026-10-07-pipeline-write-doors-scan.md`](../../docs/security/2026-10-07-pipeline-write-doors-scan.md).

## Reconcile

On main `1c21c83c0` no `matchRunId` existed anywhere, and POST /api/pipeline checked a Match add's facts for shape only. Nothing was built yet.

## Result

| Commit | Change |
| --- | --- |
| `b071685ba` | Store, `/api/match` run id, Match client, add-door check, refusal codes in 4 locales, erasure, tests, matching README |
| the docs commit that adds this file | ADR 0018 amendment, scan report status, this record (the code commit was carried unchanged from run e0d77d32 by fast-forward cherry-pick, so its SHA is the same) |

How it works:
- **Store.** `match_run_results` (`app/_lib/db/match-runs.ts`), PK `(workspace_id, run_id, job_id)`, one row per job of a run, holding the verdict facts the *server* derived (`matchReasonFacts` over the engine output), the candidate id, the scorer version, a hash of the sanitized weights and an expiry. Registered in `TENANCY_SCOPED_TABLES`.
- **TTL: 12 hours.** A rank-then-file session runs over a working day, often with a tab left open; a shorter window would turn an honest add into a refusal. Short because the rows are candidate data held only to be checked against. Expired rows are dropped on the next write, so no sweeper.
- **Add door.** After the limiter, before `humanActor()`/seal/insert: one lookup bound to workspace, run, candidate, job and expiry. Missing/expired/foreign/other-candidate/other-job are one answer (409 `PIPELINE_ADD_MATCH_RUN_UNKNOWN`); any fact difference is 409 `PIPELINE_ADD_MATCH_RUN_MISMATCH`. Sealed `inputs` = facts + `matchRunId`; `coerceMatchReasonFacts` accepts and drops that one key so old and new records both resolve.
- **Client.** `useMatchResultsPipeline` sends `matchRunId`; a card refused with either code shows the localized reason and a "Run matching" button (existing `match.tab.runMatching` key, so no new key outside the refusal block).
- **Erasure.** The table holds candidate data (id, skill names), so `scrubEntryLinkedPii` DELETEs a candidate's rows, scoped to the entry's workspace. Pinned in `erasure-full-scrub.test.ts` (including that a same-id candidate in another tenant keeps theirs) and `match-runs-tenancy.test.ts`.

## Tests (each red on the unchanged source)

- `app/api/pipeline/match-add-provenance.test.ts` (real handler): valid run files and seals; tampered score/tier/scorer version/dimension/skill list → 409, no entry, no event, no record; missing/expired/foreign/other-candidate/other-role run → 409 the same way.
- `app/api/match/match-run-stored.test.ts` (real handler, real engine): the response carries `matchRunId`, one row per job is stored with the facts the client would derive, and those facts are accepted by the add door while a forged score is refused.
- `app/_lib/db/match-runs.test.ts`, `match-runs-tenancy.test.ts`, the erasure extension.
- Existing Match-add tests (`pipeline-routes`, `add-rate-limit`, `match-add-not-sealed`, `kpi-reasons-meter`) now store a run first.

## Deviations

1. `app/_lib/tenancy.ts` (the manifest itself) and the 4 existing Match-add tests outside the declared test paths were edited; the manifest entry cannot live in `core.ts`.
2. `app/_lib/kpi-reasons-meter.test.ts` and `docs/features/matching/README.md` also lay outside the first run's paths; the resume run declares them.
3. `tenant-keys.test.ts` caught my first PK `(run_id, job_id)`; it is now keyed by workspace.

## Not built (finding 6)

Matrix and manual adds still file a client-chosen `matchScore`. See the questions in the run result.
