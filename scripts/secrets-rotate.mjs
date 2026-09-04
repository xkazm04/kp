#!/usr/bin/env node
// Re-encrypt every at-rest secret in the workspace DB under the CURRENT KP_SECRET.
//
//   KP_SECRET_PREVIOUS=<old> KP_SECRET=<new> npm run secrets:rotate
//   ... npm run secrets:rotate -- --dry-run          # report, write nothing
//   ... npm run secrets:rotate -- --db path/to.sqlite
//
// WHY THIS EXISTS. Provider keys, ATS/webhook secrets, calendar tokens and the
// edge sealing key are all stored AES-256-GCM encrypted under KP_SECRET
// (app/_lib/llm-secret.ts, app/_lib/ats-secret.ts — same "v1:<iv>:<tag>:<data>"
// envelope, same sha256(secret) key derivation). Rotating that secret therefore
// used to brick every one of them at once, and the only recovery was re-entering
// each credential by hand. With `KP_SECRET_PREVIOUS` set, decryption falls back to
// the retired secret, so the deploy keeps working; this script then walks the
// stored rows and rewrites each one under the new secret, after which
// KP_SECRET_PREVIOUS can be unset. Rotation becomes a no-op instead of an outage.
//
// SAFETY. A row is only rewritten when it DECRYPTS first — a value we cannot read
// is reported and left exactly as it was, because overwriting it would destroy the
// only copy of that credential. Rows already under the current secret are skipped,
// so re-running after an interruption is safe and idempotent. Everything happens in
// one synchronous better-sqlite3 transaction per table (no awaits inside — see the
// transaction rule in .claude/CLAUDE.md).
//
// Plain `node` + better-sqlite3 (already a dependency), importing the TS crypto
// module directly under Node's type stripping so there is exactly ONE
// implementation of the envelope. Not a CI gate — an operator command.

import Database from "better-sqlite3";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { existsSync } from "node:fs";
import {
  isProviderSecretCiphertext,
  reencryptProviderSecret,
} from "../app/_lib/llm-secret.ts";

// Keep in sync with app/_lib/db-path.ts (this script must stay runnable with bare
// `node`, so it can't import the Next-aliased TS module) — same note as db-dump.mjs.
const DEFAULT_DB_PATH = process.env.KP_DB_PATH ?? path.join(process.cwd(), "data", "kp.sqlite");

/**
 * Every column holding a secret encrypted under a master secret, and WHICH master
 * secret keys it. `KP_SECRET` columns always rotate with KP_SECRET. The `ats`
 * columns are keyed on KP_ATS_SECRET_KEY *falling back to* KP_SECRET
 * (app/_lib/ats-secret.ts), so they are only affected by — and only rotated by —
 * a KP_SECRET rotation when that dedicated key is unset.
 *
 * A table or column this list names but the DB does not have is skipped silently:
 * the schema is created lazily per store, so a deployment that never configured a
 * calendar simply has no `calendar_connections`.
 */
export const SECRET_COLUMNS = [
  { table: "provider_keys", column: "key_ciphertext", keyedBy: "KP_SECRET" },
  { table: "personas_bridge", column: "api_key", keyedBy: "ats" },
  { table: "ats_connections", column: "api_token", keyedBy: "ats" },
  { table: "ats_config", column: "webhook_secret", keyedBy: "ats" },
  { table: "calendar_connections", column: "access_token", keyedBy: "ats" },
  { table: "calendar_connections", column: "refresh_token", keyedBy: "ats" },
  { table: "comms_relay_config", column: "relay_secret", keyedBy: "ats" },
  { table: "channel_webhooks", column: "pull_secret", keyedBy: "ats" },
  { table: "edge_config", column: "edge_secret", keyedBy: "ats" },
  { table: "edge_config", column: "private_jwk", keyedBy: "ats" },
];

function hasColumn(db, table, column) {
  const tableExists = db
    .prepare(`SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?`)
    .get(table);
  if (!tableExists) return false;
  return db.prepare(`PRAGMA table_info(${table})`).all().some((c) => c.name === column);
}

/**
 * Rotate one column. Returns { scanned, rewritten, skipped, unreadable } — the
 * caller prints them; nothing here logs a secret or any part of one.
 */
