// TENANT TABLES KEY UNIQUENESS BY TEAM — the rule, derived from the tenancy manifest.
//
// The tenancy suite proves that every query on a team-scoped table FILTERS workspace_id.
// Nothing proved that the table's unique KEYS do, and a key that omits workspace_id is a
// cross-tenant defect of its own: on any id two teams can both reach (a shared corpus
// role, a vendor id, a metric name) the first team's row blocks the second team's
// INSERT. An upsert guarded by `WHERE t.workspace_id = excluded.workspace_id` then
// reports zero changes and no error, and an INSERT OR IGNORE reports a silent 0.
//
// The repo shipped that defect and fixed it BY HAND, after it shipped, four times:
// channel_spend, analytics_targets, billing_usage (org_id) and campaign_packs, each a
// one-off PK-widening rebuild in core.ts. A rule re-broken at every new site belongs in
// a checker, not in reviewers' memory, so this file derives it:
//
//   for every table in TENANCY_SCOPED_TABLES, every PRIMARY KEY and every UNIQUE index
//   either includes workspace_id, or is named in IDENTITY_KEYS with the reason one
//   team's value can never be another team's.
//
// Eager tables are read from a real ensureDb() boot. Lazy tables (created on a store's
// own connection) are built in a scratch in-memory database from the DDL their store
// source executes — the same statements, in order — so a new lazy store is covered on
// the commit that adds it, not on the day someone first calls it.
//
// A new scoped table whose key lacks workspace_id fails here. The fix is to key it by
// team; the allowlist is for keys that are globally unique BY CONSTRUCTION, and its
// entry must say which construction.

// IMPORT ORDER IS LOAD-BEARING: unit-db must precede any module that reaches db-path.
import { cleanupUnitDb } from "../testing/unit-db.ts";
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import Database from "better-sqlite3";
import { ensureDb } from "./core.ts";
import { TENANCY_LAZY_TABLES, TENANCY_SCOPED_TABLES } from "../tenancy.ts";

after(() => cleanupUnitDb());

/** One uniqueness constraint on a table: its PRIMARY KEY or a UNIQUE index. */
export type TableKey = {
  table: string;
  kind: "pk" | "unique";
  /** Index name (a PRIMARY KEY reports "PRIMARY KEY"). */
  name: string;
  columns: string[];
  /** A partial index (`WHERE …`) only constrains the rows its predicate admits. */
  partial: boolean;
  /** A single-column INTEGER PRIMARY KEY is SQLite's rowid alias. */
  rowidAlias: boolean;
};

/** The column that makes a key per-team. */
const TENANT_COLUMN = "workspace_id";

export const keyId = (k: Pick<TableKey, "table" | "columns">): string => `${k.table}(${k.columns.join(",")})`;

type Db = Pick<Database.Database, "prepare">;

/** Every PRIMARY KEY and UNIQUE index on `table`, read from the live schema. */
export function readTableKeys(db: Db, table: string): TableKey[] {
  const info = db.prepare(`PRAGMA table_info("${table}")`).all() as { name: string; type: string; pk: number }[];
  const keys: TableKey[] = [];
  const pk = info.filter((c) => c.pk > 0).sort((a, b) => a.pk - b.pk);
  if (pk.length > 0) {
    keys.push({
      table,
      kind: "pk",
      name: "PRIMARY KEY",
      columns: pk.map((c) => c.name),
      partial: false,
      rowidAlias: pk.length === 1 && (pk[0].type || "").toUpperCase() === "INTEGER",
    });
  }
  const indexes = db.prepare(`PRAGMA index_list("${table}")`).all() as {
    name: string;
    unique: number;
    origin: string;
    partial: number;
  }[];
  for (const ix of indexes) {
    // origin 'pk' is the PRIMARY KEY's own autoindex, already reported above.
    if (!ix.unique || ix.origin === "pk") continue;
    const cols = (db.prepare(`PRAGMA index_info("${ix.name}")`).all() as { seqno: number; name: string | null }[])
      .sort((a, b) => a.seqno - b.seqno)
      .map((c) => c.name ?? "<expr>");
    keys.push({ table, kind: "unique", name: ix.name, columns: cols, partial: ix.partial === 1, rowidAlias: false });
  }
  return keys;
}

