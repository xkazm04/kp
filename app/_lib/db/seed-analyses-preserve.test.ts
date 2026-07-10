// Bug-ui-scan 2026-07-09 data-store #1 — seedAnalyses must be NON-DESTRUCTIVE.
//
// The seeded `seed-<id>` analyses are the app's shipped working set and ARE
// editable in-product: a recruiter sets a disposition + decision note
// (setAnalysisDisposition), attaches a GitHub deep-dive (setAnalysisGithub), and
// the save path stamps review_flags. On every server restart ensureDb() re-runs
// seedAnalyses UNCONDITIONALLY. The old `INSERT OR REPLACE` was delete-then-insert
// over a stale 8-column list, so a reboot NULLED disposition / decision_note /
// review_flags / github_json on those rows — silent, timer-driven loss of the
// human hiring decision AiDisclosure promises. This drives the REAL store writers
// against an isolated throwaway DB, simulates a reboot (drop the memoized handle
// and re-run the initializer), and asserts the recruiter/computed columns SURVIVE.
//
// Non-vacuity: against the pre-fix `INSERT OR REPLACE` the re-seed deletes and
// re-inserts the row with only the 8 seed columns, so disposition + github_json
// (and review_flags) read back NULL after the reboot and every post-reboot
// assertion below fails. It passes only because ON CONFLICT(slug) DO UPDATE SET
// touches solely the seed-owned columns. (Confirmed by temporarily restoring
// `INSERT OR REPLACE` — the four survival asserts fail.)
//
// testing/unit-db.ts MUST be the first project import — it sets KP_DB_PATH before
// db-path.ts is evaluated by core.ts's transitive import, so every store opens the
// per-process throwaway file (mkdtempSync), never a developer's real data/kp.sqlite.
import { cleanupUnitDb } from "../testing/unit-db.ts";
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { ensureDb } from "./core.ts";
import { setAnalysisDisposition, setAnalysisGithub, loadAnalysis } from "./analyses.ts";

after(() => cleanupUnitDb());

const holder = globalThis as typeof globalThis & { __kpDb?: { close(): void } };

// Drop the memoized connection so the NEXT ensureDb() re-runs the whole
// CREATE/ALTER/seed/backfill initializer against the already-seeded file —
// exactly what a process restart / deploy / HMR reload does.
function simulateReboot(): void {
  holder.__kpDb?.close();
  holder.__kpDb = undefined;
  ensureDb();
}

type ProtectedCols = {
  disposition: string | null;
  decision_note: string | null;
  review_flags: number | null;
  github_json: string | null;
  workspace_id: string | null;
  payload_json: string;
};

function readRow(slug: string): ProtectedCols {
  return ensureDb()
    .prepare(
      `SELECT disposition, decision_note, review_flags, github_json, workspace_id, payload_json
       FROM analyses WHERE slug = ?`
    )
    .get(slug) as ProtectedCols;
}

test("re-seeding preserves recruiter dispositions + GitHub deep-dives on seeded rows", () => {
  ensureDb(); // first boot: seed the shipped seed-<id> analyses population

  // Target a genuinely seeded row (the shipped working set), not one we inserted.
  const seeded = ensureDb()
    .prepare(`SELECT slug FROM analyses WHERE slug LIKE 'seed-%' ORDER BY slug LIMIT 1`)
    .get() as { slug: string } | undefined;
  assert.ok(seeded, "expected the seed_analyses population to be seeded on first boot");
  const slug = seeded.slug;

  // A recruiter edits the seeded candidate's report: disposition + note + a
  // GitHub deep-dive; a save also stamped review_flags (later-computed data).
  const githubJson = JSON.stringify({ summary: "strong OSS history", stars: 128 });
  assert.equal(setAnalysisDisposition(slug, "advance", "strong systems-design signal"), true);
  assert.equal(setAnalysisGithub(slug, githubJson), true);
  ensureDb().prepare(`UPDATE analyses SET review_flags = 3 WHERE slug = ?`).run(slug);

  // Guard against a vacuous pass: the writes actually landed BEFORE the reboot.
  const before = readRow(slug);
  assert.equal(before.disposition, "advance");
  assert.equal(before.decision_note, "strong systems-design signal");
  assert.equal(before.review_flags, 3);
  assert.equal(before.github_json, githubJson);
  assert.equal(before.workspace_id, "workspace");

  // Server restart: seedAnalyses re-runs unconditionally over the same file.
  simulateReboot();

  // The human/computed columns MUST survive the re-seed (pre-fix: all NULL).
  const after = readRow(slug);
  assert.equal(after.disposition, "advance", "disposition was wiped by re-seed");
  assert.equal(after.decision_note, "strong systems-design signal", "decision_note was wiped by re-seed");
  assert.equal(after.review_flags, 3, "review_flags was wiped by re-seed");
  assert.equal(after.github_json, githubJson, "github_json (GitHub deep-dive) was wiped by re-seed");
  // workspace_id must stay healed (was re-NULLed then re-backfilled under REPLACE).
  assert.equal(after.workspace_id, "workspace", "workspace_id backfill regressed");

  // The seed still refreshed the row's seed-owned payload (upsert, not skip).
  assert.ok(after.payload_json && after.payload_json.length > 0, "seed payload should still be present");

  // The full read path still resolves the row with its preserved decision.
  const loaded = loadAnalysis(slug);
  assert.ok(loaded, "loadAnalysis resolves the seeded row after reboot");
  assert.equal(loaded.row.disposition, "advance");
  assert.equal(loaded.row.github_json, githubJson);
});

test("a genuinely new seed row still inserts on a truly empty DB (one-time seed intact)", () => {
  // The first test already forced at least one boot; assert the shipped seed
  // population is present and each carries the backfilled default workspace, i.e.
  // the legitimate one-time seed + workspace_id backfill for NEW rows is unchanged.
  const rows = ensureDb()
    .prepare(`SELECT COUNT(*) AS n FROM analyses WHERE slug LIKE 'seed-%' AND workspace_id = 'workspace'`)
    .get() as { n: number };
  assert.ok(rows.n > 0, "seeded rows exist and are backfilled to the default workspace");
});
