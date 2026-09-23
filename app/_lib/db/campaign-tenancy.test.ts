import { test, after } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import Database from "better-sqlite3";
// IMPORT ORDER IS LOAD-BEARING: unit-db must precede any module that reaches db-path.
import { cleanupUnitDb, UNIT_DB_PATH } from "../testing/unit-db.ts";
import { ensureDb } from "./core.ts";
import { getCampaignPack, saveCampaignPack } from "./campaign.ts";

after(() => cleanupUnitDb());

// Tenant scope (E0 Phase 1) — source guard for campaign_packs (same shape as
// jds-tenancy.test.ts). Every SQL statement touching the table must filter/stamp
// workspace_id, so a future unscoped query fails CI instead of leaking a team's
// generated campaign packs across tenants.
const src = readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), "campaign.ts"), "utf8");
const sqlBlocks = [...src.matchAll(/`([^`]*)`/g)].map((m) => m[1]);

test("every campaign_packs query is workspace-scoped", () => {
  const touching = sqlBlocks.filter((s) => /\b(from|into|update)\s+campaign_packs\b/i.test(s));
  assert.ok(touching.length >= 2, `expected >=2 campaign_packs queries, found ${touching.length}`);
  for (const sql of touching) {
    assert.ok(/workspace_id/.test(sql), `a campaign_packs query is NOT workspace-scoped:\n${sql.trim().slice(0, 200)}`);
  }
});

// ---------------------------------------------------------------------------
// The key. campaign_packs was keyed (job_id, lang); workspace_id was ALTERed in later
// and was not part of it. So the upsert's `WHERE campaign_packs.workspace_id =
// excluded.workspace_id` guard (which correctly protects the FIRST team's pack) also
// blocked the SECOND team's INSERT — SQLite reports that as 0 changes, not an error,
// and the store threw rather than lie. Reachable on any shared corpus job (workspace_id
// NULL — ~100 seeded roles every tenant can open the Campaign tab on). The key is now
// (job_id, lang, workspace_id), and tenant-keys.test.ts keeps every scoped table there.
// ---------------------------------------------------------------------------

const holder = globalThis as typeof globalThis & { __kpDb?: { close(): void } };
function reboot(): Database.Database {
  holder.__kpDb?.close();
  holder.__kpDb = undefined;
  return ensureDb();
}
function packKey(db: Pick<Database.Database, "prepare">): string[] {
  return (db.prepare(`PRAGMA table_info(campaign_packs)`).all() as { name: string; pk: number }[])
    .filter((c) => c.pk > 0)
    .sort((a, b) => a.pk - b.pk)
    .map((c) => c.name);
}
function rootpage(db: Database.Database): number {
  return (db.prepare(`SELECT rootpage FROM sqlite_master WHERE type = 'table' AND name = 'campaign_packs'`).get() as {
    rootpage: number;
  }).rootpage;
}
const LEGACY_ROW = `('job-legacy', 'cs', '{"warnings":["no_salary"]}', 'deterministic', '2024-01-01T00:00:00.000Z')`;

// MUST run first: it plants a pre-widening table in this file's DB before ensureDb
// ever opens it.
test("a legacy (job_id, lang)-keyed table boots widened with its row intact, once — and a restored old-key table is widened again", () => {
  const legacy = new Database(UNIT_DB_PATH);
  legacy.exec(`
    CREATE TABLE campaign_packs (
      job_id TEXT NOT NULL, lang TEXT NOT NULL, payload_json TEXT NOT NULL,
      source TEXT NOT NULL, created_at TEXT NOT NULL, PRIMARY KEY (job_id, lang)
    );
    INSERT INTO campaign_packs (job_id, lang, payload_json, source, created_at) VALUES ${LEGACY_ROW};
  `);
  legacy.close();

  const db = reboot();
  assert.deepEqual(packKey(db), ["job_id", "lang", "workspace_id"], "the legacy key was not widened at boot");
  assert.deepEqual(getCampaignPack("job-legacy", "cs", "workspace")?.payload, { warnings: ["no_salary"] }, "the legacy row did not survive the rebuild");
  const indexes = (db.prepare(`PRAGMA index_list(campaign_packs)`).all() as { name: string }[]).map((i) => i.name);
  assert.ok(indexes.includes("idx_campaign_packs_workspace"), "the rebuild dropped the per-team scan index");

  // A second boot reads the widened PRIMARY KEY and leaves the table alone: a rebuild
  // would create a new b-tree, so the root page is the witness.
  const page = rootpage(db);
  assert.equal(rootpage(reboot()), page, "a second boot rebuilt an already-widened table");

  // A dump taken from an older image restores the OLD key (db-load re-runs the dump's
  // DDL). The guard reads the key's shape, not a column's presence — workspace_id is
  // already there — so the next boot widens it again.
  holder.__kpDb?.close();
  holder.__kpDb = undefined;
  const restored = new Database(UNIT_DB_PATH);
  restored.exec(`
    DROP TABLE campaign_packs;
    CREATE TABLE campaign_packs (
      job_id TEXT NOT NULL, lang TEXT NOT NULL, payload_json TEXT NOT NULL,
      source TEXT NOT NULL, created_at TEXT NOT NULL,
      workspace_id TEXT NOT NULL DEFAULT 'workspace', PRIMARY KEY (job_id, lang)
    );
    INSERT INTO campaign_packs (job_id, lang, payload_json, source, created_at) VALUES ${LEGACY_ROW};
  `);
  restored.close();
  const again = reboot();
  assert.deepEqual(packKey(again), ["job_id", "lang", "workspace_id"], "a restored old-key table was not re-widened");
  assert.equal((again.prepare(`SELECT COUNT(*) AS n FROM campaign_packs`).get() as { n: number }).n, 1);
});

