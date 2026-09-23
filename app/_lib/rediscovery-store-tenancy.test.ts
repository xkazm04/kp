// Behavioral tenancy pins for the rediscovery store seam (direction 1). The source
// guards (rediscovery-tenancy.test.ts / campaign-tenancy.test.ts) assert the SQL is
// workspace-scoped; this drives the REAL modules against a throwaway SQLite file to
// pin that the three reads the callers were mis-threading actually ISOLATE by tenant:
//   - candidateOutcomes(workspaceId)      — prior-outcome labels for pickPrior
//   - record/listRediscoveryAlerts(ws)    — the standing silver-medalist feed
//   - save/getCampaignPack(ws)            — the per-job campaign pack
// so rediscovery in a non-default workspace can't read/write another tenant's rows.
//
// Runner: Node's built-in test runner with type stripping (no extra deps).
//   npm run test:unit
import { test, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { registerHooks } from "node:module";
import { fileURLToPath } from "node:url";
import Database from "better-sqlite3";

// db.ts transitively imports the "@/*" alias, extensionless TS siblings, and JSON
// files without an import attribute — none of which bare `node --test` resolves on
// its own. Same minimal hooks the other real-module tests use (rematch-source.test.ts).
const ROOT = new URL("../../", import.meta.url).href; // repo root (app/_lib/ -> ../../)
registerHooks({
  resolve(specifier, context, nextResolve) {
    let spec = specifier;
    if (spec.startsWith("@/")) spec = new URL(spec.slice(2), ROOT).href; // tsconfig "@/*"
    else if (
      (spec.startsWith("./") || spec.startsWith("../")) &&
      context.parentURL &&
      // Only rewrite OUR relative TS imports — never a dependency's internal relative
      // requires (better-sqlite3's `./database` etc.), which must resolve as plain CJS.
      !context.parentURL.includes("node_modules")
    ) {
      spec = new URL(spec, context.parentURL).href; // relative -> file: so we can test for .ts
    }
    if (spec.startsWith("file:") && !/\.[a-z0-9]+$/i.test(spec) && fs.existsSync(fileURLToPath(spec + ".ts"))) {
      spec += ".ts"; // extensionless import, e.g. "./pipeline-status"
    }
    return nextResolve(spec, context);
  },
  load(url, context, nextLoad) {
    if (url.endsWith(".json")) {
      const source = "export default " + fs.readFileSync(fileURLToPath(url), "utf8") + ";";
      return { format: "module", source, shortCircuit: true };
    }
    return nextLoad(url, context);
  },
});

// Point every store connection at a throwaway DB BEFORE importing them: db-path reads
// KP_DB_PATH at module load (DB_PATH is frozen then), so this MUST stay the first
// project import.
//
// It used to be a hand-rolled `os.tmpdir()/kp-rediscovery-store-tenancy-${process.pid}.sqlite`.
// `--test-isolation=process` gives each FILE a fresh process, but the OS RECYCLES pids:
// a later run drawing a pid this file used before re-opens that run's leftover database
// and inherits another run's cross-tenant rows (see 7c63692, the billing-suite flake). unit-db.ts is the
// repo-wide fix: a mkdtemp'd run directory (unique by construction, never pid-derived),
// a liveness-gated sweep of abandoned dirs, and cleanupUnitDb().
const { cleanupUnitDb, UNIT_DB_PATH } = await import("./testing/unit-db.ts");

const DEFAULT_WS = "workspace";
const WS_B = "team-beta";

const { createPipelineEntry, candidateOutcomes, saveCampaignPack, getCampaignPack } = await import("./db.ts");
const { recordRediscoveryAlerts, listRediscoveryAlerts, dismissRediscoveryAlert } = await import(
  "./rediscovery-alert-store.ts"
);

// Closes the memoized main connection and removes this run's temp dir; a still-open
// isolated handle only means the fixture's sweep reclaims the dir on a later run.
after(cleanupUnitDb);

test("candidateOutcomes isolates prior pipeline history by workspace", () => {
  // A candidate rejected from a role in team-beta only.
  const { entry } = createPipelineEntry({
    candidateId: "cand-onlyB",
    candidateLabel: "Cand Only B",
    jobId: "jobB1",
    jobTitle: "Beta Role",
    stage: "Screened",
    workspaceId: WS_B,
  });
  assert.ok(entry.id);

  // Read from team-beta: the outcome is there.
  assert.ok(candidateOutcomes(WS_B).has("cand-onlyB"), "team-beta sees its own candidate's history");
  // Read from the DEFAULT tenant (what an unscoped call resolves to): NOT visible —
  // the exact leak direction 1 fixes (pickPrior would otherwise read the wrong tenant).
  assert.equal(candidateOutcomes(DEFAULT_WS).has("cand-onlyB"), false, "default tenant does NOT see team-beta history");
});

// MUST run before any other test touches the rediscovery store: it plants the
// pre-migration table + index in this file's DB, so the store's first open migrates it.
//
// The alert key used to be UNIQUE (job_id, candidate_id) with no workspace_id — the key
// shape tenant-keys.test.ts forbids on a team-scoped table. Stated plainly: that
// collision is NOT reachable through the real writer today. recordRediscoveryAlerts'
// only caller (rediscover.ts) draws candidate ids from buildCandidatePool(workspaceId),
// and those ids (analyses.slug, profiles.id) are globally-unique PKs owned by ONE team,
// so two teams cannot produce the same (job, candidate) pair. The key is widened anyway
// because it is the key, not the current caller, that decides what a second team's
// write does — and `CREATE UNIQUE INDEX IF NOT EXISTS` under the OLD name would have
// been a silent no-op, so the swap is DROP INDEX IF EXISTS + a new, team-leading index.
test("the store's first open swaps the legacy (job_id, candidate_id) index for one led by workspace_id, keeping the rows", () => {
  const legacy = new Database(UNIT_DB_PATH);
  legacy.exec(`
    CREATE TABLE IF NOT EXISTS rediscovery_alerts (
      id TEXT PRIMARY KEY, job_id TEXT NOT NULL, job_title TEXT NOT NULL,
      candidate_id TEXT NOT NULL, candidate_label TEXT NOT NULL,
      archetype TEXT NOT NULL DEFAULT 'bau', score INTEGER NOT NULL,
      prior_kind TEXT NOT NULL, prior_label TEXT NOT NULL,
      created_at TEXT NOT NULL, dismissed_at TEXT
    );
    CREATE UNIQUE INDEX IF NOT EXISTS ux_rediscovery_alert ON rediscovery_alerts(job_id, candidate_id);
    INSERT INTO rediscovery_alerts (id, job_id, job_title, candidate_id, candidate_label, score, prior_kind, prior_label, created_at)
      VALUES ('ra-legacy', 'job-legacy', 'Legacy Role', 'cand-legacy', 'Cand Legacy', 70, 'rejected', 'Rejected', '2024-01-01T00:00:00.000Z');
  `);
  legacy.close();

  // First touch of the store runs its migration.
  const legacyFeed = listRediscoveryAlerts(DEFAULT_WS);
  assert.ok(legacyFeed.some((a) => a.candidateId === "cand-legacy"), "the legacy alert must survive the index swap");

  const probe = new Database(UNIT_DB_PATH);
  try {
    const unique = (probe.prepare(`PRAGMA index_list(rediscovery_alerts)`).all() as { name: string; unique: number; origin: string }[])
      .filter((i) => i.unique && i.origin !== "pk")
      .map((i) => ({
        name: i.name,
        cols: (probe.prepare(`PRAGMA index_info("${i.name}")`).all() as { seqno: number; name: string }[])
          .sort((a, b) => a.seqno - b.seqno)
          .map((c) => c.name),
      }));
    assert.equal(unique.some((i) => i.name === "ux_rediscovery_alert"), false, "the legacy index must be DROPPED, not shadowed");
    assert.deepEqual(unique.map((i) => i.cols), [["workspace_id", "job_id", "candidate_id"]]);
    // The legacy row landed in the default workspace; the tests below expect its feed empty.
    probe.prepare(`DELETE FROM rediscovery_alerts WHERE id = 'ra-legacy'`).run();
  } finally {
    probe.close();
  }

  // Key-level only (see above: the real writer cannot produce this pair today): the
  // same (job, candidate) is now a separate alert per team, and one team's dismissal
  // stays that team's.
  const row = (candidateId: string) => ({
    candidateId,
    label: "Cand Shared",
    archetype: "bau",
    score: 80,
    prior: { kind: "rejected", label: "Rejected · Z", stage: "Screened", depth: 1 },
  });
  assert.equal(recordRediscoveryAlerts("job-key", "Key Role", [row("cand-key")], "ws-key-a"), 1);
  const a = listRediscoveryAlerts("ws-key-a").find((x) => x.candidateId === "cand-key");
  assert.ok(a && dismissRediscoveryAlert(a.id, "ws-key-a"));
  assert.equal(recordRediscoveryAlerts("job-key", "Key Role", [row("cand-key")], "ws-key-b"), 1);
  assert.ok(listRediscoveryAlerts("ws-key-b").some((x) => x.candidateId === "cand-key"));
  // …and dismissal is still sticky WITHIN a team: a re-sweep re-inserts nothing.
  assert.equal(recordRediscoveryAlerts("job-key", "Key Role", [row("cand-key")], "ws-key-a"), 0);
});

test("rediscovery alerts record + list are isolated by workspace", () => {
  const rows = [
    { candidateId: "cand-B", label: "Cand B", archetype: "bau", score: 78, prior: { kind: "rejected", label: "Rejected · X", stage: "Screened", depth: 1 } },
  ];
  const added = recordRediscoveryAlerts("jobB1", "Beta Role", rows, WS_B);
  assert.equal(added, 1);

  // team-beta reads its alert back…
  const beta = listRediscoveryAlerts(WS_B);
  assert.equal(beta.length, 1);
  assert.equal(beta[0].candidateId, "cand-B");
  // …and the default tenant sees nothing (unscoped list would have leaked it).
  assert.deepEqual(listRediscoveryAlerts(DEFAULT_WS), []);
});

test("dismissing an alert BY ID cannot reach another tenant's row (dismissal is sticky)", () => {
  // The alert id is NOT a capability token: listRediscoveryAlerts hands it to every
  // recruiter in the feed, and dismissal is permanent (the UNIQUE (workspace_id, job_id, candidate_id)
  // index means a later sweep re-INSERTs nothing, so a dismissed row never comes back).
  // An unscoped `WHERE id = ? AND dismissed_at IS NULL` therefore let ANY caller
  // permanently suppress another team's silver medalist.
  recordRediscoveryAlerts(
    "jobB2",
    "Beta Role Two",
    [
      {
        candidateId: "cand-dismiss",
        label: "Cand Dismiss",
        archetype: "bau",
        score: 81,
        prior: { kind: "rejected", label: "Rejected · Y", stage: "Interview", depth: 2 },
      },
    ],
    WS_B
  );
  const target = listRediscoveryAlerts(WS_B).find((a) => a.candidateId === "cand-dismiss");
  assert.ok(target, "team-beta has a standing alert to target");

  // A DEFAULT-tenant caller holding that id must not flip it…
  assert.equal(dismissRediscoveryAlert(target!.id, DEFAULT_WS), false, "a cross-tenant dismiss must report no change");
  assert.ok(
    listRediscoveryAlerts(WS_B).some((a) => a.candidateId === "cand-dismiss"),
    "team-beta's alert must SURVIVE another tenant's dismiss"
  );

  // …while the OWNING tenant still dismisses it (no over-blocking), stickily.
  assert.equal(dismissRediscoveryAlert(target!.id, WS_B), true, "the owning tenant dismisses its own alert");
  assert.equal(
    listRediscoveryAlerts(WS_B).some((a) => a.candidateId === "cand-dismiss"),
    false,
    "the dismissed alert leaves the owner's feed"
  );
  assert.equal(dismissRediscoveryAlert(target!.id, WS_B), false, "already dismissed → no second flip");
});

test("campaign packs save + get are isolated by workspace", () => {
  // A REAL pack: getCampaignPack now reads behind campaignPackSchema (lot JW), and a
  // bare string in `variants` is exactly what it refuses (floor-not-filter -> null).
  const pack = { warnings: ["no_salary"], language: "en" };
  saveCampaignPack("jobB1", "en", pack, "deterministic", WS_B);

  const beta = getCampaignPack("jobB1", "en", WS_B);
  assert.ok(beta, "team-beta reads its own pack");
  assert.deepEqual(beta?.payload, pack);
  // The default tenant has no pack for this job (unscoped get/save would collide).
  assert.equal(getCampaignPack("jobB1", "en", DEFAULT_WS), null);
});
