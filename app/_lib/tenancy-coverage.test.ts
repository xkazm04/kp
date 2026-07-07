import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { TENANCY_SCOPED_TABLES, TENANCY_EXEMPT_TABLES, TENANCY_LAZY_TABLES } from "./tenancy.ts";

// Manifest completeness (P1) — closes the boot-guard LAZY-STORE-TABLE HOLE statically.
// assertTenancyReady reads the LIVE sqlite_master list, but ~22 tables are created on
// their OWN connections (openStore) and don't exist until their store is first touched,
// so at first boot the guard sees an INCOMPLETE schema — an unscoped lazy table could
// slip past. Two guards remove the timing dependency entirely:
//   1. every table the codebase can CREATE is classified (scoped ∪ exempt), and
//   2. TENANCY_LAZY_TABLES (which the guard unions into its check) exactly equals the
//      source's lazy-store CREATEs, so the runtime enumeration can never drift.
// A new table — lazy or not — fails CI until it is both classified AND (if lazy) listed.

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

// Only real, persisted tables (CREATE TABLE IF NOT EXISTS <name>). The composite-PK
// rebuilds use `CREATE TABLE <name>_new (...)` (no IF NOT EXISTS) — transient scratch
// tables renamed to the base name — so they never match this pattern.
const CREATE = /CREATE TABLE IF NOT EXISTS\s+([a-z_]+)/gi;

const libDir = path.dirname(fileURLToPath(import.meta.url));
const coreFile = path.resolve(libDir, "db", "core.ts");

const declared = new Set<string>(); // every table any source file CREATEs
const coreTables = new Set<string>(); // created by db/core.ts (present at boot)
const lazyDerived = new Set<string>(); // created on an own connection (openStore)

for (const f of walk(libDir)) {
  const src = readFileSync(f, "utf8");
  const tables = [...src.matchAll(CREATE)].map((m) => m[1]);
  for (const t of tables) declared.add(t);
  if (path.resolve(f) === coreFile) {
    for (const t of tables) coreTables.add(t);
  } else if (/\bopenStore\b/.test(src)) {
    for (const t of tables) lazyDerived.add(t);
  }
}
// A table is "lazy" only if NO eager (core.ts) CREATE also makes it at boot — e.g.
// job-ingest.ts mirrors `jobs` (eager) but uniquely owns `job_ingests` (lazy).
for (const t of coreTables) lazyDerived.delete(t);

test("every table the codebase declares is classified in the tenancy manifest (scoped ∪ exempt)", () => {
  assert.ok(declared.size >= 40, `expected to scan the whole schema, only found ${declared.size} tables`);
  const unclassified = [...declared]
    .filter((t) => !TENANCY_SCOPED_TABLES.has(t) && !TENANCY_EXEMPT_TABLES.has(t))
    .sort();
  assert.deepEqual(
    unclassified,
    [],
    `these declared tables are neither scoped nor exempt (the boot guard would miss the lazy ones):\n  ${unclassified.join("\n  ")}`
  );
});

test("TENANCY_LAZY_TABLES exactly matches the source's own-connection CREATEs (runtime enumeration can't drift)", () => {
  assert.ok(lazyDerived.size >= 15, `expected to find the lazy-store tables, only found ${lazyDerived.size}`);
  assert.deepEqual(
    [...TENANCY_LAZY_TABLES].sort(),
    [...lazyDerived].sort(),
    "TENANCY_LAZY_TABLES is out of sync with the lazy-store CREATE tables — assertTenancyReady would under- or over-count at boot"
  );
});
