// THE PATH BACK, REHEARSED.
//
// release.yml scripts the path TO production: it re-runs the gate, builds, signs,
// attests and publishes. docs/architecture/releases.md scripts the path back — take
// a dump, repoint the image, restore if the DATA is wrong, not just the code — and
// until this file existed nothing ever ran those steps. A written rollback nobody
// has executed is a plan, not a procedure, and the moment it is needed is the worst
// possible moment to discover that `db-load.mjs` refuses, or that a column an older
// image selects is gone.
//
// core-migrations.test.ts covers the FORWARD direction (an old DB carried onto the
// current schema). This file covers the two things that make the reverse direction
// survivable, and it is deliberately the same shape as an operator's ten minutes:
//
//   1. DOWNGRADE COMPATIBILITY. releases.md claims "an older image usually reads a
//      newer file (the columns it does not know about are simply not selected)".
//      That claim rests entirely on every migration being ADDITIVE. So: pin the
//      column shape a v0.1.x image issues SQL against, and assert the CURRENT schema
//      still carries every one of those columns with the same declared type, and
//      still accepts the INSERT statements an older image writes. A dropped column,
//      a renamed one, or a table rebuild that tightens a constraint turns this red —
//      which per releases.md's own versioning rule is a MAJOR release, not a patch.
//
//   2. THE RESTORE DRILL. Take the dump releases.md tells operators to take, let a
//      bad upgrade wreck the file (schema moved AND rows corrupted), then run the
//      documented recovery and assert the workspace is byte-for-byte what it was.
//      Also asserts the safety property the loader promises: without `--replace` it
//      refuses and writes NOTHING, so a half-eaten restore is not reachable.
//
// Everything here is plain node + better-sqlite3 over throwaway temp files: no
// build, no server, no network, no keys. It runs in `npm run test:unit`, which is
// the node-tests job in ci.yml AND the `gate` job in release.yml — so a tag can
// never publish a version whose documented rollback has not just been executed.

import { test, after } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, existsSync, readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { cleanupUnitDb } from "../testing/unit-db.ts";
import Database from "better-sqlite3";
import { ensureDb } from "./core.ts";
import { ORG_CONFIG_NOT_PORTABLE } from "../tenancy.ts";
import { CREDENTIAL_TABLES, ORG_CONFIG_TABLES, redactionPlan } from "../../../scripts/db-dump.mjs";

after(() => cleanupUnitDb());

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const DUMP_SCRIPT = path.join(REPO_ROOT, "scripts", "db-dump.mjs");
const LOAD_SCRIPT = path.join(REPO_ROOT, "scripts", "db-load.mjs");

// ---------------------------------------------------------------------------
// 1. Downgrade compatibility — can the image an operator rolls BACK to still
//    read and write this file?
// ---------------------------------------------------------------------------

/**
 * The column shape a v0.1.x image issues SQL against, per table: `name -> declared
 * type`. This is a PIN, not an inventory — it is deliberately the subset an older
 * build actually selects and writes, taken from the pre-migration schema that
 * core-migrations.test.ts already uses as its legacy fixture.
 *
 * Adding a column here is meaningless (it only claims an old image used it).
 * REMOVING one is the edit that matters: it is how you record that a release
 * dropped something an older image needs, and releases.md says that release is
 * MAJOR — "the database, in a way an older image cannot read back".
 */