export function rotateColumn(db, table, column, { dryRun = false } = {}) {
  const stats = { table, column, scanned: 0, rewritten: 0, skipped: 0, unreadable: 0 };
  if (!hasColumn(db, table, column)) return { ...stats, missing: true };
  const rows = db.prepare(`SELECT rowid AS rid, ${column} AS value FROM ${table}`).all();
  const update = db.prepare(`UPDATE ${table} SET ${column} = ? WHERE rowid = ?`);
  const pending = [];
  for (const row of rows) {
    stats.scanned += 1;
    const value = row.value;
    // Nulls, blanks and pre-encryption plaintext are not our envelope: leave them.
    if (typeof value !== "string" || !value || !isProviderSecretCiphertext(value)) {
      stats.skipped += 1;
      continue;
    }
    try {
      const next = reencryptProviderSecret(value);
      if (next.changed) pending.push([next.ciphertext, row.rid]);
      else stats.skipped += 1;
    } catch {
      // Neither KP_SECRET nor KP_SECRET_PREVIOUS opens this row. Counted and
      // reported (the exit code turns red), never rewritten: an unreadable row is
      // still the only copy of that credential, and the operator may just have the
      // wrong KP_SECRET_PREVIOUS set.
      stats.unreadable += 1;
    }
  }
  if (!dryRun && pending.length) {
    // Synchronous by construction — better-sqlite3 transactions must never await.
    db.transaction((writes) => {
      for (const [ciphertext, rid] of writes) update.run(ciphertext, rid);
    }).immediate(pending);
  }
  stats.rewritten = pending.length;
  return stats;
}

/** Rotate every declared column in one DB. `db` is an open better-sqlite3 handle. */
export function rotateDatabaseSecrets(db, { dryRun = false, env = process.env } = {}) {
  // A dedicated KP_ATS_SECRET_KEY means those columns are NOT under KP_SECRET, so a
  // KP_SECRET rotation neither breaks nor needs to touch them.
  const atsDecoupled = Boolean(env.KP_ATS_SECRET_KEY?.trim());
  const results = [];
  for (const spec of SECRET_COLUMNS) {
    if (spec.keyedBy === "ats" && atsDecoupled) continue;
    results.push(rotateColumn(db, spec.table, spec.column, { dryRun }));
  }
  return { atsDecoupled, results };
}

function parseArgs(argv) {
  const args = { db: DEFAULT_DB_PATH, dryRun: false };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === "--db") args.db = argv[++i];
    else if (a === "--dry-run") args.dryRun = true;
    else {
      console.error(`Unknown argument: ${a}`);
      console.error("Usage: node scripts/secrets-rotate.mjs [--db PATH] [--dry-run]");
      process.exit(2);
    }
  }
  return args;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!process.env.KP_SECRET?.trim()) {
    console.error("KP_SECRET is not set — set the NEW secret before rotating.");
    process.exit(2);
  }
  if (!process.env.KP_SECRET_PREVIOUS?.trim()) {
    console.error(
      "KP_SECRET_PREVIOUS is not set. Rotation reads every stored row with the retired\n" +
        "secret and rewrites it under the current one, so both must be present for this run."
    );
    process.exit(2);
  }
  if (!existsSync(args.db)) {
    console.error(`No database at ${args.db} (set KP_DB_PATH or pass --db).`);
    process.exit(2);
  }
  const db = new Database(args.db);
  try {
    const { atsDecoupled, results } = rotateDatabaseSecrets(db, { dryRun: args.dryRun });
    let rewritten = 0;
    let unreadable = 0;
    for (const r of results) {
      if (r.missing) continue;
      rewritten += r.rewritten;
      unreadable += r.unreadable;
      console.log(
        `${r.table}.${r.column}: ${r.scanned} scanned, ${r.rewritten} re-encrypted, ` +
          `${r.skipped} already current, ${r.unreadable} unreadable`
      );
    }
    if (atsDecoupled) {
      console.log("KP_ATS_SECRET_KEY is set — ATS / calendar / edge secrets are keyed on it and were not touched.");
    }
    console.log(
      args.dryRun
        ? `DRY RUN: ${rewritten} row(s) would be re-encrypted.`
        : `Done: ${rewritten} row(s) re-encrypted under the current KP_SECRET.`
    );
    if (unreadable) {
      console.error(
        `${unreadable} row(s) opened with NEITHER secret and were left untouched — check that ` +
          "KP_SECRET_PREVIOUS is the secret those rows were written under."
      );
      process.exitCode = 1;
      return;
    }
    if (!args.dryRun) console.log("You can now unset KP_SECRET_PREVIOUS and restart.");
  } finally {
    db.close();
  }
}

// Only run when invoked directly, so the tests can import the engine above.
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main();
}
