# Data Store & Persistence — Tri-Lens Scan
> Total: 5
> Severity: 1 Critical / 2 High / 2 Medium / 0 Low
> Lens: 4 bug / 0 ui / 1 biz

UI Perfectionist lens: **N/A** — this context is a pure server-side persistence layer (DB handle, schemas, migrations, path helpers). No rendered surface, so the UI lens is skipped by design and contributes 0 findings, as instructed.

Note on scope: I focused on the highest-blast-radius issues in the connection lifecycle, migration loop, and null contract. Several plausible "nits" (e.g. `Math.random()` slug RNG, `seedIssues` module-global never reset) were excluded as low-value per the no-trivial-nits rule.

## 1. `foreign_keys` pragma is never enabled — every FK relationship is unenforced
- **Lens**: 🐛 Bug Hunter
- **Severity**: Critical
- **Category**: Connection lifecycle / referential integrity
- **Value**: impact 9/10 · effort 3/10 · risk 5/10
- **File**: `app/_lib/db-path.ts:30-36` (`openStore`); confirmed absent across `app/_lib/db/core.ts` and all sibling stores
- **Scenario**: The schema models a rich graph — `pipeline_events.entry_id → pipeline_entries.id`, `skill_profiles.submission_id → dev_submissions.id`, `dev_session_events.session_id → dev_sessions.id`, `consent_events.entry_id`, `jd_revisions.slug`, etc. `openStore()` sets only `journal_mode=WAL` and `busy_timeout=5000`. SQLite defaults `foreign_keys=OFF` per-connection, and no `db.pragma("foreign_keys = ON")` exists anywhere. A delete/erasure of a `pipeline_entries` row (GDPR erasure path is a first-class feature here) leaves orphaned `pipeline_events`, `consent_events`, and `interview_sessions` rows pointing at a vanished entry; a bad `entry_id` can be inserted freely. Note none of the tables even declare `REFERENCES`, so enabling the pragma alone is necessary-but-not-sufficient — but today there is zero enforcement of any kind.
- **Root cause**: Pragmas were copy-pasted as "WAL + busy_timeout" and `foreign_keys` was simply never part of that template; tables were authored without `REFERENCES` clauses.
- **Impact**: Silent referential corruption that compounds with every delete/erasure/anonymize. The erasure feature (`erasure_token`, `anonymized_at`) is precisely the path most likely to strand orphans, undermining the GDPR "right to erasure" guarantee the product advertises.
- **Fix sketch**: Add `d.pragma("foreign_keys = ON")` to `openStore()` (and the 4 stores that hand-roll their own pragmas). Then incrementally add `REFERENCES … ON DELETE CASCADE` (or `SET NULL`) to the child tables; until columns carry `REFERENCES`, add explicit cascade-delete statements inside the erasure/delete transactions as a stopgap.

## 2. Migration loop swallows ALL errors via bare `catch {}`, not just "column exists"
- **Lens**: 🐛 Bug Hunter
- **Severity**: High
- **Category**: Migration safety
- **File**: `app/_lib/db/core.ts:542-548`, `611-616`, `687-693`, `698-705`, `711-718`
- **Scenario**: Every `ALTER TABLE … ADD COLUMN` and `CREATE UNIQUE INDEX` is wrapped in `try { db.exec(sql) } catch { /* column already exists */ }`. The catch is unconditional. A typo'd column type, a disk-full/`SQLITE_IOERR`, a `SQLITE_CORRUPT`, or an `SQLITE_BUSY` mid-migration is indistinguishable from the benign "duplicate column name" and is silently discarded. The app then boots with a column it believes exists but does not, and the first read/write against it 500s far from the real cause.
- **Root cause**: The comment asserts the only possible failure is "column already exists," but `catch {}` catches the entire error space; no inspection of `error.message`/`code`.
- **Impact**: A genuine migration failure (corruption, I/O, lock contention under the documented multi-connection scheduler load) boots a structurally-broken DB with no log, no signal — the exact "hours-long why-is-everything-empty hunt" the seed-health code was written to prevent, reintroduced one layer down.
- **Fix sketch**: Inspect the caught error: re-throw (or `recordSeedIssue`-style log) unless `/duplicate column name/i` (for ALTER) or `/already exists/i` (for indexes). At minimum `console.warn` the unexpected ones so a real failure is diagnosable.