// Fixtures are REAL packs: getCampaignPack validates the column against
// campaignPackSchema (app/_lib/schemas.ts), so a bare string where a variant belongs
// no longer decodes — covered in campaign-store.test.ts.
const pack = (hook: string) => ({
  variants: [{ hookType: "number", hook, adCopy: `${hook} copy`, videoScript: { hook, offer: "o", proof: "p", cta: "c" } }],
});

test("two teams each keep their own pack for the same shared (job, lang)", () => {
  saveCampaignPack("job-shared-corpus", "en", pack("alpha"), "llm", "ws-a");
  saveCampaignPack("job-shared-corpus", "en", pack("beta"), "llm", "ws-b");
  assert.deepEqual(getCampaignPack("job-shared-corpus", "en", "ws-a")?.payload, pack("alpha"));
  assert.deepEqual(getCampaignPack("job-shared-corpus", "en", "ws-b")?.payload, pack("beta"));
});

test("a same-team regenerate overwrites in place and leaves the other team's pack untouched", () => {
  saveCampaignPack("job-shared-corpus", "en", pack("alpha-v2"), "llm", "ws-a");
  assert.deepEqual(getCampaignPack("job-shared-corpus", "en", "ws-a")?.payload, pack("alpha-v2"));
  assert.deepEqual(getCampaignPack("job-shared-corpus", "en", "ws-b")?.payload, pack("beta"));
  const n = ensureDb()
    .prepare(`SELECT COUNT(*) AS n FROM campaign_packs WHERE job_id = 'job-shared-corpus' AND lang = 'en'`)
    .get() as { n: number };
  assert.equal(n.n, 2, "a regenerate must replace the team's row, not add one");
});

test("the upsert names no conflict target, so the SAME statement works against the legacy and the widened key", () => {
  const upsert = sqlBlocks.find((s) => /INSERT INTO campaign_packs/i.test(s));
  assert.ok(upsert, "saveCampaignPack's INSERT was not found");
  assert.match(upsert, /ON CONFLICT DO UPDATE/i, "the upsert must be target-less");
  assert.doesNotMatch(upsert, /ON CONFLICT\s*\(\s*job_id\s*,\s*lang\s*\)/i, "ON CONFLICT(job_id, lang) throws against the widened key");
  assert.match(upsert, /WHERE campaign_packs\.workspace_id = excluded\.workspace_id/, "the foreign-row guard must stay");

  const run = (db: Database.Database, ws: string, payload: string) =>
    db.prepare(upsert).run("job-x", "en", payload, "llm", "2024-01-01T00:00:00.000Z", ws).changes;
  const COLS = `job_id TEXT NOT NULL, lang TEXT NOT NULL, payload_json TEXT NOT NULL, source TEXT NOT NULL, created_at TEXT NOT NULL, workspace_id TEXT NOT NULL DEFAULT 'workspace'`;

  // Widened key: both teams insert, a same-team write updates.
  const wide = new Database(":memory:");
  wide.exec(`CREATE TABLE campaign_packs (${COLS}, PRIMARY KEY (job_id, lang, workspace_id))`);
  assert.deepEqual([run(wide, "ws-a", "a1"), run(wide, "ws-b", "b1"), run(wide, "ws-a", "a2")], [1, 1, 1]);
  assert.equal((wide.prepare(`SELECT COUNT(*) AS n FROM campaign_packs`).get() as { n: number }).n, 2);
  wide.close();

  // Legacy key (a partial rollout, or the image rolled back): the same-team path still
  // works and the foreign row is still refused rather than overwritten.
  const narrow = new Database(":memory:");
  narrow.exec(`CREATE TABLE campaign_packs (${COLS}, PRIMARY KEY (job_id, lang))`);
  assert.deepEqual([run(narrow, "ws-a", "a1"), run(narrow, "ws-a", "a2"), run(narrow, "ws-b", "b1")], [1, 1, 0]);
  assert.equal((narrow.prepare(`SELECT payload_json AS p FROM campaign_packs`).get() as { p: string }).p, "a2");
  narrow.close();
});
