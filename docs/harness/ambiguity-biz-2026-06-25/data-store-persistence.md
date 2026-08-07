# Data Store & Persistence — Ambiguity 🌀 + Business 🚀 scan
> Total: 5 | Lens: 🌀3 / 🚀2 | Severity: C0/H2/M3/L0

## 1. Every-boot reseed (`INSERT OR REPLACE`) silently erases recruiter dispositions & deep-dives on seeded rows
- **Lens**: 🌀 Ambiguity
- **Severity**: High
- **Category**: silent data loss / happy-path persistence
- **File**: app/_lib/db/core.ts:1080
- **Observation**: `seedAnalyses` re-UPSERTs every `seed-<id>` row on *every* boot (no empty-table guard — see the comment at core.ts:1073) with `INSERT OR REPLACE INTO analyses (slug, candidate_label, jd_slug, score, role_family, seniority, payload_json, created_at)`. The column list omits `disposition`, `decision_note`, `review_flags`, `github_json`, and `workspace_id`. SQLite `REPLACE` *deletes the existing row and inserts a fresh one*, so every omitted column reverts to its DEFAULT (NULL) on each restart. Seeded analyses are fully dispositionable — `setAnalysisDisposition` matches on `slug … AND workspace_id` with no slug-prefix exclusion (app/_lib/db/analyses.ts:95) — so a recruiter's advance/hold/pass decision, decision note, and GitHub deep-dive on any `seed-*` candidate are wiped on the next server start. `seedCandidates` (core.ts:1038) has the identical shape for `profiles`. The post-seed backfill only heals `workspace_id` (core.ts:790-791); the recruiter-decision columns are never restored.
- **Why it matters**: The disposition field is the literal embodiment of the AiDisclosure compliance promise the schema comment cites — "a human makes every decision" (core.ts:129-132). The seeded population is the dataset every demo/evaluation recruiter touches first, so the most-visible decisions are the ones silently lost — with no error, log, or signal (the exact failure mode the elaborate seed-health machinery above it exists to prevent, reintroduced via `REPLACE` column-omission).
- **Recommendation**: Either (a) switch the seeders to a column-complete `INSERT … ON CONFLICT(slug) DO UPDATE SET` that updates only the seed-owned columns and leaves recruiter columns untouched, or (b) keep the empty-table guard for these tables and reseed only on an explicit reset. Add a test asserting a dispositioned `seed-*` row survives a re-run of `seedAnalyses`.
- **Effort**: S

## 2. `workspace_id` tenancy is wired on 3 of ~25 tables, and even `pipeline_entries` reads ignore it
- **Lens**: 🚀 Business
- **Severity**: High
- **Category**: multi-tenant isolation / unfinished seam
- **File**: app/_lib/db/core.ts:656
- **Observation**: Only `analyses`, `profiles`, and `pipeline_entries` carry `workspace_id`; `jobs`, `jds`, `interview_sessions`, `dev_cases`/`dev_submissions`/`dev_sessions`/`skill_profiles`, `tasks`, `campaign_packs`, `channel_webhooks`/`channel_spend`, `analytics_targets`, `llm_config`/`llm_usage`, and all four `billing_*` tables have none. The schema frames `'workspace'` as "the seam multi-tenancy fills" (core.ts:116-117), but no file records *which* tables are in or out of scope or why. Worse, the column that exists is barely enforced: of ~40 `pipeline_entries` reads in pipeline.ts, only one filters by workspace (pipeline.ts:611); the main board query `listPipeline` (pipeline.ts:301) and `getById`/`listByJob` are workspace-blind. Guard tests exist for `analyses` and `profiles` (db/analyses-tenancy.test.ts, db/profiles-tenancy.test.ts) but none for `pipeline_entries` or any unscoped table.
- **Why it matters**: The moment a second workspace is created, jobs, interviews, dev-cases, billing, and most of the pipeline board leak across tenants — the enterprise "multi-tenant isolation" promise is structurally ~12% complete while reading as "supported." A future engineer flipping the seam on has no map of the gap and no test to catch the leak.
- **Recommendation**: Document the tenancy scope decision (a table → scoped? matrix in docs/ or a schema comment), extend the tenancy guard test to `pipeline_entries`, and either scope its reads by `workspace_id` now or annotate each unscoped read as deliberately global. Treat per-domain `workspace_id` columns as the explicit backlog the multi-tenant launch depends on.
- **Effort**: M

