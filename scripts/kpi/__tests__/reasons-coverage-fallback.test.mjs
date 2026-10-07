// The analysis arm of `npm run kpi:reasons` refuses the pipeline's template fallback:
// a stored analysis whose payload carries an `explanation_fallback` trust finding has
// no model-written reasons, so it is a named miss even though its explanation is non-blank.
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

test("a stored analysis carrying the explanation_fallback marker is a miss on the analysis arm", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "kp-reasons-fb-"));
  const dbPath = path.join(dir, "t.sqlite");
  try {
    const db = new Database(dbPath);
    db.exec(`CREATE TABLE analyses (slug TEXT PRIMARY KEY, payload_json TEXT)`);
    const ins = db.prepare(`INSERT INTO analyses VALUES (?, ?)`);
    ins.run("real", JSON.stringify({ explanation: "Strong Go evidence.", trustFindings: [] }));
    ins.run("tmpl", JSON.stringify({ explanation: "Ada was assessed as senior. Score 70/100.", trustFindings: [{ code: "explanation_fallback", severity: "warn", scope: "insight", text: "x" }] }));
    ins.run("tmpl-summary", JSON.stringify({ explanation: "Template.", jobFit: { summary: "Matches Go." }, trustFindings: [{ code: "explanation_fallback" }] }));
    db.close();
    const out = runMeter(dbPath);
    assert.deepEqual(
      { checked: out.rankingBySource.analysis.checked, hit: out.rankingBySource.analysis.withReasons },
      { checked: 3, hit: 2 }
    );
    const miss = out.misses.filter((m) => m.id.startsWith("analysis:"));
    assert.deepEqual(miss.map((m) => m.id), ["analysis:tmpl"]);
    assert.match(miss[0].why, /template fallback explanation only/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