/** The pure checker: the keys of a team-scoped table that neither carry the tenant
 *  column nor appear in the identity allowlist. A rowid alias is a surrogate SQLite
 *  mints per row — never a value a second team could also hold. */
export function tenantKeyOffenders(keys: TableKey[], identityKeys: ReadonlyMap<string, string>): TableKey[] {
  return keys.filter((k) => !k.rowidAlias && !k.columns.includes(TENANT_COLUMN) && !identityKeys.has(keyId(k)));
}

/**
 * Keys on team-scoped tables that are unique ACROSS teams by construction. Each reason
 * names the construction; "nobody has collided yet" is not one.
 */
const MINTED = "randomId() mints it for exactly one row; no caller supplies it";
const TOKEN = "a random capability token minted per row (CSPRNG); never a caller-chosen value";

export const IDENTITY_KEYS: ReadonlyMap<string, string> = new Map([
  // Minted identities: the value is generated for exactly one row, so no second team
  // can hold it.
  ["analyses(slug)", "insertWithUniqueSlug mints the slug globally (core.ts), retrying on a collision"],
  ["profiles(id)", "insertWithUniqueSlug mints the id globally (profiles.ts saveProfile)"],
  ["jds(slug)", "insertWithUniqueSlug mints the JD slug globally; the public JD page reads by it"],
  ["jobs(id)", "jd-<globally-unique JD slug> or a minted id; seeded corpus rows are SHARED by design (workspace_id NULL)"],
  ["pipeline_entries(id)", "the entry id carries the team prefix outside the default workspace (P1-b)"],
  ["hired_agents(id)", MINTED],
  ["hired_agents(report_token)", TOKEN],
  ["companion_brain_index(node_id)", "the Python brain indexer mints node ids globally"],
  ["agent_activity(id)", MINTED],
  ["agent_fit_specs(id)", MINTED],
  ["companion_proposals(id)", MINTED],
  ["companion_threads(id)", MINTED],
  ["companion_turns(id)", MINTED],
  ["dev_cases(id)", MINTED],
  ["dev_lifecycle(id)", MINTED],
  ["dev_outbox(id)", MINTED],
  ["dev_postings(id)", MINTED],
  ["dev_sessions(id)", MINTED],
  ["dev_submissions(id)", MINTED],
  ["interview_events(id)", MINTED],
  ["interview_kits(id)", MINTED],
  ["interview_letters(id)", MINTED],
  ["interview_sessions(id)", MINTED],
  ["interview_sessions(token)", TOKEN],
  ["jd_templates(id)", MINTED],
  ["job_postings(id)", MINTED],
  ["job_translations(id)", MINTED],
  ["jobseeker_dialogs(id)", MINTED],
  ["jobseeker_postings(id)", MINTED],
  ["jobseeker_profiles(id)", MINTED],
  ["jobseeker_sources(id)", MINTED],
  ["offers(id)", MINTED],
  ["offers(token)", TOKEN],
  ["rediscovery_alerts(id)", MINTED],
  ["repo_scans(id)", MINTED],
  ["role_intakes(id)", MINTED],
  ["schedule_invites(id)", MINTED],
  ["schedule_invites(token)", TOKEN],
  ["tasks(id)", MINTED],
  ["skill_profiles(token)", "internal PK minted by randomId (skill-profiles.ts); the public secret is access_token"],
  ["channel_webhooks(token)", "randomToken('hook') (channels.ts), a CSPRNG bearer for the inbound endpoint"],
  ["application_status_links(token)", TOKEN],
  [
    "apply_sessions(id)",
    "a random attempt id the public apply page mints per attempt (idempotent re-POST after a reload); not a shared business value",
  ],
  // A tier, not a natural key: the partial index admits only the org-default rows
  // (workspace_id IS NULL); team rows are unique by (phase, workspace_id) in
  // uq_decision_config_team.
  ["decision_config(phase)", "partial index over the org-default tier only (WHERE workspace_id IS NULL)"],
  // Child keys: the parent row already belongs to exactly one team, so a key that
  // leads with the parent's id is per-team through it.
  ["candidate_nps(entry_id)", "child of pipeline_entries (one team per entry)"],
  ["outreach_state(entry_id)", "child of pipeline_entries (one team per entry)"],
  ["application_status_links(entry_id)", "child of pipeline_entries (one team per entry)"],
  ["interview_preps(entry_id)", "child of pipeline_entries (one team per entry)"],
  ["offers(entry_id)", "child of pipeline_entries (one team per entry)"],
  ["agent_activity(hired_agent_id,period)", "child of hired_agents (one team per agent)"],
  ["agent_activity(hired_agent_id,exec_id)", "child of hired_agents (one team per agent)"],
  ["dev_session_chat(session_id,seq)", "child of a devcase session (one team per session)"],
  ["dev_session_events(session_id,seq)", "child of a devcase session (one team per session)"],
  ["interview_events(session_id,attempt,seq)", "child of an interview session (one team per session)"],
  ["dev_submissions(posting_id,candidate_ref,repo_ref)", "child of a devcase posting (one team per posting)"],
]);

