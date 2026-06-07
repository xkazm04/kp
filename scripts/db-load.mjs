#!/usr/bin/env node
// Load (upload/seed/restore) a db-dump.mjs JSON dump into the SQLite workspace.
//
//   node scripts/db-load.mjs data/dumps/kp-dump-….json              # into data/kp.sqlite
//   node scripts/db-load.mjs dump.json --replace                    # overwrite non-empty tables
//   node scripts/db-load.mjs dump.json --db path/to.sqlite          # into a non-default workspace
//
// Semantics — deliberately conservative so a restore can't half-eat a live
// workspace:
//   * Missing or EMPTY tables are always (re)created from the dump's DDL and
//     filled — so seeding a fresh checkout needs no flag at all.
//   * A table that already HAS rows is only touched with --replace, and the
//     check runs over the WHOLE dump up front: without --replace either every
//     table loads or nothing does (no partial restore).
//   * --replace drops the table (and its named indexes) and recreates it from
//     the dump's DDL, so the restored schema is exactly the dumped one; the
//     app's own boot migrations (ALTER-if-missing in db.ts and the stores)
//     then carry an OLDER dump forward to the current schema on next start.
//   * Everything runs in one transaction — an error rolls the whole load back.

import Database from "better-sqlite3";
import { readFileSync, existsSync, mkdirSync } from "node:fs";
import path from "node:path";

// Keep in sync with app/_lib/db-path.ts (bare-`node` script, can't import TS).
const DEFAULT_DB_PATH = process.env.KP_DB_PATH ?? path.join(process.cwd(), "data", "kp.sqlite");

const DUMP_FORMAT = "kp-db-dump";
const DUMP_VERSION = 1;

function parseArgs(argv) {
  const args = { db: DEFAULT_DB_PATH, dump: null, replace: false };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === "--db") args.db = argv[++i];
    else if (a === "--replace") args.replace = true;
    else if (!a.startsWith("--") && !args.dump) args.dump = a;
    else {
      console.error(`Unknown argument: ${a}`);
      console.error("Usage: node scripts/db-load.mjs <dump.json> [--db PATH] [--replace]");
      process.exit(2);
    }
  }
  if (!args.dump) {
    console.error("Usage: node scripts/db-load.mjs <dump.json> [--db PATH] [--replace]");
    process.exit(2);
  }
  return args;
}

/** Inverse of db-dump.mjs encodeCell: revive tagged BLOB wrappers. */
function decodeCell(value) {
  if (value && typeof value === "object" && typeof value.$blob === "string") {
    return Buffer.from(value.$blob, "base64");
  }
  return value;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!existsSync(args.dump)) {
    console.error(`Dump file not found: ${args.dump}`);
    process.exit(1);
  }
  const payload = JSON.parse(readFileSync(args.dump, "utf-8"));
  if (payload.format !== DUMP_FORMAT || payload.version !== DUMP_VERSION) {
    console.error(
      `Not a ${DUMP_FORMAT} v${DUMP_VERSION} file (got format=${payload.format}, version=${payload.version}).`
    );
    process.exit(1);
  }

  mkdirSync(path.dirname(args.db), { recursive: true });
  const db = new Database(args.db);
  // Same pragmas the app uses, so a load against a workspace an app instance
  // still has open waits instead of instantly failing on SQLITE_BUSY.
  db.pragma("journal_mode = WAL");
  db.pragma("busy_timeout = 5000");

  const tableExists = db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?");

  // Up-front safety sweep: no row is written unless EVERY populated table was
  // explicitly authorized with --replace.
  const populated = payload.tables.filter((t) => {
    if (!tableExists.get(t.name)) return false;
    return db.prepare(`SELECT COUNT(*) AS n FROM "${t.name}"`).get().n > 0;
  });
  if (populated.length > 0 && !args.replace) {
    console.error("Refusing to load: these tables already contain rows —");
    for (const t of populated) console.error(`  ${t.name}`);
    console.error("Re-run with --replace to drop and restore them (the dump wins), or load into a fresh --db path.");
    process.exit(1);
  }

  const loadAll = db.transaction(() => {
    const summary = [];
    for (const t of payload.tables) {
      // Drop-and-recreate gives the dump's exact schema for empty/replaced
      // tables; named indexes are dropped with the table and re-run from the dump.
      if (tableExists.get(t.name)) db.exec(`DROP TABLE "${t.name}"`);
      db.exec(t.ddl);
      for (const indexDdl of t.indexes ?? []) db.exec(indexDdl);

      if (t.rows.length > 0) {
        const placeholders = t.columns.map(() => "?").join(", ");
        const insert = db.prepare(
          `INSERT INTO "${t.name}" (${t.columns.map((c) => `"${c}"`).join(", ")}) VALUES (${placeholders})`
        );
        for (const row of t.rows) insert.run(...row.map(decodeCell));
      }
      summary.push({ name: t.name, rows: t.rows.length });
    }
    return summary;
  });

  const summary = loadAll();
  db.close();

  const totalRows = summary.reduce((n, t) => n + t.rows, 0);
  console.log(`Loaded ${summary.length} table(s), ${totalRows} row(s) into ${args.db}`);
  for (const t of summary) console.log(`  ${t.name.padEnd(22)} ${String(t.rows).padStart(7)} rows`);
  console.log("Done. The app's boot migrations will carry an older dump forward on next start.");
}

main();
