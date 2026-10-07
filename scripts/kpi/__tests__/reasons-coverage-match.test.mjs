// The ranking arm of `npm run kpi:reasons` sees Match rankings through their SEALED
// verdict (ADR 0018): a pipeline entry filed with source_channel 'match' is a ranking
// whose reasons are the newest `match_verdict` record keyed by its id, resolved through
// the shared renderer. An entry with no record is legacy — bucketed by whether its gate
// slot still holds the old prose, and never counted in the headline.
//
// The tables here are the minimum the meter selects; app/_lib/kpi-reasons-meter.test.ts
// runs the same meter against the schema the app itself builds.
//
//   node scripts/run-unit-tests.mjs "scripts/kpi/**/*.test.mjs"
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import Database from "better-sqlite3";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..");

function runMeter(dbPath, extra = []) {
  const r = spawnSync(
    process.execPath,
    ["--import", "./scripts/test-alias-loader.mjs", "--experimental-transform-types", "--disable-warning=ExperimentalWarning", "scripts/kpi/reasons-coverage.mjs", ...extra],
    { cwd: ROOT, env: { ...process.env, KP_DB_PATH: dbPath }, encoding: "utf8" }
  );
  assert.equal(r.status, 0, r.stderr);
  return r.stdout;
}

const FACTS = {
  fitTier: "strong",
  best: { labelCode: "skills", percent: 82 },
  worst: { labelCode: "career", percent: 40 },
  matched: ["Java"],
  unproven: [],
  missing: ["Rust"],
  matchScore: 71,
  scorerVersion: "match-scorer.v1",
};

test("match-filed entries: a sealed verdict that renders is a hit, a silent one a named miss, legacy rows are bucketed and not counted", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "kp-reasons-"));
  const dbPath = path.join(dir, "t.sqlite");
  try {
    const db = new Database(dbPath);
    db.exec(`CREATE TABLE pipeline_entries (id TEXT PRIMARY KEY, source_channel TEXT, approval_detail TEXT)`);
    db.exec(
      `CREATE TABLE decision_records (seq INTEGER PRIMARY KEY AUTOINCREMENT, candidate_ref TEXT, kind TEXT, reason_code TEXT, payload_json TEXT, created_at TEXT)`
    );
    const entry = db.prepare(`INSERT INTO pipeline_entries VALUES (?, ?, ?)`);
    const seal = db.prepare(`INSERT INTO decision_records (candidate_ref, kind, reason_code, payload_json, created_at) VALUES (?, ?, ?, ?, ?)`);
    const verdict = (ref, facts) => seal.run(ref, "match_verdict", "match_fit", JSON.stringify({ inputs: facts }), "2026-10-07T10:00:00.000Z");
    entry.run("sealed", "match", null); // accepted since: the slot is cleared, the record is not
    verdict("sealed", FACTS);
    entry.run("silent", "match", null);
    verdict("silent", { ...FACTS, best: null, worst: null, matched: [], missing: [] });
    entry.run("readded", "match", null);
    verdict("readded", { ...FACTS, best: null, worst: null, matched: [], missing: [] }); // older add, says nothing
    verdict("readded", FACTS); // newest add — the one that counts
    entry.run("prose", "match", JSON.stringify({ summary: "Strong fit.", strengths: [], redFlags: [] }));
    entry.run("cleared", "match", null);
    entry.run("apply", "apply", null); // not a Match ranking — must not be counted
    db.close();

    const out = JSON.parse(runMeter(dbPath, ["--json"]));
    assert.deepEqual(
      { checked: out.rankingBySource.match.checked, hit: out.rankingBySource.match.withReasons },
      { checked: 3, hit: 2 },
      "only the three sealed entries are in the arm"
    );
    const miss = out.misses.filter((m) => m.id.startsWith("match:"));
    assert.deepEqual(miss.map((m) => m.id), ["match:silent"]);
    assert.match(miss[0].why, /neither a dimension nor a skill name/);
    assert.deepEqual(out.legacyMatch, { legacy_prose_snapshot: 1, legacy_snapshot_cleared: 1 });
    assert.equal(out.rankingBySource.analysis.measured, false, "an empty source stays 'not measured'");
    assert.equal(out.rankingBySource.analysis.ratio, null);

    const text = runMeter(dbPath);
    assert.match(text, /legacy prose snapshot \(not counted\)\s+1/);
    assert.match(text, /legacy, snapshot cleared before the record existed \(not counted\)\s+1/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
