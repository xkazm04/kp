// The ranking arm of `npm run kpi:reasons` sees Match rankings: a pipeline entry
// filed with source_channel 'match' is a ranking verdict whose reasons are the
// approval_detail summary it carried; one without is a named miss, never skipped.
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

function runMeter(dbPath) {
  const r = spawnSync(
    process.execPath,
    ["--import", "./scripts/test-alias-loader.mjs", "--experimental-transform-types", "--disable-warning=ExperimentalWarning", "scripts/kpi/reasons-coverage.mjs", "--json"],
    { cwd: ROOT, env: { ...process.env, KP_DB_PATH: dbPath }, encoding: "utf8" }
  );
  assert.equal(r.status, 0, r.stderr);
  return JSON.parse(r.stdout);
}

test("match-filed entries are counted per source: a summary is a hit, none is a named miss", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "kp-reasons-"));
  const dbPath = path.join(dir, "t.sqlite");
  try {
    const db = new Database(dbPath);
    db.exec(`CREATE TABLE pipeline_entries (id TEXT PRIMARY KEY, source_channel TEXT, approval_detail TEXT)`);
    const ins = db.prepare(`INSERT INTO pipeline_entries VALUES (?, ?, ?)`);
    ins.run("a", "match", JSON.stringify({ summary: "Strong fit.", strengths: [], redFlags: [] }));
    ins.run("b", "match", null);
    ins.run("c", "apply", null); // not a Match ranking — must not be counted
    db.close();
    const out = runMeter(dbPath);
    assert.deepEqual(
      { checked: out.rankingBySource.match.checked, hit: out.rankingBySource.match.withReasons },
      { checked: 2, hit: 1 }
    );
    const miss = out.misses.filter((m) => m.id.startsWith("match:"));
    assert.deepEqual(miss.map((m) => m.id), ["match:b"]);
    assert.match(miss[0].why, /no parsable reasons summary/);
    assert.equal(out.rankingBySource.analysis.measured, false, "an empty source stays 'not measured'");
    assert.equal(out.rankingBySource.analysis.ratio, null);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
