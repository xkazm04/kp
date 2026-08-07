// Behavioral coverage for db/core.ts against an ISOLATED throwaway SQLite file
// (KP_DB_PATH is pointed at a per-process temp dir by testing/unit-db.ts —
// which must stay the FIRST project import). Pins the migration invariants a
// regression would silently break: a fresh DB gets the full schema, running the
// initializer twice is a no-op, and the llm_usage ledger + its indexes exist.
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { cleanupUnitDb, UNIT_DB_PATH } from "../testing/unit-db.ts";
import { ensureDb, getSeedHealth, insertWithUniqueSlug } from "./core.ts";

after(() => cleanupUnitDb());

const holder = globalThis as typeof globalThis & { __kpDb?: { close(): void } };

function tableNames(): Set<string> {
  return new Set(
    (ensureDb().prepare(`SELECT name FROM sqlite_master WHERE type = 'table'`).all() as { name: string }[]).map(
      (r) => r.name
    )
  );
}

function columnNames(table: string): Set<string> {
  return new Set(
    (ensureDb().prepare(`PRAGMA table_info(${table})`).all() as { name: string }[]).map((r) => r.name)
  );
}

test("a fresh DB is created at KP_DB_PATH with the full schema", () => {
  ensureDb();
  assert.ok(existsSync(UNIT_DB_PATH), `expected the isolated DB file at ${UNIT_DB_PATH}`);
  const tables = tableNames();
  // Representative cross-domain set: tenancy root, analysis/JD library, pipeline,
  // billing, LLM layer, consent audit. A missing one means a CREATE was lost.
  for (const required of [
    "workspaces",
    "organizations",
    "users",
    "user_credentials",
    "memberships",
    "invites",
    "analyses",
    "jds",
    "jd_revisions",
    "jobs",
    "profiles",
    "pipeline_entries",
    "pipeline_events",
    "consent_events",
    "interview_sessions",
    "llm_config",
    "llm_usage",
    "billing_state",
    "billing_events",
    "billing_credits",
    "billing_usage",
    "billing_alerts",
  ]) {
    assert.ok(tables.has(required), `fresh schema is missing table "${required}"`);
  }
  // The default single-tenant workspace row must exist (id matches billing's).
  const ws = ensureDb().prepare(`SELECT id FROM workspaces WHERE id = 'workspace'`).get();
  assert.ok(ws, "default 'workspace' row was not seeded");
});

test("ALTER-loop migrations landed: pipeline_entries carries every post-launch column", () => {
  const cols = columnNames("pipeline_entries");
  for (const col of [
    "workspace_id",
    "contact",
    "locale",
    "github_json",
    "github_handle",
    "source_channel",
    "lead_token",
    "profile_gaps_json",
    "notes",
    "consent_given_at",
    "consent_expires_at",
    "consent_source",
    "anonymized_at",
    "erasure_token",
    "intake_degraded",
  ]) {
    assert.ok(cols.has(col), `pipeline_entries is missing migrated column "${col}"`);
  }
});

test("ALTER-loop migrations landed: first-run onboarding flags (users + workspaces)", () => {
  const userCols = columnNames("users");
  for (const col of ["onboarding_completed_at", "onboarding_skipped_at"]) {
    assert.ok(userCols.has(col), `users is missing migrated column "${col}"`);
  }
  const wsCols = columnNames("workspaces");
  assert.ok(wsCols.has("onboarding_state"), `workspaces is missing migrated column "onboarding_state"`);
});

test("ALTER-loop migrations landed: dev_outbox carries tenancy + the failure reason", () => {
  // failure-truth-everywhere: `failure_detail` is additive and nullable, so an existing
  // DB gains it without touching a single stored row (legacy failures read as "no
  // reason recorded"). A lost migration would silently drop every dead-letter reason.
  const cols = columnNames("dev_outbox");
  for (const col of ["workspace_id", "failure_detail"]) {
    assert.ok(cols.has(col), `dev_outbox is missing migrated column "${col}"`);
  }
});