const V0_1_X_SHAPE: Record<string, Record<string, string>> = {
  workspaces: { id: "TEXT", name: "TEXT", created_at: "TEXT" },
  analyses: {
    slug: "TEXT",
    candidate_label: "TEXT",
    jd_slug: "TEXT",
    score: "INTEGER",
    role_family: "TEXT",
    seniority: "TEXT",
    payload_json: "TEXT",
    created_at: "TEXT",
  },
  pipeline_entries: {
    id: "TEXT",
    candidate_id: "TEXT",
    candidate_label: "TEXT",
    archetype: "TEXT",
    role_family: "TEXT",
    job_id: "TEXT",
    job_title: "TEXT",
    stage: "TEXT",
    match_score: "INTEGER",
    status: "TEXT",
    approval_kind: "TEXT",
    approval_detail: "TEXT",
    updated_at: "TEXT",
  },
  pipeline_events: {
    id: "INTEGER",
    entry_id: "TEXT",
    candidate_label: "TEXT",
    job_title: "TEXT",
    archetype: "TEXT",
    kind: "TEXT",
    from_stage: "TEXT",
    to_stage: "TEXT",
    detail: "TEXT",
    created_at: "TEXT",
  },
  // The three tables whose PRIMARY KEY was WIDENED by a table rebuild. A rebuild
  // is the one migration shape that CAN silently drop a column or tighten a
  // constraint, so they matter here more than the ALTER-only tables do.
  channel_spend: { channel: "TEXT", amount_czk: "REAL", updated_at: "TEXT" },
  analytics_targets: { metric: "TEXT", target_value: "REAL", updated_at: "TEXT" },
  billing_usage: { meter: "TEXT", period: "TEXT", qty: "INTEGER" },
  billing_state: {
    id: "TEXT",
    plan: "TEXT",
    status: "TEXT",
    provider: "TEXT",
    provider_customer_id: "TEXT",
    provider_subscription_id: "TEXT",
    current_period_start: "TEXT",
    current_period_end: "TEXT",
    updated_at: "TEXT",
  },
};

/** The writes an older image performs, naming ONLY v0.1.x columns. Each must still
 *  compile and execute against the current schema — which is what proves every
 *  column added since is either nullable or carries a DEFAULT. */
const V0_1_X_WRITES: string[] = [
  `INSERT INTO analyses (slug, candidate_label, payload_json, created_at) VALUES ('rollback-drill-a', 'Old Image Candidate', '{"v":"0.1.x"}', '2024-01-01T00:00:00.000Z')`,
  `INSERT INTO pipeline_entries (id, candidate_label, stage, status) VALUES ('rollback-drill-e', 'Old Image Entry', 'Sourced', 'active')`,
  `INSERT INTO pipeline_events (entry_id, kind, created_at) VALUES ('rollback-drill-e', 'matched', '2024-01-01T00:00:00.000Z')`,
  `INSERT INTO channel_spend (channel, amount_czk, updated_at) VALUES ('rollback-drill-channel', 1234.5, '2024-01-01T00:00:00.000Z')`,
  `INSERT INTO analytics_targets (metric, target_value, updated_at) VALUES ('rollback-drill-metric', 21, '2024-01-01T00:00:00.000Z')`,
  `INSERT INTO billing_usage (meter, period, qty) VALUES ('rollback_drill_meter', '2024-01', 7)`,
];

test("an image rolled BACK to v0.1.x still finds every column it selects", () => {
  const db = ensureDb();
  for (const [table, columns] of Object.entries(V0_1_X_SHAPE)) {
    const info = db.prepare(`PRAGMA table_info(${table})`).all() as { name: string; type: string }[];
    assert.notEqual(info.length, 0, `table "${table}" no longer exists — an older image cannot read this file back`);
    const declared = new Map<string, string>(info.map((c) => [c.name, (c.type || "").toUpperCase()] as [string, string]));
    for (const [column, type] of Object.entries(columns)) {
      assert.ok(
        declared.has(column),
        `${table}.${column} is gone. An image at v0.1.x SELECTs it, so this is not a patch — ` +
          `docs/architecture/releases.md makes a change "the database ... an older image cannot read back" MAJOR. ` +
          `If the removal is intended, cut a major and delete the column from V0_1_X_SHAPE in the same change.`
      );
      assert.equal(
        declared.get(column),
        type,
        `${table}.${column} changed declared type (${declared.get(column)} ≠ ${type}) — an older image reads it back wrong`
      );
    }
  }
});