// ---------------------------------------------------------------------------
// Lazy tables: the DDL their store executes, replayed into a scratch database.
// ---------------------------------------------------------------------------

const libDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function walk(dir: string, out: string[] = []): string[] {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (e.name !== "node_modules") walk(p, out);
    } else if (e.name.endsWith(".ts") && !e.name.endsWith(".test.ts")) {
      out.push(p);
    }
  }
  return out;
}

function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/(^|[^:'"`\\])\/\/[^\n]*/gm, "$1");
}

const SOURCES = walk(libDir).map((f) => ({ file: f, src: stripComments(readFileSync(f, "utf8")) }));

/** The schema statements a lazy store executes for `table`, in source order: its
 *  CREATE TABLE, its ALTERs, its CREATE/DROP INDEX. Interpolated statements are
 *  skipped (none of the key-bearing DDL is interpolated). */
function lazyStoreDdl(table: string): { file: string; statements: string[] } {
  const createRe = new RegExp(`CREATE TABLE IF NOT EXISTS\\s+${table}\\s*\\(`, "i");
  const owner = SOURCES.find((s) => createRe.test(s.src) && /\bopenStore\b/.test(s.src));
  assert.ok(owner, `no lazy store source CREATEs ${table} — TENANCY_LAZY_TABLES and the source disagree`);
  const literals = [...owner.src.matchAll(/`([^`]*)`|"((?:[^"\\\n]|\\.)*)"/g)].map((m) => m[1] ?? m[2] ?? "");
  const onTable = new RegExp(`^(CREATE TABLE IF NOT EXISTS\\s+${table}\\s*\\(|ALTER TABLE\\s+${table}\\s+ADD COLUMN|CREATE (UNIQUE )?INDEX\\b[\\s\\S]*\\bON\\s+${table}\\s*\\(|DROP INDEX\\b)`, "i");
  const statements = literals
    // SQL `--` comments come off first: they carry prose with semicolons in it.
    // A quoted interpolation is a literal value (a column DEFAULT) — any value keeps the
    // shape; an unquoted one could be structure, so its statement is dropped below.
    .flatMap((lit) => lit.replace(/--[^\n]*/g, "").replace(/'\$\{[^}]*\}'/g, "'x'").split(";"))
    .map((s) => s.trim())
    .filter((s) => s && !s.includes("${") && onTable.test(s));
  return { file: owner.file, statements };
}

function lazyTableKeys(table: string): TableKey[] {
  const { file, statements } = lazyStoreDdl(table);
  const scratch = new Database(":memory:");
  try {
    for (const sql of statements) {
      try {
        scratch.exec(sql);
      } catch (err) {
        // An ALTER re-adding a column the CREATE already carries is the store's own
        // idempotent migration; anything else is a replay we cannot trust.
        if (!/^ALTER TABLE/i.test(sql) || !/duplicate column/i.test((err as Error).message)) {
          throw new Error(`replaying ${path.relative(libDir, file)} for ${table} failed on:\n${sql}\n${(err as Error).message}`);
        }
      }
    }
    const keys = readTableKeys(scratch, table);
    assert.ok(
      (scratch.prepare(`PRAGMA table_info("${table}")`).all() as unknown[]).length > 0,
      `replaying ${path.relative(libDir, file)} did not create ${table}`
    );
    return keys;
  } finally {
    scratch.close();
  }
}

function allScopedKeys(): TableKey[] {
  const db = ensureDb();
  const keys: TableKey[] = [];
  for (const table of [...TENANCY_SCOPED_TABLES].sort()) {
    if (TENANCY_LAZY_TABLES.has(table)) {
      keys.push(...lazyTableKeys(table));
    } else {
      const exists = db.prepare(`SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?`).get(table);
      assert.ok(exists, `scoped table ${table} is neither created by ensureDb nor listed as lazy`);
      keys.push(...readTableKeys(db, table));
    }
  }
  return keys;
}

// ---------------------------------------------------------------------------

test("every PRIMARY KEY and UNIQUE index of a team-scoped table is keyed by team, or is a named identity key", () => {
  const keys = allScopedKeys();
  // A floor, so a replay that silently read nothing cannot pass as "no offenders".
  assert.ok(keys.length >= 40, `expected to read the keys of the whole scoped schema, found ${keys.length}`);
  const offenders = tenantKeyOffenders(keys, IDENTITY_KEYS).map((k) => `${keyId(k)} [${k.name}]`);
  assert.deepEqual(
    offenders,
    [],
    `these keys on team-scoped tables omit ${TENANT_COLUMN}, so one team's row blocks another's on a shared id:\n  ` +
      offenders.join("\n  ") +
      `\nKey the table by team (a PK-widening rebuild in core.ts, or a unique index with ${TENANT_COLUMN}), ` +
      `or — only if the value is globally unique by construction — add it to IDENTITY_KEYS with that construction.`
  );
});

test("every allowlisted identity key still exists — a stale entry is a hole waiting for a new table", () => {
  const present = new Set(allScopedKeys().map(keyId));
  const stale = [...IDENTITY_KEYS.keys()].filter((id) => !present.has(id)).sort();
  assert.deepEqual(stale, [], `IDENTITY_KEYS names keys the schema no longer has:\n  ${stale.join("\n  ")}`);
});

test("the checker names a natural key without workspace_id, and passes the same key widened by team", () => {
  const scratch = new Database(":memory:");
  try {
    scratch.exec(`
      CREATE TABLE fixture_packs (job_id TEXT NOT NULL, lang TEXT NOT NULL, workspace_id TEXT NOT NULL, PRIMARY KEY (job_id, lang));
      CREATE TABLE fixture_packs_wide (job_id TEXT NOT NULL, lang TEXT NOT NULL, workspace_id TEXT NOT NULL, PRIMARY KEY (job_id, lang, workspace_id));
      CREATE TABLE fixture_alerts (id TEXT PRIMARY KEY, job_id TEXT, candidate_id TEXT, workspace_id TEXT);
      CREATE UNIQUE INDEX ux_fixture_alert ON fixture_alerts (job_id, candidate_id);
      CREATE TABLE fixture_events (id INTEGER PRIMARY KEY AUTOINCREMENT, workspace_id TEXT);
    `);
    const narrow = tenantKeyOffenders(readTableKeys(scratch, "fixture_packs"), IDENTITY_KEYS);
    assert.deepEqual(narrow.map(keyId), ["fixture_packs(job_id,lang)"]);
    assert.equal(narrow[0].kind, "pk");

    assert.deepEqual(tenantKeyOffenders(readTableKeys(scratch, "fixture_packs_wide"), IDENTITY_KEYS), []);

    // A UNIQUE index is a key too; an allowlisted identity PK beside it is not.
    const alerts = tenantKeyOffenders(
      readTableKeys(scratch, "fixture_alerts"),
      new Map([["fixture_alerts(id)", "minted"]])
    );
    assert.deepEqual(alerts.map((k) => `${keyId(k)} [${k.name}]`), ["fixture_alerts(job_id,candidate_id) [ux_fixture_alert]"]);

    // A rowid alias is a surrogate, never a shared value.
    assert.deepEqual(tenantKeyOffenders(readTableKeys(scratch, "fixture_events"), IDENTITY_KEYS), []);
  } finally {
    scratch.close();
  }
});
