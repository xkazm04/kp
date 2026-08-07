> Total: 6 findings (0c critical, 0h high, 3m medium, 3l low)

## 1. `core.ts` is an oversized god-module mixing six unrelated concerns
- **Severity**: Medium
- **Category**: structure
- **File**: app/_lib/db/core.ts:1-1297
- **Scenario**: The "core" DB module is 1,297 lines. `grep -nE "^(function seed|function migrate|function backfill|const SEED_)"` shows the bottom ~470 lines (826-1296) are nothing but boot-time SEEDING (seedExampleJd/seedJobs/seedCandidates/seedAnalyses/seedPipeline + the embedded multi-paragraph `SEED_JD_BODY` job-ad text) and one-shot migrations (migratePipelineStages/backfillDeclinedStatus). Mixed in are: the connection bootstrap (ensureDb), all table DDL, the prompt-cache prune, the slug retry helper, AND two full domain layers — pipeline (`PipelineEntry` type, `recordEvent`, `LEGACY_STAGE_MAP`) and jobs (`JobRecord`/`JobRequirementRecord`/`JobEntryProfileRecord`). The codebase already proves the slicing pattern works: `ls app/_lib/db/` shows 12 domain files (analyses.ts, jobs.ts, pipeline.ts, …) that import from core; the seeding/domain-type bulk just never got sliced out.
- **Root cause**: core.ts predates the db/ domain split and kept the bootstrap-era contents instead of being trimmed to the genuine "core" (handle, DDL, shared null/parse helpers).
- **Impact**: The file the whole app depends on is hard to navigate; pipeline/job domain types and 470 lines of seed data sit on the hot bootstrap path, and every reader of "core" wades through demo-seed prose.
- **Fix sketch**: Extract seeding+one-shot migrations into `db/seed.ts` (called from ensureDb), and move `PipelineEntry`/`recordEvent`/`LEGACY_STAGE_MAP` to `db/pipeline.ts` and `JobRecord*` to `db/jobs.ts` (re-export from core if needed to avoid churn). Leaves core as connection + DDL + shared helpers only.

