> Total: 6 findings (0c critical, 1h high, 3m medium, 2l low)

## 1. Two divergent `provLabel` implementations (one missing the `observed` bucket)
- **Severity**: High
- **Category**: duplication
- **File**: app/features/sub_jobs/JobsTypes.ts:142 (consumed by app/features/sub_jobs/RecruiterCandidates.tsx:528); duplicate at app/features/sub_match/MatchTypes.ts:136
- **Scenario**: Grepped `provLabel` across `app/` — two separate exported functions exist. `JobsTypes.provLabel` returns `{ text, tone }` with hard-coded English strings and handles only `professional | internship | self_declared | open_source | certification | <else→academic>`. `MatchTypes.provLabel` returns `{ key, tone }` (i18n-resolved at render) and additionally handles `"observed"` as the highest-trust bucket. Both map the same provenance domain to the same tones; the Jobs copy is a stale fork. The hazard is concrete: `RecruiterCandidates` (the candidate ranking inside the posting modal) passes `prov[s] ?? "self_declared"` into the Jobs copy, so any candidate carrying provenance `"observed"` (a passed live case / case-grounded interview — the strongest signal) falls through to the `academic` amber stamp here, while the same skill is shown with the moss `observed` stamp on every Match/Decisions surface that uses the MatchTypes copy.
- **Root cause**: `provLabel` was copied into `JobsTypes` rather than imported; when `observed` and i18n keys were later added to the MatchTypes version, the Jobs fork wasn't updated.
- **Impact**: Maintenance double-edit + an active mislabel bug — the top-trust provenance is silently downgraded to the lowest-trust label in the recruiter candidate list.
- **Fix sketch**: Delete `JobsTypes.provLabel` and have `RecruiterCandidates` import `provLabel` from `@/app/features/sub_match/MatchTypes`, resolving the returned `key` through `useEnumLabel("provenance", key)` (the same render-site pattern MatchCard/ComparisonCells already use). Drop the local `pl.text` in favor of the resolved label. One canonical provenance→badge mapping remains.

## 2. Dead exported components `Meta` and `ReqChip` in JobsShared.tsx
- **Severity**: Medium
- **Category**: dead-code
- **File**: app/features/sub_jobs/JobsShared.tsx:28 (`ReqChip`), :102 (`Meta`)
- **Scenario**: Grepped the whole repo for JSX/import usage of both: `<Meta`, `{ Meta`, `, Meta`, `<ReqChip`, `ReqChip,` etc. — zero references outside their own definition. The eight files that import from `./JobsShared` pull only `Chip`, `EmptyState`, `Select`, `Th`, `Td`, `SkelBar`, `JobStatusBadge`, `SkippedCandidatesNote`. The lone `Meta` matches elsewhere are unrelated (CSS `text-meta`, "Meta Lead Ads" in docs/lead-payload). `ReqChip` is the only consumer of the imported `JobRequirement` type in this file, so removing it lets that import shrink too.
- **Root cause**: `JobsShared` is a grab-bag of jobs-tab primitives; these two (a `<dt>/<dd>` meta row and a requirement chip) were extracted for surfaces that were later restructured, leaving the helpers behind.
- **Impact**: Two presentational components carry their own JSX/className surface that maintainers must keep theme-consistent for no benefit; obscures the file's real (used) exports.
- **Fix sketch**: Delete `Meta` and `ReqChip`. Remove the now-unused `JobRequirement` import (keep `SkippedCandidate`). Confirm with a final grep before deletion.

## 3. Duplicated `jobs` table DDL across job-ingest.ts and db/core.ts (schema-drift hazard)
- **Severity**: Medium
- **Category**: duplication
- **File**: app/_lib/job-ingest.ts:19-35 (plus the `ALTER TABLE jobs ADD COLUMN status`), duplicated in app/_lib/db/core.ts:230-248
- **Scenario**: Grepped `CREATE TABLE IF NOT EXISTS jobs` — two definitions. `job-ingest.ts` re-declares the full `jobs` column list "so this module is self-contained" (its own header says it mirrors db.ts), then ALTERs in the `status` column. `core.ts` has the same columns but no `status` and no `job_ingests` table. The two are already partly out of sync: the `status` column only exists because job-ingest's lazy `db()` runs the ALTER, and core.ts's copy never mentions it. Whichever connection initializes the table first wins; if a code path touches `jobs` via core.ts before job-ingest's `db()` runs, `status` is absent until the ALTER fires.
- **Root cause**: Deliberate self-containment of the ingest module led to a copy of the schema; the lifecycle `status` column was bolted onto one copy via ALTER instead of being added to the canonical DDL.
- **Impact**: Any future jobs-column change must be made in two places and kept ordering-safe; the `status` definition living in an ALTER rather than the table body makes the real schema hard to read in one place.
- **Fix sketch**: Make core.ts the single source of truth: add `status TEXT` to the core.ts `jobs` DDL, and have job-ingest's `db()` call the shared `ensureDb()`/`openStore()` init (it already shares the store) instead of re-running its own `CREATE TABLE jobs`. Keep only the `job_ingests` DDL and the idempotent ALTER (as a transitional no-op for existing DBs) in job-ingest. No data migration needed (all DDL is `IF NOT EXISTS` / additive).

