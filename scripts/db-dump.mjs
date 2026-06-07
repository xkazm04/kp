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

function parseArgs(argv) {
  const args = { db: DEFAULT_DB_PATH, out: null, skip: new Set() };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === "--db") args.db = argv[++i];
    else if (a === "--out") args.out = argv[++i];
    else if (a === "--skip") for (const t of String(argv[++i]).split(",")) args.skip.add(t.trim());
    else {
      console.error(`Unknown argument: ${a}`);
      console.error("Usage: node scripts/db-dump.mjs [--db PATH] [--out PATH] [--skip table1,table2]");
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
  for (const t of tables) {
    if (args.skip.has(t.name)) {
      skipped.push(t.name);
      continue;
    }
    const columns = db.prepare(`SELECT name FROM pragma_table_info('${t.name}')`).all().map((c) => c.name);
    const rows = db
      .prepare(`SELECT * FROM "${t.name}"`)
      .raw(true)
      .all()
      .map((row) => row.map(encodeCell));
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
    tables: dumped,
  };
  writeFileSync(out, JSON.stringify(payload), "utf-8");

  const totalRows = dumped.reduce((n, t) => n + t.rows.length, 0);
  console.log(`Dumped ${dumped.length} table(s), ${totalRows} row(s) from ${args.db}`);
  for (const t of dumped) console.log(`  ${t.name.padEnd(22)} ${String(t.rows.length).padStart(7)} rows`);
  if (skipped.length) console.log(`Skipped: ${skipped.join(", ")}`);
  console.log(`→ ${out}`);
}

main();
