import { test } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { auditPgPortability, auditRoots } from "./pg-portability.ts";

// The audit is a living checklist for the Postgres migration (E-SH-3). This test
// keeps it honest: it must actually find the SQLite-isms that exist in the data
// layer today, and every finding must be locatable. Deliberately NOT asserting exact
// counts — those drift as the schema grows; that drift is the point of the tool.
test("pg-portability audit finds the known SQLite-isms in app/_lib", () => {
  const categories = auditPgPortability(path.resolve(process.cwd(), "app", "_lib"));
  const count = Object.fromEntries(categories.map((c) => [c.key, c.findings.length]));

  assert.ok(count.autoincrement > 0, "expected AUTOINCREMENT sites in the schema");
  assert.ok(count.on_conflict > 0, "expected ON CONFLICT sites");
  assert.ok(count.sync_txn > 0, "expected synchronous db.transaction() sites (the blocker)");

  // bug-ui-scan-2026-07-09 (data-store-persistence #4): the audit previously had no rowid
  // rule, so it declared a clean surface while prunePromptCache's `WHERE rowid IN (…)` — a
  // construct Postgres has no equivalent for — went unflagged. Pin the known SQLite-ism so
  // a future rule regression (or a re-introduced un-audited rowid use) fails CI here.
  assert.ok(count.rowid > 0, "expected a rowid SQLite-ism (prunePromptCache) — Postgres has no rowid");
  const rowid = categories.find((c) => c.key === "rowid");
  assert.ok(rowid, "the rowid category must exist");
  assert.ok(
    rowid!.findings.some((f) => /(^|\/)core\.ts$/.test(f.file) && /rowid/i.test(f.text)),
    "the prunePromptCache rowid line in db/core.ts must be flagged"
  );

  // Every finding is locatable and every category carries a Postgres fix note.
  for (const category of categories) {
    assert.ok(category.fix.length > 0, `category ${category.key} needs a fix note`);
    for (const finding of category.findings) {
      assert.ok(finding.file && finding.line > 0, "finding must have file:line");
    }
  }
});

// The audit's ROOTS, not just its rules. `app/_lib` was the only thing ever scanned, so
// the two operator scripts that hold their own SQL and pragmas — scripts/db-dump.mjs and
// scripts/db-load.mjs, the backup/restore path an operator actually runs — contributed
// nothing to the checklist. The audit therefore reported a smaller dialect surface than
// the deployment has, and the sync `db.transaction()` wrapping the whole load (the
// documented sync→async blocker, outside the app) was invisible to it.
test("the audit scans the operator db scripts, not only app/_lib", () => {
  const repoRoot = process.cwd();
  const categories = auditPgPortability(auditRoots(repoRoot), repoRoot);
  const files = new Set(categories.flatMap((c) => c.findings.map((f) => f.file)));

  assert.ok(
    [...files].some((f) => /(^|\/)app\/_lib\/db\/core\.ts$/.test(f)),
    "the app data layer is still scanned, and findings are now repo-root-relative"
  );
  assert.ok(files.has("scripts/db-load.mjs"), "scripts/db-load.mjs must be scanned — it holds pragmas and a sync transaction");
  assert.ok(files.has("scripts/db-dump.mjs"), "scripts/db-dump.mjs must be scanned — it reads pragma_table_info");

  const pragma = categories.find((c) => c.key === "pragma");
  assert.ok(pragma, "the pragma category must exist");
  assert.ok(
    pragma!.findings.some((f) => f.file === "scripts/db-load.mjs"),
    "db-load's journal_mode/busy_timeout pragmas are flagged"
  );
  const syncTxn = categories.find((c) => c.key === "sync_txn");
  assert.ok(
    syncTxn!.findings.some((f) => f.file === "scripts/db-load.mjs"),
    "db-load wraps the whole restore in a SYNCHRONOUS db.transaction() — the blocker, outside the app"
  );

  // The scripts add findings; they must never REPLACE the app ones. A regression that
  // pointed the audit at scripts/ alone would still satisfy every assertion above.
  const appOnly = auditPgPortability(path.resolve(repoRoot, "app", "_lib"));
  const total = (cats: typeof categories) => cats.reduce((n, c) => n + c.findings.length, 0);
  assert.ok(
    total(categories) > total(appOnly),
    "the wider roots strictly ADD to the checklist rather than narrowing it"
  );
});

// Tests are excluded from the audit under BOTH extensions — a rule literal inside a
// *.test.mjs would otherwise be counted as a real dialect site the moment .mjs scanning
// was switched on.
test("test files are never counted as dialect sites", () => {
  const repoRoot = process.cwd();
  const categories = auditPgPortability(auditRoots(repoRoot), repoRoot);
  for (const category of categories) {
    for (const finding of category.findings) {
      assert.doesNotMatch(finding.file, /\.test\.(ts|mjs)$/, `${finding.file} is a test and must not be audited`);
      assert.doesNotMatch(finding.file, /pg-portability/, "the audit module must not self-match");
    }
  }
});
