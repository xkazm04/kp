// billing_alerts.resolution — the additive migration behind the alert reader's
// resolve door (challenge-r05 billing-plan-and-spend/A).
//
// A resolution without a KIND cannot tell a real fix from noise dismissed, so the
// table gains a nullable `resolution` ('fixed' | 'dismissed'). The dangerous DB is the
// one created BEFORE the column and already carrying resolved rows: the ALTER must
// reach it, and those rows must keep their resolved_at with resolution NULL — "we do
// not know how it ended" is the honest reading of a row closed before anyone asked.
//
// The legacy table is created at the isolated KP_DB_PATH BEFORE core.ts first opens
// it, so ensureDb() meets an existing billing_alerts and has to migrate, not create.
// unit-db.ts must stay the first project import (isolated throwaway DB).
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync } from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import { cleanupUnitDb, UNIT_DB_PATH } from "../testing/unit-db.ts";

after(() => cleanupUnitDb());

mkdirSync(path.dirname(UNIT_DB_PATH), { recursive: true });
const legacy = new Database(UNIT_DB_PATH);
legacy.exec(`
  CREATE TABLE billing_alerts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    org_id TEXT NOT NULL DEFAULT 'org-default',
    kind TEXT NOT NULL,
    detail TEXT NOT NULL,
    provider_ref TEXT,
    created_at TEXT NOT NULL,
    resolved_at TEXT
  );
  INSERT INTO billing_alerts (org_id, kind, detail, provider_ref, created_at, resolved_at)
    VALUES ('org-default', 'unmapped_product', 'legacy closed', 'sub_old', '2026-01-01T00:00:00.000Z', '2026-01-02T00:00:00.000Z');
  INSERT INTO billing_alerts (org_id, kind, detail, provider_ref, created_at, resolved_at)
    VALUES ('org-default', 'price_drift', 'legacy open', 'prod_old', '2026-01-03T00:00:00.000Z', NULL);
`);
legacy.close();

const { ensureDb } = await import("./core.ts");

test("a pre-change DB boots, gains a nullable billing_alerts.resolution, and keeps its closed rows", () => {
  const db = ensureDb();
  const cols = db.prepare(`PRAGMA table_info(billing_alerts)`).all() as Array<{ name: string; notnull: number; dflt_value: unknown }>;
  const resolution = cols.find((c) => c.name === "resolution");
  assert.ok(resolution, "the ALTER reached the existing table");
  assert.equal(resolution.notnull, 0, "nullable: a legacy closure has no recorded kind");
  assert.equal(resolution.dflt_value, null, "no default — a guessed 'fixed' would be a lie");

  const rows = db.prepare(`SELECT kind, resolved_at, resolution FROM billing_alerts ORDER BY id`).all() as Array<Record<string, unknown>>;
  assert.deepEqual(rows, [
    { kind: "unmapped_product", resolved_at: "2026-01-02T00:00:00.000Z", resolution: null },
    { kind: "price_drift", resolved_at: null, resolution: null },
  ]);
});
