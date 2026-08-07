import { test, beforeEach, after } from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import fs from "node:fs";
import { registerHooks } from "node:module";
import { fileURLToPath } from "node:url";
import Database from "better-sqlite3";

// idea-83614939 — markEntryStatus (the decline-path status write) must be
// CONDITIONAL: a decline click on a stale/duplicate offer link can target an entry
// the candidate has since been Hired into (or that is already closed out), and an
// unconditional UPDATE silently demoted them to a terminal status. These tests pin
// the WHERE guard against a throwaway SQLite file, loading the REAL offers-store so
// a copied-out gate can't drift from the module itself.

// offers-store transitively imports extensionless TS siblings (./db-path,
// ./random-id, ./pipeline-status, ./pipeline-stages) — how Next/tsc resolve, but not
// the bare `node --test` runner. Install the same minimal resolve hook the other
// real-module tests use (see automation-fairness.test.ts): rewrite a relative,
// extensionless specifier to its .ts file; bare specifiers (better-sqlite3, node:*)
// pass through. Scoped to this file's process (node --test isolates files).
registerHooks({
  resolve(specifier, context, nextResolve) {
    let spec = specifier;
    if ((spec.startsWith("./") || spec.startsWith("../")) && context.parentURL) {
      spec = new URL(spec, context.parentURL).href; // relative -> file: so we can test for .ts
    }
    if (spec.startsWith("file:") && !/\.[a-z0-9]+$/i.test(spec) && fs.existsSync(fileURLToPath(spec + ".ts"))) {
      spec += ".ts"; // extensionless import, e.g. "./db-path"
    }
    return nextResolve(spec, context);
  },
});

// Point every store at a throwaway DB BEFORE importing offers-store: db-path reads
// KP_DB_PATH at module load. markEntryStatus opens its connection lazily, so the
// override is in force by the time it first runs. node --test isolates each test
// file in its own process, so this env mutation can't leak to the pure tests.
const TMP = path.join(os.tmpdir(), `kp-offers-store-test-${process.pid}.sqlite`);
process.env.KP_DB_PATH = TMP;

const { markEntryStatus } = await import("./offers-store.ts");

// markEntryStatus writes pipeline_entries (owned by db.ts), which offers-store's own
// db() never creates. Seed a minimal table with just the columns the guard reads /
// writes, via a separate connection on the same WAL file — exactly how the store and
// db.ts share kp.sqlite at runtime.
function seed(rows: Array<{ id: string; status: string; stage: string }>): void {
  const d = new Database(TMP);
  d.exec(`CREATE TABLE IF NOT EXISTS pipeline_entries (
    id TEXT PRIMARY KEY, status TEXT NOT NULL DEFAULT 'active', stage TEXT NOT NULL, updated_at TEXT,
    workspace_id TEXT NOT NULL DEFAULT 'workspace'
  );`);
  d.prepare(`DELETE FROM pipeline_entries`).run();
  const ins = d.prepare(`INSERT INTO pipeline_entries (id, status, stage, updated_at) VALUES (?, ?, ?, 't0')`);
  for (const r of rows) ins.run(r.id, r.status, r.stage);
  d.close();
}

function read(id: string): { status: string; stage: string; updated_at: string } | undefined {
  const d = new Database(TMP);
  const r = d.prepare(`SELECT status, stage, updated_at FROM pipeline_entries WHERE id = ?`).get(id) as
    | { status: string; stage: string; updated_at: string }
    | undefined;
  d.close();
  return r;
}

/** Run `fn` with console.warn captured, so we can assert the guard logs (and keep
 *  the expected warnings out of the test output). */
function withCapturedWarn<T>(fn: () => T): { ret: T; warnings: string[] } {
  const orig = console.warn;
  const warnings: string[] = [];
  console.warn = (...args: unknown[]) => void warnings.push(args.join(" "));
  try {
    return { ret: fn(), warnings };
  } finally {
    console.warn = orig;
  }
}

beforeEach(() => {
  seed([
    { id: "e_offer", status: "active", stage: "Offer" }, // live, mid-offer — the legit decline
    { id: "e_hired", status: "active", stage: "Hired" }, // accepted another offer — the headline bug
    { id: "e_rejected", status: "rejected", stage: "Offer" }, // company already passed
    { id: "e_declined", status: "declined", stage: "Offer" }, // already declined (re-decline)
  ]);
});

after(() => {
  // Best-effort: the store's connection is still open (no close hook); on Windows an
  // open SQLite file can't be unlinked, so swallow the error — the temp file is
  // disposable and the process exits next.
  for (const f of [TMP, `${TMP}-wal`, `${TMP}-shm`]) {
    try {
      fs.rmSync(f, { force: true });
    } catch {
      /* file locked / absent — fine */
    }
  }
});

test("transitions a live, mid-offer entry to declined (the legit path)", () => {
  const ok = markEntryStatus("e_offer", "declined");
  assert.equal(ok, true);
  const row = read("e_offer");
  assert.equal(row?.status, "declined");
  assert.equal(row?.stage, "Offer"); // stage untouched; only status flips
  assert.notEqual(row?.updated_at, "t0"); // updated_at was stamped
});

test("does NOT demote a Hired candidate (status active, stage Hired)", () => {
  const { ret: ok, warnings } = withCapturedWarn(() => markEntryStatus("e_hired", "declined"));
  assert.equal(ok, false);
  const row = read("e_hired");
  assert.equal(row?.status, "active"); // still hired — not flipped to declined
  assert.equal(row?.stage, "Hired");
  assert.equal(row?.updated_at, "t0"); // no write happened at all
  assert.ok(
    warnings.some((w) => w.includes("e_hired") && w.includes("blocked")),
    "guard should log the blocked write"
  );
});

test("does not re-close an already-rejected entry", () => {
  const { ret: ok } = withCapturedWarn(() => markEntryStatus("e_rejected", "declined"));
  assert.equal(ok, false);
  assert.equal(read("e_rejected")?.status, "rejected"); // company-side close preserved
});

test("a second decline on an already-declined entry is a guarded no-op", () => {
  const { ret: ok } = withCapturedWarn(() => markEntryStatus("e_declined", "declined"));
  assert.equal(ok, false);
  assert.equal(read("e_declined")?.status, "declined");
});

test("a missing entry returns false and does not throw", () => {
  const { ret: ok } = withCapturedWarn(() => markEntryStatus("does_not_exist", "declined"));
  assert.equal(ok, false);
});
