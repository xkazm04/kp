#!/usr/bin/env node
// Dump the entire SQLite workspace (data/kp.sqlite — every table the app and its
// isolated stores create: pipeline, profiles, jobs, analyses, interviews, dev
// cases, offers, schedules, …) into ONE portable JSON file that db-load.mjs can
// restore on any machine.
//
//   node scripts/db-dump.mjs                       # → data/dumps/kp-dump-<timestamp>.json
//   node scripts/db-dump.mjs --out my-dump.json    # explicit output path
//   node scripts/db-dump.mjs --db path/to.sqlite   # dump a non-default workspace
//   node scripts/db-dump.mjs --skip gemini_cache,tasks
//   node scripts/db-dump.mjs --redact                 # blank every credential
//
// THIS FILE CARRIES CREDENTIALS. "Every table" means every table: the operator
// password hashes in `user_credentials`, the encrypted provider keys in
// `provider_keys`, calendar refresh tokens, invite and webhook tokens, and the
// whole ORG_CONFIG_NOT_PORTABLE set (the edge pairing's HMAC secret and sealing
// PRIVATE key among them). The output is one plain JSON file with no encryption
// and, until this header existed, no warning either — it was routinely handed
// around as "a copy of the demo data". An unredacted dump is a copy of the
// install's secrets and must be handled as one; the script now says so on stderr
// every time, names the tables it found, and creates the file 0600 (POSIX; on
// Windows the ACL is inherited and the mode is advisory).
//
// `--redact` produces the shareable variant: the schema, the row counts and the
// non-secret columns survive, every credential is replaced by a per-row
// `[redacted:table.column#n]` marker. A marker, not NULL and not a constant,
// because a NOT NULL or UNIQUE column has to keep restoring — a redacted dump is
// still a loadable dump, which is the only way anyone will actually use it.
//
// The dump carries each table's DDL (CREATE TABLE + its named indexes) alongside
// its rows, so a restore does NOT depend on the app having booted first — the
// loader recreates the schema exactly as dumped, and the app's own boot
// migrations then carry an older dump forward. Tables are discovered from
// sqlite_master at runtime, so a new store added to the app is picked up here
// with no change. Plain `node` + better-sqlite3 (already a dependency), no build
// step — same pattern as setup-eleven-agent.mjs.

import Database from "better-sqlite3";
import { mkdirSync, writeFileSync, existsSync } from "node:fs";
import path from "node:path";

// Keep in sync with app/_lib/db-path.ts (this script must stay runnable with
// bare `node`, so it can't import the TS module).
const DEFAULT_DB_PATH = process.env.KP_DB_PATH ?? path.join(process.cwd(), "data", "kp.sqlite");

export const DUMP_FORMAT = "kp-db-dump";
export const DUMP_VERSION = 1;

/** Mirror of ORG_CONFIG_NOT_PORTABLE in app/_lib/tenancy.ts — the singleton
 *  integration configs a restore already tells the operator to re-enter, every
 *  one of which is a URL plus a secret. This script runs under bare `node` and
 *  cannot import the TS module, so app/_lib/db/rollback-drill.test.ts asserts the
 *  two sets are identical; a table added there and not here would be dumped in
 *  the clear by a `--redact` run that reported itself clean. */
export const ORG_CONFIG_TABLES = new Set([
  "brand_settings",
  "ats_config",
  "ats_connections",
  "ats_delivery",
  "comms_relay_config",
  "personas_bridge",
  "edge_config",
]);

/** The credential stores ORG_CONFIG_NOT_PORTABLE does NOT name, because they are
 *  workspace-scoped data rather than singleton config: they move with a restore,
 *  which is exactly why a dump of them is a credential file. */
export const CREDENTIAL_TABLES = new Set([
  "user_credentials", // operator password hashes
  "provider_keys", // encrypted LLM/provider keys
  "calendar_connections", // OAuth refresh + access tokens
  "invites", // bearer tokens that grant a workspace role
  "channel_webhooks", // bearer tokens that accept inbound candidate traffic
  "login_attempts", // throttle ledger keyed by identifier
]);

/** Column names that carry a secret wherever they appear. Applied to EVERY table,
 *  so a new store that names its column `*_token` is redacted the day it lands
 *  rather than the day someone remembers to list the table. */
export const SECRET_COLUMN_RE =
  /(password|secret|token|api_key|key_ciphertext|ciphertext|private_jwk|hmac|credential)/i;

/** Which columns of one table a `--redact` dump must blank.
 *  `columns` is pragma_table_info output: `{ name, pk }`.
 *
 *  For a table in the two sets above, everything EXCEPT its primary key: those
 *  tables are wholly integration state, and keeping the key preserves the row
 *  count and the shape a restore needs. Everywhere else, only the columns whose
 *  NAME says secret. Pure, so the fixtures can read the answer off a schema. */
export function redactionPlan(table, columns) {
  const wholeTable = ORG_CONFIG_TABLES.has(table) || CREDENTIAL_TABLES.has(table);
  return new Set(
    columns.filter((c) => (wholeTable ? !c.pk : SECRET_COLUMN_RE.test(c.name))).map((c) => c.name)
  );
}

/** What a redacted cell becomes. Per-row and per-column so a UNIQUE or NOT NULL
 *  column still restores; NULL stays NULL, because "this install had no calendar
 *  token" is not a secret and flattening it would make the dump lie. */
export function redactedValue(table, column, rowIndex, original) {
  if (original === null || original === undefined) return original;
  return `[redacted:${table}.${column}#${rowIndex}]`;
}

