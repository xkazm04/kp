// SQL-portability audit for the SQLite → Postgres migration (docs/architecture/postgres-backend.md).
// Prints every SQLite-specific construct in the data layer, grouped, with file:line
// and the Postgres equivalent — the checklist a migration engineer works from.
//
//   npm run db:pg-audit
//
// Runs through the TS transform loader (see the package.json script) so it can import
// the shared audit module the test also uses.
import path from "node:path";
import { auditPgPortability, auditRoots } from "@/app/_lib/db/pg-portability.ts";

// auditRoots() owns WHICH trees are the data layer: app/_lib plus the two operator
// scripts (db-dump / db-load) that carry their own SQL and pragmas. Scanning app/_lib
// alone understated the surface, and the backup/restore path is exactly where a missed
// SQLite-ism surfaces last. Findings are reported relative to the repo root so an
// app/_lib finding and a scripts/ finding stay distinguishable.
const repoRoot = process.cwd();
const roots = auditRoots(repoRoot);
const categories = auditPgPortability(roots, repoRoot);

console.log("SQL-portability audit — SQLite → Postgres (docs/architecture/postgres-backend.md)");
console.log(`Scanned: ${roots.map((r) => path.relative(repoRoot, r).replace(/\\/g, "/")).join(", ")}\n`);

let total = 0;
for (const category of categories) {
  total += category.findings.length;
  console.log(`## ${category.title} — ${category.findings.length} site(s)`);
  console.log(`   fix: ${category.fix}`);
  for (const finding of category.findings.slice(0, 10)) {
    console.log(`   ${finding.file}:${finding.line}`);
  }
  if (category.findings.length > 10) console.log(`   … +${category.findings.length - 10} more`);
  console.log("");
}

console.log(`Total dialect sites: ${total}.`);
console.log("NOTE: the real Postgres blocker is the sync→async DB API (better-sqlite3 is");
console.log("synchronous; node-postgres is not), NOT this SQL. See docs/architecture/postgres-backend.md.");
