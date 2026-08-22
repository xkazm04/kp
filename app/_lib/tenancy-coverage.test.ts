import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import {
  TENANCY_SCOPED_TABLES,
  TENANCY_EXEMPT_TABLES,
  TENANCY_LAZY_TABLES,
  TENANCY_RETIRED_TABLES,
  ORG_CONFIG_NOT_PORTABLE,
  orgExportClass,
} from "./tenancy.ts";

// Manifest completeness (P1) — closes the boot-guard LAZY-STORE-TABLE HOLE statically.
// assertTenancyReady reads the LIVE sqlite_master list, but ~22 tables are created on
// their OWN connections (openStore) and don't exist until their store is first touched,
// so at first boot the guard sees an INCOMPLETE schema — an unscoped lazy table could
// slip past. Two guards remove the timing dependency entirely:
//   1. every table the codebase can CREATE is classified (scoped ∪ exempt), and
//   2. TENANCY_LAZY_TABLES (which the guard unions into its check) exactly equals the
//      source's lazy-store CREATEs, so the runtime enumeration can never drift.
// A new table — lazy or not — fails CI until it is both classified AND (if lazy) listed.
//
// WHAT THIS FILE DOES **NOT** DO — read this before assuming it caught something.
// It inspects no SQL. It answers "is every table CLASSIFIED, exportable, and PROVEN
// somewhere", not "is this statement scoped". Per-statement read+write scoping is proven
// by the per-table `*-tenancy.test.ts` guards, and each of those owns its own by-id /
// by-token exemptions (a candidate capability token, a globally-unique PK). So a table
// can sit in TENANCY_SCOPED_TABLES, pass every assertion here, and still carry an
// unscoped point-op that its own guard deliberately excluded — that is a judgement call
// in THAT guard, not a hole here. What WAS a hole here: nothing checked that a scoped
// table had a query-level proof at all (five had none), which the last test below fixes.

function walk(dir: string, out: string[] = [], match: (name: string) => boolean = (n) => n.endsWith(".ts") && !n.endsWith(".test.ts")): string[] {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (e.name !== "node_modules") walk(p, out, match);
    } else if (match(e.name)) {
      out.push(p);
    }
  }
  return out;
}

