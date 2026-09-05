// Behavioral coverage for db/core.ts against an ISOLATED throwaway SQLite file
// (KP_DB_PATH is pointed at a per-process temp dir by testing/unit-db.ts —
// which must stay the FIRST project import). Pins the migration invariants a
// regression would silently break: a fresh DB gets the full schema, running the
// initializer twice is a no-op, and the llm_usage ledger + its indexes exist.
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { spawnSync } from "node:child_process";
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
  for (const col of ["ts", "use_case", "provider", "model", "input_tokens", "output_tokens", "cost_usd", "source", "outcome", "reason"]) {
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

// ---- The case every assertion above misses: an OLD database moved FORWARD -------
//
// Everything before this point runs against a FRESH file, where the big
// `CREATE TABLE IF NOT EXISTS` block alone produces the whole schema — so the ALTER
// loops, the PK-widening table rebuilds and the backfills could all be deleted and
// every test would still pass. The dangerous DB is the one created several migrations
// ago and carrying rows: that is where an ALTER that never runs, a rebuild that runs
// twice, or a backfill that leaves NULLs actually costs data.
//
// Driven in a child `node` process, like db-test-isolation-guard.test.ts: we need a
// pre-migration SQLite file at a KP_DB_PATH frozen before core.ts loads, without
// disturbing THIS suite's own isolated connection. Both DBs are throwaway temp files.
// KP_EMPTY=1 keeps the fixture seeds out of the way so the assertions are about
// MIGRATION only.
const LEGACY_CHILD = `
import path from "node:path";
import os from "node:os";
import { mkdtempSync, rmSync } from "node:fs";
import { pathToFileURL } from "node:url";
import Database from "better-sqlite3";

const dir = mkdtempSync(path.join(os.tmpdir(), "kp-legacy-"));
const dbPath = path.join(dir, "legacy.sqlite");
process.env.NODE_TEST_CONTEXT = "child-v8";
process.env.KP_DB_PATH = dbPath;
process.env.KP_EMPTY = "1";
delete process.env.KP_MULTI_WORKSPACE;

// A plausible pre-migration schema: no workspace_id anywhere, the legacy 7-stage
// vocabulary, single-column PKs on channel_spend / analytics_targets, no org_id on
// billing, and populated rows that the migration must carry across intact.
const legacy = new Database(dbPath);
legacy.exec([
  "CREATE TABLE workspaces (id TEXT PRIMARY KEY, name TEXT, created_at TEXT NOT NULL);",
  "INSERT INTO workspaces (id, name, created_at) VALUES ('workspace','Default workspace','2024-01-01T00:00:00.000Z');",
  "CREATE TABLE analyses (slug TEXT PRIMARY KEY, candidate_label TEXT NOT NULL, jd_slug TEXT, score INTEGER, role_family TEXT, seniority TEXT, payload_json TEXT NOT NULL, created_at TEXT NOT NULL);",
  "INSERT INTO analyses (slug, candidate_label, payload_json, created_at) VALUES ('a-legacy','Legacy Candidate','{\\"keep\\":1}','2024-01-02T00:00:00.000Z');",
  "CREATE TABLE profiles (id TEXT PRIMARY KEY, label TEXT NOT NULL, archetype TEXT, role_family TEXT, completeness REAL DEFAULT 0, payload_json TEXT NOT NULL, created_at TEXT NOT NULL);",
  "INSERT INTO profiles (id, label, payload_json, created_at) VALUES ('p-legacy','Legacy Profile','{}','2024-01-02T00:00:00.000Z');",
  "CREATE TABLE pipeline_entries (id TEXT PRIMARY KEY, candidate_id TEXT, candidate_label TEXT NOT NULL, archetype TEXT, role_family TEXT, job_id TEXT, job_title TEXT, stage TEXT NOT NULL, match_score INTEGER, status TEXT NOT NULL DEFAULT 'active', approval_kind TEXT, approval_detail TEXT, updated_at TEXT);",
  "INSERT INTO pipeline_entries (id, candidate_label, stage, status, approval_detail) VALUES ('e-1','Old Sourced','Sourced','active','');",
  "INSERT INTO pipeline_entries (id, candidate_label, stage, status) VALUES ('e-2','Candidate Decline','Offer','rejected');",
  "INSERT INTO pipeline_entries (id, candidate_label, stage, status) VALUES ('e-3','Recruiter Reject','Offer','rejected');",
  "CREATE TABLE pipeline_events (id INTEGER PRIMARY KEY AUTOINCREMENT, entry_id TEXT, candidate_label TEXT, job_title TEXT, archetype TEXT, kind TEXT NOT NULL, from_stage TEXT, to_stage TEXT, detail TEXT, created_at TEXT NOT NULL);",
  "INSERT INTO pipeline_events (entry_id, kind, to_stage, created_at) VALUES ('e-1','matched','Sourced','2024-01-03T00:00:00.000Z');",
  "INSERT INTO pipeline_events (entry_id, kind, created_at) VALUES ('e-2','offer_declined','2024-01-03T00:00:00.000Z');",
  "INSERT INTO pipeline_events (entry_id, kind, created_at) VALUES ('e-3','offer_declined','2024-01-03T00:00:00.000Z');",
  "INSERT INTO pipeline_events (entry_id, kind, created_at) VALUES ('e-3','rejected','2024-01-03T00:00:00.000Z');",
  "INSERT INTO pipeline_events (kind, created_at) VALUES ('ko_declined','2024-01-03T00:00:00.000Z');",
  "CREATE TABLE channel_spend (channel TEXT PRIMARY KEY, amount_czk REAL NOT NULL, updated_at TEXT NOT NULL);",
  "INSERT INTO channel_spend (channel, amount_czk, updated_at) VALUES ('boards',4200.5,'2024-01-04T00:00:00.000Z');",
  "CREATE TABLE analytics_targets (metric TEXT PRIMARY KEY, target_value REAL NOT NULL, updated_at TEXT NOT NULL);",
  "INSERT INTO analytics_targets (metric, target_value, updated_at) VALUES ('time_to_hire',21,'2024-01-04T00:00:00.000Z');",
  "CREATE TABLE billing_state (id TEXT PRIMARY KEY DEFAULT 'workspace', plan TEXT NOT NULL DEFAULT 'free', status TEXT NOT NULL DEFAULT 'none', provider TEXT, provider_customer_id TEXT, provider_subscription_id TEXT, current_period_start TEXT, current_period_end TEXT, updated_at TEXT NOT NULL);",
  "INSERT INTO billing_state (id, plan, status, updated_at) VALUES ('workspace','growth','active','2024-01-05T00:00:00.000Z');",
  "CREATE TABLE billing_usage (meter TEXT NOT NULL, period TEXT NOT NULL, qty INTEGER NOT NULL DEFAULT 0, PRIMARY KEY (meter, period));",
  "INSERT INTO billing_usage (meter, period, qty) VALUES ('interview_minutes','2024-01',137);",
  // The metering ledger as it stood before tiger X2/X14 added outcome + reason: no
  // ingest_key either, and two rows of REAL recorded spend. This is the case a
  // NOT NULL column added to a populated table can break — either the ALTER fails
  // outright, or it lands and the rows read differently than they did yesterday.
  "CREATE TABLE llm_usage (id INTEGER PRIMARY KEY AUTOINCREMENT, ts TEXT NOT NULL, use_case TEXT NOT NULL, provider TEXT NOT NULL, model TEXT, input_tokens INTEGER, output_tokens INTEGER, cached_tokens INTEGER, cost_usd REAL, source TEXT NOT NULL, request_id TEXT);",
  "INSERT INTO llm_usage (ts, use_case, provider, model, input_tokens, output_tokens, cost_usd, source) VALUES ('2024-01-06T00:00:00.000Z','cv_analysis','gemini','flash',900,150,0.25,'llm');",
  "INSERT INTO llm_usage (ts, use_case, provider, model, input_tokens, output_tokens, cost_usd, source) VALUES ('2024-01-06T01:00:00.000Z','cv_analysis','azure_openai','dep',400,60,NULL,'llm');",
].join("\\n"));
legacy.close();

const core = await import(pathToFileURL(path.join(process.cwd(), "app/_lib/db/core.ts")).href);
const holder = globalThis;
let db = core.ensureDb();

const fails = [];
const one = (sql, ...args) => db.prepare(sql).get(...args);
const check = (label, actual, expected) => {
  if (actual !== expected) fails.push(label + ": got " + JSON.stringify(actual) + ", expected " + JSON.stringify(expected));
};

// 1. The tenancy columns the whole isolation story rests on land on EXISTING rows.
check("entries.workspace_id backfill", one("SELECT workspace_id AS v FROM pipeline_entries WHERE id='e-1'").v, "workspace");
check("analyses.workspace_id backfill", one("SELECT workspace_id AS v FROM analyses WHERE slug='a-legacy'").v, "workspace");
check("profiles.workspace_id backfill", one("SELECT workspace_id AS v FROM profiles WHERE id='p-legacy'").v, "workspace");
check("events.workspace_id derived from the entry", one("SELECT workspace_id AS v FROM pipeline_events WHERE entry_id='e-1'").v, "workspace");
check("entry-less event falls back to the default", one("SELECT workspace_id AS v FROM pipeline_events WHERE entry_id IS NULL").v, "workspace");
check("no unscoped legacy row survives", one("SELECT COUNT(*) AS v FROM pipeline_events WHERE workspace_id IS NULL").v, 0);

// 2. Additive ALTERs actually reached the pre-existing table (not just a fresh CREATE).
const entryCols = new Set(db.prepare("PRAGMA table_info(pipeline_entries)").all().map((c) => c.name));
for (const col of ["consent_expires_at", "erasure_token", "notes", "locale", "lead_token", "intake_degraded"]) {
  check("pipeline_entries gained " + col, entryCols.has(col), true);
}

// 3. Row-level backfills that are NOT expressible as a column default.
check("legacy 7-stage entry remapped", one("SELECT stage AS v FROM pipeline_entries WHERE id='e-1'").v, "Accepted");
check("legacy 7-stage event remapped", one("SELECT to_stage AS v FROM pipeline_events WHERE entry_id='e-1'").v, "Accepted");
check("candidate decline split out of 'rejected'", one("SELECT status AS v FROM pipeline_entries WHERE id='e-2'").v, "declined");
check("a genuine recruiter reject is untouched", one("SELECT status AS v FROM pipeline_entries WHERE id='e-3'").v, "rejected");
check("empty approval_detail healed to NULL", one("SELECT COUNT(*) AS v FROM pipeline_entries WHERE approval_detail=''").v, 0);
check("legacy analysis payload untouched", one("SELECT payload_json AS v FROM analyses WHERE slug='a-legacy'").v, '{"keep":1}');

// 4. The three PK-widening REBUILDS must carry every row across, not drop them.
const spend = one("SELECT amount_czk AS amt, workspace_id AS ws FROM channel_spend WHERE channel='boards'");
check("channel_spend row survived the PK rebuild", spend && spend.amt, 4200.5);
check("channel_spend row gained the tenant", spend && spend.ws, "workspace");
const target = one("SELECT target_value AS val, workspace_id AS ws FROM analytics_targets WHERE metric='time_to_hire'");
check("analytics_targets row survived the PK rebuild", target && target.val, 21);
check("analytics_targets row gained the tenant", target && target.ws, "workspace");
const usage = one("SELECT qty AS q, org_id AS org FROM billing_usage WHERE meter='interview_minutes' AND period='2024-01'");
check("billing_usage counter survived the PK rebuild", usage && usage.q, 137);
check("billing_usage counter gained the org", usage && usage.org, "org-default");

// 5. Identity/billing backfills the ALTER defaults cannot express.
check("billing_state.org_id backfilled", one("SELECT org_id AS v FROM billing_state WHERE id='workspace'").v, "org-default");
check("billing_state plan preserved", one("SELECT plan AS v FROM billing_state WHERE id='workspace'").v, "growth");
check("workspace adopted the default org", one("SELECT org_id AS v FROM workspaces WHERE id='workspace'").v, "org-default");
check("workspace typed as a team", one("SELECT type AS v FROM workspaces WHERE id='workspace'").v, "team");
check("workspace gained the comms locale default", one("SELECT default_locale AS v FROM workspaces WHERE id='workspace'").v, "cs");
check("the default organization exists", one("SELECT COUNT(*) AS v FROM organizations WHERE id='org-default'").v, 1);

// 5b. tiger X2/X14 — the ledger's new columns on a POPULATED table. outcome is
//     NOT NULL DEFAULT 'ok', which is the only shape that can be added to rows that
//     already exist: every one of them recorded a call that happened and was summed,
//     which is precisely what 'ok' means. reason is nullable — "no reason recorded"
//     is the honest reading of a row written before anyone recorded one. And the
//     aggregate must return what it returned yesterday, to the cent.
const ledgerCols = new Set(db.prepare("PRAGMA table_info(llm_usage)").all().map((c) => c.name));
for (const col of ["outcome", "reason", "ingest_key"]) {
  check("llm_usage gained " + col, ledgerCols.has(col), true);
}
check("no legacy ledger row was left unclassified", one("SELECT COUNT(*) AS v FROM llm_usage WHERE outcome IS NULL").v, 0);
check("every legacy ledger row reads as a call that happened", one("SELECT COUNT(*) AS v FROM llm_usage WHERE outcome='ok'").v, 2);
check("a row with no recorded reason says so", one("SELECT COUNT(*) AS v FROM llm_usage WHERE reason IS NULL").v, 2);
check("legacy spend is unchanged to the cent", one("SELECT COALESCE(SUM(cost_usd),0) AS v FROM llm_usage WHERE outcome='ok'").v, 0.25);
check("legacy tokens are unchanged", one("SELECT COALESCE(SUM(input_tokens),0) AS v FROM llm_usage WHERE outcome='ok'").v, 1300);
check("the unpriced row is STILL unpriced, not reclassified as a failure", one("SELECT COUNT(*) AS v FROM llm_usage WHERE outcome='ok' AND cost_usd IS NULL").v, 1);

// 6. A SECOND boot over the now-migrated legacy DB must change nothing (a rebuild
//    that re-runs, or a backfill that flips a row back, shows up here).
holder.__kpDb.close();
holder.__kpDb = undefined;
db = core.ensureDb();
check("2nd boot keeps the decline", one("SELECT status AS v FROM pipeline_entries WHERE id='e-2'").v, "declined");
check("2nd boot keeps one channel_spend row", one("SELECT COUNT(*) AS v FROM channel_spend").v, 1);
check("2nd boot keeps the spend amount", one("SELECT amount_czk AS v FROM channel_spend WHERE channel='boards'").v, 4200.5);
check("2nd boot keeps the usage counter", one("SELECT qty AS v FROM billing_usage WHERE meter='interview_minutes'").v, 137);
check("2nd boot adds no entries", one("SELECT COUNT(*) AS v FROM pipeline_entries").v, 3);
// The ALTERs are re-run verbatim on every boot (migrateExec swallows only "duplicate
// column name"), so this is where a non-idempotent column addition would show up.
check("2nd boot keeps the ledger rows", one("SELECT COUNT(*) AS v FROM llm_usage").v, 2);
check("2nd boot keeps the ledger spend", one("SELECT COALESCE(SUM(cost_usd),0) AS v FROM llm_usage WHERE outcome='ok'").v, 0.25);

db.close();
rmSync(dir, { recursive: true, force: true });
console.log(fails.length === 0 ? "LEGACY_OK" : "LEGACY_FAIL " + fails.join(" ;; "));
`;

test("a PRE-MIGRATION database is carried forward: ALTERs, PK rebuilds and row backfills", () => {
  const res = spawnSync(
    process.execPath,
    [
      "--import",
      "./scripts/test-alias-loader.mjs",
      "--experimental-transform-types",
      "--disable-warning=ExperimentalWarning",
      "--input-type=module",
      "-e",
      LEGACY_CHILD,
    ],
    // Same colour pinning as the isolation guard: FORCE_COLOR is inherited and would
    // wrap the child's output in escape codes, silently breaking the match below.
    { cwd: process.cwd(), encoding: "utf8", env: { ...process.env, NO_COLOR: "1", FORCE_COLOR: "0" } }
  );
  assert.match(res.stdout, /LEGACY_OK/, `stdout=${res.stdout}\nstderr=${res.stderr}`);
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