test("ALTER-loop migrations landed: jds carries the backgrounded-analysis columns", () => {
  const cols = columnNames("jds");
  for (const col of ["archived_at", "analysis_status", "analysis_task_id", "analysis_error", "analysis_json"]) {
    assert.ok(cols.has(col), `jds is missing migrated column "${col}"`);
  }
});

test("the llm_usage ledger exists with its metering columns and both indexes", () => {
  const cols = columnNames("llm_usage");
  for (const col of ["ts", "use_case", "provider", "model", "input_tokens", "output_tokens", "cost_usd", "source"]) {
    assert.ok(cols.has(col), `llm_usage is missing column "${col}"`);
  }
  const indexes = new Set(
    (ensureDb()
      .prepare(`SELECT name FROM sqlite_master WHERE type = 'index' AND tbl_name = 'llm_usage'`)
      .all() as { name: string }[]).map((r) => r.name)
  );
  assert.ok(indexes.has("idx_llm_usage_ts"), "idx_llm_usage_ts is missing");
  assert.ok(indexes.has("idx_llm_usage_use_case"), "idx_llm_usage_use_case is missing");
});

test("running the initializer twice is a no-op (idempotent migrations + seeds)", () => {
  const db1 = ensureDb();
  const snapshot = (db: ReturnType<typeof ensureDb>) => ({
    schema: db
      .prepare(`SELECT name, sql FROM sqlite_master WHERE type IN ('table','index') ORDER BY name`)
      .all(),
    counts: db
      .prepare(
        `SELECT (SELECT COUNT(*) FROM jds) AS jds,
                (SELECT COUNT(*) FROM jobs) AS jobs,
                (SELECT COUNT(*) FROM profiles) AS profiles,
                (SELECT COUNT(*) FROM pipeline_entries) AS entries,
                (SELECT COUNT(*) FROM pipeline_events) AS events,
                (SELECT COUNT(*) FROM workspaces) AS workspaces`
      )
      .get(),
  });
  const before = snapshot(db1);
  // Drop the memoized connection so ensureDb() re-runs the ENTIRE
  // CREATE/ALTER/seed/backfill initializer against the already-initialized file
  // — exactly what a process restart does.
  holder.__kpDb?.close();
  holder.__kpDb = undefined;
  const db2 = ensureDb();
  const afterInit = snapshot(db2);
  assert.deepEqual(afterInit.schema, before.schema, "schema changed on re-init");
  assert.deepEqual(afterInit.counts, before.counts, "seed/backfill re-ran and changed row counts on re-init");
});

test("seed health reports ok when run from the repo root", () => {
  assert.equal(getSeedHealth().ok, true);
});

test("insertWithUniqueSlug retries UNIQUE collisions, rethrows real errors, and bounds retries", () => {
  // Succeeds first try.
  const seen: string[] = [];
  const slug = insertWithUniqueSlug((s) => {
    seen.push(s);
  });
  assert.equal(seen.length, 1);
  assert.equal(slug, seen[0]);
  assert.match(slug, /^[a-z2-9]{8}$/);

  // Two UNIQUE collisions then success → three attempts, returns the third slug.
  let attempts = 0;
  const retried = insertWithUniqueSlug((s) => {
    attempts += 1;
    if (attempts <= 2) throw new Error("UNIQUE constraint failed: jds.slug");
    seen.push(s);
  });
  assert.equal(attempts, 3);
  assert.equal(retried, seen[1]);

  // A non-UNIQUE error is rethrown immediately (no retry storm over corruption).
  let calls = 0;
  assert.throws(
    () =>
      insertWithUniqueSlug(() => {
        calls += 1;
        throw new Error("SQLITE_IOERR: disk I/O error");
      }),
    /disk I\/O error/
  );
  assert.equal(calls, 1);

  // Persistent UNIQUE failures exhaust the bounded retries and surface the error.
  assert.throws(
    () =>
      insertWithUniqueSlug(() => {
        throw new Error("UNIQUE constraint failed: jds.slug");
      }),
    /UNIQUE constraint failed/
  );
});