## 4. `Stats` (client) and `JobStats` (server) are byte-identical duplicate type definitions
- **Severity**: Medium
- **Category**: duplication
- **File**: app/features/sub_jobs/JobsTypes.ts:83-89 (`Stats`), app/_lib/db/jobs.ts:281-287 (`JobStats`)
- **Scenario**: Read both: same five fields, same types (`total`, `entryEligible`, `byRoleFamily`, `bySeniority`, `byWorkMode`). `JobStats` is `jobStats()`'s return type; `Stats` is hand-mirrored on the client and cast onto the `/api/jobs` payload in `useJobsList` (`payload.stats as Stats`). Because the client type is a manual copy, a server-side field rename/add silently desyncs the cast.
- **Root cause**: No shared API-contract type between the route's return type and the client consumer; the client author re-typed the shape locally.
- **Impact**: Two definitions to keep in lockstep; the `as Stats` cast hides any drift at compile time.
- **Fix sketch**: Export `JobStats` from the db layer (or a shared `jobs-api` types module) and have `JobsTypes`/`useJobsList` import it (re-export as `Stats` if the name is load-bearing for the UI). One definition; the cast then references the authoritative shape.

## 5. `bySeniority` / `byWorkMode` computed and shipped over the wire but never consumed
- **Severity**: Low
- **Category**: dead-code
- **File**: app/_lib/db/jobs.ts:296-307 (the `group("seniority")` + `group("work_mode")` calls), surfaced via app/api/jobs/route.ts and the `Stats`/`JobStats` types
- **Scenario**: Grepped `stats.bySeniority`, `stats.byWorkMode`, `.bySeniority`, `.byWorkMode` across `app/` — the only consumer of `stats` (`JobsTab.tsx`) reads `total`, `entryEligible`, and `byRoleFamily` only; the two grouped maps are computed by `jobStats()`, serialized in the `/api/jobs` response, and dropped on the floor.
- **Root cause**: `jobStats()` computes all three group-bys symmetrically; only the role-family chips were ever rendered.
- **Impact**: Two extra `GROUP BY` scans of the `jobs` table per list request plus dead JSON in every payload — small, but pure waste.
- **Fix sketch**: If no near-term UI needs them, drop the two `group()` calls and the corresponding fields from `JobStats`/`Stats` (folds naturally into finding #4's consolidation). If they're intended for a planned seniority/mode chip row, leave a one-line TODO referencing it instead of silently shipping unused data.

## 6. Ingest route accepts a `jobId` request field no caller ever sends
- **Severity**: Low
- **Category**: dead-code
- **File**: app/api/jobs/ingest/route.ts:18,27
- **Scenario**: The route reads `body.jobId` and forwards it to `ingestJobAd(adText, body.jobId, …)`. Grepped every `/api/jobs/ingest` fetch — the sole caller, `IngestAdPanel` (single + bulk paths via `ingestOne`), posts only `{ adText }`. So `body.jobId` is always `undefined` in practice; the `--job-id` branch in `ingestJobAd`/`runJobsCli` is dead from this entry point. (Note: the underlying `normalizeJob` does pass `--job-id` for the JD-save path, so the CLI flag itself is live — only this route's `jobId` plumbing is unreached.)
- **Root cause**: The route was generalized to mirror the CLI's optional `--job-id` affordance, but the only UI caller never needs it (pasted ads get a content-hash-derived id).
- **Impact**: Minor — a request field that looks supported but is never exercised; slight confusion about whether the ingest path supports caller-chosen ids.
- **Fix sketch**: Either drop `jobId` from the route body type + the `ingestJobAd` call (keep the helper param for the JD-save caller), or leave a short comment noting it's an intentional unused affordance. Low priority; safe to defer.