## 3. Null contract drift: `approval_detail=''` written where the column is semantically nullable
- **Lens**: 🐛 Bug Hunter
- **Severity**: High
- **Category**: Null contract correctness (NULL vs '' drift)
- **File**: `app/_lib/db/pipeline.ts:1228, 1234, 1254` vs `app/_lib/db/core.ts:273` (`approval_detail TEXT`, nullable)
- **Scenario**: `approval_kind` is consistently cleared to SQL `NULL`, but its sibling `approval_detail` is cleared to the empty string `''` in the same UPDATEs (`SET approval_kind=NULL, approval_detail=''`). The `PipelineEntry` type declares `approvalDetail: string | null` and the read path returns the column verbatim. So a "cleared" detail reads back as `""` on rows touched by these paths, but `null` on rows that never had one (column default / inbound inserts). Any consumer doing `approvalDetail == null`, `?? fallback`, or `!approvalDetail.length` branches differently for two states that mean the same thing ("no detail").
- **Root cause**: The schema's null contract (column is nullable, "cleared" = NULL) was not applied uniformly; one writer chose `''` for the paired field.
- **Impact**: Subtle, data-dependent UI/logic divergence ("cleared" vs "never set" conflated or split inconsistently) — the classic NULL-vs-'' drift this lens calls out, made worse because the partner column on the same row uses NULL.
- **Fix sketch**: Change the three UPDATEs to `approval_detail=NULL` to match `approval_kind` and the column's nullable contract. Optionally add a one-shot idempotent migration `UPDATE pipeline_entries SET approval_detail=NULL WHERE approval_detail=''` to heal existing rows.

## 4. No `synchronous` pragma set on WAL connections — crash window can lose committed writes
- **Lens**: 🚀 Business Visionary
- **Severity**: Medium
- **Category**: Durability / data-loss confidence
- **File**: `app/_lib/db-path.ts:33-34` (and the 4 stores at `decision-config-store.ts:26`, `decision-record-store.ts:57`, `job-ingest.ts:20`, `templates-store.ts:17` that set WAL without `synchronous`)
- **Scenario**: WAL mode is enabled but `synchronous` is left at SQLite's default, which under WAL is `NORMAL` only if the DB was opened that way — better-sqlite3 inherits the file/compile default (`FULL` for the main DB, but the WAL-specific durability story depends on it being explicit). The bigger gap: there is no documented/forced durability level, no `wal_checkpoint` strategy, and no backup path. On power-loss or a hard kill between a WAL write and a checkpoint, the last transactions in `-wal` can be lost; the `-wal`/`-shm` sidecar files are also never explicitly checkpointed/truncated, so they grow (the prompt-cache prune at `core.ts:747` mitigates row growth but not WAL size).
- **Root cause**: Durability was treated as "WAL is enough"; no explicit `synchronous`, checkpoint, or backup policy was ever pinned.
- **Impact**: For an AI-recruiting SaaS, a lost commit = a lost candidate disposition, consent record, or billing-credit ledger entry — operational-trust and (for consent/billing) compliance/revenue consequences at scale.
- **Fix sketch**: Set `d.pragma("synchronous = NORMAL")` explicitly in `openStore()` (the safe WAL default) and document it; add a periodic `PRAGMA wal_checkpoint(TRUNCATE)` (e.g. on boot beside the prompt-cache prune) and an `Online Backup API` (`db.backup()`) hook so the file is recoverable. Cheap, centralized in `openStore`.

## 5. DB path resolves against `process.cwd()` — non-portable across runtime working dirs
- **Lens**: 🐛 Bug Hunter
- **Severity**: Medium
- **Category**: DB path portability
- **File**: `app/_lib/db-path.ts:13`
- **Scenario**: `DB_PATH = process.env.KP_DB_PATH ?? path.join(process.cwd(), "data", "kp.sqlite")`. `process.cwd()` is the directory the Node process was launched from, not the app root. Next.js dev/`next start` from the project root works, but a standalone build, a PM2/systemd unit, a cron-launched `/api/automation/run`, or any tool invoked from a different cwd resolves a *different* `data/kp.sqlite` — silently opening (and seeding) an empty DB while the real one sits elsewhere. The comment even notes the scheduler and an external cron open this same path on their own connections, which is exactly where cwd drift bites. The Python side (`seed_interview_calendar.py`) recomputes the same default independently, doubling the surface.
- **Root cause**: `process.cwd()` used as a proxy for "app root"; no anchor to the module/install location.
- **Impact**: "Why is my data gone after deploy?" / split-brain databases across the Node and Python halves — a portability + data-confidence trap that only manifests in production launch topologies, not local dev.
- **Fix sketch**: Anchor the default to a stable root (e.g. derive from `import.meta.dirname`/`__dirname` walking up to the app root, matching how `next.config.ts:17` pins `turbopack.root = import.meta.dirname`) rather than `process.cwd()`. Keep `KP_DB_PATH` as the explicit override and recommend setting it in all deploy/cron units; sync the Python default the same way.
