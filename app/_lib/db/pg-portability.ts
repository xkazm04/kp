// SQL-portability audit for the Postgres migration (E-SH-3, docs/architecture/postgres-backend.md).
//
// Scans the data layer for the SQLite-specific constructs that need a dialect tweak
// when porting to Postgres. This is NOT run in the request path — it's a living
// checklist so the eventual migration knows exactly what to touch, and so a
// newly-added SQLite-ism shows up here instead of being discovered at migration time.
//
// IMPORTANT framing: the audit below confirms the DIALECT surface is small. The real
// blocker for Postgres is the sync→async DB API (better-sqlite3 is synchronous;
// node-postgres is not), NOT the SQL. See docs/architecture/postgres-backend.md.

import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

export type PortabilityFinding = { file: string; line: number; text: string };
export type PortabilityCategory = {
  key: string;
  title: string;
  /** What porting this construct to Postgres involves. */
  fix: string;
  findings: PortabilityFinding[];
};

const RULES: { key: string; title: string; fix: string; pattern: RegExp }[] = [
  {
    key: "autoincrement",
    title: "AUTOINCREMENT",
    fix: "→ Postgres GENERATED ALWAYS AS IDENTITY (or BIGSERIAL).",
    pattern: /AUTOINCREMENT/i,
  },
  {
    key: "insert_or_ignore",
    title: "INSERT OR IGNORE",
    fix: "→ INSERT … ON CONFLICT DO NOTHING.",
    pattern: /INSERT\s+OR\s+IGNORE/i,
  },
  {
    key: "insert_or_replace",
    title: "INSERT OR REPLACE",
    fix: "→ INSERT … ON CONFLICT (cols) DO UPDATE SET … (explicit upsert).",
    pattern: /INSERT\s+OR\s+REPLACE/i,
  },
  {
    key: "on_conflict",
    title: "ON CONFLICT (verify target)",
    fix: "Postgres requires an explicit conflict target (columns/constraint); SQLite lets you omit it. Audit each clause.",
    pattern: /ON\s+CONFLICT/i,
  },
  {
    key: "pragma",
    title: ".pragma() / PRAGMA",
    fix: "SQLite-only (WAL / foreign_keys / busy_timeout). Drop, or map to connection/pool settings. The `pragma_*()` TABLE-VALUED form (pragma_table_info in scripts/db-dump.mjs) is a schema query — Postgres answers it from information_schema / pg_catalog instead.",
    // The third alternative catches the table-valued form — `SELECT … FROM
    // pragma_table_info('t')` — which db-dump.mjs uses to enumerate every column of every
    // table. Neither `.pragma(` nor `PRAGMA ` matches it, so the dump script's one hard
    // dependency on SQLite's schema introspection went unlisted.
    pattern: /\.pragma\s*\(|\bPRAGMA\s|\bpragma_[a-z_]+\s*\(/i,
  },
  {
    key: "sync_txn",
    title: "db.transaction() — SYNCHRONOUS",
    fix: "better-sqlite3's sync transaction wrapper → async BEGIN/COMMIT. This IS the sync→async blocker.",
    pattern: /\.transaction\s*\(/,
  },
  // bug-ui-scan-2026-07-09 (data-store-persistence #4): the audit under-reported — these
  // SQLite-isms exist in the data layer but had no rule, so the checklist declared a clean
  // surface it didn't have (e.g. prunePromptCache's `WHERE rowid IN (…)` has no Postgres
  // equivalent). Add rules so a missed construct fails the pg-portability test instead of
  // being discovered at migration time.
  {
    key: "rowid",
    title: "rowid (implicit SQLite row key)",
    fix: "Postgres has NO implicit rowid. `WHERE rowid IN (SELECT rowid …)` (prunePromptCache) must use an explicit surrogate PK; ctid exists but is NOT stable across VACUUM.",
    pattern: /\browid\b/i,
  },
  {
    key: "json_fn",
    title: "SQLite JSON functions (json_*)",
    fix: "json_extract / json_group_array / json_object / json_each → Postgres jsonb operators (->, ->>, jsonb_agg, jsonb_build_object) + a jsonb column type.",
    pattern: /\bjson_[a-z]+\s*\(/i,
  },
  {
    key: "datetime_fn",
    title: "SQLite date/time functions (strftime / datetime / julianday)",
    fix: "strftime / datetime / julianday / unixepoch → Postgres to_char / date_trunc / EXTRACT / to_timestamp (different names + format codes).",
    pattern: /\b(strftime|julianday|unixepoch)\s*\(|\bdatetime\s*\(/i,
  },
  {
    key: "without_rowid",
    title: "WITHOUT ROWID table",
    fix: "A SQLite storage tweak with no Postgres equivalent — drop the clause (Postgres always has a heap + PK index).",
    pattern: /WITHOUT\s+ROWID/i,
  },
  // NOTE: INTEGER-as-boolean columns (0/1 stored in an INTEGER) also need a Postgres
  // BOOLEAN tweak, but there is no reliable text pattern (INTEGER is ubiquitous and
  // legitimate) — audit those by hand from the schema, not via this checklist.
];

/** A source file this audit reads: the TypeScript data layer, plus the `.mjs` operator
 *  scripts that carry their OWN SQL and pragmas (see auditRoots). Tests and THIS audit
 *  module are skipped — the latter's rule literals would self-match. */
function isAuditable(full: string): boolean {
  if (full.endsWith(".test.ts") || full.endsWith(".test.mjs")) return false;
  if (full.includes("pg-portability")) return false;
  return full.endsWith(".ts") || full.endsWith(".mjs");
}

/** Collect auditable files under `entry`, which may be a directory OR a single file. */
function walkSourceFiles(entry: string, acc: string[] = []): string[] {
  if (!statSync(entry).isDirectory()) {
    if (isAuditable(entry)) acc.push(entry);
    return acc;
  }
  for (const name of readdirSync(entry)) walkSourceFiles(path.join(entry, name), acc);
  return acc;
}

/**
 * The roots a full audit covers, resolved against the repo root.
 *
 * `app/_lib` alone was never the whole data layer: `scripts/db-dump.mjs` and
 * `scripts/db-load.mjs` ARE the operator's backup/restore path, and they hold their own
 * SQL and their own pragmas (`pragma_table_info`, `journal_mode = WAL`, `busy_timeout`,
 * and a synchronous `db.transaction()` wrapping the entire load — the sync→async blocker
 * again, outside the app). Those are exactly the constructs this checklist exists to
 * enumerate, so leaving them unscanned let the audit report a smaller dialect surface than
 * the deployment has: a port that migrated every app store but left the dump/load tooling
 * speaking SQLite is discovered on the day someone tries to restore a backup.
 *
 * Named FILES rather than all of `scripts/`: the rest of that tree is build, release and
 * docs tooling that never opens the store, and sweeping it in would bury the real findings.
 */
export function auditRoots(repoRoot: string): string[] {
  return [
    path.join(repoRoot, "app", "_lib"),
    path.join(repoRoot, "scripts", "db-dump.mjs"),
    path.join(repoRoot, "scripts", "db-load.mjs"),
  ];
}

/**
 * Scan one or more roots (each a directory or a single file) for SQLite-isms, grouped by
 * category.
 *
 * `base` is what finding paths are reported relative to. Pass the repo root when auditing
 * several roots, so `app/_lib/db/core.ts` and `scripts/db-load.mjs` stay distinguishable;
 * it defaults to the root itself for a single root, preserving the original
 * `app/_lib`-relative output.
 */
export function auditPgPortability(roots: string | string[], base?: string): PortabilityCategory[] {
  const rootList = Array.isArray(roots) ? roots : [roots];
  const relBase = base ?? (rootList.length === 1 ? rootList[0] : process.cwd());
  const categories: PortabilityCategory[] = RULES.map((r) => ({
    key: r.key,
    title: r.title,
    fix: r.fix,
    findings: [],
  }));
  for (const file of rootList.flatMap((root) => walkSourceFiles(root))) {
    const rel = path.relative(relBase, file).replace(/\\/g, "/");
    const lines = readFileSync(file, "utf8").split(/\r?\n/);
    lines.forEach((line, i) => {
      RULES.forEach((rule, r) => {
        if (rule.pattern.test(line)) {
          categories[r].findings.push({ file: rel, line: i + 1, text: line.trim().slice(0, 120) });
        }
      });
    });
  }
  return categories;
}
