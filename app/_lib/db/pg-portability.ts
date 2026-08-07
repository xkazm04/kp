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
