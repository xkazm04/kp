> Total: 6 findings (0c critical, 1h high, 2m medium, 3l low)

## 1. The `getJob → ingestJobAd` "re-sync linked job" block is duplicated verbatim across PATCH and revert routes
- **Severity**: High
- **Category**: duplication
- **File**: app/api/jds/[slug]/route.ts:77-86, app/api/jds/[slug]/revisions/route.ts:54-63
- **Scenario**: Both routes end with an identical best-effort "keep the linked jd-<slug> job in step" block: `let jobResynced = false; const jobId = jdJobId(slug); if (getJob(jobId)) { try { await ingestJobAd(<body>, jobId); jobResynced = true; } catch (ingestError) { console.error(`[api:jds…] JD ${slug} … re-ingest failed`, ingestError); } }`. I grepped `if (getJob(jobId))` and `jobResynced` across the repo: exactly these two routes carry the full block (the third hit, `app/api/jds/[slug]/ingest-job/route.ts:25`, is a *different* shape — an early-return idempotency check, not a re-sync, so it is correctly excluded). The only difference between the two copies is the source body (`fields.body` vs `restored.body`) and the log prefix.
- **Root cause**: The revert route (idea-6a18e0fc) was modeled on the PATCH route ("mirroring the PATCH edit path", per its own comment) by copy-paste rather than by extracting the shared step.
- **Impact**: The contract "an edit/revert must best-effort re-ingest the linked job, preserving lifecycle status, swallowing failures" now lives in two places. A change to that contract (e.g. surfacing the re-ingest failure to the client, adding a retry, or changing the log channel) must be made twice and can silently drift — exactly the class of bug this codebase elsewhere fixes with shared helpers (`validateJdFields`, `safeJsonError`, `jdJobId`).
- **Fix sketch**: Extract one helper, e.g. `resyncLinkedJob(slug: string, body: string): Promise<boolean>` in `app/_lib/job-ingest.ts` (or a small `jd-job-sync.ts` next to `jd-limits.ts`), containing the `getJob/try ingestJobAd/catch console.error` body and returning `jobResynced`. Both routes then call `const jobResynced = await resyncLinkedJob(slug, fields.body)`. Behavior-preserving; the existing save-ingest-contract / error-hygiene tests are unaffected.