## 3. No migration registry — schema evolves via an idempotent ADD-COLUMN loop guarded only by matching SQLite's English error text
- **Lens**: 🌀 Ambiguity
- **Severity**: Medium
- **Category**: migration discipline / tribal knowledge
- **File**: app/_lib/db/core.ts:582
- **Observation**: There is no `schema_version`/migrations table. Schema changes are appended to one of three separate `ALTER TABLE … ADD COLUMN` loops (core.ts:588, 593-664, 696-739) re-run on every boot; `migrateExec` swallows "already applied" only by regex-matching the driver message — `/duplicate column name/i || /already exists/i` (core.ts:582). Ordering across the three loops and the inline `db.exec` index/heal statements is implicit, there is no down path, and renames/reorders/type changes are impossible. The benign-error detection is coupled to SQLite/better-sqlite3 wording: if a future version rephrases the message, real failures get a structurally-broken boot (the loop's prior bare-`catch{}` trap) or benign ones start throwing.
- **Why it matters**: This is the discipline the whole foundation rests on, and it lives as undocumented convention. A reviewer can't tell what migration state a given `kp.sqlite` is in, can't add a non-additive change, and can't trust the swallow-by-message guard across driver upgrades.
- **Recommendation**: Introduce a `schema_migrations(version, applied_at)` table and gate each migration on version rather than ADD-COLUMN idempotence + message regex; or at minimum match better-sqlite3's structured error `code` instead of `message` text. Document the "additive-only, re-run every boot" contract beside the loop.
- **Effort**: M

## 4. `synchronous = NORMAL` is applied uniformly — including to the financial ledger
- **Lens**: 🚀 Business
- **Severity**: Medium
- **Category**: durability / revenue correctness
- **File**: app/_lib/db-path.ts:73
- **Observation**: `openStore()` pins `synchronous = NORMAL` for every connection (db-path.ts:73) with the documented trade-off "only an OS crash / power loss between commit and checkpoint can drop the last few transactions" (db-path.ts:68-72). That reasoning was written for analysis/pipeline data, but the same pragma silently governs the prepaid-credit and usage ledgers created in this same module — `billing_credits`, `billing_events`, `billing_usage` (core.ts:534-569). There is no per-ledger durability override (`synchronous = FULL` or an explicit `wal_checkpoint` after a credit commit).
- **Why it matters**: A power loss between a credit-grant commit and the next checkpoint can drop a just-purchased minute-pack or an entitlement-meter increment — a customer who paid sees no credit, or usage under-counts revenue. The `billing_events.provider_ref UNIQUE` idempotency gate only self-heals for events the provider *redelivers*; a dropped `billing_credits`/`billing_usage` write is not guaranteed to be replayed. "Reliability as a differentiator" and revenue correctness are left to chance for the one table class where it's unacceptable.
- **Recommendation**: Either run billing writes on a connection with `synchronous = FULL`, or force a `wal_checkpoint(FULL)` immediately after a credit/entitlement commit, and document the financial-durability decision explicitly rather than inheriting the analysis-grade default.
- **Effort**: M

## 5. A corrupt / locked / disk-full database hard-crashes every request with no diagnostic
- **Lens**: 🌀 Ambiguity
- **Severity**: Medium
- **Category**: unhandled edge case / reliability
- **File**: app/_lib/db-path.ts:65
- **Observation**: `openStore()` does a bare `new Database(DB_PATH)` (db-path.ts:65) with no try/catch, and `ensureDb()` calls it unguarded as its first act (core.ts:110). Every *downstream* failure mode has rich handling — seed read/parse issues are recorded with path+reason (core.ts:34-43), migrations fail loud, JSON rows degrade via `safeRowParse` — but the connection open itself does not. A corrupt `kp.sqlite` (`SQLITE_CORRUPT`/`SQLITE_NOTADB`), a stale lock, a permission error, or a disk-full first write throws a raw stack out of `ensureDb` on the *first* request and re-throws on every subsequent one, with none of the diagnostic breadcrumbs the rest of the boot path provides.
- **Why it matters**: The single-file SQLite model means one bad file takes down the whole app, and the operator gets an opaque trace instead of "the database at `<path>` is corrupt/locked" — the inverse of the carefully-built seed-health diagnostics. Corrupt-db / disk-full is exactly the foundation edge case that should fail *legibly*.
- **Recommendation**: Wrap the open in a try/catch that logs the resolved `DB_PATH` + classified reason (corrupt vs locked vs no-space vs permission) before re-throwing, mirroring `recordSeedIssue`. Optionally expose it through `getSeedHealth()`/the health route so monitoring sees a structured "db unopenable" signal.
- **Effort**: S
