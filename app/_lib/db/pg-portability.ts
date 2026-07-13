// SQL-portability audit for the Postgres migration (E-SH-3, docs/POSTGRES_BACKEND.md).
//
// Scans the data layer for the SQLite-specific constructs that need a dialect tweak
// when porting to Postgres. This is NOT run in the request path — it's a living
// checklist so the eventual migration knows exactly what to touch, and so a
// newly-added SQLite-ism shows up here instead of being discovered at migration time.
//
// IMPORTANT framing: the audit below confirms the DIALECT surface is small. The real
// blocker for Postgres is the sync→async DB API (better-sqlite3 is synchronous;
// node-postgres is not), NOT the SQL. See docs/POSTGRES_BACKEND.md.

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
    fix: "SQLite-only (WAL / foreign_keys / busy_timeout). Drop, or map to connection/pool settings.",
    pattern: /\.pragma\s*\(|\bPRAGMA\s/i,
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

function walkTsFiles(dir: string, acc: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) {
      walkTsFiles(full, acc);
      continue;
    }
    // Skip tests and THIS audit module (its rule literals would self-match).
    if (!full.endsWith(".ts")) continue;
    if (full.endsWith(".test.ts")) continue;
    if (full.includes("pg-portability")) continue;
    acc.push(full);
  }
  return acc;
}

/** Scan `root` (typically app/_lib) for SQLite-isms, grouped by category. */
export function auditPgPortability(root: string): PortabilityCategory[] {
  const categories: PortabilityCategory[] = RULES.map((r) => ({
    key: r.key,
    title: r.title,
    fix: r.fix,
    findings: [],
  }));
  for (const file of walkTsFiles(root)) {
    const rel = path.relative(root, file).replace(/\\/g, "/");
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