test("an image rolled BACK to v0.1.x can still WRITE: every column added since is nullable or defaulted", () => {
  // Executed for real, then rolled back — `prepare()` alone would prove the columns
  // resolve but not that the row is actually insertable. A migration that rebuilt a
  // table with a new NOT NULL column and no DEFAULT passes the shape test above and
  // fails here, which is the correct verdict: the old image boots and then cannot
  // write, the worst of the three outcomes because it looks like a successful rollback.
  const db = ensureDb();
  const ROLLBACK = Symbol("drill-rollback");
  const drill = db.transaction(() => {
    for (const sql of V0_1_X_WRITES) {
      db.prepare(sql).run();
    }
    throw ROLLBACK; // better-sqlite3 rolls the whole thing back and rethrows
  });
  try {
    drill();
  } catch (err) {
    if (err !== ROLLBACK) {
      throw new Error(
        `a v0.1.x-shaped write no longer succeeds against the current schema: ${(err as Error).message}. ` +
          `A column added since v0.1.x is NOT NULL without a DEFAULT, so an operator who rolls the image ` +
          `back gets an app that starts and then fails every write.`
      );
    }
  }
  // The rollback is part of the assertion: this suite's DB must be untouched.
  const leaked = db.prepare(`SELECT COUNT(*) AS n FROM analyses WHERE slug = 'rollback-drill-a'`).get() as { n: number };
  assert.equal(leaked.n, 0, "the drill's transaction did not roll back");
});

// ---------------------------------------------------------------------------
// 2. The restore drill — `npm run db:dump` before, `npm run db:load` after.
// ---------------------------------------------------------------------------

/** The pre-upgrade workspace, in the v0.1.x schema, with rows worth losing. */
const PRE_UPGRADE_SQL = [
  "CREATE TABLE workspaces (id TEXT PRIMARY KEY, name TEXT, created_at TEXT NOT NULL);",
  "INSERT INTO workspaces (id, name, created_at) VALUES ('workspace','Default workspace','2024-01-01T00:00:00.000Z');",
  "CREATE TABLE analyses (slug TEXT PRIMARY KEY, candidate_label TEXT NOT NULL, jd_slug TEXT, score INTEGER, payload_json TEXT NOT NULL, created_at TEXT NOT NULL);",
  "INSERT INTO analyses (slug, candidate_label, score, payload_json, created_at) VALUES ('a-1','Petra Nováková',82,'{\"keep\":1}','2024-01-02T00:00:00.000Z');",
  "INSERT INTO analyses (slug, candidate_label, score, payload_json, created_at) VALUES ('a-2','Jan Dvořák',64,'{\"keep\":2}','2024-01-02T01:00:00.000Z');",
  "CREATE TABLE pipeline_entries (id TEXT PRIMARY KEY, candidate_label TEXT NOT NULL, job_id TEXT, stage TEXT NOT NULL, match_score INTEGER, status TEXT NOT NULL DEFAULT 'active', updated_at TEXT);",
  "INSERT INTO pipeline_entries (id, candidate_label, job_id, stage, match_score, status, updated_at) VALUES ('e-1','Petra Nováková','job-1','Offer',82,'active','2024-01-03T00:00:00.000Z');",
  "INSERT INTO pipeline_entries (id, candidate_label, job_id, stage, match_score, status, updated_at) VALUES ('e-2','Jan Dvořák','job-1','Screen',64,'active','2024-01-03T00:00:00.000Z');",
  "CREATE TABLE pipeline_events (id INTEGER PRIMARY KEY AUTOINCREMENT, entry_id TEXT, kind TEXT NOT NULL, to_stage TEXT, created_at TEXT NOT NULL);",
  "INSERT INTO pipeline_events (entry_id, kind, to_stage, created_at) VALUES ('e-1','matched','Sourced','2024-01-03T00:00:00.000Z');",
  "INSERT INTO pipeline_events (entry_id, kind, to_stage, created_at) VALUES ('e-1','advanced','Offer','2024-01-04T00:00:00.000Z');",
  "CREATE TABLE channel_spend (channel TEXT PRIMARY KEY, amount_czk REAL NOT NULL, updated_at TEXT NOT NULL);",
  "INSERT INTO channel_spend (channel, amount_czk, updated_at) VALUES ('boards',4200.5,'2024-01-04T00:00:00.000Z');",
  "CREATE TABLE billing_usage (meter TEXT NOT NULL, period TEXT NOT NULL, qty INTEGER NOT NULL DEFAULT 0, PRIMARY KEY (meter, period));",
  "INSERT INTO billing_usage (meter, period, qty) VALUES ('interview_minutes','2024-01',137);",
  "CREATE INDEX idx_drill_entries_job ON pipeline_entries (job_id);",
].join("\n");