// Only real, persisted tables (CREATE TABLE IF NOT EXISTS <name> **(**). The composite-PK
// rebuilds use `CREATE TABLE <name>_new (...)` (no IF NOT EXISTS) — transient scratch
// tables renamed to the base name — so they never match this pattern.
//
// The trailing `\(` and stripComments() below are load-bearing, not tidiness: the pattern
// used to scan raw file text and harvest ENGLISH PROSE. `app/_lib/auth/login-throttle.ts`
// explains a migration with "…because CREATE TABLE IF NOT EXISTS cannot alter an existing
// table", which declared a table named `cannot` — enough to fail all three assertions
// below at once (it also matched that file's `openStore`, so it landed in the lazy set
// too). A phantom name reads exactly like a real unclassified table, and the quickest way
// to green is the one thing tenancy.ts forbids: dropping a fictional entry into
// TENANCY_EXEMPT_TABLES. Every real CREATE is followed by its column list, and no CREATE
// lives in a comment, so requiring both costs nothing and cannot be tripped by prose.
const CREATE = /CREATE TABLE IF NOT EXISTS\s+([a-z_]+)\s*\(/gi;

/** Drop JS/TS comments so only executable source is scanned. Purely subtractive — it
 *  can never synthesize a CREATE that wasn't there — and the `declared`/`lazyDerived`
 *  size floors below catch it if it ever over-strips. */
function stripComments(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/(^|[^:'"`\\])\/\/[^\n]*/gm, "$1");
}

const libDir = path.dirname(fileURLToPath(import.meta.url));
const appDir = path.resolve(libDir, "..");
const coreFile = path.resolve(libDir, "db", "core.ts");

const declared = new Set<string>(); // every table any source file CREATEs
const coreTables = new Set<string>(); // created by db/core.ts (present at boot)
const lazyDerived = new Set<string>(); // created on an own connection (openStore)

for (const f of walk(libDir)) {
  const src = stripComments(readFileSync(f, "utf8"));
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

test("every table the codebase declares is classified in the tenancy manifest (scoped ∪ exempt ∪ retired)", () => {
  assert.ok(declared.size >= 40, `expected to scan the whole schema, only found ${declared.size} tables`);
  // Retired counts as classified: a table no current code path reads or writes cannot
  // leak across tenants, and it is named in its own set precisely so "inert" is never
  // mistaken for "verified". Leaving it out here would fail the build for a table a
  // removed feature left behind in existing databases.
  const unclassified = [...declared]
    .filter((t) => !TENANCY_SCOPED_TABLES.has(t) && !TENANCY_EXEMPT_TABLES.has(t) && !TENANCY_RETIRED_TABLES.has(t))
    .sort();
  assert.deepEqual(
    unclassified,
    [],
    `these declared tables are neither scoped nor exempt (the boot guard would miss the lazy ones):\n  ${unclassified.join("\n  ")}`
  );
});

test("every declared table has an ORG EXPORT class — a new table is never dumped on a guess", () => {
  // dumpOrg is driven by this manifest rather than by sqlite_master, precisely so a
  // table nobody classified cannot be swept into a customer's backup by default. The
  // classes derive from the two sets above (scoped ⇒ "workspace", exempt ⇒ "exclude"),
  // so this only fails for a table whose export rule genuinely needs a decision — and
  // then it fails HERE, in CI, instead of by leaking or by silently omitting somebody's
  // data. Add it to ORG_EXPORT_OVERRIDES with the reasoning.
  const unclassified = [...declared].filter((t) => orgExportClass(t) === null).sort();
  assert.deepEqual(
    unclassified,
    [],
    `these tables have no org-export class (dumpOrg would silently skip them):\n  ${unclassified.join("\n  ")}`
  );
});

test("the six non-portable config tables are excluded from the export, not merely documented", () => {
  // ORG_CONFIG_NOT_PORTABLE is what the restore REPORTS to the operator. If one of
  // those tables were also classified as carryable, the file would contain rows the
  // summary promises are absent — a documented gap that isn't the real behaviour.
  for (const table of ORG_CONFIG_NOT_PORTABLE) {
    assert.equal(orgExportClass(table), "exclude", `${table} is named as not portable, so it must not be exported`);
  }
});

test("TENANCY_LAZY_TABLES exactly matches the source's own-connection CREATEs (runtime enumeration can't drift)", () => {
  assert.ok(lazyDerived.size >= 15, `expected to find the lazy-store tables, only found ${lazyDerived.size}`);
  assert.deepEqual(
    [...TENANCY_LAZY_TABLES].sort(),
    [...lazyDerived].sort(),
    "TENANCY_LAZY_TABLES is out of sync with the lazy-store CREATE tables — assertTenancyReady would under- or over-count at boot"
  );
});

// ---- PROOF COVERAGE --------------------------------------------------------
//
// tenancy.ts states the rule that makes membership of TENANCY_SCOPED_TABLES mean
// anything: "A table counts as 'scoped' only when its read AND write paths are verified
// to filter on workspace_id — proven by a colocated `*-tenancy.test.ts`." Nothing checked
// that claim, and it was false for FIVE of the 44 entries — candidate_nps, outreach_state,
// ats_links, calendar_connections and apply_sessions had no query-level tenancy proof
// anywhere in app/. Their SQL happens to be correctly scoped today (pinned below), but the
// manifest was reporting "verified" on an unverified promise, and membership is exactly
// what lets assertTenancyReady wave KP_MULTI_WORKSPACE through. Adding a table to the
// scoped list is now only possible alongside a proof.

/** Files that pin a table's SQL. Excludes tenancy.test.ts (pure manifest LOGIC — its
 *  synthetic fixtures name real tables like "analyses"/"jobs" incidentally, so counting
 *  it would hand five tables a proof they don't have) and this file's own name. */
const proofFiles = walk(appDir, [], (n) => n.includes("tenancy") && n.endsWith(".test.ts")).filter(
  (f) => !/(^|[\\/])(tenancy|tenancy-coverage|route-tenancy-coverage)\.test\.ts$/.test(f)
);
const proofText = new Map(proofFiles.map((f) => [path.relative(appDir, f), readFileSync(f, "utf8")]));

/** Scoped tables whose proof lives HERE because no colocated guard was ever written for
 *  them. A pin asserts the same thing a sibling guard does: every statement touching the
 *  table BINDS workspace_id. Writing a real `<store>-tenancy.test.ts` and deleting the
 *  entry is the preferred end state — this list should only ever shrink. */
const ORPHAN_PINS: { table: string; source: string; exempt?: RegExp; why?: string }[] = [
  { table: "candidate_nps", source: "candidate-nps-store.ts" },
  { table: "outreach_state", source: "outreach-state-store.ts" },
  { table: "ats_links", source: path.join("ats", "links-store.ts") },
  { table: "calendar_connections", source: path.join("calendar", "token-store.ts") },
  {
    table: "apply_sessions",
    source: "apply-session-store.ts",
    // The one exemption tenancy.ts already spells out: "the back-link write is by the
    // session's own client-generated PK, which carries no tenant meaning and grants
    // nothing". Pinned as a literal so widening it to any `id = ?` write is a diff.
    exempt: /^\s*UPDATE\s+apply_sessions\s+SET\s+entry_id\s*=\s*\?\s+WHERE\s+id\s*=\s*\?\s+AND\s+entry_id\s+IS\s+NULL\s*$/i,
    why: "back-link write keyed by the client-generated apply-session PK",
  },
];

/** workspace_id must be BOUND — a predicate (`= ?` / `IN` / `IS`) or an INSERT column —
 *  never merely mentioned. A bare /workspace_id/ match is satisfied by a SELECT-list
 *  column name, which is the hollow-guard shape this sweep keeps finding. */
function bindsWorkspace(sql: string): boolean {
  if (/workspace_id\s*(=|IN\b|IS\b)/i.test(sql)) return true;
  return /INSERT\s+INTO\s+[a-z_]+\s*\([^)]*\bworkspace_id\b[^)]*\)/i.test(sql);
}

test("every workspace-scoped table has a query-level tenancy proof (the manifest's own rule, now enforced)", () => {
  assert.ok(proofText.size >= 40, `expected to find the per-table tenancy guards, only found ${proofText.size}`);
  const pinned = new Set(ORPHAN_PINS.map((p) => p.table));
  for (const t of pinned) {
    assert.ok(TENANCY_SCOPED_TABLES.has(t), `${t} is pinned here but is no longer a scoped table — drop the stale pin`);
  }
  const unproven = [...TENANCY_SCOPED_TABLES]
    .filter((t) => !pinned.has(t) && ![...proofText.values()].some((s) => new RegExp(`(^|[^a-z_])${t}([^a-z_]|$)`).test(s)))
    .sort();
  assert.deepEqual(
    unproven,
    [],
    `these tables are listed as VERIFIED workspace-scoped but no *-tenancy.test.ts pins their SQL — ` +
      `the manifest is promising a proof that does not exist:\n  ${unproven.join("\n  ")}`
  );
});

for (const pin of ORPHAN_PINS) {
  test(`${pin.table}: every statement binds workspace_id (orphan pin — no colocated guard exists)`, () => {
    const src = readFileSync(path.join(libDir, pin.source), "utf8");
    const statements = [...src.matchAll(/`([^`]*)`/g)]
      .map((m) => m[1])
      .filter((s) => new RegExp(`\\b(from|into|update|join)\\s+${pin.table}\\b`, "i").test(s));
    assert.ok(statements.length >= 3, `expected ${pin.table}'s read+write paths in ${pin.source}, found ${statements.length}`);
    for (const sql of statements) {
      if (pin.exempt?.test(sql.replace(/\s+/g, " "))) continue;
      assert.ok(
        bindsWorkspace(sql),
        `a ${pin.table} statement does not BIND workspace_id (mentioning the column is not scoping it):\n${sql.trim().slice(0, 240)}`
      );
    }
  });
}