## 2. `TemplateData` is imported into JdTemplateManager solely to be re-exported, but nothing consumes the re-export
- **Severity**: Medium
- **Category**: dead-code
- **File**: app/features/sub_library/JdTemplateManager.tsx:7,218
- **Scenario**: `JdTemplateManager.tsx` imports `type TemplateData` from `./render-template` (line 7) and re-exports it at the bottom (line 218: `export type { TemplateData };`) with the comment "Re-export for the composer's convenience." I grepped `TemplateData` repo-wide: it is defined and used in `render-template.ts` (the renderer's own param type), imported+re-exported in `JdTemplateManager.tsx`, and referenced once in a backlog idea `.md`. No source file imports `TemplateData` *from* `JdTemplateManager` — the "composer" (`JdBuilder.tsx`) imports `Template`/`renderTemplate` directly from `./render-template` and never touches `TemplateData` at all.
- **Root cause**: The re-export was added speculatively for a planned live-preview feature (see `idea-…-live-template-preview` backlog note) that would render the editing body against sample `TemplateData`; that consumer was never built, leaving the re-export (and the import that feeds it) orphaned.
- **Impact**: A dead import + dead re-export that mislead readers into thinking `JdTemplateManager` is the canonical export point for the template-data shape. Minor, but it is pure cruft that a manager component shouldn't carry.
- **Fix sketch**: Delete line 218 and remove `type TemplateData` from the import on line 7. Any future consumer should import `TemplateData` directly from `render-template.ts` (the source of truth), as every current caller already does.

## 3. `JdRevision` row type is declared twice — once exported in the DB layer, once re-typed in the client
- **Severity**: Medium
- **Category**: duplication
- **File**: app/jds/[slug]/JdActions.tsx:7 (also app/_lib/db/jobs.ts:112)
- **Scenario**: `JdActions.tsx:7` declares `type JdRevision = { id: number; title: string; body: string; created_at: string }`. The DB layer already exports the canonical shape at `app/_lib/db/jobs.ts:112`: `export type JdRevision = { id: number; slug: string; title: string; body: string; created_at: string }` (same fields plus `slug`), and `listJdRevisions()` returns it. I grepped `type JdRevision` (two hits, these two) and confirmed the revisions API (`/api/jds/[slug]/revisions` GET) serializes `listJdRevisions(slug)` rows that the client then re-types by hand.
- **Root cause**: The client component hand-rolled a local interface for the fetched JSON instead of importing the exported DB type (understandable — `slug` is redundant in the client where it's already in scope — but it forks the shape).
- **Impact**: If a column is added/renamed on `jd_revisions` (e.g. an author or a reason field), the DB type updates but the client's local copy silently goes stale, and the mismatch isn't caught at compile time because the client parses untyped JSON. Two sources of truth for one wire shape.
- **Fix sketch**: In `JdActions.tsx`, `import type { JdRevision } from "@/app/_lib/db/jobs"` and either use it directly or `Omit<JdRevision, "slug">` if dropping the unused field is desired. Removes the local declaration and ties the client to the row shape it actually receives.

## 4. `findExclusionaryPhrases` is exported but only ever called by `lintJd` in the same module
- **Severity**: Low
- **Category**: dead-code
- **File**: app/_lib/jd-lint.ts:106
- **Scenario**: `findExclusionaryPhrases` is `export`ed (line 106) but I grepped it repo-wide: its only reference outside its own definition is `lintJd` two functions below it in the same file (line 124). Its sibling `findVaguePhrases` is genuinely external-facing — the unit test `jd-lint.test.ts:9` imports it directly — which justifies *that* export, but no test or component imports `findExclusionaryPhrases`.
- **Root cause**: Added in commit 7469c05f alongside `findVaguePhrases` and given matching visibility by symmetry, without a caller needing the broader scope.
- **Impact**: Trivial — an over-broad export surface implying an external contract that doesn't exist. No runtime cost.
- **Fix sketch**: Drop the `export` (make it a module-private `function findExclusionaryPhrases`) unless a test is planned for it. If symmetry with the tested `findVaguePhrases` is preferred, instead add a direct unit test for it to justify the export. Either resolves the inconsistency.

## 5. Dead `MarketSalary` re-export in jd-build-run.ts
- **Severity**: Low
- **Category**: dead-code
- **File**: app/_lib/jd-build-run.ts:66
- **Scenario**: Line 66 re-exports `export type { MarketSalary };` with the comment "Re-exported for callers that import it from this module." I grepped every import of `jd-build-run` (`from "@/app/_lib/jd-build-run"` and `from "./jd-build-run"`): the only consumers are `ingest-job.ts` (imports `RoleSpec`) and `tasks.ts` (imports `runJdBuild`). No caller imports `MarketSalary` from this module — `JdBuilderResult.tsx` and `JdBuilder.tsx` both import `MarketSalary`/`normalizeMarketSalary` straight from `@/app/_lib/salary-band`, its real home.
- **Root cause**: A convenience re-export added in anticipation of callers that never materialized; everyone reaches for the canonical `salary-band` module instead.
- **Impact**: Trivial dead code; slightly misleads about where the type lives.
- **Fix sketch**: Delete line 66 (and its comment). `MarketSalary` is still freely importable from `salary-band`, which is where all current callers get it.

## 6. JD vs Template field-validation pairs duplicate the same trim/cap/required pattern
- **Severity**: Low
- **Category**: duplication
- **File**: app/_lib/jd-limits.ts:38-49, app/features/sub_library/render-template.ts:190-241
- **Scenario**: `validateJdFields` (jd-limits.ts) and `validateTemplateFields` (render-template.ts) implement nearly identical logic: coerce `unknown`→trimmed string, reject empty, length-cap each field with a `.toLocaleString("en-US")` over-cap message, return a discriminated `{ ok }` union. `render-template.ts` already factored its own over-cap wording into a private `templateTooLong` helper (lines 190-192) and shares it between `validateTemplateFields` and `validateTemplateUpdate` — but the JD side hand-inlines the same `if (x.length > MAX) return …${MAX.toLocaleString…}` twice (jd-limits.ts:42-47). I confirmed all four validators (`validateJdFields`, `validateJdBuildInput`, `validateTemplateFields`, `validateTemplateUpdate`) are real, each used by a route + the client form + their own tests, so the *functions* are not dead — only the per-field cap-and-message snippet is repeated.
- **Root cause**: The two validator families grew in separate modules (`jd-limits` for saved JDs, `render-template` for templates) and independently reinvented the "field too long → localized message" idiom; only the template module bothered to extract it.
- **Impact**: Low, but the localized over-cap message format ("must be N characters or fewer") and its `toLocaleString` formatting now live in 3 spots (jd-limits.ts x2 inline + templateTooLong); a wording/locale tweak risks inconsistency between JD and template errors.
- **Fix sketch**: Optional consolidation — lift a shared `fieldTooLong(label, value, max)` (the existing `templateTooLong` generalized) into a small shared util (e.g. `app/_lib/field-validation.ts`) and have both `jd-limits` and `render-template` use it. Keep the two validator *entry points* (their field names/messages differ intentionally); only the cap-check primitive is shared. Do not over-merge — the required/trim semantics differ slightly (JD title min-length vs template name), so a full unification would be the kind of reorg this audit avoids.
