// The scorecard arm of `npm run kpi:reasons`, against the schema the APP builds (ensureDb in a
// child process, then rows written into the real interview_sessions table) — so the meter's
// SELECTs are checked against columns that exist.
//
// Three things it pins: a grounded scorecard is a hit AND prints its k of N; a placeholder-only
// scorecard is a miss; a COMPLETED session with no scorecard (what a refused re-score leaves)
// lands in its own 'completed, unscored' bucket — not a hit, not a miss, not dropped.
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
const NODE = ["--import", "./scripts/test-alias-loader.mjs", "--experimental-transform-types", "--disable-warning=ExperimentalWarning"];

function run(args, dbPath) {
  const r = spawnSync(process.execPath, [...NODE, ...args], { cwd: ROOT, env: { ...process.env, KP_DB_PATH: dbPath }, encoding: "utf8" });
  assert.equal(r.status, 0, r.stderr);
  return r.stdout;
}

test("scorecard arm: grounded = hit with k of N, placeholder-only = miss, completed-without-scorecard = unscored bucket", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "kp-reasons-sc-"));
  const dbPath = path.join(dir, "t.sqlite");
  try {
    // Build the app's own schema on the throwaway file.
    run(["--input-type=module", "-e", "const { ensureDb } = await import('./app/_lib/db/core.ts'); ensureDb().close();"], dbPath);
    const db = new Database(dbPath);
    const insert = db.prepare(
      `INSERT INTO interview_sessions (id, provider, mode, status, scorecard_json, created_at) VALUES (?, 'openai', 'candidate', ?, ?, '2026-10-07T10:00:00.000Z')`
    );
    const real = (c) => ({ competency: c, rating: 4, evidence: `I led the ${c} migration myself` });
    const placeholder = (c) => ({ competency: c, rating: 3, evidence: "Not assessed — the transcript does not cover this competency." });
    insert.run("grounded", "completed", JSON.stringify({ recommendation: "advance", ratings: [real("a"), placeholder("b"), placeholder("c")] }));
    insert.run("empty", "completed", JSON.stringify({ recommendation: "hold", ratings: [placeholder("a"), placeholder("b")] }));
    insert.run("refused", "completed", null); // a completed session whose scorecard was refused
    insert.run("refused-2", "completed", null);
    insert.run("live", "live", null); // not completed: not an unscored scorecard
    db.close();

    const out = JSON.parse(run(["scripts/kpi/reasons-coverage.mjs", "--json"], dbPath));
    assert.equal(out.byKind.scorecard.checked, 2, "only rows that carry a scorecard are checked");
    assert.equal(out.byKind.scorecard.withReasons, 1, "the grounded one is a hit, the placeholder-only one a miss");
    assert.ok(out.misses.some((m) => m.id === "interview:empty" && /placeholder/.test(m.why)));
    assert.equal(out.completedUnscored, 2, "completed sessions with no scorecard get their own bucket");
    assert.deepEqual(out.scorecardAxes, { assessed: 1, axes: 5 });
    assert.deepEqual(out.scorecardFractions.find((f) => f.id === "interview:grounded"), { id: "interview:grounded", assessed: 1, axes: 3 });

    const text = run(["scripts/kpi/reasons-coverage.mjs"], dbPath);
    assert.match(text, /completed, unscored: 2/);
    assert.match(text, /interview:grounded: 1 of 3 axes/);
    assert.match(text, /1 of 5 axes with real evidence/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