function parseArgs(argv) {
  const args = { db: DEFAULT_DB_PATH, out: null, skip: new Set(), redact: false };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === "--db") args.db = argv[++i];
    else if (a === "--out") args.out = argv[++i];
    else if (a === "--redact") args.redact = true;
    else if (a === "--skip") for (const t of String(argv[++i]).split(",")) args.skip.add(t.trim());
    else {
      console.error(`Unknown argument: ${a}`);
      console.error("Usage: node scripts/db-dump.mjs [--db PATH] [--out PATH] [--skip table1,table2] [--redact]");
      process.exit(2);
    }
  }
  return args;
}

/** JSON-safe cell encoding. SQLite values are string/number/null in this schema;
 *  BLOBs (none today, but a future column must not silently corrupt) round-trip
 *  as a tagged base64 wrapper db-load.mjs decodes. */
function encodeCell(value) {
  if (Buffer.isBuffer(value)) return { $blob: value.toString("base64") };
  return value;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!existsSync(args.db)) {
    console.error(`No workspace database at ${args.db} — nothing to dump.`);
    console.error("Start the app once (npm run dev) or pass --db <path>.");
    process.exit(1);
  }
  const db = new Database(args.db, { readonly: true, fileMustExist: true });

  // Every user table; sqlite_* internals are never dumped. Named indexes ride
  // along per table (auto-created UNIQUE/PK indexes have NULL sql and are
  // recreated implicitly by the table DDL).
  const tables = db
    .prepare("SELECT name, sql FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name")
    .all();
  const indexStmt = db.prepare(
    "SELECT sql FROM sqlite_master WHERE type = 'index' AND tbl_name = ? AND sql IS NOT NULL ORDER BY name"
  );

  const dumped = [];
  const skipped = [];
  /** Every table/column pair a redaction WOULD touch, whether or not --redact was
   *  passed — this is what the warning names, so the operator is told which
   *  secrets are in the file rather than a generic "may contain credentials". */
  const sensitive = [];
  for (const t of tables) {
    if (args.skip.has(t.name)) {
      skipped.push(t.name);
      continue;
    }
    const columnInfo = db.prepare(`SELECT name, pk FROM pragma_table_info('${t.name}')`).all();
    const columns = columnInfo.map((c) => c.name);
    const plan = redactionPlan(t.name, columnInfo);
    if (plan.size) sensitive.push({ table: t.name, columns: [...plan] });
    const redactAt = columns.map((c) => args.redact && plan.has(c));
    const rows = db
      .prepare(`SELECT * FROM "${t.name}"`)
      .raw(true)
      .all()
      .map((row, rowIndex) =>
        row.map((cell, i) =>
          redactAt[i] ? redactedValue(t.name, columns[i], rowIndex, cell) : encodeCell(cell)
        )
      );
    dumped.push({
      name: t.name,
      ddl: t.sql,
      indexes: indexStmt.all(t.name).map((i) => i.sql),
      columns,
      rows,
    });
  }
  db.close();

  const out =
    args.out ??
    path.join(
      process.cwd(),
      "data",
      "dumps",
      `kp-dump-${new Date().toISOString().replace(/[:.]/g, "-")}.json`
    );
  mkdirSync(path.dirname(out), { recursive: true });
  const payload = {
    format: DUMP_FORMAT,
    version: DUMP_VERSION,
    createdAt: new Date().toISOString(),
    sourceDb: args.db,
    redacted: args.redact,
    tables: dumped,
  };
  // 0600 at creation: a dump lands in data/dumps/ beside the workspace and used
  // to inherit the directory's default mode. No-op on Windows (advisory only).
  writeFileSync(out, JSON.stringify(payload), { encoding: "utf-8", mode: 0o600 });

  const totalRows = dumped.reduce((n, t) => n + t.rows.length, 0);
  console.log(`Dumped ${dumped.length} table(s), ${totalRows} row(s) from ${args.db}`);
  for (const t of dumped) console.log(`  ${t.name.padEnd(22)} ${String(t.rows.length).padStart(7)} rows`);
  if (skipped.length) console.log(`Skipped: ${skipped.join(", ")}`);
  console.log(`→ ${out}`);

  // The warning is the point of the whole flag: an operator who has never read
  // this file must not be able to produce a credential dump without being told.
  const rowsOf = (name) => dumped.find((t) => t.name === name)?.rows.length ?? 0;
  const withRows = sensitive.filter((x) => rowsOf(x.table) > 0);
  if (args.redact) {
    console.log(
      `Redacted ${sensitive.length} table(s): ${sensitive.map((x) => x.table).join(", ") || "none"} — ` +
        `every credential column is a [redacted:table.column#n] marker. The file still restores.`
    );
  } else if (withRows.length) {
    console.error("");
    console.error(`WARNING: this dump contains CREDENTIALS IN THE CLEAR, from ${withRows.length} table(s):`);
    for (const x of withRows) console.error(`  ${x.table.padEnd(22)} ${x.columns.join(", ")}`);
    console.error(
      "It is a plain, unencrypted JSON copy of this install's secrets. Do not mail it, attach it to an"
    );
    console.error("issue, or commit it. Re-run with --redact for a shareable dump that still restores.");
  }
}

// Only dump when invoked as a script: app/_lib/db/rollback-drill.test.ts imports
// this module to assert ORG_CONFIG_TABLES still mirrors ORG_CONFIG_NOT_PORTABLE,
// and an import must not open a database or write a file.
if (process.argv[1]?.endsWith("db-dump.mjs")) main();