/** Schema + every row, in a stable order, as one comparable value.
 *  Opened read-WRITE on purpose: `db-load.mjs` puts the file into WAL mode, and a
 *  read-only connection to a WAL database cannot create the `-shm` it needs. */
function snapshot(dbPath: string): string {
  const db = new Database(dbPath, { fileMustExist: true });
  const objects = db
    .prepare(
      `SELECT type, name, sql FROM sqlite_master
        WHERE name NOT LIKE 'sqlite_%' AND sql IS NOT NULL ORDER BY type, name`
    )
    .all() as { type: string; name: string; sql: string }[];
  const tables = objects.filter((o) => o.type === "table").map((o) => o.name);
  const data = tables.map((name) => ({
    name,
    rows: db.prepare(`SELECT * FROM "${name}" ORDER BY rowid`).raw(true).all(),
  }));
  db.close();
  return JSON.stringify({ objects, data }, null, 1);
}

function runScript(script: string, args: string[]): { status: number | null; out: string } {
  const res = spawnSync(process.execPath, [script, ...args], {
    cwd: REPO_ROOT,
    encoding: "utf8",
    env: { ...process.env, NO_COLOR: "1", FORCE_COLOR: "0" },
  });
  return { status: res.status, out: `${res.stdout ?? ""}${res.stderr ?? ""}` };
}

