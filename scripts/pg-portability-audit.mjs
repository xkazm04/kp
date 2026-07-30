// SQL-portability audit for the SQLite → Postgres migration (docs/architecture/postgres-backend.md).
// Prints every SQLite-specific construct in the data layer, grouped, with file:line
// and the Postgres equivalent — the checklist a migration engineer works from.
//
//   npm run db:pg-audit
//
// Runs through the TS transform loader (see the package.json script) so it can import
// the shared audit module the test also uses.
import path from "node:path";
import { auditPgPortability } from "@/app/_lib/db/pg-portability.ts";

const root = path.resolve(process.cwd(), "app", "_lib");
const categories = auditPgPortability(root);

console.log("SQL-portability audit — SQLite → Postgres (docs/architecture/postgres-backend.md)");
console.log(`Scanned: ${path.relative(process.cwd(), root).replace(/\\/g, "/")}\n`);

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
