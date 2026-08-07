import { test } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { auditPgPortability } from "./pg-portability.ts";

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