## 2. `analyses` (and peers) CREATE TABLE has drifted from the ALTER migration set — schema defined in two disagreeing places
- **Severity**: Medium
- **Category**: duplication
- **File**: app/_lib/db/core.ts:120-135 vs 717-731
- **Scenario**: Confirmed by diffing the two column lists. `awk '/CREATE TABLE IF NOT EXISTS analyses/,/\);/'` yields columns ending at `disposition, decision_note`. `grep ALTER TABLE analyses ADD COLUMN` yields `disposition, decision_note, review_flags, github_json, workspace_id`. So `disposition`/`decision_note` are declared in BOTH the CREATE and the ALTER loop (the ALTER is a guaranteed no-op on a fresh DB, swallowed by migrateExec's "duplicate column" branch), while `review_flags`/`github_json`/`workspace_id` exist ONLY in the ALTER loop — a brand-new DB gets them via the migration, never from CREATE. The same drift exists for `pipeline_entries` (CREATE has `contact` but the ~17 source/consent/lead/erasure columns are ALTER-only) and `jobs`/`jds`/`dev_*`.
- **Root cause**: New columns were added to the ALTER migration loop for legacy-DB compatibility but inconsistently back-ported into the CREATE — `disposition`/`decision_note` were added to both, the rest only to ALTER.
- **Impact**: No correctness bug today (ALTER fills the gap), but the canonical table shape is now unknowable from the CREATE alone; a reader must mentally merge CREATE + every ALTER. The redundant `disposition`/`decision_note` ALTERs are pure dead motion run on every fresh boot.
- **Fix sketch**: Pick one authority. Either keep CREATE authoritative (add review_flags/github_json/workspace_id to it and drop the now-redundant disposition/decision_note ALTERs), or comment that CREATE intentionally holds only the original shape and all evolution is ALTER-only. Consistency is the win, not which side.

## 3. Prompt-cache helpers are split across two modules (`prunePromptCache` orphaned in core.ts)
- **Severity**: Medium
- **Category**: structure
- **File**: app/_lib/db/core.ts:919 vs app/_lib/db/analyses.ts:238-294
- **Scenario**: `grep "export function (lookupPromptCache|storePromptCache|promptCacheStats)"` shows all three prompt-cache accessors live in `db/analyses.ts`, but `prunePromptCache` (which operates on the same `gemini_cache` table) lives in `core.ts:919`. The four functions that form one cohesive prompt-cache surface are split 3/1 across modules.
- **Root cause**: `prunePromptCache` is invoked from ensureDb's boot path (core.ts:806), so it was left in core for proximity; the read/write/stats helpers were sliced into analyses.ts later.
- **Impact**: A maintainer touching prompt-cache behavior must edit two files; the table's owning module is ambiguous. Minor, but it's the kind of split that breeds divergent assumptions (e.g. TTL handling).
- **Fix sketch**: Move `prunePromptCache` to `db/analyses.ts` alongside its siblings and import it into core for the boot-prune call (core already imports nothing circular from analyses for this — analyses imports core, so call it via a small boot hook or keep the call in analyses' own init). If the circular-import risk isn't worth it, at minimum leave a pointer comment in both spots.

## 4. `ALTER TABLE jobs ADD COLUMN status` is duplicated across two files on two connections
- **Severity**: Low
- **Category**: duplication
- **File**: app/_lib/db/core.ts:715 and app/_lib/job-ingest.ts:32
- **Scenario**: `grep -rn "ALTER TABLE jobs ADD COLUMN status"` returns both core.ts:715 and job-ingest.ts:32. The core.ts comment (710-714) explicitly documents this is deliberate — job-ingest ALTERs on its own connection, mirrored in core so the db.ts connection can filter drafts even if ingestion never ran this boot.
- **Root cause**: Two independently-opened connections to the same kp.sqlite each defensively ensure the column; neither owns the migration.
- **Impact**: Intentional and harmless (migrateExec/IF-NOT-EXISTS make re-runs no-ops), but it's a maintenance footgun: the column's type/default is now asserted in two places that could silently diverge.
- **Fix sketch**: Leave as-is given the documented multi-connection rationale, OR centralize the jobs-table migration in one exported helper both files call. Flagging only so it's a known, deliberate dup rather than an accidental one.

## 5. `comparisonSchema` is exported but consumed only by its own test
- **Severity**: Low
- **Category**: dead-code
- **File**: app/_lib/schemas.ts:46
- **Scenario**: `grep -rln "comparisonSchema" app/` (worktrees excluded) returns only `schemas.ts` and `comparison.test.ts`. Inside schemas.ts it IS used internally at line 70 (`comparison: comparisonSchema.optional()`), so the value isn't dead — but the `export` keyword serves no production consumer; only `comparison.test.ts:16` imports it. (Contrast `analysisSchema`/`MIN_COMPARISON_VARIANTS`, which have real source consumers — verified.)
- **Root cause**: Exported for testability and as a presumed reusable boundary that other modules never adopted.
- **Impact**: Negligible — it's a legitimate test-only export. Noted for completeness; the export widens the barrel surface (db.ts/schemas re-exports) with a symbol no feature uses.
- **Fix sketch**: Keep the export (it's load-bearing for the contract test) — no action recommended beyond awareness. If a "test-only export" lint convention exists, annotate it.

## 6. `getTask(id)!` non-null assertion in `createTask` masks a possible null
- **Severity**: Low
- **Category**: cleanup
- **File**: app/_lib/db/tasks.ts:126
- **Scenario**: `createTask` ends with `return getTask(id)!;`. `getTask` (line 129) returns `TaskRecord | null`, and the `!` forcibly narrows it. In the normal path the INSERT just succeeded so the row exists, but if a concurrent writer/cleanup deleted it between INSERT and SELECT, this returns a runtime `undefined` typed as a non-null `TaskRecord`, deferring the crash to the caller with no context.
- **Root cause**: Convenience assertion instead of an explicit invariant check.
- **Impact**: Very low (tight window, single-process queue), but the `!` is exactly the kind of silent-narrowing this module otherwise avoids (it has loud guards everywhere else, e.g. serializeResult, migrateExec).
- **Fix sketch**: Replace with `const created = getTask(id); if (!created) throw new Error(\`createTask: row ${id} vanished after insert\`); return created;` so the impossible case fails loudly at the source.