test("the documented rollback drill: dump before, wreck the upgrade, restore, and the workspace is exactly what it was", () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), "kp-rollback-drill-"));
  try {
    const dbPath = path.join(dir, "kp.sqlite");
    const dumpPath = path.join(dir, "kp-dump-pre-upgrade.json");

    // — Before upgrading, per releases.md §"Before upgrading".
    const pre = new Database(dbPath);
    pre.exec(PRE_UPGRADE_SQL);
    pre.close();
    const before = snapshot(dbPath);

    const dumped = runScript(DUMP_SCRIPT, ["--db", dbPath, "--out", dumpPath]);
    assert.equal(dumped.status, 0, `npm run db:dump failed — there is no rollback at all without it:\n${dumped.out}`);
    assert.ok(existsSync(dumpPath), "db-dump.mjs reported success and wrote no file");

    // — 0.1.1 ships a migration that moves the schema AND corrupts the rows. This is
    //   the scenario releases.md names: "if the data is wrong, not just the code".
    //   Repointing the image back cannot undo any of it.
    const bad = new Database(dbPath);
    bad.exec(
      [
        "ALTER TABLE pipeline_entries ADD COLUMN workspace_id TEXT NOT NULL DEFAULT 'workspace';",
        "UPDATE pipeline_entries SET stage = 'Sourced', match_score = 0;",
        "DELETE FROM pipeline_events WHERE kind = 'advanced';",
        "UPDATE channel_spend SET amount_czk = 0;",
        "DROP TABLE billing_usage;",
      ].join("\n")
    );
    bad.close();
    assert.notEqual(snapshot(dbPath), before, "the simulated bad upgrade changed nothing — the drill would prove nothing");

    // — The loader must NOT touch a populated workspace without an explicit
    //   --replace, and must write nothing at all when it refuses. An operator who
    //   fires the recovery command with a typo'd flag has to end up where they
    //   started, not half-restored.
    const wrecked = snapshot(dbPath);
    const refused = runScript(LOAD_SCRIPT, [dumpPath, "--db", dbPath]);
    assert.notEqual(refused.status, 0, "db-load.mjs overwrote a populated workspace with no --replace");
    assert.match(refused.out, /--replace/, "the refusal must name the flag that authorizes it");
    assert.equal(snapshot(dbPath), wrecked, "a REFUSED load still modified the database — a half-eaten restore");

    // — Going back, per releases.md §"Going back" step 3.
    const restored = runScript(LOAD_SCRIPT, [dumpPath, "--db", dbPath, "--replace"]);
    assert.equal(restored.status, 0, `the documented restore command failed:\n${restored.out}`);

    // The whole point: schema AND every row are the pre-upgrade workspace again.
    // That file is precisely the shape core-migrations.test.ts proves the current
    // code carries forward, so the operator can retry the upgrade once it is fixed.
    assert.equal(
      snapshot(dbPath),
      before,
      "the restored workspace is not the one that was dumped — the documented rollback does not actually roll back"
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("restoring into an EMPTY target needs no flag and is a faithful copy, indexes included", () => {
  // The other half of the runbook: bringing the dump up on a different host, which
  // is what an operator does when the volume itself is what went wrong. It must
  // also carry the named indexes across — a table restored without its indexes
  // reads correctly and runs slower every day afterwards, which is the kind of
  // rollback damage nobody ever attributes to the rollback.
  const dir = mkdtempSync(path.join(os.tmpdir(), "kp-rollback-fresh-"));
  try {
    const source = path.join(dir, "source.sqlite");
    const target = path.join(dir, "target.sqlite");
    const dumpPath = path.join(dir, "dump.json");
    const db = new Database(source);
    db.exec(PRE_UPGRADE_SQL);
    db.close();

    const sourceDump = runScript(DUMP_SCRIPT, ["--db", source, "--out", dumpPath]);
    assert.equal(sourceDump.status, 0, `db-dump.mjs failed:\n${sourceDump.out}`);
    const loaded = runScript(LOAD_SCRIPT, [dumpPath, "--db", target]);
    assert.equal(loaded.status, 0, `restoring into a fresh path needs no flag and failed:\n${loaded.out}`);
    assert.equal(snapshot(target), snapshot(source), "a restore into an empty target is not a faithful copy");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});


// ---------------------------------------------------------------------------
// 3. THE DUMP IS A CREDENTIAL FILE — and there is a shareable variant.
//
//    "Every table" is literal: password hashes, encrypted provider keys, calendar
//    refresh tokens, invite and webhook bearer tokens, and the whole
//    ORG_CONFIG_NOT_PORTABLE set including the edge pairing's HMAC secret and
//    sealing PRIVATE key — into one plain JSON file with no encryption. The
//    operator running the rollback runbook is entitled to be told that, and to
//    have a way to produce a dump they can hand to someone.
// ---------------------------------------------------------------------------

const CREDENTIAL_SQL = [
  "CREATE TABLE user_credentials (user_id TEXT PRIMARY KEY, password_hash TEXT NOT NULL, updated_at TEXT);",
  "INSERT INTO user_credentials VALUES ('u-1','scrypt$16384$8$1$c0ffee','2024-01-01T00:00:00.000Z');",
  "CREATE TABLE edge_config (id INTEGER PRIMARY KEY, edge_url TEXT, edge_secret TEXT, private_jwk TEXT);",
  "INSERT INTO edge_config VALUES (1,'https://edge.example','hmac-s3cr3t','{\"d\":\"private-key-material\"}');",
  "CREATE TABLE calendar_connections (workspace_id TEXT PRIMARY KEY, provider TEXT, refresh_token TEXT, access_token TEXT);",
  "INSERT INTO calendar_connections VALUES ('w-1','google','1//refresh-abc','ya29.access-def');",
  "CREATE TABLE jobs (id TEXT PRIMARY KEY, title TEXT NOT NULL, city TEXT);",
  "INSERT INTO jobs VALUES ('job-1','Site Reliability Engineer','Praha');",
].join("\n");

/** Every credential literal planted above, in one list: what must NOT survive a
 *  redacted dump. Substring search over the raw file, because a leak through a
 *  nested JSON string or a column nobody thought about is still a leak. */
const SECRET_LITERALS = [
  "scrypt$16384$8$1$c0ffee",
  "hmac-s3cr3t",
  "private-key-material",
  "1//refresh-abc",
  "ya29.access-def",
];

test("the script's redaction list still mirrors ORG_CONFIG_NOT_PORTABLE", () => {
  // db-dump.mjs runs under bare `node` and cannot import tenancy.ts, so the list is
  // duplicated. A table added to ORG_CONFIG_NOT_PORTABLE and not to the script is a
  // config table full of secrets that a `--redact` run dumps in the clear while
  // reporting itself clean — the worst of the three possible states.
  assert.deepEqual(
    [...ORG_CONFIG_TABLES].sort(),
    [...ORG_CONFIG_NOT_PORTABLE].sort(),
    "scripts/db-dump.mjs ORG_CONFIG_TABLES has drifted from app/_lib/tenancy.ts ORG_CONFIG_NOT_PORTABLE"
  );
  // The second list is deliberately NOT in tenancy's set (those tables ARE portable
  // and do move with a restore) — which is exactly why dumping them is the leak.
  for (const table of CREDENTIAL_TABLES) {
    assert.equal(
      ORG_CONFIG_NOT_PORTABLE.has(table),
      false,
      `${table} is in both lists — one of them is wrong about whether it survives a restore`
    );
  }
});

test("redactionPlan blanks a secret column wherever it appears, and keeps the key", () => {
  // An unlisted table is judged by column NAME, so a store that lands tomorrow with
  // a `*_token` column is covered on day one rather than on the day someone lists it.
  assert.deepEqual(
    [...redactionPlan("some_new_store", [
      { name: "id", pk: 1 },
      { name: "label", pk: 0 },
      { name: "webhook_secret", pk: 0 },
      { name: "api_token", pk: 0 },
    ])].sort(),
    ["api_token", "webhook_secret"]
  );
  // A listed table is blanked whole except its key, because every non-key column of
  // an integration config is either the endpoint or the credential for it.
  assert.deepEqual(
    [...redactionPlan("edge_config", [
      { name: "id", pk: 1 },
      { name: "edge_url", pk: 0 },
      { name: "cursor", pk: 0 },
    ])].sort(),
    ["cursor", "edge_url"]
  );
  // And a table of ordinary business data is untouched — a redacted dump has to stay
  // worth restoring.
  assert.equal(redactionPlan("jobs", [{ name: "id", pk: 1 }, { name: "title", pk: 0 }]).size, 0);
});

test("a plain dump WARNS that it carries credentials, and names the tables", () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), "kp-dump-warn-"));
  try {
    const dbPath = path.join(dir, "kp.sqlite");
    const dumpPath = path.join(dir, "plain.json");
    const db = new Database(dbPath);
    db.exec(CREDENTIAL_SQL);
    db.close();

    const dumped = runScript(DUMP_SCRIPT, ["--db", dbPath, "--out", dumpPath]);
    assert.equal(dumped.status, 0, dumped.out);
    assert.match(dumped.out, /CREDENTIALS IN THE CLEAR/, "an unredacted dump was produced with no warning");
    for (const table of ["user_credentials", "edge_config", "calendar_connections"]) {
      assert.match(dumped.out, new RegExp(table), `the warning does not name ${table}`);
    }
    // A generic "may contain secrets" teaches nobody anything; naming the column is
    // what tells an operator whether the file is safe to hand over.
    assert.match(dumped.out, /password_hash/);
    assert.match(dumped.out, /--redact/, "the warning must name the flag that fixes it");

    // The warning is honest: those secrets really are in the file, verbatim.
    const raw = readFileSync(dumpPath, "utf-8");
    for (const secret of SECRET_LITERALS) assert.ok(raw.includes(secret), `${secret} was expected in a plain dump`);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("--redact removes every credential and the dump still restores", () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), "kp-dump-redact-"));
  try {
    const dbPath = path.join(dir, "kp.sqlite");
    const dumpPath = path.join(dir, "redacted.json");
    const target = path.join(dir, "restored.sqlite");
    const db = new Database(dbPath);
    db.exec(CREDENTIAL_SQL);
    db.close();

    const dumped = runScript(DUMP_SCRIPT, ["--db", dbPath, "--out", dumpPath, "--redact"]);
    assert.equal(dumped.status, 0, dumped.out);
    assert.doesNotMatch(dumped.out, /CREDENTIALS IN THE CLEAR/, "a redacted dump still warned");

    const raw = readFileSync(dumpPath, "utf-8");
    for (const secret of SECRET_LITERALS) {
      assert.equal(raw.includes(secret), false, `--redact leaked ${secret}`);
    }
    // Not a scorched dump: the business rows an operator actually wants are intact.
    assert.ok(raw.includes("Site Reliability Engineer"), "--redact blanked ordinary business data");

    // The whole reason redaction is a marker rather than NULL: a NOT NULL column has
    // to keep restoring, or nobody will ever use the flag.
    const loaded = runScript(LOAD_SCRIPT, [dumpPath, "--db", target]);
    assert.equal(loaded.status, 0, `a redacted dump did not restore:\n${loaded.out}`);
    const restored = new Database(target, { fileMustExist: true });
    const hash = restored.prepare("SELECT password_hash AS h FROM user_credentials").get() as { h: string };
    const job = restored.prepare("SELECT title AS t FROM jobs").get() as { t: string };
    restored.close();
    assert.match(hash.h, /^\[redacted:user_credentials\.password_hash#0\]$/);
    assert.equal(job.t, "Site Reliability Engineer");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// 4. THE REHEARSAL. The restore command is executed once, under pressure, against
//    a workspace that is already wrong. --dry-run is how an operator finds out
//    what it will do BEFORE it does it, so it must predict the real outcome —
//    exit code included — and must itself write nothing at all.
// ---------------------------------------------------------------------------

test("--dry-run reports the plan, predicts the refusal, and writes nothing", () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), "kp-load-dryrun-"));
  try {
    const dbPath = path.join(dir, "kp.sqlite");
    const dumpPath = path.join(dir, "dump.json");
    const pre = new Database(dbPath);
    pre.exec(PRE_UPGRADE_SQL);
    pre.close();
    const before = snapshot(dbPath);
    assert.equal(runScript(DUMP_SCRIPT, ["--db", dbPath, "--out", dumpPath]).status, 0);

    // (a) Against a path that does not exist yet, a dry run must not CREATE the
    //     workspace — `new Database(path)` would, and an empty file left behind is
    //     the one thing that makes the next real load behave differently.
    const fresh = path.join(dir, "nested", "fresh.sqlite");
    const planned = runScript(LOAD_SCRIPT, [dumpPath, "--db", fresh, "--dry-run"]);
    assert.equal(planned.status, 0, planned.out);
    assert.equal(existsSync(fresh), false, "a dry run created the target workspace file");
    assert.equal(existsSync(path.dirname(fresh)), false, "a dry run created the target directory");
    assert.match(planned.out, /pipeline_entries/, "the plan does not name the tables it would write");
    assert.match(planned.out, /Nothing was written/);

    // (b) Against a POPULATED workspace with no --replace, the dry run has to fail
    //     the same way the real run fails. A rehearsal that reports success for a
    //     command that will refuse is worse than no rehearsal.
    const refusedDry = runScript(LOAD_SCRIPT, [dumpPath, "--db", dbPath, "--dry-run"]);
    assert.notEqual(refusedDry.status, 0, "--dry-run reported success for a load that will refuse");
    assert.match(refusedDry.out, /--replace/);
    assert.equal(snapshot(dbPath), before, "a dry run modified the database");

    // (c) With --replace, the plan says what it will destroy — the word an operator
    //     needs to see before typing the real command.
    const replaceDry = runScript(LOAD_SCRIPT, [dumpPath, "--db", dbPath, "--dry-run", "--replace"]);
    assert.equal(replaceDry.status, 0, replaceDry.out);
    assert.match(replaceDry.out, /REPLACE/);
    assert.match(replaceDry.out, /existing row\(s\) discarded/);
    assert.equal(snapshot(dbPath), before, "a --dry-run --replace modified the database");

    // (d) And the prediction holds: the real run it rehearsed succeeds.
    const real = runScript(LOAD_SCRIPT, [dumpPath, "--db", dbPath, "--replace"]);
    assert.equal(real.status, 0, real.out);
    assert.equal(snapshot(dbPath), before, "the rehearsed restore did not reproduce the dumped workspace");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
